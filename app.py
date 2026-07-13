from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import uuid4

from flask import (
    Flask,
    abort,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
INSTANCE_DIR = BASE_DIR / "instance"

UPLOAD_DIR.mkdir(exist_ok=True)
INSTANCE_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {"musicxml", "xml", "mxl"}

app = Flask(__name__, instance_path=str(INSTANCE_DIR))
app.config["SECRET_KEY"] = "cambiar-esta-clave-en-produccion"
app.config["SQLALCHEMY_DATABASE_URI"] = (
    f"sqlite:///{(INSTANCE_DIR / 'biblioteca_musical.db').as_posix()}"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024

db = SQLAlchemy(app)


class Score(db.Model):
    __tablename__ = "score"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(180), nullable=False)
    lesson_number = db.Column(db.Integer, nullable=True)
    exercise_number = db.Column(db.Integer, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    original_filename = db.Column(db.String(255), nullable=False)
    stored_filename = db.Column(db.String(255), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    @property
    def display_order(self) -> str:
        parts = []
        if self.lesson_number is not None:
            parts.append(f"Lección {self.lesson_number}")
        if self.exercise_number is not None:
            parts.append(f"Ejercicio {self.exercise_number}")
        return " · ".join(parts)


def allowed_file(filename: str) -> bool:
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


@app.get("/")
def index():
    scores = (
        Score.query
        .order_by(
            Score.lesson_number.is_(None),
            Score.lesson_number.asc(),
            Score.exercise_number.is_(None),
            Score.exercise_number.asc(),
            Score.title.asc(),
        )
        .all()
    )
    return render_template("index.html", scores=scores)


@app.post("/scores")
def create_score():
    uploaded_file = request.files.get("score_file")
    title = (request.form.get("title") or "").strip()
    notes = (request.form.get("notes") or "").strip() or None

    if not uploaded_file or not uploaded_file.filename:
        flash("Debes seleccionar un archivo MusicXML o MXL.", "error")
        return redirect(url_for("index"))

    if not allowed_file(uploaded_file.filename):
        flash("Solo se permiten archivos .musicxml, .xml o .mxl.", "error")
        return redirect(url_for("index"))

    original_filename = secure_filename(uploaded_file.filename)
    extension = original_filename.rsplit(".", 1)[1].lower()
    stored_filename = f"{uuid4().hex}.{extension}"

    if not title:
        title = Path(original_filename).stem

    def parse_optional_int(field_name: str):
        raw = (request.form.get(field_name) or "").strip()
        if not raw:
            return None
        try:
            return int(raw)
        except ValueError:
            raise ValueError(field_name)

    try:
        lesson_number = parse_optional_int("lesson_number")
        exercise_number = parse_optional_int("exercise_number")
    except ValueError:
        flash("Lección y ejercicio deben ser números enteros.", "error")
        return redirect(url_for("index"))

    target = UPLOAD_DIR / stored_filename

    try:
        uploaded_file.save(target)

        score = Score(
            title=title,
            lesson_number=lesson_number,
            exercise_number=exercise_number,
            notes=notes,
            original_filename=original_filename,
            stored_filename=stored_filename,
        )
        db.session.add(score)
        db.session.commit()
    except Exception:
        db.session.rollback()
        target.unlink(missing_ok=True)
        raise

    flash("Partitura guardada correctamente.", "success")
    return redirect(url_for("index", score_id=score.id))


@app.get("/scores/<int:score_id>/file")
def score_file(score_id: int):
    score = db.get_or_404(Score, score_id)
    return send_from_directory(
        UPLOAD_DIR,
        score.stored_filename,
        as_attachment=False,
        download_name=score.original_filename,
    )


@app.get("/api/scores/<int:score_id>")
def score_info(score_id: int):
    score = db.get_or_404(Score, score_id)
    return jsonify(
        {
            "id": score.id,
            "title": score.title,
            "lesson_number": score.lesson_number,
            "exercise_number": score.exercise_number,
            "notes": score.notes,
            "original_filename": score.original_filename,
            "file_url": url_for("score_file", score_id=score.id),
        }
    )


@app.post("/scores/<int:score_id>/delete")
def delete_score(score_id: int):
    score = db.get_or_404(Score, score_id)
    target = UPLOAD_DIR / score.stored_filename

    db.session.delete(score)
    db.session.commit()
    target.unlink(missing_ok=True)

    flash("Partitura eliminada.", "success")
    return redirect(url_for("index"))


@app.errorhandler(413)
def file_too_large(_error):
    flash("El archivo supera el límite de 20 MB.", "error")
    return redirect(url_for("index"))


with app.app_context():
    db.create_all()




if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)