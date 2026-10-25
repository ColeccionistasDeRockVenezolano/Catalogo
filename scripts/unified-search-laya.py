#!/usr/bin/env python3
"""Laya tipado para evidencias de E2. Solo predicciones; nunca escribe decisiones/DB.
Usa pesos locales fijados por snapshot, CPU/GPU acotados y exclusión de procesos.
La interpretación no equivale a revisión musical independiente ni a publicación.
"""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from importlib.metadata import version
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
QUESTIONS = ROOT / "docs/unified-search/stage2/laya-evidence-questions.json"


def metadata():
    cache = Path.home() / ".cache/huggingface/hub/models--convaiinnovations--laya"
    revision = (cache / "refs/main").read_text().strip()
    if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise ValueError("Invalid local model revision")
    checkpoint = cache / "snapshots" / revision / "multilingual"
    if not (checkpoint / "rl_agent_config.json").exists():
        raise ValueError("Multilingual checkpoint not cached")
    return {"model": "multilingual", "modelRevision": revision, "sdkVersion": version("laya"),
            "questionVersion": json.loads(QUESTIONS.read_text())["version"],
            "questionHash": hashlib.sha256(QUESTIONS.read_bytes()).hexdigest()}, checkpoint


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata", action="store_true")
    args = parser.parse_args()
    info, checkpoint = metadata()
    if args.metadata:
        print(json.dumps(info)); return
    tasks = json.load(sys.stdin)
    if not isinstance(tasks, list) or not 1 <= len(tasks) <= 20:
        raise ValueError("Batch must contain 1–20 tasks")
    if any(t["metadata"] != info for t in tasks):
        raise ValueError("Model/questions changed after export")
    with open(f"/tmp/crv-knowledge-laya-{os.getuid()}.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
        import torch
        torch.set_num_threads(2)
        if torch.cuda.is_available() and torch.cuda.mem_get_info()[0] < 3 * 1024**3:
            raise RuntimeError("GPU budget unavailable; retain pending tasks")
        from laya import Router
        router = Router(default="multilingual", models={"multilingual": str(checkpoint)}, max_loaded=1)
        questions = json.loads(QUESTIONS.read_text())["questions"]
        rows = []
        for task in tasks:
            if len(json.dumps(task["state"], ensure_ascii=False)) > 8000:
                raise ValueError("Input budget exceeded")
            result = router.predict(task["state"], questions, model="multilingual", max_len=4096)
            # Deliberately no rating, previous analysis or human verdict in state.
            rows.append({"unitKey": task["unitKey"], "inputHash": task["inputHash"], **info,
                         "decisions": result["answers"], "routing": result["routing"]})
        print(json.dumps(rows, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # SDK/SQL/input details may contain private text; retain work for retry.
        print("knowledge_laya_failed", file=sys.stderr)
        sys.exit(1)
