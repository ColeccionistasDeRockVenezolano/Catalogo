#!/usr/bin/env python3
"""Métricas de evidencia de la etapa 3 sobre respuestas de Laya (formato de laya_runner).

  evidence_eval.py --tasks tasks.jsonl --answers answers.jsonl [--calibration c.json]
Decisiones tipadas: support macro-F1, exactitud de assertion_state y recall de estados no afirmados,
exactitud de object_scope, precisión de declared_use. Extracción: top-1 y recall de «none». ECE por familia.
"""
from __future__ import annotations
import argparse, json, math
from collections import defaultdict
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from calibrate import ece, softmax  # noqa: E402


def macro_f1(pairs, labels):
    f = []
    for l in labels:
        tp = sum(g == l and p == l for g, p in pairs); fp = sum(g != l and p == l for g, p in pairs); fn = sum(g == l and p != l for g, p in pairs)
        if tp + fp + fn:
            f.append(2 * tp / (2 * tp + fp + fn))
    return sum(f) / len(f) if f else None


def metrics(tasks_path, answers_path, calibration=None):
    temps = (json.load(open(calibration))["temperature"] if calibration else {})
    gold = {(t["qid"], t["key"]): t for t in map(json.loads, open(tasks_path))}
    by = defaultdict(list)
    for a in map(json.loads, open(answers_path)):
        t = gold.get((a["qid"], a["key"]))
        if not t:
            continue
        keys = list(a["raw"].keys())
        by[a["family"]].append((t["gold"], a["choice"], a["logits"], keys.index(t["gold"])))
    out = {}
    def acc(fam):
        rows = by.get(fam, [])
        return sum(g == p for g, p, *_ in rows) / len(rows) if rows else None
    sp = [(g, p) for g, p, *_ in by.get("support", [])]
    out["supportMacroF1"] = macro_f1(sp, ["supports", "contradicts", "insufficient"])
    out["assertionStateAccuracy"] = acc("assertion_state")
    non = [(g, p) for g, p, *_ in by.get("assertion_state", []) if g != "affirmed"]
    out["nonAffirmedRecall"] = sum(g == p for g, p in non) / len(non) if non else None
    out["objectScopeAccuracy"] = acc("object_scope")
    du = [(g, p) for g, p, *_ in by.get("activity_basis", []) if p == "declared_use"]
    out["activityDeclaredUsePrecision"] = sum(g == p for g, p in du) / len(du) if du else 1.0
    out["activityDeclaredUsePredicted"] = len(du)
    out["activityBasisAccuracy"] = acc("activity_basis")
    ex = by.get("claim_extraction", [])
    pos = [(g, p) for g, p, *_ in ex if g != "none"]; neg = [(g, p) for g, p, *_ in ex if g == "none"]
    out["claimTop1Accuracy"] = sum(g == p for g, p in pos) / len(pos) if pos else None
    out["claimNoneRecall"] = sum(p == "none" for _, p in neg) / len(neg) if neg else None
    out["ece"] = {fam: round(ece([(l, y) for *_, l, y in rows], float(temps.get(fam, 1.0))), 4) for fam, rows in by.items()}
    out["n"] = {fam: len(rows) for fam, rows in by.items()}
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in out.items()}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", required=True); ap.add_argument("--answers", required=True); ap.add_argument("--calibration")
    a = ap.parse_args()
    print(json.dumps(metrics(a.tasks, a.answers, a.calibration), ensure_ascii=False))
