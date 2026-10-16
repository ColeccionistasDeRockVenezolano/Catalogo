#!/usr/bin/env python3
"""Ledger de géneros para scripts/apply-source-genres.ts (formato LedgerRow).

Fuente: los géneros que la banda declaraba en su perfil MySpace clásico (title del perfil:
«… - Ciudad - Géneros - www…») y su campo Genres. El orden es el del perfil (el primero
manda como principal). Regla de Brian: si una fuente dice el género y la ficha no lo tiene,
entra directo.

Salida: reports/genre-laya-evidence-myspace-wayback-2026-10-16.jsonl
Uso: python3 scripts/myspace-2026-10-16/05-generos-ledger.py
"""
import collections
import json
import re
from pathlib import Path

PLAN = Path("reports/myspace-2026-10-16/plan/genero-epoca.jsonl")
PILOTO = Path("reports/ma-links-2026-10-15/myspace-piloto.jsonl")
SALIDA = Path("reports/genre-laya-evidence-myspace-wayback-2026-10-16.jsonl")
TITULO = re.compile(r"^\s*MySpace\.com\s*-\s*(?P<banda>[^-]+?)\s*-\s*(?P<ciudad>[^-]+?)\s*-\s*(?P<generos>[^-]+?)\s*-\s*(?P<url>\S+)", re.I)


def main() -> None:
    pilotos = {}
    for l in PILOTO.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(l)
        except Exception:
            continue
        pilotos[str(r.get("slug") or r.get("ma_id"))] = r

    filas = [json.loads(l) for l in PLAN.read_text(encoding="utf-8").splitlines() if l.strip()]
    por_artista: dict[int, dict] = {}
    for f in filas:
        aid = f["artistId"]
        entrada = por_artista.setdefault(aid, {"banda": f["banda"], "url": f["url"], "orden": [], "resto": []})
        # orden: los géneros del título clásico van primero (orden declarado por la banda)
        r = next((p for p in pilotos.values() if p.get("crv_artist_id") and int(p["crv_artist_id"]) == aid), None)
        m = TITULO.match((r or {}).get("titulo") or "")
        del_titulo = {g.strip() for g in re.split(r"[/,]", m.group("generos")) if g.strip()} if m else set()
        etiqueta = f["genre"].strip()
        if etiqueta in del_titulo:
            if etiqueta not in entrada["orden"]:
                entrada["orden"].append(etiqueta)
        elif etiqueta not in entrada["resto"]:
            entrada["resto"].append(etiqueta)

    n = 0
    with open(SALIDA, "w", encoding="utf-8") as fh:
        for aid, e in sorted(por_artista.items()):
            generos = e["orden"] + [g for g in e["resto"] if g not in e["orden"]]
            if not generos:
                continue
            fila = {
                "caseId": f"artist-{aid}",
                "kind": "artist",
                "entityId": aid,
                "source": "myspace-wayback",
                "url": e["url"],
                "title": e["banda"],
                "rawGenres": generos,
                "pages": [{"url": e["url"]}],
            }
            fh.write(json.dumps(fila, ensure_ascii=False) + "\n")
            n += 1
    print(f"ledger de géneros: {n} fichas → {SALIDA}")
    conteo = collections.Counter()
    for aid, e in por_artista.items():
        for g in e["orden"] + e["resto"]:
            conteo[g] += 1
    print("términos:", dict(conteo.most_common(18)))


if __name__ == "__main__":
    main()
