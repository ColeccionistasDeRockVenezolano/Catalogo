#!/usr/bin/env python3
"""Exporta el lote de evidencia a tareas de Laya (mismo formato que las consultas).

  evidence_tasks.py <evidence-dir> <out-dir>            train/val/calib desde typed.jsonl y extraction.jsonl
  evidence_tasks.py --reserved <test.json> <out.jsonl>  prueba reservada congelada

Las decisiones tipadas usan las preguntas de la etapa 2 (crv-knowledge-evidence-questions-v1) sin
cambios, con el estado de `knowledgeModelState`. La extracción pregunta qué frase sostiene el rasgo,
con la opción `none`. Solo se exportan las preguntas que tienen respuesta adjudicada o del analista.
"""
from __future__ import annotations
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
Q = json.loads((ROOT / "docs/unified-search/stage2/laya-evidence-questions.json").read_text())["questions"]
EXTRACTION = {"instructions": "¿Qué frase de la reseña sostiene directamente el rasgo propuesto para el objeto? Elige none si ninguna lo describe; no basta con un tema parecido."}


def typed_tasks(it: dict) -> list[dict]:
    return [{"qid": it["id"], "key": k, "family": k, "state": it["state"], "question": {"type": "choice", **Q[k]}, "gold": v, "group": it["group"]}
            for k, v in it["gold"].items() if k in Q]


def extraction_task(it: dict) -> dict:
    criteria = {f"s{i}": o for i, o in enumerate(it["options"])}
    criteria["none"] = "Ninguna frase sostiene el rasgo propuesto"
    gold = "none" if it["gold"] == "none" else f"s{it['gold']}"
    return {"qid": it["id"], "key": "claim_extraction", "family": "claim_extraction", "state": it["state"],
            "question": {"type": "choice", "instructions": EXTRACTION["instructions"], "criteria": criteria}, "gold": gold, "group": it["group"]}


def write(path: Path, rows: list[dict]):
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def main():
    if sys.argv[1] == "--reserved":
        doc = json.loads(Path(sys.argv[2]).read_text())
        rows = [t for it in doc["typed"] for t in typed_tasks(it)] + [extraction_task(it) for it in doc["extraction"]]
        write(Path(sys.argv[3]), rows)
        print(json.dumps({"tasks": len(rows)}))
        return
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    typed = [json.loads(l) for l in open(src / "typed.jsonl")]
    extraction = [json.loads(l) for l in open(src / "extraction.jsonl")]
    stats = {}
    for split in ("train", "val", "calib"):
        rows = [t for it in typed if it["split"] == split for t in typed_tasks(it)] + [extraction_task(it) for it in extraction if it["split"] == split]
        write(out / f"tasks-{split}.jsonl", rows)
        stats[split] = len(rows)
    print(json.dumps(stats))


if __name__ == "__main__":
    main()
