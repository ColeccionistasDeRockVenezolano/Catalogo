#!/usr/bin/env python3
"""Mide el modo «solo si coinciden» (criteria-1.10.0 · gatedAgreementMode) a partir de las evaluaciones `plans`.
  gate_score.py <dataset.json> <eval.json> [--mandatory eval.json] [--real eval.json] [--latency-ms P95] [--json out.json]
Imprime cada métrica con su umbral y APRUEBA / NO APRUEBA."""
import json, sys

def arg(name):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else None

ds = json.load(open(sys.argv[1])); ev = json.load(open(sys.argv[2]))
gold = {c["id"]: c["gold"] for c in ds["cases"]}
det = {d["id"]: d for d in ev["details"]}
res = ev["summary"]["results"]
EXEC = ("query_valid", "partial", "entity_lookup")
executed = [r for r in res if det[r["id"]]["canonical"]["status"] in EXEC]
answerable = [r for r in res if gold[r["id"]]["status"] in EXEC]
cov = sum(det[r["id"]]["canonical"]["status"] in EXEC for r in answerable) / max(1, len(answerable))
exe_exact = sum(r["exact"] for r in executed) / max(1, len(executed))
ovc = sum((not r["exact"]) for r in executed) / len(res)
s = ev["summary"]

def conds(c):
    return {(m, x) for m in ("req", "exc", "pref") for x in (c.get(m) or [])}
tp = fp = fn = 0
for r in executed:
    p, g = conds(det[r["id"]]["canonical"]), conds(gold[r["id"]])
    tp += len(p & g); fp += len(p - g); fn += len(g - p)
f1 = 2 * tp / max(1, 2 * tp + fp + fn)
mand = json.load(open(arg("--mandatory")))["summary"]["criticalErrorRate"] if arg("--mandatory") else None
real = json.load(open(arg("--real")))["summary"]["noInvention"] if arg("--real") else None
lat = float(arg("--latency-ms")) if arg("--latency-ms") else None
rows = [("executedExactAccuracy", exe_exact, ">=", 0.85), ("coverage", cov, ">=", 0.40), ("overconfidence", ovc, "<=", 0.05),
        ("criticalErrors", s["criticalErrorRate"], "<=", 0.02), ("unsupportedPreservation", s["unsupportedPreservation"], ">=", 0.95),
        ("conditionF1Executed", f1, ">=", 0.90)]
if mand is not None: rows.append(("criticalErrors mandatory", mand, "<=", 0.0))
if real is not None: rows.append(("realTrafficNoInvention", real, ">=", 0.98))
if lat is not None: rows.append(("latencyP95WarmMs", lat, "<=", 500))
ok = True; out = {}
for name, v, op, th in rows:
    p = v >= th if op == ">=" else v <= th
    ok &= p; out[name] = {"value": v, "threshold": f"{op} {th}", "pass": p}
    print(f"{name:26s} {v:.3f} {op} {th:.2f}  {'ok' if p else 'FALLA'}")
print(f"n={len(res)} respondidos={len(executed)} respondibles={len(answerable)}")
print("MODO COINCIDENCIA:", "APRUEBA" if ok else "NO APRUEBA")
if arg("--json"): json.dump({"n": len(res), "answered": len(executed), "answerable": len(answerable), "metrics": out, "passed": ok}, open(arg("--json"), "w"), indent=1)
