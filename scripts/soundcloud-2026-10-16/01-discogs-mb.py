#!/usr/bin/env python3
"""SoundCloud por fuentes deterministas (2026-10-16): Discogs urls[] + MusicBrainz url-rels.

Para cada artista del catálogo sin perfil de SoundCloud verificado:
  · Discogs (API oficial, DISCOGS_TOKEN del .env): búsqueda por nombre -> ficha -> urls[]
  · MusicBrainz (API pública, 1 req/s): búsqueda por nombre -> url-rels

Escribe lotes en el formato que YA entiende scripts/apply-soundcloud-chatgpt.ts (que verifica
og:type/og:title contra la página canónica y el dueño del perfil antes de escribir). Reanudable.

Uso: python3 01-discogs-mb.py [--limit N] [--solo discogs|mb] [--pausa S] [--min-discos N]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
DEST = ROOT / "reports" / "soundcloud-2026-10-16" / "lotes-fuentes"
ESTADO = ROOT / "reports" / "soundcloud-2026-10-16" / "estado-fuentes.json"
UA = "CRV-reproductores/1.0 (+coleccionistasderockvenezolano.com)"
SC = re.compile(r"soundcloud\.com/([A-Za-z0-9_.-]+)(?:/(?:sets|tracks)/?([A-Za-z0-9_.-]*))?", re.I)


def env(clave: str) -> str:
    for linea in (ROOT / ".env").read_text(encoding="utf8", errors="replace").splitlines():
        if linea.startswith(clave + "="):
            return linea.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get(clave, "")


def norm(t: str) -> str:
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    t = re.sub(r"\b(?:el|la|los|las|the)\b", " ", t)
    return " ".join("".join(c if c.isalnum() else " " for c in t).split())


def pide(url: str, timeout: int = 25) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    for intento in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf8", "replace") or "{}")
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                time.sleep(4 * (intento + 1))
                continue
            return None
        except Exception:
            time.sleep(2)
    return None


def psql(sql: str) -> list[list[str]]:
    out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAc", sql, "-F", "\t"],
                         capture_output=True, text=True).stdout
    return [l.split("\t") for l in out.splitlines() if l.strip()]


def artistas(min_discos: int) -> list[tuple[int, str, int]]:
    filas = psql(f"""
        SELECT a.id, a.name, count(al.id) AS discos
          FROM public.artists a LEFT JOIN public.albums al ON al.artist_id = a.id
         WHERE NOT EXISTS (SELECT 1 FROM public.streaming_links sl
                            WHERE sl.artist_id = a.id AND sl.platform='soundcloud' AND sl.verified)
         GROUP BY a.id, a.name HAVING count(al.id) >= {min_discos}
         ORDER BY count(al.id) DESC, a.name""")
    return [(int(f[0]), f[1], int(f[2])) for f in filas]


def por_discogs(nombre: str, token: str, pausa: float) -> dict | None:
    if not token:
        return None
    q = urllib.parse.urlencode({"q": nombre, "type": "artist", "per_page": 5, "token": token})
    res = pide(f"https://api.discogs.com/database/search?{q}")
    time.sleep(pausa)
    if not res:
        return None
    for r in (res.get("results") or [])[:3]:
        if norm(r.get("title", "")) != norm(nombre):
            continue
        ficha = pide(f"{r.get('resource_url')}?token={token}")
        time.sleep(pausa)
        if not ficha:
            continue
        for u in (ficha.get("urls") or []):
            if "soundcloud.com" in u.lower():
                return {"url": u.strip(), "confianza": "media",
                        "evidencia": f"Discogs urls[] de {ficha.get('name')} ({ficha.get('uri', '')})",
                        "motivo": "Perfil declarado por el propio artista en su ficha de Discogs."}
    return None


def por_mb(nombre: str, pausa: float) -> dict | None:
    q = urllib.parse.urlencode({"query": f'artist:"{nombre}"', "fmt": "json", "limit": 3})
    res = pide(f"https://musicbrainz.org/ws/2/artist?{q}")
    time.sleep(max(1.0, pausa))
    if not res or not res.get("artists"):
        return None
    for cand in res["artists"][:2]:
        if norm(cand.get("name", "")) != norm(nombre):
            continue
        rel = pide(f"https://musicbrainz.org/ws/2/artist/{cand['id']}?inc=url-rels&fmt=json")
        time.sleep(max(1.0, pausa))
        if not rel:
            continue
        for r in (rel.get("relations") or []):
            u = (r.get("url") or {}).get("resource", "")
            if "soundcloud.com" in u.lower():
                return {"url": u.strip(), "confianza": "alta",
                        "evidencia": f"MusicBrainz url-rels de {cand.get('name')} ({cand['id']})",
                        "motivo": "Relación declarada en MusicBrainz (fuente curada)."}
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--solo", choices=["discogs", "mb", "ambos"], default="ambos")
    ap.add_argument("--pausa", type=float, default=1.1)
    ap.add_argument("--min-discos", type=int, default=1)
    args = ap.parse_args()

    token = env("DISCOGS_TOKEN")
    DEST.mkdir(parents=True, exist_ok=True)
    hechas: set[int] = set(json.loads(ESTADO.read_text()).get("hechas", [])) if ESTADO.exists() else set()
    print(f"Discogs token: {'sí' if token else 'NO'} · ya procesadas: {len(hechas)}")

    lista = [a for a in artistas(args.min_discos) if a[0] not in hechas]
    if args.limit:
        lista = lista[: args.limit]
    print(f"artistas por revisar: {len(lista)} (de {len(artistas(args.min_discos))} sin SoundCloud verificado)")

    lote, numero, con_perfil, fallos = [], 0, 0, 0
    for i, (artista_id, nombre, discos) in enumerate(lista, 1):
        hallado = None
        if args.solo in ("discogs", "ambos"):
            hallado = por_discogs(nombre, token, args.pausa)
        if not hallado and args.solo in ("mb", "ambos"):
            hallado = por_mb(nombre, min(args.pausa, 1.05))
        if hallado:
            con_perfil += 1
            lote.append({"artistId": artista_id, "nombre": nombre, "soundcloud": hallado, "discos": []})
        hechas.add(artista_id)
        if i % 100 == 0 or i == len(lista):
            print(f"  {i}/{len(lista)} · con perfil: {con_perfil} · fallos: {fallos}")
        if len(lote) >= 400 or (i % 300 == 0 and lote):
            numero += 1
            (DEST / f"lote-{numero:03d}.json").write_text(
                json.dumps({"tramo": f"fuentes-{numero:03d}", "artistas": lote}, ensure_ascii=False, indent=1), encoding="utf8")
            lote = []
        ESTADO.write_text(json.dumps({"hechas": sorted(hechas)}, ensure_ascii=False), encoding="utf8")

    if lote:
        numero += 1
        (DEST / f"lote-{numero:03d}.json").write_text(
            json.dumps({"tramo": f"fuentes-{numero:03d}", "artistas": lote}, ensure_ascii=False, indent=1), encoding="utf8")
    print(f"LISTO: {len(lista)} revisados · {con_perfil} con perfil · {numero} lotes en {DEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
