#!/usr/bin/env python3
"""Banco de fragmentos para entrenar Laya de consultas (etapa 3). Redacción: DeepSeek flash.

Cada fragmento tiene una etiqueta conocida por construcción (el concepto o la clase que se pidió
redactar), así que la alineación con los fragmentos del segmentador no depende del modelo.
La prueba reservada se redactó antes y por otro autor; este banco nunca la lee.
Salida: <out>/bank.jsonl (texto, etiqueta, clase, autor, lote) y <out>/usage.json.
Con --supplement redacta el suplemento 0.3.0 (circunstancias, oyente, relleno).
Con --supplement2 redacta el suplemento 0.4.0 (cláusulas de refuerzo por concepto e intensificadores).
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


def supplement_jobs():
    """Suplemento 0.3.0 (versión 1.3.0): circunstancias que acompañan a una actividad sin pedir nada a la
    música, y más estados del oyente y relleno. Las clases que Laya confundía con restricciones."""
    for topic in ("cuándo (hora, día, frecuencia: «todas las mañanas», «el sábado», «temprano»)",
                  "cuánto dura («media hora», «un rato», «quince minutos al día»)",
                  "con quién («con mi pareja», «con los panas», «con la familia», «de mi mamá»)",
                  "dónde o con qué objeto («en la casa», «por la avenida», «un libro con un café», «en la oficina»)"):
        yield ("filler", "circumstance", f"Complementos que alguien añade DESPUÉS de una actividad en una búsqueda de música («para correr …», «para leer …»), indicando {topic}. "
               "Escribe SOLO el complemento, sin la actividad, sin «para» al inicio, sin pedir nada sobre cómo debe sonar la música.", 40)
    yield ("listener", "listener", "Fragmentos donde la persona cuenta CÓMO SE SIENTE O ESTÁ ella ahora o qué le pasa («estoy…», «ando…», «me siento…», «hoy tengo…»), con causas variadas, sin pedir nada a la música.", 60)
    yield ("filler", "filler", "Relleno de búsqueda sin pedido musical concreto: cortesía, valoraciones vagas, muletillas, comentarios sobre la propia búsqueda.", 40)


# Palabras que las convenciones de etiqueta dejan pendientes (ocasión fuera del vocabulario, idioma, duración,
# tempo, instrumentación, voz, versión, origen, popularidad): una cláusula de refuerzo que las use no es relleno.
import re
PENDING_WORDS = re.compile(r"\b(dedic\w*|limpi\w*|cocin\w*|orar|rez\w*|playa|ingl[eé]s|espa[nñ]ol|franc[eé]s|idioma|letra\w*|minut\w*|segund\w*|hora\w*|bpm|tempo|"
                           r"lent\w*|r[aá]pid\w*|guitarr\w*|bater[ií]\w*|bajo|piano|viol[ií]n\w*|voz|voces|cant\w*|coro\w*|en vivo|remaster\w*|"
                           r"venezol\w*|latin\w*|famos\w*|conocid\w*|nuev\w*|viej\w*|antigu\w*|cl[aá]sic\w*|instrument\w*)\b", re.I)


def supplement2_jobs():
    """Suplemento 0.4.0 (versión 1.5.0): cláusulas que refuerzan o elaboran un pedido ya hecho sin añadir
    otra restricción («que te parta el alma» tras «tristes», «sin distraerme» tras «para estudiar»).
    En 1.4.0 Laya las dejaba pendientes. La etiqueta es relleno; `pair` guarda el concepto que refuerzan."""
    for c in LEX["concepts"]:
        yield ("elaboration", c["id"], f"Alguien ya pidió música con este concepto: {c['labelEs']} ({c['id']}). Definición: {c['definitionEs']}\n"
               "Escribe SOLO la cláusula que añadiría DESPUÉS para reforzar o explicar lo mismo con otras palabras, sin pedir nada nuevo: "
               "consecuencias en quien escucha («que te parta el alma», «para sentirme vivo», «que me saque de la rutina»), imágenes («como si flotaras»), "
               "intensidad del deseo («de esas que te llegan»), finalidad equivalente («sin distraerme», «para no pensar en nada»). "
               "Empieza con «que», «para», «de esas que», «como», «sin» o similar. NO nombres idiomas, épocas, duración, tempo, instrumentos, voces, países ni otro concepto distinto.", 14)
    for cid, idea in (("energy:energy-high", "mucha potencia, rapidez y fuerza («rápido y fuerte», «con mucha potencia», «con mucho ritmo», «a todo dar», «bien prendido»)"),
                      ("energy:energy-low", "poca intensidad («bajito», «de poca intensidad», «nada estridente», «calmadito»)")):
        yield ("concept", cid, f"Concepto: {cid}. Fragmentos que piden ese nivel de energía con intensificadores coloquiales: {idea}.", 30)


def main(out_dir: str, supplement: bool = False, supplement2: bool = False):
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    rows = []
    todo = list(supplement2_jobs() if supplement2 else supplement_jobs() if supplement else jobs())
    batch = "bank-0.4.0-supplement" if supplement2 else "bank-0.3.0-supplement" if supplement else "bank-0.2.0"
    with ThreadPoolExecutor(6) as pool:
        for (kind, label, _p, _n), phrases in zip(todo, pool.map(lambda j: call(j[2], j[3]), todo)):
            for p in dict.fromkeys(phrases):
                if kind == "elaboration":
                    if PENDING_WORDS.search(p): continue
                    rows.append({"text": p, "label": "filler", "class": "filler", "sub": "elaboration", "pair": label, "author": f"DeepSeek ({MODEL})", "batch": batch})
                    continue
                rows.append({"text": p, "label": "filler" if label == "circumstance" else label, "class": kind, "author": f"DeepSeek ({MODEL})",
                             "batch": batch, **({"sub": "circumstance"} if label == "circumstance" else {})})
            print(kind, label, len(phrases), flush=True)
    with open(out / "bank.jsonl", "w") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (out / "usage.json").write_text(json.dumps({**usage, "model": MODEL, "rows": len(rows)}, indent=1))
    print(json.dumps(usage))


if __name__ == "__main__":
    main(sys.argv[1], "--supplement" in sys.argv, "--supplement2" in sys.argv)
