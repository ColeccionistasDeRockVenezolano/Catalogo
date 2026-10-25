#!/usr/bin/env python3
"""Calibración por familia de pregunta (escala de temperatura) y ECE.

  calibrate.py fit  --tasks calib-tasks.jsonl --answers calib-answers.jsonl --out calibration.json
  calibrate.py ece  --tasks tasks.jsonl --answers answers.jsonl [--calibration calibration.json]

La temperatura se ajusta en el conjunto de calibración (nunca en la prueba) minimizando la
log-verosimilitud; el ECE usa 10 intervalos de confianza de igual ancho.
"""
from __future__ import annotations
import argparse, json, math
from collections import defaultdict


def softmax(z, t):
    z = [v / t for v in z]; m = max(z); e = [math.exp(v - m) for v in z]; s = sum(e)
    return [v / s for v in e]


def joined(tasks_path, answers_path):
    gold = {(t["qid"], t["key"]): t["gold"] for t in map(json.loads, open(tasks_path)) if "gold" in t}
    rows = defaultdict(list)
    for a in map(json.loads, open(answers_path)):
        g = gold.get((a["qid"], a["key"]))
        if g is None:
            continue
        keys = list(a["raw"].keys())
        rows[a["family"]].append((a["logits"], keys.index(g)))
    return rows


def ece(items, t, bins=10):
    acc = [[0, 0, 0.0] for _ in range(bins)]
    for logits, y in items:
        p = softmax(logits, t); k = max(range(len(p)), key=p.__getitem__)
        b = min(bins - 1, int(p[k] * bins))
        acc[b][0] += 1; acc[b][1] += int(k == y); acc[b][2] += p[k]
    n = sum(a[0] for a in acc)
    return sum(abs(a[1] - a[2]) for a in acc if a[0]) / n if n else None


def nll(items, t):
    return -sum(math.log(max(softmax(l, t)[y], 1e-12)) for l, y in items) / len(items)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fit", "ece"])
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--answers", required=True)
    ap.add_argument("--out")
    ap.add_argument("--calibration")
    a = ap.parse_args()
    rows = joined(a.tasks, a.answers)
    if a.cmd == "fit":
        grid = [round(0.25 * 1.06 ** i, 4) for i in range(80)]
        out = {"version": "crv-stage3-calibration-1", "method": "temperatura por familia, NLL en calibración", "temperature": {}, "ece": {}, "n": {}}
        for fam, items in rows.items():
            t = min(grid, key=lambda t: nll(items, t))
            out["temperature"][fam] = t
            out["ece"][fam] = {"before": round(ece(items, 1.0), 4), "after": round(ece(items, t), 4)}
            out["n"][fam] = len(items)
        open(a.out, "w").write(json.dumps(out, indent=1))
        print(json.dumps(out))
    else:
        temps = json.load(open(a.calibration))["temperature"] if a.calibration else {}
        print(json.dumps({fam: {"n": len(items), "ece": round(ece(items, float(temps.get(fam, 1.0))), 4),
                                "acc": round(sum(max(range(len(l)), key=l.__getitem__) == y for l, y in items) / len(items), 4)} for fam, items in rows.items()}))


if __name__ == "__main__":
    main()
