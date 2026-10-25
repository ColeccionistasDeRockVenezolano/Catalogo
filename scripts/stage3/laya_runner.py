#!/usr/bin/env python3
"""Ejecuta preguntas tipadas de la etapa 3 con Laya base o con una superposición ajustada.

Entrada: JSONL de tareas {qid, key, family, state, question}. Salida: JSONL de respuestas.
Solo predice; nunca escribe en la base ni en decisiones. Un solo proceso con GPU a la vez.
"""
from __future__ import annotations
import argparse, fcntl, json, os, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from laya_common import load_agent, predict  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--variant", default="base")
    ap.add_argument("--calibration")
    ap.add_argument("--batch", type=int, default=24)
    args = ap.parse_args()
    tasks = [json.loads(line) for line in open(args.tasks) if line.strip()]
    calibration = json.loads(Path(args.calibration).read_text()) if args.calibration else None
    with open(f"/tmp/crv-stage3-laya-{os.getuid()}.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        t0 = time.perf_counter()
        agent, card = load_agent(args.variant)
        load_s = time.perf_counter() - t0
        rows = predict(agent, tasks, calibration, args.batch)
    with open(args.out, "w") as f:
        for row in rows:
            row["variant"] = card.get("id", "base")
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(json.dumps({"tasks": len(rows), "variant": card.get("id", "base"), "baseRevision": card["baseRevision"], "loadSeconds": round(load_s, 1)}))


if __name__ == "__main__":
    main()
