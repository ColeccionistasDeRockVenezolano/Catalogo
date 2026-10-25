#!/usr/bin/env python3
"""Exporta el lote de evidencia a tareas de Laya (mismo formato que las consultas).

  evidence_tasks.py <evidence-dir> <out-dir>            train/val/calib desde typed.jsonl y extraction.jsonl
  evidence_tasks.py --reserved <test.json> <out.jsonl>  prueba reservada congelada
  --context pool.jsonl[,pool2.jsonl]   (1.1.0) añade al estado la fuente y ±300 caracteres alrededor de la cita

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


POOL: dict[str, dict] = {}


def with_context(it: dict) -> dict:
    """Estado 1.1.0: el contexto permite decidir si el texto habla de otra obra u homónimo."""
    if not POOL:
        return it["state"]
    rid = it.get("review") or it["id"].split("-C")[0]
    r, q = POOL.get(rid), it["state"].get("quote")
    if not r or not q:
        return it["state"]
    text, i = r["text"], r["text"].find(q)
    a, b = (max(0, i - 300), min(len(text), i + len(q) + 300)) if i >= 0 else (0, 600)
    return {**it["state"], "source": r["source"], "context": ("…" if a else "") + text[a:b] + ("…" if b < len(text) else "")}


def typed_tasks(it: dict) -> list[dict]:
    st = with_context(it)
    return [{"qid": it["id"], "key": k, "family": k, "state": st, "question": {"type": "choice", **Q[k]}, "gold": v, "group": it["group"]}
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
    if "--context" in sys.argv:
        i = sys.argv.index("--context")
        for p in sys.argv[i + 1].split(","):
            POOL.update({json.loads(l)["id"]: json.loads(l) for l in open(p)})
        del sys.argv[i:i + 2]
    if sys.argv[1] == "--reserved":
        doc = json.loads(Path(sys.argv[2]).read_text())
        rows = [t for it in doc["typed"] for t in typed_tasks(it)] + [extraction_task(it) for it in doc["extraction"]]
        write(Path(sys.argv[3]), rows)
        print(json.dumps({"tasks": len(rows)}))
        return
    srcs, out = [Path(x) for x in sys.argv[1].split(",")], Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    typed = [json.loads(l) for src in srcs for l in open(src / "typed.jsonl")]
    extraction = [json.loads(l) for src in srcs for l in open(src / "extraction.jsonl")]
    stats = {}
    for split in ("train", "val", "calib"):
        rows = [t for it in typed if it["split"] == split for t in typed_tasks(it)] + [extraction_task(it) for it in extraction if it["split"] == split]
        write(out / f"tasks-{split}.jsonl", rows)
        stats[split] = len(rows)
    print(json.dumps(stats))


if __name__ == "__main__":
    main()
