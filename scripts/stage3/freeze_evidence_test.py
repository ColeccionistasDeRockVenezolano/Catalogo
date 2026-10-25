#!/usr/bin/env python3
"""Congela la prueba reservada de evidencia (etapa 3) con la adjudicación de Claude como evaluador.

Entrada: muestra estratificada de las obras de la partición test (analista DeepSeek flash). Las
correcciones y exclusiones de abajo son la adjudicación; se registran junto al valor del analista.
Salida: docs/unified-search/stage3/datasets/evidence-test-reserved.json (y su huella en el recibo).
"""
import hashlib, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/unified-search/stage3/datasets/evidence-test-reserved.json"
S, A, P, U = "object_scope", "assertion_state", "support", "activity_basis"
# Índices de la muestra → correcciones de la adjudicación (Claude, 2026-10-25).
FIX = {
    18: {A: "affirmed", P: "supports"}, 23: {A: "affirmed", P: "supports"}, 24: {U: "absent"}, 30: {U: "absent"}, 31: {U: "absent"},
    33: {A: "negated", P: "contradicts"}, 34: {U: "absent"}, 35: {A: "affirmed", P: "supports", U: "absent"}, 38: {A: "affirmed", P: "supports"},
    39: {A: "affirmed", P: "supports"}, 40: {U: "absent"}, 41: {A: "affirmed", P: "supports"}, 44: {U: "absent"}, 46: {A: "affirmed", P: "supports"},
    48: {U: "absent"}, 50: {U: "absent"}, 57: {U: "absent"}, 58: {U: "absent"}, 59: {U: "absent"}, 60: {U: "absent"}, 62: {U: "absent"},
    65: {U: "absent"}, 70: {U: "absent"}, 76: {P: "supports"}, 77: {P: "supports"}, 78: {P: "supports"}, 79: {P: "supports"}, 80: {P: "supports"},
    81: {P: "supports"}, 82: {P: "supports"}, 83: {P: "supports"}, 91: {P: "supports"}, 104: {P: "insufficient"}, 107: {P: "supports"},
    108: {P: "supports"}, 114: {P: "supports"},
}
DROP = {43: "rasgo propuesto sin sentido musical", 49: "objeto dudoso (otra banda citada)", 54: "actividad y soporte indecidibles",
        61: "uso «para gritar» indecidible", 64: "el rasgo no es un rasgo («para escuchar ahora»)", 138: "el rasgo cambiado coincide en parte con la cita",
        154: "el rasgo cambiado coincide en parte con la cita"}
DROP_X = {39: "dos frases sostienen el rasgo", 66: "dos frases sostienen el rasgo"}
CONVENTIONS = [
    "Un rasgo redactado como ausencia («sin clichés», «falta de crudeza», «mucho relleno») se sostiene (supports); contradicts exige que la cita niegue el rasgo propuesto.",
    "Una valoración negativa no es contradicción: «aburrido», «voces que necesitan mejorar» sostienen ese rasgo.",
    "activity_basis distinto de absent exige una actividad de escucha o uso; recomendar oír, comprar o ver un clip no es actividad.",
    "Las puntuaciones («100/100») no sostienen rasgos.",
    "Un texto de otra obra, pista concreta u homónimo es different_object y no sostiene el rasgo del objeto.",
]

def main(sample_path):
    d = json.load(open(sample_path))
    typed = []
    for i, t in enumerate(d["typed"]):
        if i in DROP:
            continue
        gold = {**t["gold"], **FIX.get(i, {})}
        typed.append({"id": t["id"], "group": t["group"], "source": t["source"], "constructed": t["constructed"], "state": t["state"], "gold": gold,
                      "analyst": t["gold"], "adjudication": "corrected" if i in FIX else "confirmed"})
    extraction = [{"id": x["id"], "group": x["group"], "constructed": x["constructed"], "state": x["state"], "options": x["options"], "gold": x["gold"]}
                  for i, x in enumerate(d["extraction"]) if i not in DROP_X]
    doc = {"version": "crv-evidence-test-reserved-1.0.0", "frozenAt": "2026-10-25", "policy": "Prueba reservada: se congela antes de entrenar y se evalúa una vez por versión. Ninguna obra de estas particiones entra en entrenamiento, validación ni calibración.",
           "protocol": {"analyst": "DeepSeek (deepseek-flash), lote crv-evidence-batch-0.1.0", "evaluator": "Claude (adjudicación completa de la muestra)", "conventions": CONVENTIONS,
                        "excluded": {**{f"typed:{k}": v for k, v in DROP.items()}, **{f"extraction:{k}": v for k, v in DROP_X.items()}}},
           "split": "grupos (obra o artista) con huella SHA-256 en el 15 % superior", "typed": typed, "extraction": extraction,
           "counts": {"typed": len(typed), "corrected": sum(t["adjudication"] == "corrected" for t in typed), "extraction": len(extraction)}}
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({**doc["counts"], "sha256": hashlib.sha256(OUT.read_bytes()).hexdigest()}))

if __name__ == "__main__":
    main(sys.argv[1])
