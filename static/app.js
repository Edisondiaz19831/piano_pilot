"use strict";

const $ = (selector) => document.querySelector(selector);

const state = {
    xmlText: null,
    originalXmlText: null,
    originalScoreTitle: "",
    transposeSemitones: 0,
    spellingPreference: "auto",
    originalKeyInfo: null,
    showNoteNames: false,
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
    scheduledClicks: [],
    measureCache: new Map(),
    measureCachePromises: new Map(),
    cacheRenderQueue: Promise.resolve(),
    cacheViewerLoaded: false
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


const cacheHost = document.createElement("div");
cacheHost.id = "osmdCacheHost";
cacheHost.setAttribute("aria-hidden", "true");
cacheHost.style.position = "fixed";
cacheHost.style.left = "-100000px";
cacheHost.style.top = "0";
cacheHost.style.width = "1400px";
cacheHost.style.height = "900px";
cacheHost.style.overflow = "hidden";
cacheHost.style.pointerEvents = "none";
cacheHost.style.opacity = "0";
document.body.appendChild(cacheHost);

const cacheViewer =
    new opensheetmusicdisplay.OpenSheetMusicDisplay(
        cacheHost,
        baseOptions
    );

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


const STEP_TO_PC = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11
};

const SHARP_SPELLINGS = [
    { step: "C", alter: 0 },
    { step: "C", alter: 1 },
    { step: "D", alter: 0 },
    { step: "D", alter: 1 },
    { step: "E", alter: 0 },
    { step: "F", alter: 0 },
    { step: "F", alter: 1 },
    { step: "G", alter: 0 },
    { step: "G", alter: 1 },
    { step: "A", alter: 0 },
    { step: "A", alter: 1 },
    { step: "B", alter: 0 }
];

const FLAT_SPELLINGS = [
    { step: "C", alter: 0 },
    { step: "D", alter: -1 },
    { step: "D", alter: 0 },
    { step: "E", alter: -1 },
    { step: "E", alter: 0 },
    { step: "F", alter: 0 },
    { step: "G", alter: -1 },
    { step: "G", alter: 0 },
    { step: "A", alter: -1 },
    { step: "A", alter: 0 },
    { step: "B", alter: -1 },
    { step: "B", alter: 0 }
];

const NOTE_NAMES_SHARP = [
    "Do", "Do♯", "Re", "Re♯", "Mi", "Fa",
    "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"
];

const NOTE_NAMES_FLAT = [
    "Do", "Re♭", "Re", "Mi♭", "Mi", "Fa",
    "Sol♭", "Sol", "La♭", "La", "Si♭", "Si"
];

const MAJOR_KEYS = {
    "-7": 11, "-6": 6, "-5": 1, "-4": 8, "-3": 3,
    "-2": 10, "-1": 5, "0": 0, "1": 7, "2": 2,
    "3": 9, "4": 4, "5": 11, "6": 6, "7": 1
};

const MINOR_KEYS = {
    "-7": 8, "-6": 3, "-5": 10, "-4": 5, "-3": 0,
    "-2": 7, "-1": 2, "0": 9, "1": 4, "2": 11,
    "3": 6, "4": 1, "5": 8, "6": 3, "7": 10
};

function normalizePitchClass(value) {
    return ((value % 12) + 12) % 12;
}

function directChild(node, localName) {
    return [...node.children].find(child => child.localName === localName)
        || null;
}

function createMusicXmlElement(documentXml, localName) {
    const namespace = documentXml.documentElement.namespaceURI;
    return namespace
        ? documentXml.createElementNS(namespace, localName)
        : documentXml.createElement(localName);
}

function setOrCreateChildText(parent, localName, value, beforeNode = null) {
    let child = directChild(parent, localName);

    if (!child) {
        child = createMusicXmlElement(parent.ownerDocument, localName);
        if (beforeNode) {
            parent.insertBefore(child, beforeNode);
        } else {
            parent.appendChild(child);
        }
    }

    child.textContent = String(value);
    return child;
}

function removeDirectChildren(parent, localName) {
    directChildrenByName(parent, localName).forEach(child => child.remove());
}

function detectFirstKeyInfo(xmlText) {
    const documentXml = new DOMParser().parseFromString(
        xmlText,
        "application/xml"
    );
    const key = [...documentXml.getElementsByTagName("*")]
        .find(node => node.localName === "key");

    if (!key) return null;

    const fifthsNode = directChild(key, "fifths");
    const modeNode = directChild(key, "mode");
    const fifths = Number.parseInt(fifthsNode?.textContent || "0", 10);
    const mode = (modeNode?.textContent || "major").trim().toLowerCase();

    return {
        fifths: Number.isFinite(fifths) ? fifths : 0,
        mode: mode === "minor" ? "minor" : "major"
    };
}

function keyTonicPitchClass(fifths, mode) {
    const table = mode === "minor" ? MINOR_KEYS : MAJOR_KEYS;
    return table[String(Math.max(-7, Math.min(7, fifths)))] ?? 0;
}

function selectTargetFifths(targetPc, mode, preference) {
    const table = mode === "minor" ? MINOR_KEYS : MAJOR_KEYS;
    const candidates = Object.entries(table)
        .filter(([, pc]) => pc === targetPc)
        .map(([fifths]) => Number(fifths));

    if (!candidates.length) return 0;

    if (preference === "sharp") {
        return [...candidates].sort((a, b) => {
            const aPenalty = a < 0 ? 20 : 0;
            const bPenalty = b < 0 ? 20 : 0;
            return (aPenalty + Math.abs(a)) - (bPenalty + Math.abs(b));
        })[0];
    }

    if (preference === "flat") {
        return [...candidates].sort((a, b) => {
            const aPenalty = a > 0 ? 20 : 0;
            const bPenalty = b > 0 ? 20 : 0;
            return (aPenalty + Math.abs(a)) - (bPenalty + Math.abs(b));
        })[0];
    }

    return [...candidates].sort((a, b) => Math.abs(a) - Math.abs(b))[0];
}

function effectiveSpellingPreference(preference, targetFifths = 0) {
    if (preference === "sharp" || preference === "flat") {
        return preference;
    }

    return targetFifths < 0 ? "flat" : "sharp";
}

function spellingForPitchClass(pc, preference) {
    const table = preference === "flat"
        ? FLAT_SPELLINGS
        : SHARP_SPELLINGS;
    return table[normalizePitchClass(pc)];
}

function transposePitchNode(pitch, semitones, preference) {
    const stepNode = directChild(pitch, "step");
    const alterNode = directChild(pitch, "alter");
    const octaveNode = directChild(pitch, "octave");

    if (!stepNode || !octaveNode) return;

    const step = stepNode.textContent.trim().toUpperCase();
    const alter = Number.parseInt(alterNode?.textContent || "0", 10) || 0;
    const octave = Number.parseInt(octaveNode.textContent || "4", 10);

    if (!(step in STEP_TO_PC) || !Number.isFinite(octave)) return;

    const originalMidi =
        (octave + 1) * 12 + STEP_TO_PC[step] + alter;
    const targetMidi = originalMidi + semitones;
    const targetPc = normalizePitchClass(targetMidi);
    const targetOctave = Math.floor(targetMidi / 12) - 1;
    const spelling = spellingForPitchClass(targetPc, preference);

    stepNode.textContent = spelling.step;
    octaveNode.textContent = String(targetOctave);

    if (spelling.alter === 0) {
        if (alterNode) alterNode.remove();
    } else {
        setOrCreateChildText(
            pitch,
            "alter",
            spelling.alter,
            octaveNode
        );
    }

    const note = pitch.parentElement;
    if (note?.localName === "note") {
        removeDirectChildren(note, "accidental");
    }
}

function transposeHarmonyPitch(container, stepName, alterName, semitones, preference) {
    const stepNode = directChild(container, stepName);
    if (!stepNode) return;

    const alterNode = directChild(container, alterName);
    const step = stepNode.textContent.trim().toUpperCase();
    const alter = Number.parseInt(alterNode?.textContent || "0", 10) || 0;

    if (!(step in STEP_TO_PC)) return;

    const targetPc = normalizePitchClass(
        STEP_TO_PC[step] + alter + semitones
    );
    const spelling = spellingForPitchClass(targetPc, preference);

    stepNode.textContent = spelling.step;

    if (spelling.alter === 0) {
        if (alterNode) alterNode.remove();
    } else {
        setOrCreateChildText(
            container,
            alterName,
            spelling.alter
        );
    }
}


const NOTE_LETTER_NAMES = {
    C: "C",
    D: "D",
    E: "E",
    F: "F",
    G: "G",
    A: "A",
    B: "B"
};

function accidentalText(alter) {
    if (alter === 2) return "𝄪";
    if (alter === 1) return "♯";
    if (alter === -1) return "♭";
    if (alter === -2) return "𝄫";
    if (alter > 2) return "♯".repeat(alter);
    if (alter < -2) return "♭".repeat(Math.abs(alter));
    return "";
}

function spanishNameFromPitch(pitch) {
    const stepNode = directChild(pitch, "step");
    const alterNode = directChild(pitch, "alter");

    if (!stepNode) return "";

    const step = stepNode.textContent.trim().toUpperCase();
    const alter = Number.parseInt(alterNode?.textContent || "0", 10) || 0;

    return `${NOTE_LETTER_NAMES[step] || step}${accidentalText(alter)}`;
}

function removeGeneratedNoteGuides(documentXml) {
    [...documentXml.getElementsByTagName("*")]
        .filter(node =>
            node.localName === "lyric" &&
            node.getAttribute("number") === "99" &&
            node.getAttribute("name") === "Cifrado de notas"
        )
        .forEach(node => node.remove());
}

function addGuideLyric(note, label) {
    if (!label) return;

    const documentXml = note.ownerDocument;
    const lyric = createMusicXmlElement(documentXml, "lyric");
    lyric.setAttribute("number", "99");
    lyric.setAttribute("name", "Cifrado de notas");
    lyric.setAttribute("placement", "below");

    const syllabic = createMusicXmlElement(documentXml, "syllabic");
    syllabic.textContent = "single";

    const text = createMusicXmlElement(documentXml, "text");
    text.textContent = label;

    lyric.appendChild(syllabic);
    lyric.appendChild(text);
    note.appendChild(lyric);
}

function addNoteNameGuides(xmlText) {
    const documentXml = new DOMParser().parseFromString(
        xmlText,
        "application/xml"
    );

    if (documentXml.querySelector("parsererror")) {
        throw new Error(
            "No fue posible interpretar la partitura para mostrar el cifrado."
        );
    }

    removeGeneratedNoteGuides(documentXml);

    /*
     * En MusicXML, un acorde se representa con una nota inicial seguida
     * por notas que contienen <chord/>. Creamos una sola etiqueta
     * combinada, por ejemplo: Do–Mi–Sol, para evitar superposiciones.
     */
    const measures = [...documentXml.getElementsByTagName("*")]
        .filter(node => node.localName === "measure");

    measures.forEach(measure => {
        const notes = directChildrenByName(measure, "note");
        let chordAnchor = null;
        let chordNames = [];

        const flushChord = () => {
            if (chordAnchor && chordNames.length) {
                addGuideLyric(chordAnchor, chordNames.join("–"));
            }
            chordAnchor = null;
            chordNames = [];
        };

        notes.forEach(note => {
            const isRest = Boolean(directChild(note, "rest"));
            const pitch = directChild(note, "pitch");
            const isChordContinuation = Boolean(directChild(note, "chord"));
            const isGrace = Boolean(directChild(note, "grace"));

            if (isRest || !pitch) {
                if (!isChordContinuation) flushChord();
                return;
            }

            const name = spanishNameFromPitch(pitch);

            if (isChordContinuation && chordAnchor) {
                chordNames.push(name);
                return;
            }

            flushChord();
            chordAnchor = note;
            chordNames = [name];

            /*
             * Las notas de adorno también reciben guía, pero forman su
             * propio grupo para no mezclarse con la nota principal.
             */
            if (isGrace) {
                flushChord();
            }
        });

        flushChord();
    });

    return new XMLSerializer().serializeToString(documentXml);
}

function buildDisplayedMusicXml() {
    if (!state.originalXmlText) return null;

    let xmlText = transposeMusicXml(
        state.originalXmlText,
        state.transposeSemitones,
        state.spellingPreference
    );

    if (state.showNoteNames) {
        xmlText = addNoteNameGuides(xmlText);
    }

    return xmlText;
}

function transposeMusicXml(xmlText, semitones, preference = "auto") {
    if (!semitones) return xmlText;

    const documentXml = new DOMParser().parseFromString(
        xmlText,
        "application/xml"
    );

    if (documentXml.querySelector("parsererror")) {
        throw new Error("No fue posible interpretar la partitura para transponer.");
    }

    const keyNodes = [...documentXml.getElementsByTagName("*")]
        .filter(node => node.localName === "key");

    let firstTargetFifths = 0;

    keyNodes.forEach((key, index) => {
        const fifthsNode = directChild(key, "fifths");
        if (!fifthsNode) return;

        const modeNode = directChild(key, "mode");
        const fifths = Number.parseInt(
            fifthsNode.textContent || "0",
            10
        ) || 0;
        const mode = (modeNode?.textContent || "major")
            .trim()
            .toLowerCase() === "minor"
            ? "minor"
            : "major";

        const originalPc = keyTonicPitchClass(fifths, mode);
        const targetPc = normalizePitchClass(originalPc + semitones);
        const targetFifths = selectTargetFifths(
            targetPc,
            mode,
            preference
        );

        fifthsNode.textContent = String(targetFifths);
        if (index === 0) firstTargetFifths = targetFifths;
    });

    const spelling = effectiveSpellingPreference(
        preference,
        firstTargetFifths
    );

    [...documentXml.getElementsByTagName("*")]
        .filter(node => node.localName === "pitch")
        .forEach(pitch => {
            transposePitchNode(pitch, semitones, spelling);
        });

    [...documentXml.getElementsByTagName("*")]
        .filter(node => node.localName === "root")
        .forEach(root => {
            transposeHarmonyPitch(
                root,
                "root-step",
                "root-alter",
                semitones,
                spelling
            );
        });

    [...documentXml.getElementsByTagName("*")]
        .filter(node => node.localName === "bass")
        .forEach(bass => {
            transposeHarmonyPitch(
                bass,
                "bass-step",
                "bass-alter",
                semitones,
                spelling
            );
        });

    return new XMLSerializer().serializeToString(documentXml);
}

function currentKeyDescription() {
    if (!state.originalKeyInfo) {
        if (!state.transposeSemitones) return "Tonalidad original";
        const sign = state.transposeSemitones > 0 ? "+" : "";
        return `${sign}${state.transposeSemitones} semitonos`;
    }

    const originalPc = keyTonicPitchClass(
        state.originalKeyInfo.fifths,
        state.originalKeyInfo.mode
    );
    const targetPc = normalizePitchClass(
        originalPc + state.transposeSemitones
    );

    const preference = state.spellingPreference === "auto"
        ? (
            selectTargetFifths(
                targetPc,
                state.originalKeyInfo.mode,
                "auto"
            ) < 0
                ? "flat"
                : "sharp"
        )
        : state.spellingPreference;

    const tonicName = preference === "flat"
        ? NOTE_NAMES_FLAT[targetPc]
        : NOTE_NAMES_SHARP[targetPc];

    const modeName = state.originalKeyInfo.mode === "minor"
        ? "menor"
        : "mayor";

    if (!state.transposeSemitones) {
        return `${tonicName} ${modeName} · original`;
    }

    const sign = state.transposeSemitones > 0 ? "+" : "";
    return `${tonicName} ${modeName} · ${sign}${state.transposeSemitones}`;
}

function resetRenderState() {
    pause();

    state.cacheViewerLoaded = false;
    state.measureCache.clear();
    state.measureCachePromises.clear();
    state.cacheRenderQueue = Promise.resolve();

    try {
        cacheViewer.clear();
    } catch (_) {}

    cacheHost.innerHTML = "";

    Object.values(viewers).forEach(viewer => {
        try {
            viewer.clear();
        } catch (_) {}
    });
}

async function applyTransposition() {
    if (!state.originalXmlText) return;

    const previousIndex = state.currentIndex;
    resetRenderState();
    showMessage("Aplicando transposición…", 1800);

    try {
        const transformedXml = buildDisplayedMusicXml();

        parseScore(transformedXml);
        state.currentIndex = Math.min(
            previousIndex,
            Math.max(0, state.totalMeasures - 1)
        );

        $("#tonalityBadge").textContent = currentKeyDescription();
        $("#measureProgress").style.width = "0%";

        await renderWindow();
        const guideText = state.showNoteNames
            ? " · cifrado de notas visible"
            : "";

        showMessage(
            state.transposeSemitones === 0
                ? `Tonalidad original${guideText}.`
                : `Transposición aplicada: ${currentKeyDescription()}${guideText}.`,
            3200
        );
    } catch (error) {
        console.error(error);
        showMessage(
            error?.message || "No fue posible transponer la partitura.",
            8000
        );
    }
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
    state.cacheViewerLoaded = false;
    state.measureCache.clear();
    state.measureCachePromises.clear();
    state.cacheRenderQueue = Promise.resolve();
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


async function loadCacheViewer() {
    if (state.cacheViewerLoaded) return;

    await cacheViewer.load(state.xmlText);
    state.cacheViewerLoaded = true;
}

function clearViewer(elementId) {
    const element = document.getElementById(elementId);
    element.innerHTML = "";
    element.scrollLeft = 0;
}

function readSvgNaturalSize(svg) {
    /*
     * OSMD no siempre entrega viewBox. Intentamos, en orden:
     * 1. viewBox
     * 2. atributos width/height
     * 3. propiedades SVG animadas
     * 4. getBBox()
     */
    const viewBox = svg.viewBox?.baseVal;

    if (viewBox?.width > 0 && viewBox?.height > 0) {
        return {
            width: viewBox.width,
            height: viewBox.height
        };
    }

    const parseSvgLength = value => {
        if (!value) return 0;
        const parsed = Number.parseFloat(String(value).replace(",", "."));
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const attributeWidth = parseSvgLength(svg.getAttribute("width"));
    const attributeHeight = parseSvgLength(svg.getAttribute("height"));

    if (attributeWidth > 0 && attributeHeight > 0) {
        return {
            width: attributeWidth,
            height: attributeHeight
        };
    }

    const baseWidth = svg.width?.baseVal?.value || 0;
    const baseHeight = svg.height?.baseVal?.value || 0;

    if (baseWidth > 0 && baseHeight > 0) {
        return {
            width: baseWidth,
            height: baseHeight
        };
    }

    try {
        const box = svg.getBBox();
        if (box.width > 0 && box.height > 0) {
            return {
                width: box.width,
                height: box.height
            };
        }
    } catch (_) {
        // getBBox puede fallar durante el primer frame.
    }

    return null;
}

// Reemplaza la función applyUniformSvgSize con esta versión mejorada
function applyUniformSvgSize(element) {
    const svg = element.querySelector("svg");
    if (!svg) return;

    const container = svg.parentElement;
    if (container) {
        container.style.width = "100%";
        container.style.height = "100%";
        container.style.display = "flex";
        container.style.alignItems = "center";
        container.style.justifyContent = "center";
        container.style.padding = "8px 6px 14px";
        container.style.boxSizing = "border-box";
        container.style.overflow = "visible";
    }

    // Eliminar atributos de tamaño fijo para que el CSS controle el escalado
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    
    svg.style.display = "block";
    svg.style.flex = "0 0 auto";
    svg.style.overflow = "visible";
    svg.style.margin = "0 auto";
    svg.style.maxWidth = "100%";
    svg.style.maxHeight = "100%";
    svg.style.width = "auto";
    svg.style.height = "auto";

    // Forzar redibujado después del render
    requestAnimationFrame(() => {
        // Pequeño retraso para asegurar que el SVG ya está renderizado
        setTimeout(() => {
            // Asegurar que el SVG no se desborde
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                svg.style.maxWidth = `${Math.max(rect.width - 16, 100)}px`;
                svg.style.maxHeight = `${Math.max(rect.height - 20, 100)}px`;
            }
        }, 50);
    });
}
async function buildMeasureCache(index) {
    if (index < 0 || index >= state.totalMeasures) {
        return null;
    }

    if (state.measureCache.has(index)) {
        return state.measureCache.get(index);
    }

    if (state.measureCachePromises.has(index)) {
        return state.measureCachePromises.get(index);
    }

    const promise = state.cacheRenderQueue.then(async () => {
        await loadCacheViewer();

        const number = osmdMeasureNumber(index);

        cacheViewer.setOptions({
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

        await cacheViewer.render();

        const html = cacheHost.innerHTML;
        state.measureCache.set(index, html);
        return html;
    });

    state.cacheRenderQueue = promise.catch(() => {});
    state.measureCachePromises.set(index, promise);

    try {
        return await promise;
    } finally {
        state.measureCachePromises.delete(index);
    }
}

async function showCachedMeasure(elementId, index) {
    if (index < 0 || index >= state.totalMeasures) {
        clearViewer(elementId);
        return;
    }

    const html = await buildMeasureCache(index);
    const element = document.getElementById(elementId);

    element.innerHTML = html || "";
    applyUniformSvgSize(element);
}

function resetPanelScrollPositions() {
    ["pastScore", "presentScore", "futureScore"].forEach(id => {
        const panel = document.getElementById(id);
        if (!panel) return;

        panel.scrollLeft = 0;
        requestAnimationFrame(() => {
            panel.scrollLeft = 0;
        });
    });
}

function preloadMeasure(index) {
    if (
        index < 0 ||
        index >= state.totalMeasures ||
        state.measureCache.has(index) ||
        state.measureCachePromises.has(index)
    ) {
        return;
    }

    const schedule = window.requestIdleCallback
        ? callback => window.requestIdleCallback(callback, { timeout: 800 })
        : callback => window.setTimeout(callback, 30);

    schedule(() => {
        buildMeasureCache(index).catch(error => {
            console.error("No se pudo precargar el compás:", error);
        });
    });
}

function preloadAround(index) {
    preloadMeasure(index + 2);
    preloadMeasure(index + 3);
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
        await Promise.all([
            showCachedMeasure("pastScore", current - 1),
            showCachedMeasure("presentScore", current),
            showCachedMeasure("futureScore", current + 1)
        ]);
    } catch (error) {
        console.error("Error real de OSMD:", error);
        showMessage(
            `Error al renderizar: ${error?.message || String(error)}`,
            9000
        );
    }

    if (token !== state.renderToken) return;

    resetPanelScrollPositions();
    state.measureDurationMs = durationForMeasure(current);
    preloadAround(current);
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
    preloadAround(state.currentIndex);
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

        state.originalXmlText = xmlText;
        state.originalScoreTitle = displayName || "Partitura";
        state.transposeSemitones = 0;
        state.spellingPreference = "auto";
        state.showNoteNames = false;
        state.originalKeyInfo = detectFirstKeyInfo(xmlText);

        $("#transposeSelect").value = "0";
        $("#spellingSelect").value = "auto";
        $("#showNoteNamesToggle").checked = false;
        $("#tonalityBadge").textContent = currentKeyDescription();

        parseScore(buildDisplayedMusicXml());

        Object.values(viewers).forEach(viewer => {
            try {
                viewer.clear();
            } catch (_) {}
        });

        try {
            cacheViewer.clear();
        } catch (_) {}

        cacheHost.innerHTML = "";

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

// ============================================================
//   LOOP DE COMPASES
// ============================================================

const loopState = {
    active: false,
    startIndex: 0,
    endIndex: 2,
    originalLoopEnd: 2
};

function updateLoopUI() {
    const startInput = $("#loopStart");
    const endInput = $("#loopEnd");
    const statusBadge = $("#loopBadge");
    const setBtn = $("#setLoopBtn");
    
    if (loopState.active) {
        statusBadge.className = "loop-badge active";
        statusBadge.innerHTML = `
            🔁 Repitiendo compases 
            <span class="loop-range">${loopState.startIndex + 1} → ${loopState.endIndex + 1}</span>
        `;
        setBtn.textContent = "⏹ Detener loop";
        setBtn.classList.add("active");
        
        // Actualizar inputs para mostrar el rango activo
        startInput.value = loopState.startIndex + 1;
        endInput.value = loopState.endIndex + 1;
    } else {
        statusBadge.className = "loop-badge";
        statusBadge.innerHTML = `⏹ Loop desactivado`;
        setBtn.textContent = "🔁 Activar loop";
        setBtn.classList.remove("active");
    }
}

function validateLoopRange(start, end) {
    if (start < 0 || end >= state.totalMeasures || start > end) {
        return false;
    }
    return true;
}

function setLoop() {
    const startInput = $("#loopStart");
    const endInput = $("#loopEnd");
    
    let start = parseInt(startInput.value) - 1;
    let end = parseInt(endInput.value) - 1;
    
    // Validar que sean números válidos
    if (isNaN(start) || isNaN(end)) {
        showMessage("Por favor, ingresa números de compás válidos.", 3000);
        return;
    }
    
    // Ajustar a índices 0-based
    start = Math.max(0, start);
    end = Math.min(state.totalMeasures - 1, end);
    
    if (!validateLoopRange(start, end)) {
        showMessage(
            `El rango debe ser entre 1 y ${state.totalMeasures}, y el inicio debe ser menor o igual al final.`,
            4000
        );
        return;
    }
    
    // Si el loop ya está activo con el mismo rango, lo desactivamos
    if (loopState.active && 
        loopState.startIndex === start && 
        loopState.endIndex === end) {
        clearLoop();
        return;
    }
    
    // Activar loop
    loopState.active = true;
    loopState.startIndex = start;
    loopState.endIndex = end;
    loopState.originalLoopEnd = end;
    
    // Si el compás actual está fuera del rango, ir al inicio del loop
    if (state.currentIndex < start || state.currentIndex > end) {
        state.currentIndex = start;
        renderWindow();
    }
    
    updateLoopUI();
    showMessage(
        `🔁 Loop activado: compases ${start + 1} → ${end + 1}.`,
        2500
    );
}

function clearLoop() {
    loopState.active = false;
    updateLoopUI();
    showMessage("Loop desactivado.", 1500);
}

function toggleLoop() {
    if (loopState.active) {
        clearLoop();
    } else {
        setLoop();
    }
}

function isInLoopRange(index) {
    if (!loopState.active) return true;
    return index >= loopState.startIndex && index <= loopState.endIndex;
}

function getNextLoopIndex(currentIndex) {
    if (!loopState.active) return currentIndex + 1;
    
    if (currentIndex >= loopState.endIndex) {
        return loopState.startIndex;
    }
    return currentIndex + 1;
}

// Sobrescribir advanceAfterMeasure para soportar loop
const originalAdvanceAfterMeasure = advanceAfterMeasure;

advanceAfterMeasure = async function() {
    if (!state.playing) return;
    
    if (loopState.active) {
        // Estamos en loop: si llegamos al final, volvemos al inicio
        if (state.currentIndex >= loopState.endIndex) {
            state.currentIndex = loopState.startIndex;
            await renderWindow();
            
            // Reproducir desde el inicio del loop
            cancelPlaybackTimer();
            state.measureDurationMs = durationForMeasure(state.currentIndex);
            state.measureStartedAt = performance.now();
            $("#measureProgress").style.width = "0%";
            updateProgress();
            
            try {
                await scheduleMeasureMetronome(state.currentIndex);
            } catch (error) {
                console.error(error);
            }
            
            state.timerId = window.setTimeout(
                advanceAfterMeasure,
                state.measureDurationMs
            );
            return;
        }
    }
    
    // Comportamiento normal: avanzar al siguiente compás
    if (state.currentIndex >= state.totalMeasures - 1) {
        if (loopState.active) {
            // Si estamos en loop y llegamos al final de la partitura, 
            // volvemos al inicio del loop (esto no debería pasar normalmente)
            state.currentIndex = loopState.startIndex;
            await renderWindow();
            await startCurrentMeasure();
        } else {
            pause();
            $("#measureProgress").style.width = "100%";
            showMessage("Fin de la partitura.");
        }
        return;
    }
    
    state.currentIndex += 1;
    await renderWindow();
    await startCurrentMeasure();
};

// Sobrescribir goToMeasure para respetar límites del loop
const originalGoToMeasure = goToMeasure;

goToMeasure = async function(index) {
    pause();
    
    let targetIndex = Math.max(0, Math.min(state.totalMeasures - 1, index));
    
    // Si el loop está activo, limitar la navegación al rango del loop
    if (loopState.active) {
        if (targetIndex < loopState.startIndex) {
            targetIndex = loopState.startIndex;
        } else if (targetIndex > loopState.endIndex) {
            targetIndex = loopState.endIndex;
        }
    }
    
    state.currentIndex = targetIndex;
    $("#measureProgress").style.width = "0%";
    await renderWindow();
};

// Event listeners para loop
$("#setLoopBtn").addEventListener("click", toggleLoop);
$("#clearLoopBtn").addEventListener("click", clearLoop);

// Validar inputs de loop cuando cambian
$("#loopStart").addEventListener("change", function() {
    const maxVal = state.totalMeasures || 1;
    let val = parseInt(this.value) || 1;
    val = Math.max(1, Math.min(maxVal, val));
    this.value = val;
    
    // Si el inicio es mayor que el final, ajustar automáticamente
    const endVal = parseInt($("#loopEnd").value) || 1;
    if (val > endVal) {
        $("#loopEnd").value = Math.min(val, maxVal);
    }
});

$("#loopEnd").addEventListener("change", function() {
    const maxVal = state.totalMeasures || 1;
    let val = parseInt(this.value) || 1;
    val = Math.max(1, Math.min(maxVal, val));
    this.value = val;
    
    // Si el final es menor que el inicio, ajustar automáticamente
    const startVal = parseInt($("#loopStart").value) || 1;
    if (val < startVal) {
        $("#loopStart").value = Math.max(1, val);
    }
});

// Actualizar límites de inputs cuando se carga una partitura
function updateLoopLimits() {
    const maxVal = state.totalMeasures || 1;
    $("#loopStart").max = maxVal;
    $("#loopEnd").max = maxVal;
    $("#loopEnd").value = Math.min(3, maxVal);
    $("#loopStart").value = 1;
    
    // Si el loop estaba activo, desactivarlo al cargar nueva partitura
    if (loopState.active) {
        loopState.active = false;
        updateLoopUI();
    }
}

// Modificar loadScoreFromSource para actualizar límites
// Agregar esta línea al final de la función loadScoreFromSource, 
// después de parseScore pero antes de renderWindow:

// Dentro de loadScoreFromSource, después de parseScore(xmlText):
// updateLoopLimits();

// Para no reescribir toda la función, podemos extenderla:
const originalLoadScore = loadScoreFromSource;

loadScoreFromSource = async function(source, displayName) {
    await originalLoadScore(source, displayName);
    // Después de cargar, actualizar límites del loop
    if (state.totalMeasures > 0) {
        updateLoopLimits();
    }
};

// También actualizar cuando se renderiza la ventana
const originalRenderWindow = renderWindow;

renderWindow = async function() {
    await originalRenderWindow();
    
    // Actualizar progreso si estamos en loop
    if (loopState.active) {
        const startInput = $("#loopStart");
        const endInput = $("#loopEnd");
        startInput.value = loopState.startIndex + 1;
        endInput.value = loopState.endIndex + 1;
        updateLoopUI();
    }
};

// Inicializar UI del loop
updateLoopUI();

// Teclas rápidas para loop
window.addEventListener("keydown", function(event) {
    if (!state.xmlText) return;
    
    // L para activar/desactivar loop
    if (event.key === "l" || event.key === "L") {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            toggleLoop();
        }
    }
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



$("#showNoteNamesToggle").addEventListener("change", async event => {
    state.showNoteNames = Boolean(event.target.checked);

    if (!state.originalXmlText) return;

    await applyTransposition();
});

$("#transposeSelect").addEventListener("change", async event => {
    state.transposeSemitones = Number(event.target.value) || 0;
    await applyTransposition();
});

$("#spellingSelect").addEventListener("change", async event => {
    state.spellingPreference = event.target.value || "auto";

    if (state.transposeSemitones !== 0) {
        await applyTransposition();
    } else {
        $("#tonalityBadge").textContent = currentKeyDescription();
    }
});

$("#resetTransposeBtn").addEventListener("click", async () => {
    $("#transposeSelect").value = "0";
    state.transposeSemitones = 0;
    await applyTransposition();
});

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
    window._scoreResizeTimer = window.setTimeout(() => {
        ["pastScore", "presentScore", "futureScore"].forEach(id => {
            applyUniformSvgSize(document.getElementById(id));
        });
        resetPanelScrollPositions();
    }, 120);
});
