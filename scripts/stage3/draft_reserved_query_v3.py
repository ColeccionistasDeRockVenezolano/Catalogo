#!/usr/bin/env python3
"""Borrador de la tercera prueba reservada de consultas (etapa 3, criterios 1.2.0).

Para que la redacción no dependa de quien corrige el sistema, DeepSeek flash redacta las frases
a partir de una especificación por categoría; los conceptos, géneros y entidades se sortean con
semilla fija (nombres reales de la instantánea del catálogo). Claude etiqueta después cada frase
con las convenciones de la prueba (author_reserved_query_test_v3.py) sin pasar el sistema por ellas.

  draft_reserved_query_v3.py <salida-dir> [semilla]   (escribe drafts.jsonl y usage.json; nada en la base)

La semilla 31 redactó la prueba 3.0.0 (criterios 1.2.0); la 47, la prueba 4.0.0 (criterios 1.3.0).
Las frases ya presentes en cualquier conjunto de `datasets/` se descartan.
"""
from __future__ import annotations
import json, random, sys, urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEX = json.loads((ROOT / "docs/unified-search/stage3/query-lexicon.json").read_text())
CATALOG = Path.home() / ".cache/crv-stage3/catalog-names-2026-10-25.json"
DS = ROOT / "docs/unified-search/stage3/datasets"
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 31
rnd = random.Random(SEED)

concepts = {d: [c for c in LEX["concepts"] if c["dimension"] == d] for d in ("activity", "emotion", "energy", "atmosphere", "theme")}
label = lambda c: f'{c["labelEs"]} ({c["definitionEs"]})'
genres = [g for g in LEX["genres"] if g["definition"] and g["traits"]]
used_texts = set()
for f in DS.glob("query-*.json"):
    for c in json.loads(f.read_text())["cases"]:
        used_texts.add(c["text"].lower())

names = json.loads(CATALOG.read_text())["names"]
lex_phrases = {a for c in LEX["concepts"] for a in c["aliases"] + c["themeNouns"]} | {a for g in LEX["genres"] for a in g["aliases"]}
def sample_names(kind: str, k: int) -> list[str]:
    pool = sorted({n for _, n in names[kind] if 3 <= len(n) <= 28 and n.lower() not in lex_phrases and not any(ch in n for ch in "()[]/:")})
    return rnd.sample(pool, k)

SPECS: list[tuple[str, int, str]] = []
def spec(cat: str, n: int, text: str):
    SPECS.append((cat, n, text))

pick = lambda xs, k: rnd.sample(xs, min(k, len(xs)))
spec("activity", 17, "Cada frase pide música para UNA de estas actividades (una frase por actividad, en este orden, repitiendo si hace falta): "
     + "; ".join(label(c) for c in pick(concepts["activity"], 14)) + ". Usa formas variadas de decirlo (verbos, situaciones concretas).")
spec("emotion", 16, "Cada frase pide música con UNA de estas cualidades afectivas (una por frase, en este orden): "
     + "; ".join(label(c) for c in pick(concepts["emotion"], 16)) + ". Varía adjetivos, sinónimos y giros coloquiales.")
spec("energy", 5, "Cada frase pide música con un nivel de energía: baja, media o alta (varía cuál y cómo se dice).")
spec("atmosphere", 14, "Cada frase pide música con UNO de estos ambientes (en este orden): " + "; ".join(label(c) for c in pick(concepts["atmosphere"], 14)) + ".")
spec("theme", 15, "Cada frase pide canciones cuya letra trate de UNO de estos temas (en este orden): " + "; ".join(label(c) for c in pick(concepts["theme"], 15)) + ". Varía la forma de pedirlo.")
spec("genre", 15, "Cada frase pide música de UNO de estos géneros, nombrándolo como lo diría una persona (en este orden): " + "; ".join(g["name"] for g in pick(genres, 15)) + ".")
spec("and", 24, "Cada frase combina DOS o TRES pedidos a la vez (género, emoción, ambiente, actividad, tema o energía), p. ej. un género para una actividad con cierta emoción. Todas distintas.")
spec("or", 11, "Cada frase ofrece ALTERNATIVAS con «o» entre dos géneros, dos emociones, dos ambientes, dos actividades o dos temas; algunas añaden otro pedido fijo.")
spec("negation", 19, "Cada frase pide algo y EXCLUYE otra cosa (sin, no, que no sea, nada de, excepto, menos, ni), o solo excluye. Excluye géneros, emociones, ambientes, temas o energía.")
spec("preference", 7, "Cada frase pide algo y añade una PREFERENCIA no obligatoria (preferiblemente, de preferencia, mejor si es, ojalá, si es posible, idealmente).")
spec("listener", 12, "Cada frase empieza contando cómo se siente o está la persona (estoy, ando, me siento) y luego pide música; lo pedido puede ser distinto de su estado.")
spec("unsupported", 19, "Cada frase pide algo que un buscador por género/emoción/ambiente/actividad/tema NO puede representar: tempo en BPM, duración, compás, idioma, color, voz masculina/femenina, instrumentación concreta (sin nombrar género), grabación en vivo, remasterizado, rasgos de producción (lo-fi, samples, voz al fondo de la mezcla), estructura (temas enlazados sin pausas, álbum conceptual), recepción (gana con las escuchas). Algunas combinan eso con una actividad o emoción representable.")
spec("decade", 4, "Cada frase pide un género o una emoción de una década concreta (años 60, 70, 80, 90 o 2000).")
spec("clarify", 11, "Cada frase es AMBIGUA: una palabra que puede querer decir varias cosas (p. ej. caliente, intenso, aura, para recordar, amor como tema o como romanticismo, sexo como actividad o como tema, psicodélico como ambiente o como género, animarme). Una frase por ambigüedad, todas distintas.")
spec("contradiction", 5, "Cada frase se contradice sola: pide algo y lo excluye a la vez, o pide dos niveles de energía incompatibles.")
spec("multilingual", 5, "Cada frase está en INGLÉS y pide música por actividad, emoción, ambiente o género.")
desc = pick([g for g in genres if g["level"] != "root"] or genres, 13)
spec("described", 13, "Cada frase describe cómo SUENA la música (instrumentos, ritmo, voz, producción) SIN nombrar el género, para que alguien adivine el género. Una frase por género, en este orden: " + "; ".join(f'{g["name"]} ({g["definition"][:160]})' for g in desc) + ".")

SYSTEM = ("Redactas consultas reales que una persona venezolana o latinoamericana escribiría en el buscador de un archivo de música. "
          "Español natural y variado (coloquial a veces), sin comillas, sin nombres de artistas salvo que se pida. "
          "Devuelve JSON {\"queries\": [{\"text\": ..., \"intent\": breve explicación de lo que pide}]} con exactamente el número pedido.")


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    env = dict(l.split("=", 1) for l in (ROOT / ".env").read_text().splitlines() if l.startswith("DEEPSEEK_"))
    key, model = env["DEEPSEEK_API_KEY"].strip(), env.get("DEEPSEEK_MODEL_FAST", "deepseek-flash").strip()
    usage = Counter()

    def call(s):
        cat, n, text = s
        body = json.dumps({"model": model, "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": f"Categoría: {cat}. Número de frases: {n}.\n{text}"}],
                           "response_format": {"type": "json_object"}, "max_tokens": 3000, "temperature": 0.9, "thinking": {"type": "disabled"}, "stream": False}).encode()
        req = urllib.request.Request("https://api.deepseek.com/chat/completions", body, {"content-type": "application/json", "authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.load(resp)
        usage["calls"] += 1; usage["prompt"] += data["usage"]["prompt_tokens"]; usage["completion"] += data["usage"]["completion_tokens"]
        qs = json.loads(data["choices"][0]["message"]["content"])["queries"]
        return [{"category": cat, "text": q["text"].strip(), "intent": q.get("intent", ""), "spec": text} for q in qs if q["text"].lower().strip() not in used_texts]

    with ThreadPoolExecutor(6) as ex:
        rows = [r for batch in ex.map(call, SPECS) for r in batch]
    # Entidades y parecido: nombres sorteados del catálogo; el patrón de la frase lo fija la plantilla.
    artists, tracks, albums = sample_names("artist", 30), sample_names("track", 10), sample_names("album", 4)
    ent = ([("entity", f"busca la canción {t}") for t in tracks[:4]] + [("entity", f"la canción «{tracks[4]}»"), ("entity", f"el tema {tracks[5]}"), ("entity", f"el tema {tracks[6]}")]
           + [("entity", f"busca el disco {albums[0]}"), ("entity", f"el disco {albums[1]}"), ("entity", f"busca la banda {artists[0]}")]
           + [("entity", a) for a in artists[1:9]] + [("entity", f"temas de {artists[9]}"), ("entity", f"discos de {artists[10]}"), ("entity", f"canciones de {artists[11]}")]
           + [("entity", f"la canción {tracks[7]}"), ("entity", f"el tema {tracks[8]}"), ("entity", f"canción \"{tracks[9]}\"")])
    sim = [("similarity", t) for t in (f"algo parecido a {artists[12]}", f"bandas como {artists[13]}", f"música similar a {artists[14]}", f"parecido a {artists[15]} en la voz",
                                       f"al estilo de {artists[16]} en las guitarras", f"que suene como {artists[17]} en la producción", f"como {artists[18]} pero más triste",
                                       f"parecido a {artists[19]} en el ambiente", f"algo al estilo de {artists[20]} para manejar")]
    rows += [{"category": c, "text": t, "intent": "plantilla con nombre sorteado del catálogo", "spec": "catálogo"} for c, t in ent + sim]
    rows += [{"category": "noise", "text": t, "intent": "ruido", "spec": "fijo"} for t in ("qwrt pfff", "temas", "algo nice")]
    with open(out / "drafts.jsonl", "w") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    (out / "usage.json").write_text(json.dumps({**usage, "model": model, "seed": SEED}, indent=1))
    print(json.dumps({"rows": len(rows), **usage, "byCategory": Counter(r["category"] for r in rows)}, ensure_ascii=False))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
