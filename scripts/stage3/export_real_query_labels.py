#!/usr/bin/env python3
"""Exporta las etiquetas humanas de consultas reales al formato de casos de la etapa 3.

Lee el lote (docs/unified-search/stage3/datasets/query-real-labeling-1.json) y
las etiquetas de ingest.search_query_labels de una persona. Escribe dos
archivos con la partición sorteada en el lote antes de etiquetar:
  query-real-human-test-1.json   → prueba de la versión 1.6.0 (no se usa para desarrollar)
  query-real-human-train-1.json  → entrenamiento y desarrollo
Las consultas marcadas «no sé» y las que aún no tienen etiqueta quedan fuera y
se cuentan. La categoría se deriva de la etiqueta para los cortes adversariales.

Uso:
  python3 scripts/stage3/export_real_query_labels.py --labeler "<nombre de operador>" [--require-complete]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATASETS = ROOT / "docs/unified-search/stage3/datasets"
BATCH = DATASETS / "query-real-labeling-1.json"


def category(gold: dict) -> str:
    if gold["status"] in {"clarify", "contradiction", "unsupported", "unrecognized"}:
        return gold["status"]
    if gold["exc"]:
        return "negation"
    if gold["ctx"]:
        return "listener"
    if gold["ent"]:
        return "entity"
    return "partial" if gold["status"] == "partial" else "plain"


def labels(labeler: str) -> list[dict]:
    sql = ("SELECT coalesce(json_agg(json_build_object('item_id',item_id,'batch_version',batch_version,'text_sha256',text_sha256,"
           "'outcome',outcome,'gold',gold,'note',note,'labeled_at',labeled_at)),'[]') FROM ingest.search_query_labels WHERE labeler=:'who'")
    out = subprocess.run(["docker", "exec", "-i", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-At", "-v", f"who={labeler}"],
                         input=sql, check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--labeler", required=True)
    ap.add_argument("--require-complete", action="store_true", help="falla si queda alguna consulta sin etiqueta ni «no sé»")
    args = ap.parse_args()
    batch_bytes = BATCH.read_bytes()
    batch = json.loads(batch_bytes)
    by_id = {r["item_id"]: r for r in labels(args.labeler)}
    out = {"test_real_human": [], "train_real_human": []}
    skipped = missing = stale = 0
    for item in batch["items"]:
        row = by_id.get(item["id"])
        if not row:
            missing += 1
            continue
        if row["text_sha256"] != hashlib.sha256(item["text"].encode()).hexdigest():
            stale += 1
            continue
        if row["outcome"] == "skipped":
            skipped += 1
            continue
        case = {"id": item["id"], "category": category(row["gold"]), "text": item["text"], "gold": row["gold"], "split": item["split"],
                "source": item["source"], "author": f"Consulta real ({item['source']}) · etiqueta humana de {args.labeler}"}
        if row["note"]:
            case["note"] = row["note"]
        out[item["split"]].append(case)
    if args.require_complete and (missing or stale):
        raise SystemExit(f"faltan {missing} etiquetas y {stale} quedaron desfasadas")
    common = {"batch": {"path": str(BATCH.relative_to(ROOT)), "version": batch["version"], "sha256": hashlib.sha256(batch_bytes).hexdigest()},
              "labeler": args.labeler, "exportedAt": date.today().isoformat(),
              "excluded": {"skipped": skipped, "unlabeled": missing, "stale": stale}}
    for split, name, policy in [("test_real_human", "query-real-human-test-1.json", "Prueba de la versión 1.6.0: no se usa para reglas, léxico, umbrales ni entrenamiento."),
                                ("train_real_human", "query-real-human-train-1.json", "Entrenamiento y desarrollo.")]:
        path = DATASETS / name
        path.write_text(json.dumps({"version": f"crv-{name.removesuffix('.json')}.0.0", **common, "policy": policy, "cases": out[split]},
                                   ensure_ascii=False, indent=1) + "\n")
        print(f"{split}: {len(out[split])} casos → {path.relative_to(ROOT)} sha256 {hashlib.sha256(path.read_bytes()).hexdigest()}")
    print(f"fuera: {skipped} «no sé», {missing} sin etiqueta, {stale} desfasadas")


if __name__ == "__main__":
    main()
