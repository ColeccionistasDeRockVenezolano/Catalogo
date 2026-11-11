#!/usr/bin/env python3
"""Segundo etiquetador (DeepSeek flash) de consultas reales con la convención escrita.

Mide el techo de las etiquetas: si dos etiquetadores no coinciden en el plan exacto,
un umbral de exactitud mayor que esa coincidencia no es alcanzable por construcción.

  second_labeler.py label <casos.json> <salida.jsonl> [--limit N]
  second_labeler.py compare <casos.json> <salida.jsonl>
Solo se envían textos de consultas públicas (autocompletado) y la convención; nada del usuario.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ST3 = ROOT / "docs/unified-search/stage3"
env = dict(l.split("=", 1) for l in (ROOT / ".env").read_text().splitlines() if l.startswith("DEEPSEEK_"))
KEY, MODEL = env["DEEPSEEK_API_KEY"].strip(), env.get("DEEPSEEK_MODEL_FAST", env.get("DEEPSEEK_MODEL", "deepseek-flash")).strip()


def system_prompt() -> str:
    lx = json.loads((ST3 / "query-lexicon.json").read_text())
    concepts = "\n".join(f"- {c['id']}: {c['labelEs']} — {c['definitionEs']}" for c in lx["concepts"])
    genres = ", ".join(g["slug"] for g in lx["genres"])
    return f"""Etiquetas consultas reales de búsqueda de música según esta convención escrita (síguela al pie de la letra):

{(ST3 / 'query-label-convention.md').read_text()}

Conceptos permitidos para `req`/`exc`/`pref`/`alts` (formato dimensión:id, tal cual):
{concepts}

Géneros permitidos: se escriben `genre:<slug>` con uno de: {genres}.
Décadas: `decade:1980s`.

Responde SOLO un objeto JSON con las claves:
status: query_valid|partial|entity_lookup|unsupported|clarify|contradiction|unrecognized
req: lista de ids exigidos; exc: excluidos («sin X»); pref: preferidos; any: lista de grupos O (lista de listas) ; alts: alternativas de un término ambiguo (solo con clarify)
ent: lista de {{"literal": texto en minúsculas, "kind": "artist"|"song"|null, "role": "target"|"reference"}}
ctx: número de contextos del oyente (0 o 1…)
pending: número de restricciones pendientes (convención §3)
facet: null"""


def _grams(t: str) -> dict:
    import math
    t = " " + " ".join(t.lower().split()) + " "
    g: dict = {}
    for n in (3, 4):
        for i in range(len(t) - n + 1):
            g[t[i:i + n]] = g.get(t[i:i + n], 0) + 1
    return g


class Shots:
    """Ejemplos etiquetados por Claude más parecidos (TF-IDF de n-gramas de caracteres)."""
    def __init__(self, pool: list[dict]):
        import math
        self.pool = pool
        self.grams = [_grams(c["text"]) for c in pool]
        df: dict = {}
        for g in self.grams:
            for k in g:
                df[k] = df.get(k, 0) + 1
        n = len(pool)
        self.idf = {k: math.log(1 + n / v) for k, v in df.items()}
        self.vecs = [self._vec(g) for g in self.grams]

    def _vec(self, g: dict) -> dict:
        import math
        v = {k: c * self.idf.get(k, 1.0) for k, c in g.items()}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        return {k: x / norm for k, x in v.items()}

    def top(self, text: str, k: int) -> list[dict]:
        q = self._vec(_grams(text))
        scored = sorted(((sum(w * v.get(t, 0.0) for t, w in q.items()), i) for i, v in enumerate(self.vecs)), reverse=True)
        return [self.pool[i] for _, i in scored[:k]]


def call(text: str, sys_prompt: str, shots=None) -> dict:
    user = f"Consulta: «{text}»"
    if shots:
        ex = "\n".join(f"«{c['text']}» → {json.dumps({k: c['gold'].get(k) for k in ('status','req','exc','pref','any','alts','ent','ctx','pending')}, ensure_ascii=False)}" for c in shots)
        user = f"Ejemplos ya etiquetados por la persona que fija la convención (imítalos en estilo y criterio):\n{ex}\n\n{user}"
    body = json.dumps({"model": MODEL, "messages": [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user}],
                       "response_format": {"type": "json_object"}, "max_tokens": 600, "thinking": {"type": "disabled"}, "stream": False}).encode()
    for attempt in range(4):
        try:
            rq = urllib.request.Request("https://api.deepseek.com/chat/completions", body,
                                        {"content-type": "application/json", "authorization": f"Bearer {KEY}"})
            with urllib.request.urlopen(rq, timeout=90) as r:
                return json.loads(json.load(r)["choices"][0]["message"]["content"])
        except Exception as e:  # reintento simple
            err = str(e)
    return {"error": err}


def canon(g: dict) -> tuple:
    g = {**g, **{k: (g.get(k) or []) for k in ("req", "exc", "pref", "any", "alts", "ent")}}
    g["any"] = [x for x in g["any"] if isinstance(x, list)]
    ents = tuple(sorted((e.get("literal", "").lower().strip(), e.get("role", "target")) for e in g.get("ent", [])))
    return (g.get("status"), tuple(sorted(g.get("req", []))), tuple(sorted(g.get("exc", []))), tuple(sorted(g.get("pref", []))),
            tuple(sorted(map(tuple, (sorted(x) for x in g.get("any", []))))), tuple(sorted(g.get("alts", []))),
            ents, int(g.get("ctx", 0) or 0), int(g.get("pending", 0) or 0))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["label", "compare"])
    ap.add_argument("cases")
    ap.add_argument("out")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--shots", type=int, default=0, help="ejemplos etiquetados por Claude (kNN) en cada consulta")
    ap.add_argument("--pool", nargs="*", default=[], help="casos etiquetados (desarrollo) para los ejemplos")
    a = ap.parse_args()
    cases = json.loads(Path(a.cases).read_text())["cases"]
    if a.limit:
        cases = cases[: a.limit]
    out = Path(a.out)
    if a.mode == "label":
        sp = system_prompt()
        shots = None
        if a.shots:
            pool = [c for f in a.pool for c in json.loads(Path(f).read_text())["cases"]]
            texts = {c["text"].lower() for c in cases}
            shots = Shots([c for c in pool if c["text"].lower() not in texts])
        done = {json.loads(l)["id"] for l in out.read_text().splitlines()} if out.exists() else set()
        todo = [c for c in cases if c["id"] not in done]
        errors = 0
        with ThreadPoolExecutor(a.workers) as ex, out.open("a") as fh:
            for c, r in zip(todo, ex.map(lambda c: call(c["text"], sp, shots.top(c["text"], a.shots) if shots else None), todo)):
                if "error" in r:
                    errors += 1
                    continue
                fh.write(json.dumps({"id": c["id"], "text": c["text"], "gold": r}, ensure_ascii=False) + "\n")
                fh.flush()
        print(f"{len(todo)} pedidas, {errors} con error (se reintentan al repetir)")
        return
    other = {json.loads(l)["id"]: json.loads(l)["gold"] for l in out.read_text().splitlines()}
    n = same = same_status = 0
    diffs = []
    for c in cases:
        o = other.get(c["id"])
        if not o or "error" in o:
            continue
        n += 1
        same += canon(c["gold"]) == canon(o)
        same_status += c["gold"]["status"] == o.get("status")
        if canon(c["gold"]) != canon(o):
            diffs.append((c["text"], c["gold"], o))
    print(f"n={n} plan exacto={same/n:.3f} estado={same_status/n:.3f}")
    for t, g, o in diffs[:40]:
        print("-", t, "\n   Claude:", json.dumps(canon(g), ensure_ascii=False), "\n   DS    :", json.dumps(canon(o), ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
