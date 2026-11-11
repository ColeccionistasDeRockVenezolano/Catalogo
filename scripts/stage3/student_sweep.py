#!/usr/bin/env python3
"""Barrido del umbral de confianza: por debajo se abstiene (unsupported con pendiente, si no unrecognized).
  student_sweep.py <dir con plans-t*.jsonl> [--sets 1 2 3]"""
import json, subprocess, sys, collections
from pathlib import Path
W = Path(sys.argv[1]); sets = sys.argv[2:] or ["1", "2", "3"]
ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "docs/unified-search/stage3/datasets"
def abstain(c):
    c = dict(c); c["status"] = "unsupported" if c["pending"] else "unrecognized"; c["req"] = []; c["ent"] = []
    return c
for tau in [0, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98]:
    tot = collections.Counter(); 
    for n in sets:
        rows = [json.loads(l) for l in (W / f"plans-t{n}.jsonl").read_text().splitlines()]
        out = W / f"sweep-t{n}.jsonl"
        out.write_text("".join(json.dumps({"id": r["id"], "canonical": abstain(r["canonical"]) if r["confidence"] < tau and r["canonical"]["status"] in ("query_valid", "partial", "entity_lookup") else r["canonical"], "ms": r["ms"]}) + "\n" for r in rows))
        subprocess.run(["./scripts/with-node22.sh", "./node_modules/.bin/tsx", "scripts/unified-search-stage3-queries.ts", "plans", str(DS / f"query-real-human-test-{n}.json"), str(out), "--out", str(W / f"sweep-eval-t{n}.json")], cwd=ROOT, capture_output=True, check=True)
        s = json.loads((W / f"sweep-eval-t{n}.json").read_text())["summary"]; k = s["n"]
        res = s["results"]
        tot["n"] += k; tot["exact"] += sum(r["exact"] for r in res); tot["crit"] += sum(bool(r["critical"]) for r in res)
        tot["ovabs"] += sum(r["overAbstained"] for r in res)
        tot["pend_n"] += sum(r["pendingPreserved"] is not None for r in res); tot["pend"] += sum(bool(r["pendingPreserved"]) for r in res)
        # sobreconfianza: inexacto y ejecutado
        det = {d["id"]: d for d in json.loads((W / f"sweep-eval-t{n}.json").read_text())["details"]}
        tot["ovc"] += sum((not r["exact"]) and det[r["id"]]["canonical"]["status"] in ("query_valid", "partial", "entity_lookup") for r in res)
    n = tot["n"]
    print(f"tau {tau}: exact {tot['exact']/n:.3f} crit {tot['crit']/n:.3f} ovc {tot['ovc']/n:.3f} pend {tot['pend']/max(1,tot['pend_n']):.3f} sobreabst/n {tot['ovabs']/n:.3f}")
