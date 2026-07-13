"use strict";

const $ = (selector) => document.querySelector(selector);

const state = {
    xmlText: null,
    measureNumbers: [],
    currentIndex: 0,
    totalMeasures: 0,
    tempo: 60,
    playing: false,
    timerId: null,
    animationId: null,
    measureStartedAt: 0,
    measureDurationMs: 4000,
    renderToken: 0,
    loadedInViewers: false,
    timeSignatures: [],
    audioContext: null,
    scheduledClicks: []
};

const baseOptions = {
    autoResize: false,
    backend: "svg",
    drawTitle: false,
    drawSubtitle: false,
    drawComposer: false,
    drawLyricist: false,
    drawCredits: false,
    drawPartNames: false,
    drawMeasureNumbers: false,
    drawingParameters: "compacttight",
    followCursor: false,
    newSystemFromXML: false,
    newPageFromXML: false,
    pageFormat: "Endless",
    renderSingleHorizontalStaffline: true
};

const viewers = {
    past: new opensheetmusicdisplay.OpenSheetMusicDisplay("pastScore", baseOptions),
    present: new opensheetmusicdisplay.OpenSheetMusicDisplay("presentScore", baseOptions),
    future: new opensheetmusicdisplay.OpenSheetMusicDisplay("futureScore", baseOptions)
};

function showMessage(text, timeout = 4500) {
    const box = $("#message");
    box.textContent = text;
    box.classList.remove("hidden");
    window.clearTimeout(box._hideTimer);
    box._hideTimer = window.setTimeout(() => box.classList.add("hidden"), timeout);
}

async function readScoreFile(file) {
    const extension = file.name.split(".").pop().toLowerCase();

    if (extension !== "mxl") {
        return await file.text();
    }

    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    let scorePath = null;

    const containerFile = zip.file("META-INF/container.xml");
    if (containerFile) {
        const containerXml = await containerFile.async("text");
        const containerDoc = new DOMParser().parseFromString(
            containerXml,
            "application/xml"
        );
        const rootfile = containerDoc.querySelector("rootfile");
        scorePath = rootfile?.getAttribute("full-path") || null;
    }

    if (!scorePath) {
        scorePath = Object.keys(zip.files).find(name =>
            !name.startsWith("META-INF/") &&
            (
                name.toLowerCase().endsWith(".musicxml") ||
                name.toLowerCase().endsWith(".xml")
            )
        );
    }

    if (!scorePath || !zip.file(scorePath)) {
        throw new Error(
            "No fue posible encontrar el MusicXML dentro del archivo MXL."
        );
    }

    return await zip.file(scorePath).async("text");
}

function directChildrenByName(node, localName) {
    return [...node.children].filter(child => child.localName === localName);
}

function parseScore(xmlText) {
    const documentXml = new DOMParser().parseFromString(
        xmlText,
        "application/xml"
    );

    if (documentXml.querySelector("parsererror")) {
        throw new Error("El archivo no contiene un MusicXML válido.");
    }

    if (documentXml.documentElement.localName !== "score-partwise") {
        throw new Error(
            "Por ahora el visor admite MusicXML de tipo score-partwise."
        );
    }

    const parts = directChildrenByName(documentXml.documentElement, "part");
    if (!parts.length) {
        throw new Error("La partitura no contiene partes musicales.");
    }

    const firstPartMeasures = directChildrenByName(parts[0], "measure");
    if (!firstPartMeasures.length) {
        throw new Error("La partitura no contiene compases.");
    }

    state.xmlText = xmlText;
    state.totalMeasures = firstPartMeasures.length;
    state.currentIndex = 0;
    state.loadedInViewers = false;
    state.measureNumbers = [];
    state.timeSignatures = [];

    let currentBeats = 4;
    let currentBeatType = 4;

    firstPartMeasures.forEach((measure, index) => {
        const rawNumber = measure.getAttribute("number");
        const parsedNumber = Number.parseInt(rawNumber || "", 10);

        state.measureNumbers.push(
            Number.isFinite(parsedNumber) ? parsedNumber : index + 1
        );

        const attributes = directChildrenByName(measure, "attributes")[0];
        const time = attributes
            ? directChildrenByName(attributes, "time")[0]
            : null;

        if (time) {
            const beatsNode = directChildrenByName(time, "beats")[0];
            const beatTypeNode = directChildrenByName(time, "beat-type")[0];

            const beatsValue = Number.parseInt(
                beatsNode?.textContent || "",
                10
            );
            const beatTypeValue = Number.parseInt(
                beatTypeNode?.textContent || "",
                10
            );

            if (Number.isFinite(beatsValue)) currentBeats = beatsValue;
            if (Number.isFinite(beatTypeValue)) currentBeatType = beatTypeValue;
        }

        state.timeSignatures.push({
            beats: currentBeats,
            beatType: currentBeatType
        });
    });
}

function measureLabel(index) {
    if (index < 0 || index >= state.totalMeasures) return "—";
    return String(state.measureNumbers[index] ?? index + 1);
}

function osmdMeasureNumber(index) {
    /*
     * OSMD trabaja con números de compás. Cuando el XML contiene números
     * no numéricos, usamos la posición natural del compás.
     */
    if (index < 0 || index >= state.totalMeasures) return null;
    return state.measureNumbers[index] ?? index + 1;
}

function currentTimeSignature(index) {
    return state.timeSignatures[index] || { beats: 4, beatType: 4 };
}

function durationForMeasure(index) {
    const { beats, beatType } = currentTimeSignature(index);
    const quarterNotes = beats * (4 / beatType);
    return Math.max(250, quarterNotes * (60000 / state.tempo));
}

async function loadFullScoreInViewers() {
    if (state.loadedInViewers) return;

    await Promise.all(
        Object.values(viewers).map(viewer => viewer.load(state.xmlText))
    );

    state.loadedInViewers = true;
}

function clearViewer(elementId) {
    const element = document.getElementById(elementId);
    element.innerHTML = "";
}

async function renderMeasure(viewer, elementId, index) {
    if (index < 0 || index >= state.totalMeasures) {
        clearViewer(elementId);
        return;
    }

    const number = osmdMeasureNumber(index);

    viewer.setOptions({
        drawFromMeasureNumber: number,
        drawUpToMeasureNumber: number,
        drawMeasureNumbers: false,
        drawTitle: false,
        drawSubtitle: false,
        drawComposer: false,
        drawLyricist: false,
        drawCredits: false,
        drawPartNames: false,
        newSystemFromXML: false,
        newPageFromXML: false,
        pageFormat: "Endless",
        renderSingleHorizontalStaffline: true
    });

    await viewer.render();

    const element = document.getElementById(elementId);
    const svg = element.querySelector("svg");

    if (svg) {
        /*
         * Todos los compases conservan la misma escala vertical.
         * Antes se usaba width: 100%, por lo que un compás corto se
         * agrandaba y uno denso se encogía. Ahora fijamos la altura
         * musical y dejamos que el ancho sea proporcional.
         */
        const uniformHeight = 300;

        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.style.height = `${uniformHeight}px`;
        svg.style.width = "auto";
        svg.style.maxWidth = "none";
        svg.style.maxHeight = "none";
        svg.style.display = "block";
        svg.style.flex = "0 0 auto";

        const osmdPage = svg.parentElement;
        if (osmdPage) {
            osmdPage.style.width = "max-content";
            osmdPage.style.minWidth = "100%";
            osmdPage.style.display = "flex";
            osmdPage.style.alignItems = "center";
            osmdPage.style.justifyContent = "center";
        }

        element.scrollLeft = 0;
    }
}

async function renderWindow() {
    const token = ++state.renderToken;
    const current = state.currentIndex;

    $("#pastNumber").textContent = measureLabel(current - 1);
    $("#presentNumber").textContent = measureLabel(current);
    $("#futureNumber").textContent = measureLabel(current + 1);
    $("#progressText").textContent =
        `Compás ${current + 1} de ${state.totalMeasures}`;

    $("#firstBtn").disabled = current === 0;
    $("#prevBtn").disabled = current === 0;
    $("#nextBtn").disabled = current >= state.totalMeasures - 1;

    try {
        await loadFullScoreInViewers();

        await Promise.all([
            renderMeasure(viewers.past, "pastScore", current - 1),
            renderMeasure(viewers.present, "presentScore", current),
            renderMeasure(viewers.future, "futureScore", current + 1)
        ]);
    } catch (error) {
        console.error("Error real de OSMD:", error);
        showMessage(
            `Error al renderizar: ${error?.message || String(error)}`,
            9000
        );
    }

    if (token !== state.renderToken) return;
    state.measureDurationMs = durationForMeasure(current);
}


async function ensureAudioContext() {
    if (!state.audioContext) {
        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) {
            throw new Error(
                "Este navegador no permite reproducir el metrónomo."
            );
        }

        state.audioContext = new AudioContextClass();
    }

    if (state.audioContext.state === "suspended") {
        await state.audioContext.resume();
    }

    return state.audioContext;
}

function metronomeGain() {
    const raw = Number($("#metronomeVolume")?.value ?? 18);
    /*
     * El control visual va de 0 a 100, pero el volumen real se mantiene
     * deliberadamente bajo para que el clic sea una guía y no moleste.
     */
    return Math.pow(raw / 100, 1.8) * 0.22;
}

function playMetronomeClick(when, accented = false) {
    if (!$("#metronomeToggle")?.checked) return;
    if (!state.audioContext) return;

    const context = state.audioContext;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(
        accented ? 1050 : 760,
        when
    );

    const peak = metronomeGain() * (accented ? 1.28 : 1.0);

    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, peak),
        when + 0.004
    );
    gain.gain.exponentialRampToValueAtTime(
        0.0001,
        when + 0.055
    );

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start(when);
    oscillator.stop(when + 0.065);

    state.scheduledClicks.push(oscillator);

    oscillator.addEventListener("ended", () => {
        state.scheduledClicks = state.scheduledClicks.filter(
            item => item !== oscillator
        );
    });
}

function cancelScheduledClicks() {
    for (const oscillator of state.scheduledClicks) {
        try {
            oscillator.stop();
        } catch (_) {
            // El sonido pudo haber terminado ya.
        }
    }

    state.scheduledClicks = [];
}

async function scheduleMeasureMetronome(index) {
    if (!$("#metronomeToggle")?.checked) return;

    const context = await ensureAudioContext();
    const { beats, beatType } = currentTimeSignature(index);
    const beatDurationSeconds =
        ((60 / state.tempo) * (4 / beatType));

    const firstClickTime = context.currentTime + 0.035;

    for (let beat = 0; beat < Math.max(1, beats); beat++) {
        playMetronomeClick(
            firstClickTime + beat * beatDurationSeconds,
            beat === 0
        );
    }
}

function cancelPlaybackTimer() {
    window.clearTimeout(state.timerId);
    window.cancelAnimationFrame(state.animationId);
    cancelScheduledClicks();
    state.timerId = null;
    state.animationId = null;
}

function updateProgress() {
    if (!state.playing) return;

    const elapsed = performance.now() - state.measureStartedAt;
    const ratio = Math.min(1, elapsed / state.measureDurationMs);
    $("#measureProgress").style.width = `${ratio * 100}%`;

    if (ratio < 1) {
        state.animationId = requestAnimationFrame(updateProgress);
    }
}

async function advanceAfterMeasure() {
    if (!state.playing) return;

    if ($("#loopToggle").checked) {
        await startCurrentMeasure();
        return;
    }

    if (state.currentIndex >= state.totalMeasures - 1) {
        pause();
        $("#measureProgress").style.width = "100%";
        showMessage("Fin de la partitura.");
        return;
    }

    state.currentIndex += 1;
    await renderWindow();
    await startCurrentMeasure();
}

async function startCurrentMeasure() {
    cancelPlaybackTimer();
    state.measureDurationMs = durationForMeasure(state.currentIndex);
    state.measureStartedAt = performance.now();
    $("#measureProgress").style.width = "0%";
    updateProgress();

    try {
        await scheduleMeasureMetronome(state.currentIndex);
    } catch (error) {
        console.error(error);
        showMessage(error?.message || "No se pudo iniciar el metrónomo.");
    }

    state.timerId = window.setTimeout(
        advanceAfterMeasure,
        state.measureDurationMs
    );
}

function pause() {
    state.playing = false;
    cancelPlaybackTimer();
    $("#playBtn").textContent = "▶";
    $("#playBtn").title = "Iniciar";
}

async function runCountIn() {
    const overlay = $("#countIn");
    const { beats, beatType } = currentTimeSignature(state.currentIndex);
    const countBeats = Math.max(1, beats);
    const beatMs = (60000 / state.tempo) * (4 / beatType);

    overlay.classList.remove("hidden");

    try {
        await ensureAudioContext();
    } catch (error) {
        console.error(error);
    }

    for (let count = countBeats; count >= 1; count--) {
        overlay.textContent = String(count);

        if (state.audioContext && $("#metronomeToggle")?.checked) {
            playMetronomeClick(
                state.audioContext.currentTime + 0.01,
                count === countBeats
            );
        }

        await new Promise(resolve => setTimeout(resolve, beatMs));
        if (!state.playing) break;
    }

    overlay.classList.add("hidden");
}

async function play() {
    if (state.playing) {
        pause();
        return;
    }

    try {
        await ensureAudioContext();
    } catch (error) {
        console.error(error);
        showMessage(error?.message || "No se pudo activar el audio.");
    }

    state.playing = true;
    $("#playBtn").textContent = "⏸";
    $("#playBtn").title = "Pausar";

    if ($("#countInToggle").checked) {
        await runCountIn();
    }

    if (state.playing) {
        await startCurrentMeasure();
    }
}

async function goToMeasure(index) {
    pause();
    state.currentIndex = Math.max(
        0,
        Math.min(state.totalMeasures - 1, index)
    );
    $("#measureProgress").style.width = "0%";
    await renderWindow();
}


async function loadScoreFromSource(source, displayName) {
    pause();
    showMessage("Cargando partitura…", 1200);

    try {
        let xmlText;

        if (source instanceof File) {
            xmlText = await readScoreFile(source);
        } else {
            const response = await fetch(source);

            if (!response.ok) {
                throw new Error("No fue posible obtener la partitura guardada.");
            }

            const blob = await response.blob();
            const filename = displayName || "partitura.musicxml";
            const file = new File([blob], filename, { type: blob.type });
            xmlText = await readScoreFile(file);
        }

        parseScore(xmlText);

        Object.values(viewers).forEach(viewer => {
            try {
                viewer.clear();
            } catch (_) {}
        });

        $("#scoreTitle").textContent = displayName || "Partitura";
        $("#welcome").classList.add("hidden");
        $("#practiceArea").classList.remove("hidden");
        $("#controls").classList.remove("hidden");

        await renderWindow();
        showMessage(`Partitura lista: ${state.totalMeasures} compases.`);
    } catch (error) {
        console.error(error);
        showMessage(
            error?.message || "No fue posible abrir la partitura.",
            9000
        );
    }
}

function openLibrary() {
    $("#libraryPanel").classList.add("open");
    $("#panelBackdrop").classList.remove("hidden");
}

function closeLibrary() {
    $("#libraryPanel").classList.remove("open");
    $("#panelBackdrop").classList.add("hidden");
}

function openUploadDialog() {
    $("#uploadDialog").showModal();
}

document.querySelectorAll(".score-select").forEach(button => {
    button.addEventListener("click", async () => {
        const item = button.closest(".score-item");
        closeLibrary();
        await loadScoreFromSource(
            item.dataset.scoreUrl,
            item.dataset.scoreTitle
        );
    });
});

$("#libraryBtn").addEventListener("click", openLibrary);
$("#welcomeLibraryBtn").addEventListener("click", openLibrary);
$("#closeLibraryBtn").addEventListener("click", closeLibrary);
$("#panelBackdrop").addEventListener("click", closeLibrary);

$("#uploadBtn").addEventListener("click", openUploadDialog);
$("#welcomeUploadBtn").addEventListener("click", openUploadDialog);
$("#closeUploadBtn").addEventListener(
    "click",
    () => $("#uploadDialog").close()
);
$("#cancelUploadBtn").addEventListener(
    "click",
    () => $("#uploadDialog").close()
);

$("#playBtn").addEventListener("click", play);
$("#firstBtn").addEventListener("click", () => goToMeasure(0));
$("#prevBtn").addEventListener(
    "click",
    () => goToMeasure(state.currentIndex - 1)
);
$("#nextBtn").addEventListener(
    "click",
    () => goToMeasure(state.currentIndex + 1)
);

$("#tempo").addEventListener("input", event => {
    state.tempo = Number(event.target.value);
    $("#tempoValue").textContent = `${state.tempo} BPM`;

    if (state.playing) {
        startCurrentMeasure();
    } else if (state.xmlText) {
        state.measureDurationMs = durationForMeasure(state.currentIndex);
    }
});


$("#metronomeToggle").addEventListener("change", () => {
    if (!$("#metronomeToggle").checked) {
        cancelScheduledClicks();
        return;
    }

    /*
     * Si se activa mientras la reproducción está en curso, comienza a sonar
     * desde el siguiente compás para no reiniciar ni alterar la lectura.
     */
    showMessage("El metrónomo sonará desde el siguiente compás.", 2200);
});

$("#metronomeVolume").addEventListener("input", event => {
    const value = Number(event.target.value);

    if (value === 0) {
        showMessage("Metrónomo silenciado.", 1600);
    }
});

$("#fullscreenBtn").addEventListener("click", async () => {
    try {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
        } else {
            await document.exitFullscreen();
        }
    } catch {
        showMessage(
            "El navegador no permitió activar la pantalla completa."
        );
    }
});

window.addEventListener("keydown", event => {
    if (!state.xmlText) return;

    if (event.code === "Space") {
        event.preventDefault();
        play();
    } else if (event.code === "ArrowLeft") {
        goToMeasure(state.currentIndex - 1);
    } else if (event.code === "ArrowRight") {
        goToMeasure(state.currentIndex + 1);
    }
});

window.addEventListener("resize", () => {
    if (!state.xmlText) return;

    window.clearTimeout(window._scoreResizeTimer);
    window._scoreResizeTimer = window.setTimeout(renderWindow, 250);
});
