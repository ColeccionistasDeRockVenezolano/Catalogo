#!/usr/bin/env python3
"""Variantes construidas del estado de la afirmación (solo entrenamiento, etapa 3).

Toma afirmaciones afirmadas del lote (partición train) y pide a DeepSeek flash tres reescrituras de la
misma cita sobre el mismo rasgo: negada, hipotética (deseo, condición o suposición) y citada (atribuida
a otra voz). Se marcan `constructed: true`; nunca entran en validación, calibración ni prueba.
Salida: <out>/typed.jsonl con los ítems nuevos (mismo formato que build_evidence_batch.py items).
"""
import json, random, sys, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
env = dict(l.split("=", 1) for l in (ROOT / ".env").read_text().splitlines() if l.startswith("DEEPSEEK_"))
KEY = env["DEEPSEEK_API_KEY"].strip(); MODEL = env.get("DEEPSEEK_MODEL_FAST", env.get("DEEPSEEK_MODEL", "deepseek-flash")).strip()
SYSTEM = ("Reescribes una frase de reseña musical en tres variantes, en el mismo idioma y registro, sobre el MISMO rasgo y el mismo disco: "
          "negated (quien escribe niega explícitamente el rasgo), hypothetical (deseo, condición o suposición: el rasgo no se afirma como hecho), "
          "quoted (el rasgo lo afirma otra voz citada: la banda, la prensa, un amigo; quien escribe no lo asume). Máximo 200 caracteres cada una. "
          "Responde SOLO JSON: {\"negated\":\"...\",\"hypothetical\":\"...\",\"quoted\":\"...\"}")
SUPPORT = {"negated": "contradicts", "hypothetical": "insufficient", "quoted": "insufficient"}


def call(item):
    body = json.dumps({"model": MODEL, "messages": [{"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"Rasgo: {item['state']['candidate']['value']}\nFrase: {item['state']['quote']}"}],
        "response_format": {"type": "json_object"}, "max_tokens": 500, "temperature": 0.7, "thinking": {"type": "disabled"}, "stream": False}).encode()
    req = urllib.request.Request("https://api.deepseek.com/chat/completions", body, {"content-type": "application/json", "authorization": f"Bearer {KEY}"})
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return item, json.loads(json.load(r)["choices"][0]["message"]["content"])
        except Exception:  # noqa: BLE001
            continue
    return item, None


def main(src_dirs, out, n):
    rnd = random.Random(3)
    base = [json.loads(l) for d in src_dirs for l in open(Path(d) / "typed.jsonl")]
    pool = [t for t in base if t["split"] == "train" and not t["constructed"] and t["gold"].get("assertion_state") == "affirmed"
            and t["gold"].get("object_scope") == "same_object" and t["gold"].get("support") == "supports"]
    rnd.shuffle(pool)
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    rows = []
    with ThreadPoolExecutor(8) as ex:
        for item, res in ex.map(call, pool[:n]):
            if not isinstance(res, dict):
                continue
            for state, text in res.items():
                if state in SUPPORT and isinstance(text, str) and 10 <= len(text) <= 240:
                    rows.append({**item, "id": f"{item['id']}-V{state[0]}", "constructed": True, "constructedFrom": item["id"],
                                 "state": {**item["state"], "quote": text.strip()},
                                 "gold": {"object_scope": "same_object", "assertion_state": state, "support": SUPPORT[state], "activity_basis": "absent"},
                                 "analyst": f"DeepSeek ({MODEL}) reescritura"})
    with open(out / "typed.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    open(out / "extraction.jsonl", "w").close()
    print(json.dumps({"source": len(pool[:n]), "items": len(rows)}))


if __name__ == "__main__":
    main(sys.argv[1].split(","), sys.argv[2], int(sys.argv[3]))
