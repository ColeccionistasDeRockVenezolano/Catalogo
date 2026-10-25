#!/usr/bin/env python3
"""Latencia en caliente de la interpretación con Laya: una consulta = un lote con todas sus preguntas.

  latency_bench.py --tasks tasks.jsonl --variant <id|base> [--calibration c.json] [--warmup 20]
Mide p50/p95/p99 del tiempo de modelo por consulta en este equipo (incluye codificación y pase).
El segmentador y el compilador (TypeScript) se miden aparte en la evaluación.
"""
import argparse, json, statistics, sys, time
from collections import OrderedDict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from laya_common import load_agent, predict  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--tasks", required=True); ap.add_argument("--variant", default="base"); ap.add_argument("--calibration"); ap.add_argument("--warmup", type=int, default=20)
a = ap.parse_args()
groups = OrderedDict()
for t in map(json.loads, open(a.tasks)):
    groups.setdefault(t["qid"], []).append(t)
cal = json.load(open(a.calibration)) if a.calibration else None
agent, card = load_agent(a.variant)
items = list(groups.values())
for g in items[: a.warmup]:
    predict(agent, g, cal, batch=64)
import torch
times = []
for g in items:
    if torch.cuda.is_available(): torch.cuda.synchronize()
    t0 = time.perf_counter(); predict(agent, g, cal, batch=64)
    if torch.cuda.is_available(): torch.cuda.synchronize()
    times.append((time.perf_counter() - t0) * 1000)
times.sort()
q = lambda p: round(times[min(len(times) - 1, int(len(times) * p))], 1)
print(json.dumps({"variant": card.get("id", "base"), "queries": len(times), "p50": q(0.5), "p95": q(0.95), "p99": q(0.99), "mean": round(statistics.mean(times), 1),
                  "device": "cuda" if torch.cuda.is_available() else "cpu"}))
