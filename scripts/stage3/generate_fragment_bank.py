#!/usr/bin/env python3
"""Banco de fragmentos para entrenar Laya de consultas (etapa 3). Redacción: DeepSeek flash.

Cada fragmento tiene una etiqueta conocida por construcción (el concepto o la clase que se pidió
redactar), así que la alineación con los fragmentos del segmentador no depende del modelo.
La prueba reservada se redactó antes y por otro autor; este banco nunca la lee.
Salida: <out>/bank.jsonl (texto, etiqueta, clase, autor, lote) y <out>/usage.json.
"""
from __future__ import annotations
import json, sys, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
env = dict(l.split("=", 1) for l in (ROOT / ".env").read_text().splitlines() if l.startswith("DEEPSEEK_"))
KEY = env["DEEPSEEK_API_KEY"].strip()
MODEL = env.get("DEEPSEEK_MODEL_FAST", env.get("DEEPSEEK_MODEL", "deepseek-flash")).strip()
LEX = json.loads((ROOT / "docs/unified-search/stage3/query-lexicon.json").read_text())
usage = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0}
lock = threading.Lock()

SYSTEM = ("Redactas fragmentos breves de búsquedas reales de música. "
          "Escribe como escribe la gente en un buscador: minúsculas, sin punto final, a veces coloquial venezolano (pa', full, chévere, burda, vaina), "
          "a veces neutro y a veces en inglés. Cada fragmento expresa SOLO lo pedido; no añadas géneros, emociones, actividades ni temas distintos. "
          "PROHIBIDO mencionar géneros o estilos (rock, metal, salsa, pop…), países u orígenes (venezolano, latino…), artistas o «playlist»; "
          "usa como mucho «música», «canciones», «temas» o «algo». "
          "Responde SOLO JSON: {\"phrases\": [\"...\"]}.")


def call(prompt: str, n: int) -> list[str]:
    body = json.dumps({"model": MODEL, "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt + f"\nDevuelve {n} fragmentos distintos."}],
                       "response_format": {"type": "json_object"}, "max_tokens": 2500, "temperature": 1.1, "thinking": {"type": "disabled"}, "stream": False}).encode()
    req = urllib.request.Request("https://api.deepseek.com/chat/completions", body, {"content-type": "application/json", "authorization": f"Bearer {KEY}"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.load(r)
            with lock:
                usage["calls"] += 1
                usage["prompt_tokens"] += data["usage"]["prompt_tokens"]
                usage["completion_tokens"] += data["usage"]["completion_tokens"]
            phrases = json.loads(data["choices"][0]["message"]["content"])["phrases"]
            return [p.strip() for p in phrases if isinstance(p, str) and 1 <= len(p.strip()) <= 90]
        except Exception as exc:  # noqa: BLE001 - reintento acotado
            if attempt == 2:
                print("fallo", prompt[:60], exc, file=sys.stderr)
                return []
    return []


ROLE = {
    "activity": "Fragmentos que piden música PARA esa actividad o uso (p. ej. «para X», «pa' X», «mientras X», «to X»).",
    "emotion": "Fragmentos que piden que la MÚSICA tenga ese carácter afectivo (adjetivos o expresiones sobre la música, no sobre la persona).",
    "energy": "Fragmentos que piden ese nivel de intensidad o energía en la música.",
    "atmosphere": "Fragmentos que piden ese ambiente sonoro en la música.",
    "theme": "Fragmentos que piden canciones cuyas LETRAS traten de ese tema («sobre X», «que hablen de X», «letras de X», «songs about X»).",
}


def jobs():
    for c in LEX["concepts"]:
        yield ("concept", c["id"], f"Concepto: {c['labelEs']} ({c['id']}). Definición: {c['definitionEs']}\n{ROLE[c['dimension']]}\n"
               f"Varía mucho la forma; incluye unos pocos en inglés y algunos con estas palabras: {', '.join(c['aliases'][:4] + c['themeNouns'][:3])}.", 30)
    for f in LEX["facets"]:
        yield ("facet", f["id"], f"Rasgo técnico pedido: {f['definition']}. Ejemplos de la idea: {', '.join(f['aliases'])}.\n"
               "Fragmentos que piden música con ese rasgo de producción, voz, estructura o escucha.", 14)
    for g in LEX["genres"]:
        if len(g["traits"]) >= 2 and g["mapStatus"] != "excluded_by_decision":
            traits = "; ".join(t["description"] for t in g["traits"])
            yield ("genre_description", f"genre:{g['slug']}", f"Rasgos documentados de un estilo musical: {traits}\n"
                   "Escribe cómo describiría ese SONIDO alguien que no recuerda el nombre del estilo. NO escribas el nombre del estilo ni de sus subgéneros, "
                   "ni palabras como su nombre en otro idioma. Describe instrumentos, ritmo, voces, forma o producción.", 5)
    yield ("listener", "listener", "Fragmentos donde la persona cuenta CÓMO SE SIENTE O ESTÁ ella ahora («estoy…», «ando…», «me siento…», «i feel…»), sin pedir nada a la música.", 40)
    yield ("unsupported", "unsupported", "(Aquí SÍ puedes mencionar países u orígenes.) Restricciones concretas sobre la música que NO son género, emoción, energía, ambiente, actividad ni tema: tempo en BPM, duración, compás, "
           "colores, clima, país u origen, idioma de la letra, año exacto, sello discográfico, número de integrantes, etc.", 40)
    yield ("filler", "filler", "Relleno de búsqueda sin pedido musical concreto: cortesía, valoraciones vagas («algo bueno», «lo mejor», «que esté chévere»), "
           "muletillas («lo que sea», «sorpréndeme»).", 30)


def main(out_dir: str):
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    rows = []
    todo = list(jobs())
    with ThreadPoolExecutor(6) as pool:
        for (kind, label, _p, _n), phrases in zip(todo, pool.map(lambda j: call(j[2], j[3]), todo)):
            for p in dict.fromkeys(phrases):
                rows.append({"text": p, "label": label, "class": kind, "author": f"DeepSeek ({MODEL})", "batch": "bank-0.2.0"})
            print(kind, label, len(phrases), flush=True)
    with open(out / "bank.jsonl", "w") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (out / "usage.json").write_text(json.dumps({**usage, "model": MODEL, "rows": len(rows)}, indent=1))
    print(json.dumps(usage))


if __name__ == "__main__":
    main(sys.argv[1])
