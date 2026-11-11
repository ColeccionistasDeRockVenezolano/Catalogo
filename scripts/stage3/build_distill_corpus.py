#!/usr/bin/env python3
"""Corpus de destilación (1.9.0): consultas musicales del autocompletado público que no están en ningún lote
etiquetado (1–4). Excluye los textos del lote 4 (prueba). Salida: casos sin etiqueta {id,text,source}.

  build_distill_corpus.py --raw <suggestions-raw.jsonl> --out <corpus.json>
"""
from __future__ import annotations
import argparse, hashlib, json
from pathlib import Path

import build_real_query_batch as b

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "docs/unified-search/stage3/datasets"

ap = argparse.ArgumentParser()
ap.add_argument("--raw", required=True, type=Path)
ap.add_argument("--out", required=True, type=Path)
a = ap.parse_args()
vocab = b.vocabulary()
seen = {b.norm(i["text"]) for n in (1, 2, 3, 4) for i in json.loads((DS / f"query-real-labeling-{n}.json").read_text())["items"]}
cases = []
for line in a.raw.read_text().splitlines():
    r = json.loads(line)
    for t in r["suggestions"]:
        k = b.norm(t)
        if k and k not in seen and b.musical(t, vocab):
            seen.add(k)
            cases.append({"id": f"D{len(cases) + 1:05d}", "text": t.strip(), "source": r["client"]})
a.out.write_text(json.dumps({"version": "crv-distill-corpus-1.0.0", "raw": hashlib.sha256(a.raw.read_bytes()).hexdigest(), "cases": cases}, ensure_ascii=False) + "\n")
print(len(cases), "consultas →", a.out)
