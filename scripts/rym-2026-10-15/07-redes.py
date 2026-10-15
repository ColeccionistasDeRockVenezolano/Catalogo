#!/usr/bin/env python3
"""Redes sociales en lo ya capturado · 2026-10-15 (pedido de Brian).

Consume lo que extrajo `bash scripts/rym-2026-10-15/09-redes-extraer.sh` (dos pasadas de grep sobre data/raw) y atribuye cada
enlace a un artista del catálogo:

  · el nombre del artista sale del propio archivo (og:title, «"artist": …», <title>) o del nombre
    del archivo; debe casar con UN solo artista (nombre o alias, normalizado);
  · se descarta el pie de las fuentes (cuentas de RYM/Last.fm/Wikipedia…) y las rutas no-personales
    (sharer, intent, watch, p/…, grupos, eventos).

Salida: reports/redes-2026-10-15/redes.jsonl (artistId, platform, url, handle, evidencia, matchHandle)
"""
from __future__ import annotations

import collections
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
DEST = ROOT / "reports" / "redes-2026-10-15"
PARES = Path("/tmp/redes-pares-raw.txt")
NOMBRES = Path("/tmp/redes-nombres-raw.txt")

URL_RX = re.compile(r"(?:https?://)?(?:www\.|m\.)?(?:facebook\.com/|instagram\.com/|twitter\.com/|x\.com/|tiktok\.com/@|threads\.(?:net|com)/|youtube\.com/|[a-z0-9-]+\.bandcamp\.com)")
BASURA = re.compile(r"^(?:rateyourmusic|rym|lastfm|last\.fm|wikipedia|wikimedia|discogs|musicbrainz|theaudiodb|google|youtube|facebook|instagram|twitter|x|tiktok|threads|bandcamp|sharer|intent|share|p|reel|reels|watch|embed|results|search|login|signup|privacy|about|help|business|developers|policy|pages|groups|events|photo|photos|video|videos|hashtag|explore|music|channel|user|c)$", re.I)
PLATAFORMA = re.compile(r"facebook\.com|instagram\.com|twitter\.com|tiktok\.com|threads\.|youtube\.com|bandcamp\.com")


def normalizar(t: str) -> str:
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    t = re.sub(r"\b(?:official|oficial|music|musica|band|banda|the|el|la|los|las)\b", " ", t)
    return re.sub(r"[^a-z0-9]+", "", t)


def psql(sql: str) -> list[list[str]]:
    salida = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAc", sql, "-F", "\t"],
                            capture_output=True, text=True, check=True).stdout
    return [linea.split("\t") for linea in salida.splitlines() if linea.strip()]


def plataforma_de(url: str) -> str | None:
    if "facebook.com" in url:
        return "facebook"
    if "instagram.com" in url:
        return "instagram"
    if "twitter.com" in url or re.search(r"//(?:www\.)?x\.com/", url):
        return "x"
    if "tiktok.com" in url:
        return "tiktok"
    if "threads." in url:
        return "threads"
    if "youtube.com" in url:
        return "youtube"
    if "bandcamp.com" in url:
        return "bandcamp"
    return None


def limpiar_nombre(texto: str) -> str:
    t = re.sub(r"<[^>]+>", "", texto)
    t = re.sub(r"\s*[|·—–-]\s*(?:Rate Your Music|Last\.fm.*|Wikipedia.*|Discogs.*|Lobotoradio.*|Rock Hecho.*)$", "", t, flags=re.I)
    t = re.sub(r"^(?:perfil de|album|disc|rate your music)\s*", "", t, flags=re.I)
    return t.strip()[:90]


def main() -> int:
    DEST.mkdir(parents=True, exist_ok=True)
    por_nombre: dict[str, list[int]] = collections.defaultdict(list)
    for aid, nombre in psql("SELECT id, name FROM public.artists;"):
        por_nombre[normalizar(nombre)].append(int(aid))
    for aid, alias in psql("SELECT artist_id, alias FROM ingest.artist_aliases WHERE is_primary IS NOT TRUE;"):
        por_nombre[normalizar(alias)].append(int(aid))

    nombres: dict[str, str] = {}
    for linea in NOMBRES.read_text(encoding="utf8", errors="replace").splitlines() if NOMBRES.exists() else []:
        idx = linea.find(":")
        if idx < 0:
            continue
        archivo, resto = linea[:idx], linea[idx + 1:]
        m = re.search(r'og:title" content="([^"]+)"', resto)
        if not m:
            m = re.search(r'"artist"\s*:\s*"([^"]+)"', resto)
        if not m:
            m = re.search(r"<title>([^<]+)</title>", resto)
        if not m:
            continue
        nombre = limpiar_nombre(m.group(1))
        if nombre and archivo not in nombres:
            nombres[archivo] = nombre

    filas_crudas: list[dict] = []
    cuenta = collections.Counter()
    vistos_url: set[str] = set()
    for linea in PARES.read_text(encoding="utf8", errors="replace").splitlines() if PARES.exists() else []:
        m = URL_RX.search(linea)
        if not m:
            continue
        archivo, url = linea[:m.start()], linea[m.start():]
        plataforma = plataforma_de(url)
        if not plataforma:
            continue
        base = url.split("://")[-1].lstrip("/")
        if plataforma == "youtube":
            resto = base.split("youtube.com/", 1)[-1].split("?")[0].rstrip("/")
            handle = resto
            url_final = f"https://www.youtube.com/{resto}"
        else:
            resto = base.split("/", 1)[-1].split("?")[0].rstrip("/") if "/" in base else ""
            handle = resto.split("/")[-1].lstrip("@")
            url_final = f"https://{base.split('?')[0].rstrip('/')}"
        if not handle or BASURA.match(handle) or len(handle) < 3:
            cuenta[f"{plataforma}: ruta no personal"] += 1
            continue
        if url_final.lower() in vistos_url:
            continue
        vistos_url.add(url_final.lower())

        # 1º la señal fuerte: el usuario de la red ES el nombre de un artista del catálogo.
        ids = sorted(set(por_nombre.get(normalizar(handle), [])))
        exacto = len(ids) == 1
        if not exacto:
            # 2º señal débil: atribuirlo al artista del archivo, marcado como candidato.
            candidato = nombres.get(archivo) or Path(archivo).stem.replace("-", " ").replace("_", " ")
            ids = sorted(set(por_nombre.get(normalizar(candidato), [])))
            if len(ids) != 1:
                cuenta[f"{plataforma}: sin artista (ni por usuario ni por archivo)"] += 1
                continue
        filas_crudas.append({"artistId": ids[0], "platform": plataforma, "url": url_final, "handle": handle,
                             "evidencia": archivo, "matchHandle": exacto,
                             "nombreArchivo": nombres.get(archivo) or Path(archivo).stem})

    # Una cuenta que aparece en las fichas de MUCHOS artistas es la del propio sitio (blog, sello,
    # prensa) o un pie de página: no es la red de nadie. Se descarta por frecuencia.
    por_url: dict[str, set[int]] = collections.defaultdict(set)
    for f in filas_crudas:
        por_url[f["url"].lower()].add(f["artistId"])
    fuente = {u for u, artistas in por_url.items() if len(artistas) > 4}
    cuenta[f"descartado por aparecer en >4 artistas"] = sum(1 for f in filas_crudas if f["url"].lower() in fuente)

    hallazgos: dict[tuple[int, str], dict] = {}
    for f in filas_crudas:
        if f["url"].lower() in fuente:
            continue
        clave = (f["artistId"], f["platform"])
        previo = hallazgos.get(clave)
        if previo and (previo["matchHandle"] or not f["matchHandle"]):
            continue
        hallazgos[clave] = f
        cuenta[f"{f['platform']}: {'handle coincide' if f['matchHandle'] else 'handle distinto'}"] += 1

    filas = sorted(hallazgos.values(), key=lambda f: (f["artistId"], f["platform"]))
    with (DEST / "redes.jsonl").open("w", encoding="utf8") as fh:
        for f in filas:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    print(f"parejas artista-plataforma: {len(filas)} · artistas: {len({f['artistId'] for f in filas})}")
    for k, v in cuenta.most_common(18):
        print(f"  {k}: {v}")
    print(f"→ {DEST / 'redes.jsonl'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
