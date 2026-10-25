#!/usr/bin/env python3
"""Ampliación sistemática de alias del léxico de consultas (léxico 0.4.0). Redacción: DeepSeek flash.

Para cada concepto del vocabulario se pide, a partir SOLO de su etiqueta y su definición, la lista de
expresiones con que una persona lo escribiría en un buscador (adjetivos con sus flexiones, sustantivos,
locuciones; para actividades, el verbo o la situación tras «para»; para temas, los sustantivos del asunto
de la letra). No se le muestra ninguna consulta de prueba ni de desarrollo. build_query_lexicon.py filtra
después colisiones entre conceptos, nombres de género y frases largas.

  expand_concept_aliases.py <salida.json>            primera ronda (léxico 0.4.0)
  expand_concept_aliases.py <salida.json> --round 2  segunda ronda (léxico 0.5.0): la primera gastó el cupo en
      diminutivos y flexiones; esta pide lemas distintos (las flexiones las genera build_query_lexicon.py)
      y expresiones en inglés.
"""
from __future__ import annotations
import json, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEX = json.loads((ROOT / "docs/unified-search/stage3/query-lexicon.json").read_text())
env = dict(l.split("=", 1) for l in (ROOT / ".env").read_text().splitlines() if l.startswith("DEEPSEEK_"))
KEY, MODEL = env["DEEPSEEK_API_KEY"].strip(), env.get("DEEPSEEK_MODEL_FAST", "deepseek-flash").strip()

GUIDE = {
    "activity": "verbos, locuciones y situaciones que siguen a «música para …» (p. ej. sinónimos y formas coloquiales del verbo, la actividad nombrada como sustantivo, el lugar típico que la nombra sin ambigüedad)",
    "emotion": "adjetivos (con sus formas masculina, femenina, singular y plural y diminutivos usuales) y sustantivos de la cualidad afectiva de la música",
    "energy": "adjetivos y locuciones del nivel de energía o intensidad física de la música",
    "atmosphere": "adjetivos (con flexiones) y locuciones del ambiente o la atmósfera sonora",
    "theme": "sustantivos y frases nominales cortas del asunto del que habla la letra (singular y plural), y adjetivos que lo califican",
}
SYSTEM = ("Eres lexicógrafo de búsquedas de música en español de Venezuela y Latinoamérica. Devuelve SOLO JSON "
          "{\"expressions\": [..]} con expresiones en minúsculas de 1 a 4 palabras, sin repetir las ya conocidas, que signifiquen "
          "inequívocamente el concepto pedido y no otro concepto cercano. No incluyas géneros musicales, artistas, países ni palabras genéricas (música, canciones, algo).")


ROUND = 2 if "--round" in sys.argv and sys.argv[sys.argv.index("--round") + 1] == "2" else 1
ROUND2 = ("Devuelve hasta 25 LEMAS distintos en español (sustantivos, adjetivos en masculino singular, verbos en infinitivo "
          "y locuciones) que nombren el concepto, SIN diminutivos, aumentativos ni flexiones de una misma palabra, y hasta "
          "10 expresiones en inglés con que una persona lo pediría (p. ej. «for a dinner», «long drive»). Incluye el sustantivo "
          "abstracto de la cualidad cuando exista. No incluyas instrumentos, voces ni rasgos de grabación.")


def call(c: dict) -> tuple[str, list[str]]:
    dim = c["dimension"]
    known = ", ".join(sorted({a for a in c["aliases"] + c.get("themeNouns", []) if len(a) < 14})[:80])
    ask = ROUND2 if ROUND == 2 else "Devuelve hasta 30 expresiones nuevas."
    user = (f"Concepto: {c['labelEs']} — {c['definitionEs']}\nDimensión: {dim}. Pide {GUIDE[dim]}.\n"
            f"Ya conocidas: {known}\n{ask}")
    body = json.dumps({"model": MODEL, "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
                       "response_format": {"type": "json_object"}, "max_tokens": 3000 if ROUND == 2 else 1500, "temperature": 0.4, "thinking": {"type": "disabled"}, "stream": False}).encode()
    req = urllib.request.Request("https://api.deepseek.com/chat/completions", body, {"content-type": "application/json", "authorization": f"Bearer {KEY}"})
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.load(r)
            return c["id"], [e.strip().lower() for e in json.loads(data["choices"][0]["message"]["content"])["expressions"] if isinstance(e, str)]
        except Exception as exc:  # noqa: BLE001
            err = exc
    raise RuntimeError(f"{c['id']}: {err}")


if __name__ == "__main__":
    concepts = [c for c in LEX["concepts"] if c["dimension"] in GUIDE]
    version = "crv-concept-expansion-0.2.0" if ROUND == 2 else "crv-concept-expansion-0.1.0"
    with ThreadPoolExecutor(8) as ex:
        out = dict(ex.map(call, concepts))
    Path(sys.argv[1]).write_text(json.dumps({"version": version, "round": ROUND, "model": MODEL, "authoredAt": "2026-10-25",
                                             "policy": "Generado a partir de etiqueta y definición; sin consultas de prueba ni de desarrollo.", "concepts": out}, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({k: len(v) for k, v in out.items()}))
