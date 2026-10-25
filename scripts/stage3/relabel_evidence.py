#!/usr/bin/env python3
"""Reetiquetado de evidencia con las convenciones de la adjudicación (etapa 3, versión 1.1.0).

  relabel_evidence.py <evidence-dir> [--splits train,val,calib] [--workers 8]

La primera pasada del analista (build_evidence_batch.py) mezclaba extracción y decisión, y la regla
mecánica «negado ⇒ contradicts» no coincidía con la adjudicación de la prueba reservada (36 de 153
corregidas). Esta segunda pasada de DeepSeek flash solo DECIDE las cuatro preguntas tipadas sobre
una afirmación ya extraída, con su contexto y con las convenciones escritas. Escribe
relabels.jsonl (caché reanudable) y typed-relabeled.jsonl (mismos ítems, gold reetiquetado; los
construidos conservan su gold). Nunca toca la prueba reservada.
"""
from __future__ import annotations
import argparse, json, sys, threading, urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from freeze_evidence_test import CONVENTIONS  # noqa: E402

Q = json.loads((ROOT / "docs/unified-search/stage2/laya-evidence-questions.json").read_text())["questions"]
KEYS = ("object_scope", "assertion_state", "support", "activity_basis")
SYSTEM = ("Eres evaluador de evidencia musical. Para cada caso recibes el OBJETO del catálogo, un fragmento de texto con su contexto y un RASGO "
          "propuesto. Decide cuatro preguntas usando solo el texto.\n\n"
          + "\n".join(f"{k}: {Q[k]['instructions']}\n" + "\n".join(f"  - {o}: {d}" for o, d in Q[k]["criteria"].items()) for k in KEYS)
          + "\n\nConvenciones obligatorias:\n" + "\n".join(f"- {c}" for c in CONVENTIONS)
          + "\n- assertion_state es affirmed cuando quien escribe describe la obra en presente o pasado aunque use adjetivos fuertes o comparaciones; "
            "hypothetical solo con condición, deseo o suposición explícitos; quoted solo si reproduce otra voz o la letra; uncertain solo si duda explícitamente."
          + "\n- support: supports si el fragmento describe el rasgo propuesto en el objeto (también con valoración negativa); contradicts si niega ESE rasgo; "
            "insufficient si no lo describe, describe otro objeto, o el estado no es affirmed/negated."
          + "\n\nResponde SOLO JSON: {\"answers\":[{\"id\":\"...\",\"object_scope\":\"...\",\"assertion_state\":\"...\",\"support\":\"...\",\"activity_basis\":\"...\"}]}")


def context(text: str, quote: str, width: int = 260) -> str:
    i = text.find(quote)
    if i < 0:
        return quote
    a, b = max(0, i - width), min(len(text), i + len(quote) + width)
    return ("…" if a else "") + text[a:b] + ("…" if b < len(text) else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir"); ap.add_argument("--splits", default="train,val,calib"); ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--batch", type=int, default=8)
    a = ap.parse_args()
    d = Path(a.dir)
    env = dict(l.split("=", 1) for l in (ROOT / ".env").read_text().splitlines() if l.startswith("DEEPSEEK_"))
    key = env["DEEPSEEK_API_KEY"].strip()
    model = env.get("DEEPSEEK_MODEL_FAST", env.get("DEEPSEEK_MODEL", "deepseek-flash")).strip()
    pool = {json.loads(l)["id"]: json.loads(l) for l in open(d / "pool.jsonl")}
    typed = [json.loads(l) for l in open(d / "typed.jsonl")]
    splits = set(a.splits.split(","))
    cache = d / "relabels.jsonl"
    done = {}
    if cache.exists():
        for l in open(cache):
            r = json.loads(l); done[r["id"]] = r
    todo = [t for t in typed if not t["constructed"] and t["split"] in splits and t["id"] not in done]
    usage, lock, fh = Counter(), threading.Lock(), open(cache, "a")

    def call(batch):
        cases = []
        for t in batch:
            o = t["state"]["object"]; r = pool[t["review"]]
            cases.append(f"id: {t['id']}\nOBJETO: {o['kind']} «{o['name']}»\nFUENTE: {t['source']}\nCONTEXTO: {context(r['text'], t['state']['quote'])}\n"
                         f"FRAGMENTO: {t['state']['quote']}\nRASGO: {t['state']['candidate']['value']} (eje {t['state']['candidate']['axis']})")
        body = json.dumps({"model": model, "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": "\n\n".join(cases)}],
                           "response_format": {"type": "json_object"}, "max_tokens": 2000, "temperature": 0.0,
                           "thinking": {"type": "disabled"}, "stream": False}).encode()
        req = urllib.request.Request("https://api.deepseek.com/chat/completions", body, {"content-type": "application/json", "authorization": f"Bearer {key}"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    data = json.load(resp)
                answers = json.loads(data["choices"][0]["message"]["content"]).get("answers", [])
                ids = {t["id"] for t in batch}
                with lock:
                    usage["calls"] += 1; usage["prompt"] += data["usage"]["prompt_tokens"]; usage["completion"] += data["usage"]["completion_tokens"]
                    for ans in answers:
                        if ans.get("id") in ids and all(ans.get(k) in Q[k]["criteria"] for k in KEYS):
                            fh.write(json.dumps({"id": ans["id"], "verifier": f"DeepSeek ({model})", **{k: ans[k] for k in KEYS}}, ensure_ascii=False) + "\n")
                            usage["answers"] += 1
                    fh.flush()
                return
            except Exception as exc:  # noqa: BLE001
                if attempt == 2:
                    print("fallo", batch[0]["id"], exc, file=sys.stderr)

    batches = [todo[i:i + a.batch] for i in range(0, len(todo), a.batch)]
    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(call, batches))
    fh.close()
    done = {json.loads(l)["id"]: json.loads(l) for l in open(cache)}
    out, changed = [], Counter()
    for t in typed:
        r = done.get(t["id"])
        if r and not t["constructed"]:
            new = {k: r[k] for k in KEYS}
            for k in KEYS:
                if t["gold"].get(k) != new[k]:
                    changed[f"{k}:{t['gold'].get(k)}→{new[k]}"] += 1
            t = {**t, "gold": new, "labelSource": "verifier-conventions-1.1.0", "analystGold": t["gold"]}
        out.append(t)
    with open(d / "typed-relabeled.jsonl", "w") as f:
        for t in out:
            f.write(json.dumps(t, ensure_ascii=False) + "\n")
    prev = json.loads((d / "relabel-usage.json").read_text()) if (d / "relabel-usage.json").exists() else {}
    (d / "relabel-usage.json").write_text(json.dumps({k: usage.get(k, 0) + prev.get(k, 0) for k in ("calls", "prompt", "completion", "answers")} | {"model": model}, indent=1))
    print(json.dumps({"usage": usage, "relabeled": sum(1 for t in out if t.get("labelSource")), "changes": changed.most_common(25)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
