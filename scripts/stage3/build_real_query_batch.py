#!/usr/bin/env python3
"""Arma el lote de consultas reales que Brian etiqueta en Administrar › Buscador › Etiquetar consultas.

Etapa 3, versión 1.6.0. Fuentes, todas escritas por personas:
  * ingest.search_misses / ingest.search_operations: búsquedas del sitio (ya saneadas);
  * el autocompletado público de YouTube y Google (región VE, idioma es),
    cosechado por harvest_query_suggestions.py.

Nada lo redacta un modelo. El filtro solo decide si una sugerencia es una
petición musical (vocabulario del léxico congelado) y descarta letras, acordes,
descargas y tutoriales. La partición prueba/entrenamiento se sortea aquí, antes
de cualquier etiqueta, con semilla fija, y queda escrita en el lote.

Uso:
  python3 scripts/stage3/build_real_query_batch.py --raw <staging>/suggestions-raw.jsonl
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import subprocess
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEXICON = ROOT / "docs/unified-search/stage3/query-lexicon.json"
OUT = ROOT / "docs/unified-search/stage3/datasets/query-real-labeling-1.json"
VERSION = "crv-query-real-labeling-1.0.0"
SEED = 97
SIZE = 300
TEST_SHARE = 0.4
PER_SEED = 2

# Palabras que por sí solas hacen musical la petición. «grupos», «bandas», «temas», «mix» o «lista»
# no bastan («grupos de investigación paranormal»): necesitan además un género o concepto del léxico.
MUSIC_WORDS = {"musica", "canciones", "cancion", "playlist", "album", "disco", "discos", "cantantes", "cantante", "rolas", "baladas"}
# Búsquedas de otra cosa que la música del catálogo.
EXCLUDE = re.compile(r"\b(letra|letras|lyrics|acordes|chords|tabs?|karaoke|descargar|download|mp3|mp4|tutorial|como tocar|como hacer|"
                     r"como bailar|clases|aprender a|partitura|ringtone|tono de llamada|gratis|free fire|minecraft|roblox|fortnite|tiktok|"
                     r"capcut|editar|edits?|video de|para videos?|sin copyright|copyright|derechos? de autor|de fondo para|status|estados?|"
                     r"whatsapp|telegram|facebook|instagram|reproductor|app|aplicacion|sin conexion|sin anuncios|celular|xiaomi|samsung|iphone|"
                     r"investigacion|paranormal|juegos|estudio biblico|wifi|perdida|registro|valoracion|tension alta|presion alta|"
                     # «salsa» de cocina
                     r"hamburguesas?|smash|chuletas?|ahumad[ao]s?|pasta|alitas|tacos|pollo|carne|pizza|espagueti|spaghetti|receta|tomate|pescado|nachos|ensalada|sushi|"
                     r"papas|camarones|costillas|enchiladas|hot ?dogs?|pan|arroz|bbq|barbacoa|soya|picante|teriyaki|bechamel|pesto|cebolla)\b")


def norm(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9ñ\s]", " ", text)).strip()


def vocabulary() -> set[str]:
    lex = json.loads(LEXICON.read_text())
    words: set[str] = set()
    for genre in lex["genres"]:
        words.add(norm(genre["name"]))
        words.update(norm(a) for a in genre.get("aliases", []))
    for concept in lex["concepts"]:
        if concept["dimension"] in {"activity", "emotion", "energy", "atmosphere"}:
            words.update(norm(a) for a in concept["aliases"] if len(a) > 3)
    return {w for w in words if w}


def musical(text: str, vocab: set[str]) -> bool:
    n = f" {norm(text)} "
    if EXCLUDE.search(n):
        return False
    return any(f" {w} " in n for w in MUSIC_WORDS) or any(f" {w} " in n for w in vocab)


def site_queries() -> list[dict]:
    sql = ("SELECT json_agg(x) FROM (SELECT sample_query AS text, 'search_miss' AS source FROM ingest.search_misses "
           "UNION SELECT sample AS text, 'search_operation' AS source FROM ingest.search_operations WHERE sample IS NOT NULL) x")
    out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-Atc", sql], check=True, capture_output=True, text=True).stdout
    return json.loads(out or "[]") or []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, type=Path)
    args = ap.parse_args()
    vocab = vocabulary()
    rows = [json.loads(line) for line in args.raw.read_text().splitlines()]
    rng = random.Random(SEED)

    seen: set[str] = set()
    site = []
    queries = site_queries()
    keys = {norm(q["text"]) for q in queries}
    for q in sorted(queries, key=lambda q: q["text"]):
        key = norm(q["text"])
        # El registro guarda también lo que se iba tecleando («Overkrain» antes de «Overkrainv»): queda la forma más larga.
        # Las pruebas técnicas del propio sitio («zzqx…», identificadores con «__») no son búsquedas de nadie.
        if "__" in q["text"] or key.startswith("zzq"):
            continue
        if not key or key in seen or any(k != key and k.startswith(key) for k in keys):
            continue
        seen.add(key)
        site.append({"text": q["text"].strip(), "source": q["source"]})

    by_seed: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        for text in row["suggestions"]:
            key = norm(text)
            if not key or key in seen or not musical(text, vocab):
                continue
            seen.add(key)
            by_seed[row["seed"]].append({"text": text.strip(), "source": "youtube_suggest" if row["client"] == "youtube" else "web_suggest", "seed": row["seed"]})
    eligible = sum(len(v) for v in by_seed.values())

    # Hasta PER_SEED por semilla, para que una apertura frecuente no llene el lote.
    pool = []
    for seed in sorted(by_seed):
        items = by_seed[seed][:]
        rng.shuffle(items)
        pool.extend(items[:PER_SEED])
    rng.shuffle(pool)
    chosen = site + pool[: SIZE - len(site)]
    rng.shuffle(chosen)

    tests = set(rng.sample(range(len(chosen)), round(len(chosen) * TEST_SHARE)))
    items = [{"id": f"RL{i + 1:04d}", **item, "split": "test_real_human" if i in tests else "train_real_human"} for i, item in enumerate(chosen)]
    batch = {
        "version": VERSION,
        "builtAt": date.today().isoformat(),
        "builtBy": "scripts/stage3/build_real_query_batch.py",
        "decision": "Brian, 2026-10-25: «consultas reales etiquetadas por una persona» (opción 1 tras la versión 1.5.0)",
        "sources": {"suggestions": {"file": args.raw.name, "sha256": hashlib.sha256(args.raw.read_bytes()).hexdigest(), "responses": len(rows),
                                    "eligibleMusical": eligible, "seeds": len(by_seed),
                                    "coverage": "La cosecha del 2026-10-25 se detuvo cuando Google respondió 403 (límite de frecuencia): faltan las semillas de géneros desde «punk» y las de conceptos sueltos."},
                    "site": {"tables": ["ingest.search_misses", "ingest.search_operations"], "queries": len(site)}},
        "selection": {"seed": SEED, "size": len(items), "perSeedCap": PER_SEED, "testShare": TEST_SHARE},
        "policy": ("Etiqueta humana a ciegas: la página no muestra la lectura del sistema. La partición se sorteó antes de etiquetar. "
                   "Las consultas test_real_human forman la prueba de la versión 1.6.0 y no se usan para reglas, léxico ni entrenamiento."),
        "items": items,
    }
    OUT.write_text(json.dumps(batch, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(items)} consultas ({len(site)} del sitio, {len(items) - len(site)} del autocompletado; {len(tests)} de prueba) "
          f"de {eligible} elegibles → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
