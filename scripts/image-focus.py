#!/usr/bin/env python3
"""Encuadre de fotos de artistas: dónde están los rostros.

La portada recorta la foto del artista del día en recuadros de proporciones
muy distintas (cuadrado en escritorio, franja alta en el teléfono). Este
detector devuelve la caja que reúne los rostros para que la web los coloque
a la vista sin ajustes a mano por artista.

Modelo: YuNet (OpenCV Zoo, licencia MIT), en scripts/models.

Uso:
    python3 scripts/image-focus.py web/public/media/artist/4292.jpg [...]

Imprime una línea JSON por imagen:
    {"path": ..., "width": 400, "height": 294, "faces": 1,
     "focus": {"x": 0.51, "y": 0.3, "width": 0.27, "height": 0.4}}
`focus` es null si no hay rostros fiables (logos, portadas, paisajes) y
`error` aparece si la imagen no se pudo leer.
"""
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
import cv2  # noqa: E402

MODEL = Path(__file__).resolve().parent / "models" / "face_detection_yunet_2023mar.onnx"
# Lado mayor con el que se analiza: más rápido y suficiente para rostros.
ANALYSIS_SIDE = 640
MIN_SCORE = 0.65
# Fondos hechos con la misma foto ampliada y desenfocada: sus caras son mucho
# menos nítidas (varianza del laplaciano) que las de la foto real.
MIN_RELATIVE_SHARPNESS = 0.1
# Rostros mucho menores que el mayor suelen ser público, carteles o falsos positivos.
MIN_RELATIVE_AREA = 0.2


def sharpness(gray, face) -> float:
    left, top = max(0, int(face[0])), max(0, int(face[1]))
    region = gray[top:top + max(1, int(face[3])), left:left + max(1, int(face[2]))]
    return float(cv2.Laplacian(region, cv2.CV_64F).var()) if region.size else 0.0


def focus_for(path: str, detector) -> dict:
    image = cv2.imread(path)
    if image is None:
        return {"path": path, "error": "imagen ilegible"}
    height, width = image.shape[:2]
    scale = min(1.0, ANALYSIS_SIDE / max(height, width))
    if scale < 1:
        image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    rows, cols = image.shape[:2]
    detector.setInputSize((cols, rows))
    _, found = detector.detect(image)
    faces = [face for face in ([] if found is None else found) if float(face[14]) >= MIN_SCORE]
    if len(faces) > 1:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        scored = [(sharpness(gray, face), face) for face in faces]
        sharpest = max(value for value, _ in scored)
        faces = [face for value, face in scored if value >= sharpest * MIN_RELATIVE_SHARPNESS]
    if faces:
        largest = max(float(face[2] * face[3]) for face in faces)
        faces = [face for face in faces if float(face[2] * face[3]) >= largest * MIN_RELATIVE_AREA]
    result = {"path": path, "width": width, "height": height, "faces": len(faces), "focus": None}
    if faces:
        left = max(0.0, min(float(face[0]) for face in faces))
        top = max(0.0, min(float(face[1]) for face in faces))
        right = min(float(cols), max(float(face[0] + face[2]) for face in faces))
        bottom = min(float(rows), max(float(face[1] + face[3]) for face in faces))
        result["focus"] = {
            "x": round(left / cols, 4), "y": round(top / rows, 4),
            "width": round((right - left) / cols, 4), "height": round((bottom - top) / rows, 4),
        }
    return result


def main(paths: list[str]) -> int:
    if not paths:
        print(__doc__, file=sys.stderr)
        return 2
    detector = cv2.FaceDetectorYN.create(str(MODEL), "", (ANALYSIS_SIDE, ANALYSIS_SIDE), MIN_SCORE, 0.3, 5000)
    for path in paths:
        try:
            line = focus_for(path, detector)
        except cv2.error as error:
            line = {"path": path, "error": str(error).strip().splitlines()[-1]}
        print(json.dumps(line, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
