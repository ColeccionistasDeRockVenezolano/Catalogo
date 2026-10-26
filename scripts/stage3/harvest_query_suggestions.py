#!/usr/bin/env python3
"""Cosecha consultas reales de música desde el autocompletado público de YouTube y Google.

Etapa 3, versión 1.6.0 (decisión de Brian del 2026-10-25: «consultas reales
etiquetadas por una persona»). El autocompletado devuelve consultas que mucha
gente escribió de verdad (región VE, idioma es); no las redacta ningún modelo.
Cada respuesta se guarda cruda con su semilla, cliente y hora en el staging del
SSD; nada se escribe en el almacén ni en la base. Las semillas salen del léxico
congelado (géneros y conceptos) y de aperturas genéricas de petición musical.

Uso:
  python3 scripts/stage3/harvest_query_suggestions.py --out $HOME/crv-staging/tmp-analysis/<campaña>
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEXICON = ROOT / "docs/unified-search/stage3/query-lexicon.json"
ENDPOINT = "https://suggestqueries.google.com/complete/search"
CLIENTS = {"youtube": {"ds": "yt"}, "web": {}}

OPENERS = [
    "musica para", "música para", "canciones para", "algo para", "playlist para", "musica de", "canciones de",
    "musica que", "canciones que", "musica sin", "musica tipo", "musica como", "bandas de", "grupos de",
    "bandas venezolanas", "musica venezolana", "rock venezolano", "rock para", "salsa para", "musica romantica",
    "musica triste", "musica alegre", "canciones tristes", "canciones alegres", "musica relajante", "musica para escuchar",
    "que musica escuchar", "que escuchar cuando", "canciones para cuando", "musica para cuando", "musica con",
    "canciones con", "musica instrumental", "musica de los", "canciones de los", "musica vieja", "musica nueva",
    "musica rapida", "musica lenta", "musica fuerte", "musica suave", "musica oscura", "musica epica",
    "canciones para dedicar", "musica para bailar", "musica para el carro", "musica para la playa",
    "recomiendame musica", "recomiendenme musica", "canciones parecidas a", "bandas parecidas a",
]
LETTERS = "abcdefghijklmnopqrstuvwxyz"


def fetch(query: str, client: str) -> list[str]:
    params = {"client": "firefox", "hl": "es", "gl": "VE", "q": query, **CLIENTS[client]}
    req = urllib.request.Request(f"{ENDPOINT}?{urllib.parse.urlencode(params)}", headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) crv-research"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8", "replace"))
    return [s for s in data[1] if isinstance(s, str)]


def seeds() -> list[str]:
    lex = json.loads(LEXICON.read_text())
    out: list[str] = []
    for opener in OPENERS:
        out.append(opener)
        out.extend(f"{opener} {letter}" for letter in LETTERS)
    for genre in lex["genres"]:
        name = genre["name"].lower()
        out.extend([name, f"{name} para", f"{name} venezolano", f"{name} que"])
    for concept in lex["concepts"]:
        label = concept["labelEs"].lower()
        out.extend([f"musica {label}", f"canciones {label}"])
    return list(dict.fromkeys(out))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--delay", type=float, default=0.35)
    ap.add_argument("--workers", type=int, default=1)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    raw = args.out / "suggestions-raw.jsonl"
    done = set()
    if raw.exists():
        for line in raw.read_text().splitlines():
            row = json.loads(line)
            done.add((row["seed"], row["client"]))
    todo = [(s, c) for s in seeds() for c in CLIENTS if (s, c) not in done]
    print(f"semillas×clientes pendientes: {len(todo)}", flush=True)
    def one(task: tuple[str, str]) -> dict | None:
        seed, client = task
        try:
            suggestions = fetch(seed, client)
        except Exception as exc:  # noqa: BLE001 — se registra y se reintenta en la próxima corrida
            print(f"error {seed!r} {client}: {exc}", flush=True)
            time.sleep(5)
            return None
        time.sleep(args.delay)
        return {"seed": seed, "client": client, "suggestions": suggestions, "at": datetime.now(timezone.utc).isoformat()}

    with raw.open("a") as fh, ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, row in enumerate(pool.map(one, todo), 1):
            if row:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
                fh.flush()
            if i % 200 == 0:
                print(f"{i}/{len(todo)}", flush=True)

if __name__ == "__main__":
    main()
