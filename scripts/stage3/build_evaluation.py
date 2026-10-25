#!/usr/bin/env python3
"""Arma los archivos de evaluación de la etapa 3 (crv-stage3-evaluation-1) contra los criterios congelados.

  build_evaluation.py query    --tuned W --base W --model ID
  build_evaluation.py evidence --tuned W --base W --model ID --tasks reserved-tasks.jsonl

W es el directorio de trabajo de query_eval.sh o de la evaluación de evidencia. Escribe
docs/unified-search/stage3/results/<tarea>--<modelo>.json. Un archivo existente no se sobrescribe:
una versión se evalúa una vez sobre la prueba reservada.
"""
from __future__ import annotations
import argparse, hashlib, json, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from evidence_eval import metrics as evidence_metrics  # noqa: E402

RESULTS = ROOT / "docs/unified-search/stage3/results"
CRITERIA = json.loads((ROOT / "docs/unified-search/stage3/criteria.json").read_text())  # se reemplaza con --criteria
MODELS = Path.home() / ".local/share/crv-laya/models"
MANDATORY_IDS = ["T144", "T151", "T156", "T157", "T174", "T182", "T190", "T213"]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def card(model: str) -> dict:
    return json.loads((MODELS / model / "card.json").read_text())


def check(name, value, op, bound):
    ok = value is not None and (value >= bound if op == ">=" else value <= bound)
    return {"name": name, "value": None if value is None else round(float(value), 4), "threshold": f"{op} {bound}", "pass": bool(ok)}


def summary(w: Path, name: str) -> dict:
    return json.loads((w / f"eval-{name}.json").read_text())["summary"]


def run_baseline(dataset: str, mode: str) -> dict:
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".json") as tmp:
        subprocess.run(["./scripts/with-node22.sh", "./node_modules/.bin/tsx", "scripts/unified-search-stage3-queries.ts", "eval", dataset, mode, "--out", tmp.name],
                       cwd=ROOT, capture_output=True, text=True, check=True)
        return json.loads(Path(tmp.name).read_text())["summary"]


def write(task: str, model: str, doc: dict):
    RESULTS.mkdir(parents=True, exist_ok=True)
    doc["criteriaVersion"] = CRITERIA["version"]
    path = RESULTS / f"{task}--{model}.json"
    if path.exists():
        raise SystemExit(f"{path} ya existe: la prueba reservada se evalúa una vez por versión")
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    print(path, json.dumps({"passed": doc["passed"], "failed": [c["name"] for c in doc["checks"] if not c["pass"]]}, ensure_ascii=False))


def ece_max(w: Path, tasks: Path, answers: Path) -> tuple[float, dict]:
    out = subprocess.run([sys.executable, str(ROOT / "scripts/stage3/calibrate.py"), "ece", "--tasks", str(tasks), "--answers", str(answers),
                          "--calibration", str(w / "calibration.json")], capture_output=True, text=True, check=True).stdout
    per = json.loads(out)
    return max(v["ece"] for v in per.values() if v["n"] >= 30), per


def common(task, model, c, datasets, checks, comparison, notes, runs):
    return {"version": "crv-stage3-evaluation-1", "task": task, "modelId": model, "baseRevision": c["baseRevision"], "weightsSha256": c["weightsSha256"],
            "card": c, "criteriaVersion": CRITERIA["version"], "evaluatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "reservedTestRuns": runs,
            "datasets": datasets, "checks": checks, "comparison": comparison, "passed": all(x["pass"] for x in checks), "notes": notes}


def query(a):
    tw, bw = Path(a.tuned), Path(a.base)
    res, mand, real = summary(tw, "reserved"), summary(tw, "mandatory"), summary(tw, "real")
    base = summary(bw, "reserved")
    DS = ROOT / "docs/unified-search/stage3/datasets"
    reserved_path = ROOT / CRITERIA["reservedTests"]["queries"]["path"]
    legacy = run_baseline(str(reserved_path), "legacy")
    rules = run_baseline(str(reserved_path), "rules")
    lat = json.loads((tw / "latency.json").read_text())
    compile_p95 = json.loads((tw / "eval-reserved.json").read_text())["compileMsP95"] or 0
    crit_ids = {x["id"] for x in res["criticalCases"]} | {x["id"] for x in mand["criticalCases"]}
    ece, per = ece_max(tw, Path(a.val_tasks), tw / "answers-val-tasks.jsonl")
    checks = [
        check("Exactitud del plan (reservada)", res["exactPlanAccuracy"], ">=", 0.85),
        check("Exactitud en casos adversariales", res["exactPlanAccuracyAdversarial"], ">=", 0.80),
        check("Errores críticos (reservada)", res["criticalErrorRate"], "<=", 0.02),
        {"name": "Errores críticos en obligatorios (M01–M05 y T144…T213)", "value": float(len(crit_ids & set(MANDATORY_IDS)) + len(mand["criticalCases"])), "threshold": "= 0", "pass": not (crit_ids & set(MANDATORY_IDS)) and not mand["criticalCases"]},
        check("Exactitud en los cinco obligatorios", mand["exactPlanAccuracy"], ">=", 1.0),
        check("Restricciones pendientes conservadas", res["unsupportedPreservation"], ">=", 0.95),
        check("Sobreabstención", res["overAbstention"], "<=", 0.10),
        check("Sobreconfianza", res["overconfidence"], "<=", 0.05),
        check("F1 de condiciones", res["conditionF1"], ">=", 0.90),
        check("Género descrito: acierto entre tres", res["describedGenreRecallAt3"], ">=", 0.70),
        check("Tráfico real sin invención", real["noInvention"], ">=", 0.98),
        check("Latencia p95 en caliente (ms)", lat["p95"] + compile_p95, "<=", 500),
        check("ECE máximo por familia (validación)", ece, "<=", 0.10),
        check("Margen sobre reglas heredadas", res["exactPlanAccuracy"] - legacy["exactPlanAccuracy"], ">=", 0.20),
        check("Críticos no peores que reglas sin modelo", rules["criticalErrorRate"] - res["criticalErrorRate"], ">=", 0.0),
    ]
    row = lambda name, s: {"system": name, "exactitud": s["exactPlanAccuracy"], "críticos": s["criticalErrorRate"], "F1": s["conditionF1"], "sobreconfianza": s.get("overconfidence")}
    comparison = [row("legacy", legacy), row("rules", rules), row("base", base), {**row("tuned", res), "latencia_p95_ms": lat["p95"] + compile_p95}]
    files = {"reserved": reserved_path, "mandatory": DS / "query-test-mandatory.json", "real": DS / "query-test-real.json"}
    datasets = {k: {"path": str(v.relative_to(ROOT)), "sha256": sha(v), "cases": len(json.loads(v.read_text())["cases"])} for k, v in files.items()}
    for k, v in files.items():
        expected = CRITERIA["reservedTests"]["queries" if k == "reserved" else "mandatory" if k == "mandatory" else "realTraffic"]["sha256"]
        if datasets[k]["sha256"] != expected:
            raise SystemExit(f"{k}: la huella no coincide con criteria.json")
    runs = sum(1 for _ in open(tw / "reserved-runs.log"))
    notes = [f"ECE por familia en validación: " + ", ".join(f"{k} {v['ece']}" for k, v in per.items()),
             f"Latencia: modelo p95 {lat['p95']} ms + compilación p95 {round(compile_p95, 1)} ms ({lat['device']}).",
             f"Por categoría: " + ", ".join(f"{k} {v['exact']}/{v['n']}" for k, v in res["byCategory"].items())]
    write("query_interpretation", a.model, common("query_interpretation", a.model, card(a.model), datasets, checks, comparison, notes, runs))


def evidence(a):
    tw, bw, tasks = Path(a.tuned), Path(a.base), Path(a.tasks)
    t = evidence_metrics(str(tasks), str(tw / "answers-reserved.jsonl"), str(tw / "calibration.json"))
    b = evidence_metrics(str(tasks), str(bw / "answers-reserved.jsonl"), str(bw / "calibration.json"))
    test = ROOT / CRITERIA["reservedTests"]["evidence"].get("path", "docs/unified-search/stage3/datasets/evidence-test-reserved.json")
    if CRITERIA["reservedTests"]["evidence"].get("sha256") and sha(test) != CRITERIA["reservedTests"]["evidence"]["sha256"]:
        raise SystemExit("evidencia: la huella no coincide con los criterios")
    doc = json.loads(test.read_text())
    datasets = {"reserved": {"path": str(test.relative_to(ROOT)), "sha256": sha(test), "cases": doc["counts"]["typed"] + doc["counts"]["extraction"]}}
    runs = sum(1 for _ in open(tw / "reserved-runs.log"))
    typed_keys = ["supportMacroF1", "assertionStateAccuracy", "objectScopeAccuracy", "activityBasisAccuracy"]
    better = sum(t[k] > b[k] for k in typed_keys); worse = [k for k in typed_keys if t[k] < b[k]]
    ece_typed = max(t["ece"][k] for k in ("object_scope", "assertion_state", "support", "activity_basis"))
    checks = [
        check("Soporte: macro-F1", t["supportMacroF1"], ">=", 0.75),
        check("Estado de la afirmación: exactitud", t["assertionStateAccuracy"], ">=", 0.85),
        check("Estados no afirmados: recall", t["nonAffirmedRecall"], ">=", 0.60),
        check("Alcance del objeto: exactitud", t["objectScopeAccuracy"], ">=", 0.85),
        check("Uso declarado: precisión", t["activityDeclaredUsePrecision"], ">=", 0.90),
        check("ECE máximo por pregunta", ece_typed, "<=", 0.12),
        {"name": "No peor que Laya base en ninguna pregunta y mejor en dos", "value": float(better), "threshold": ">= 2 mejores y 0 peores", "pass": better >= 2 and not worse},
    ]
    keys = typed_keys + ["nonAffirmedRecall", "activityDeclaredUsePrecision"]
    comparison = [{"system": "base", **{k: b[k] for k in keys}}, {"system": "tuned", **{k: t[k] for k in keys}}]
    notes = [f"Prueba adjudicada por Claude: {doc['counts']['typed']} decisiones ({doc['counts']['corrected']} corregidas al analista) y {doc['counts']['extraction']} extracciones.",
             "Las etiquetas de entrenamiento son del analista (DeepSeek flash) con las convenciones de la adjudicación; incluye ejemplos construidos marcados.",
             f"n por pregunta: {t['n']}"]
    c = card(a.model)
    write("evidence_typed_decision", a.model, common("evidence_typed_decision", a.model, c, datasets, checks, comparison, notes, runs))
    checks_x = [check("Extracción: acierto top-1", t["claimTop1Accuracy"], ">=", 0.80), check("Extracción: recall de «ninguna»", t["claimNoneRecall"], ">=", 0.70),
                check("ECE de extracción", t["ece"].get("claim_extraction"), "<=", 0.12)]
    comp_x = [{"system": "base", "top1": b["claimTop1Accuracy"], "ninguna": b["claimNoneRecall"]}, {"system": "tuned", "top1": t["claimTop1Accuracy"], "ninguna": t["claimNoneRecall"]}]
    write("claim_extraction", a.model, common("claim_extraction", a.model, c, datasets, checks_x, comp_x, notes[:1], runs))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=["query", "evidence"])
    ap.add_argument("--tuned", required=True); ap.add_argument("--base", required=True); ap.add_argument("--model", required=True); ap.add_argument("--tasks")
    ap.add_argument("--criteria", default="docs/unified-search/stage3/criteria.json")
    ap.add_argument("--val-tasks", default=str(ROOT / "tmp-analysis/unified-search-stage3/compose-0.1.0/tasks-val.jsonl"))
    a = ap.parse_args()
    CRITERIA = json.loads((ROOT / a.criteria).read_text())
    (query if a.kind == "query" else evidence)(a)
