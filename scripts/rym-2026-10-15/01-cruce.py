#!/usr/bin/env python3
"""Campaña RYM 2026-10-15 · FASE 1: cruce ficha capturada ↔ disco del catálogo.

Fuentes (todo offline):
  · data/raw/fuentes-web-2026-10-01/rym-nuevos/pages/rel_*.html  (7.328 fichas de disco)
  · reports/rym-v4-2026-10-04/albumes.jsonl                     (3.997 re-parseadas con campos ricos)
  · el catálogo vivo (artists/albums/ingest.artist_aliases)

Salida: reports/rym-2026-10-15/cruce.jsonl (una fila por ficha casada) + resumen en pantalla.

Reglas del cruce (estrictas, para no inventar enlaces):
  · el artista de la ficha debe casar por nombre normalizado (o por uno de sus alias) con UN artista;
  · el título debe casar por título normalizado con UN disco de ese artista;
  · con varios candidatos gana el del mismo año; empate entre artistas distintos → se descarta.
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path
import hashlib

ROOT = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
sys.path.insert(0,str(ROOT/'scripts'))
from rym_identity import publication_type_conflict
# Reutilizable por campañas nuevas: --paginas (una o varias carpetas de fichas), --v4 (re-parseo) y
# --dest (carpeta de informes). Por defecto, la campaña del 2026-10-15.
_paginas_por_defecto = [ROOT / "data" / "raw" / "fuentes-web-2026-10-01" / "rym-nuevos" / "pages"]
PAGINAS = _paginas_por_defecto
V4 = ROOT / "reports" / "rym-v4-2026-10-04" / "albumes.jsonl"
DEST = ROOT / "reports" / "rym-2026-10-15"

META = re.compile(r'<meta name="description" content="([^"]*)"')
META_FICHA = re.compile(r"^(?P<titulo>.+?), (?:an|a) (?P<tipo>[A-Za-z ]+?) by (?P<artista>.+?)\.(?: Released (?P<fecha>[^.]*)\.)?")
TIPOS_FUERA = {"music video", "video", "unauth", "additional release", "djmix", "mixtape"}


def normalizar(t: str) -> str:
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    # Edition/version words are identity evidence, never decoration to strip.
    return " ".join("".join(c if c.isalnum() else " " for c in t).split())


def psql(sql: str) -> list[list[str]]:
    salida = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAc", sql, "-F", "\t"],
                            capture_output=True, text=True, check=True).stdout
    return [linea.split("\t") for linea in salida.splitlines() if linea.strip()]


def main() -> int:
    global V4, DEST, PAGINAS
    ap = argparse.ArgumentParser(description="Cruce fichas RYM ↔ discos del catálogo")
    ap.add_argument("--paginas", action="append", default=[], help="carpeta de fichas (repetible)")
    ap.add_argument("--v4", default=str(V4), help="re-parseo rico (albumes.jsonl)")
    ap.add_argument("--dest", default=str(DEST), help="carpeta de informes")
    ap.add_argument("--identities", help="ledger de identidades acreditadas (obligatorio; por defecto en --dest)")
    args = ap.parse_args()
    if args.paginas:
        PAGINAS = [Path(p) for p in args.paginas]
    V4, DEST = Path(args.v4), Path(args.dest)
    DEST.mkdir(parents=True, exist_ok=True)
    ledger = json.loads(Path(args.identities or DEST / 'identity-ledger.json').read_text())
    if ledger.get('version') != 'crv-rym-identity-v1':
        raise ValueError('Versión de ledger de identidad RYM inválida')
    identities = {}
    for item in ledger['identities']:
        if item['status'] != 'resolved':
            continue
        for pin in item['pins']:
            if hashlib.sha256(Path(pin['path']).read_bytes()).hexdigest() != pin['sha256']:
                raise ValueError('Captura cambió; regenerar ledger: '+pin['path'])
        identities[item['href'].rstrip('/')] = item['artistId']
    artistas = {int(i): n for i, n in psql("SELECT id, name FROM public.artists ORDER BY id;")}
    por_nombre: dict[str, list[int]] = collections.defaultdict(list)
    for aid, nombre in artistas.items():
        por_nombre[normalizar(nombre)].append(aid)
    for aid, alias in psql("SELECT artist_id, alias FROM ingest.artist_aliases WHERE is_primary IS NOT TRUE;"):
        por_nombre[normalizar(alias)].append(int(aid))
    discos: dict[int, list[tuple[int, str, int | None]]] = collections.defaultdict(list)
    for aid, did, titulo, anio in psql("SELECT artist_id, id, title, coalesce(release_year,0) FROM public.albums WHERE artist_id IS NOT NULL;"):
        discos[int(aid)].append((int(did), titulo, int(anio)))
    album_aliases = collections.defaultdict(set)
    for did, alias in psql('SELECT album_id,alias FROM ingest.album_aliases'):
        album_aliases[int(did)].add(normalizar(alias))
    editions = {int(did): (catalog, fmt, kind) for did,catalog,fmt,kind in psql("SELECT id,coalesce(catalog_id,''),coalesce(media_format,''),album_type::text FROM public.albums")}
    classes = collections.defaultdict(set)
    for did,label in psql('SELECT album_id,classification FROM ingest.effective_album_classifications'):
        classes[int(did)].add(label)
    held = {int(row[0]) for row in psql("SELECT album_id FROM ingest.review_queue WHERE payload->>'operation'='rym_publication_identity_hold' AND status IN ('open','in_progress')")}

    ricos: dict[str, dict] = {}
    for linea in V4.open(encoding="utf8"):
        try:
            d = json.loads(linea)
        except Exception:  # noqa: BLE001
            continue
        ricos[d.get("slug") or ""] = d

    def paginas_rel() -> list[Path]:
        salida: list[Path] = []
        for carpeta in PAGINAS:
            salida.extend([page for page in sorted(carpeta.glob("rel_*.html")) if page.stem in ricos] if carpeta.exists() else [])
        return salida

    stats = collections.Counter()
    filas = []
    sobrantes: list[dict] = []
    for pagina in paginas_rel():
        slug = pagina.name[:-5]
        meta = META.search(pagina.read_text(encoding="utf8", errors="replace"))
        titulo = artista = tipo = fecha = ""
        if meta:
            m = META_FICHA.match(meta.group(1))
            if m:
                titulo, tipo, artista = m.group("titulo"), (m.group("tipo") or "").strip().lower(), m.group("artista")
                fecha = m.group("fecha") or ""
        rico = ricos.get(slug)
        if rico:
            titulo = rico.get("titulo") or titulo
            artista = rico.get("artista") or artista
            tipo = (rico.get("tipo") or rico.get("tipo_desc") or tipo or "").strip().lower()
            fecha = rico.get("released_text") or fecha
        def source_details():
            return {'artistHref': (rico or {}).get('artista_url'), 'sourceHref': (rico or {}).get('href'),
                    'capturePins': [{'path':str(pagina),'sha256':hashlib.sha256(pagina.read_bytes()).hexdigest()},
                                    {'path':str(pagina.with_suffix('.json')),'sha256':hashlib.sha256(pagina.with_suffix('.json').read_bytes()).hexdigest()}]}
        if not titulo or not artista:
            stats["ficha sin título/artista legible"] += 1
            continue
        if tipo in TIPOS_FUERA or re.search(r'video|documentary|documental|interview|entrevista|short|dj.?mix|mixtape|additional|bootleg|unauthorized',tipo,re.I):
            stats[f"tipo fuera de catálogo ({tipo})"] += 1
            continue
        anio = rico.get("anio") if rico else None
        if not anio:
            m_anio = re.search(r"(19|20)\d\d", fecha or "")
            anio = int(m_anio.group(0)) if m_anio else 0
        artist_href = ((rico or {}).get('artista_url') or '').replace('https://rateyourmusic.com', '').rstrip('/')
        candidatos = [identities[artist_href]] if artist_href in identities else []
        if not candidatos:
            stats["identidad fuente-artista no acreditada"] += 1
            continue
        objetivo = normalizar(titulo)
        casados = [(aid, did, dtitulo, danio)
                   for aid in candidatos for did, dtitulo, danio in discos.get(aid, [])
                   if normalizar(dtitulo) == objetivo or objetivo in album_aliases[did]]
        if not casados:
            stats["disco sin casar por título"] += 1
            sobrantes.append({"slug": slug, "artistId": candidatos[0], "tituloRym": titulo, "anio": anio, 'reason':'missing_title', **source_details()})
            continue
        if len(casados) > 1:
            mismo_anio = [c for c in casados if anio and c[3] == anio]
            if len(mismo_anio) == 1:
                casados = mismo_anio
                stats["casado por año"] += 1
            elif len({c[0] for c in casados}) > 1:
                stats["ambiguo (varios artistas)"] += 1
                continue
            else:
                stats["varias ediciones del mismo título (revisión)"] += 1
                sobrantes.append({'slug':slug,'artistId':candidatos[0],'tituloRym':titulo,'anio':anio,
                                  'reason':'ambiguous_editions','albumIds':[c[1] for c in casados], **source_details()})
                continue
        aid, did, dtitulo, danio = casados[0]
        if anio and danio and anio != danio:
            stats['año/edición contradictorios (revisión)'] += 1
            sobrantes.append({'slug':slug,'artistId':aid,'albumId':did,'tituloRym':titulo,'anio':anio,'reason':'year_conflict', **source_details()})
            continue
        catalog_id, media_format, album_type = editions[did]
        incoming_catalog = (rico or {}).get('catalog_no')
        incoming_format = (rico or {}).get('formato')
        format_key = lambda v: {'vinyl lp':'lp','compact disc':'cd','digital file':'digital'}.get(normalizar(v),normalizar(v))
        if (catalog_id and incoming_catalog and normalizar(catalog_id)!=normalizar(incoming_catalog)
            or media_format and incoming_format and format_key(media_format)!=format_key(incoming_format)):
            stats['catálogo/formato de otra edición (revisión)'] += 1
            sobrantes.append({'slug':slug,'artistId':aid,'albumId':did,'tituloRym':titulo,'reason':'edition_conflict',
                              'catalogId':catalog_id,'sourceCatalogId':incoming_catalog,'format':media_format,'sourceFormat':incoming_format,**source_details()})
            continue
        if did in held or publication_type_conflict(tipo,album_type,classes[did]):
            stats['tipo de publicación contradictorio (revisión)'] += 1
            sobrantes.append({'slug':slug,'artistId':aid,'albumId':did,'tituloRym':titulo,'reason':'publication_type_conflict',**source_details()})
            continue
        filas.append({
            "slug": slug, "albumId": did, "artistId": aid,
            "artistHref": artist_href, "sourceHref": (rico or {}).get('href'), "identityVersion": ledger['version'],
            "releaseIdentityVersion":"crv-rym-release-v2", "publicationType":tipo,
            "capturePins": [{'path':str(pagina),'sha256':hashlib.sha256(pagina.read_bytes()).hexdigest()},
                            {'path':str(pagina.with_suffix('.json')),'sha256':hashlib.sha256(pagina.with_suffix('.json').read_bytes()).hexdigest()}],
            "tituloCatalogo": dtitulo, "tituloRym": titulo, "artistaRym": artista,
            "anioRym": anio or None, "anioCatalogo": danio or None, "tipo": tipo,
            "fechaTexto": fecha or None, "v4": bool(rico),
        })

    with (DEST / "cruce.jsonl").open("w", encoding="utf8") as fh:
        for f in filas:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    with (DEST / "cruce-sobrantes.jsonl").open("w", encoding="utf8") as fh:
        for f in sobrantes:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")

    con_v4 = sum(1 for f in filas if f["v4"])
    print(f"fichas casadas: {len(filas)} (con re-parseo rico: {con_v4}) · artistas distintos: {len({f['artistId'] for f in filas})}")
    for k, v in stats.most_common(12):
        print(f"  {k}: {v}")
    print(f"→ {DEST / 'cruce.jsonl'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
