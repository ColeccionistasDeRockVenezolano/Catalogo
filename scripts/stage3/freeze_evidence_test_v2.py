#!/usr/bin/env python3
"""Congela la prueba reservada de evidencia 2.0.0 (criterios 1.1.0) con la adjudicación de Claude.

Entrada: docs/unified-search/stage3/inputs/evidence-r2/ — muestra estratificada (test-sample.json) de un
lote nuevo (pool-reserved: solo grupos test, sin textos ni grupos de los lotes 0.1.0/0.2.0 ni de la
prueba 1.0.0) anotada por el analista, y las correcciones/exclusiones de la adjudicación por partes.
Salida: docs/unified-search/stage3/datasets/evidence-test-reserved-2.json. Mismas convenciones que la 1.0.0.
"""
import hashlib, json
from pathlib import Path
from freeze_evidence_test import CONVENTIONS

ROOT = Path(__file__).resolve().parents[2]
IN = ROOT / "docs/unified-search/stage3/inputs/evidence-r2"
OUT = ROOT / "docs/unified-search/stage3/datasets/evidence-test-reserved-2.json"
EXTRA_CONVENTIONS = [
    "Una pista concreta citada dentro del objeto es different_object (misma regla que la 1.0.0).",
    "Una pregunta retórica o concesiva sobre un rasgo presente lo afirma; «puede sentirse como» describe la obra (affirmed).",
    "Evocar recuerdos o recomendar escuchar no es actividad: activity_basis = absent.",
    "Valoraciones sin rasgo («gran disco», «bellas», «fabuloso», «50/50») se excluyen de la prueba.",
]


def main():
    d = json.loads((IN / "test-sample.json").read_text())
    fix, drop = {}, {}
    for p in sorted(IN.glob("adjudication-part*.json")):
        a = json.loads(p.read_text())
        fix.update({int(k): v for k, v in a["fix"].items()}); drop.update({int(k): v for k, v in a["drop"].items()})
    drop_x = {int(k): v for k, v in json.loads((IN / "adjudication-extraction.json").read_text())["drop"].items()}
    typed = []
    for i, t in enumerate(d["typed"]):
        if i in drop:
            continue
        gold = {**t["gold"], **fix.get(i, {})}
        typed.append({"id": t["id"], "group": t["group"], "source": t["source"], "constructed": t["constructed"], "review": t["review"], "state": t["state"],
                      "gold": gold, "analyst": t["gold"], "adjudication": "corrected" if i in fix else "confirmed"})
    extraction = [{"id": x["id"], "group": x["group"], "constructed": x["constructed"], "state": x["state"], "options": x["options"], "gold": x["gold"]}
                  for i, x in enumerate(d["extraction"]) if i not in drop_x]
    doc = {"version": "crv-evidence-test-reserved-2.0.0", "frozenAt": "2026-10-25",
           "policy": "Prueba reservada de los criterios 1.1.0: se congela antes de entrenar la versión siguiente y se evalúa una vez por versión.",
           "protocol": {"analyst": "DeepSeek (deepseek-flash), lote pool-reserved (ER-*)", "evaluator": "Claude (adjudicación completa de la muestra)",
                        "conventions": CONVENTIONS + EXTRA_CONVENTIONS, "sample": "todos los casos minoritarios del analista + aleatorio (semilla 11) hasta 120 reales, 40 construidos y 70 extracciones",
                        "excluded": {**{f"typed:{k}": v for k, v in drop.items()}, **{f"extraction:{k}": v for k, v in drop_x.items()}},
                        "inputSha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(IN.glob("*.json"))}},
           "split": "grupos test (huella SHA-256 en el 15 % superior) no usados en lotes anteriores ni en la prueba 1.0.0",
           "typed": typed, "extraction": extraction,
           "counts": {"typed": len(typed), "corrected": sum(t["adjudication"] == "corrected" for t in typed), "extraction": len(extraction)}}
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({**doc["counts"], "sha256": hashlib.sha256(OUT.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
