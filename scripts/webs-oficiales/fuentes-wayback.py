#!/usr/bin/env python3
"""Lee el dominio muerto en Internet Archive (otra fuente: copia histórica).

Para las fichas cuyo dominio candidato no responde, consulta el CDX de Wayback
Machine y lee la última copia con estado 200. Sirve para dos cosas:

  1. Cerrar el caso con evidencia: qué era ese dominio y hasta cuándo existió.
  2. Descubrir un dominio nuevo: enlaces externos de la copia cuyo texto de
     ancla habla de «web», «sitio» u «official», o cuyo host conserva el nombre
     del artista. Esos enlaces pasan por la captura y evaluación habituales.

Salida: revision-990/wayback/{fichas.json,candidatos.json,resumen.json}
Uso: python3 scripts/webs-oficiales/fuentes-wayback.py [--workers=5]
"""
from __future__ import annotations

import argparse, concurrent.futures, json, re, unicodedata, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'reports/webs-oficiales-2026-10-18'
REV = BASE / 'revision-990'
OUT = REV / 'wayback'
UA = 'CRV-catalogo/1.0 (catalogo de rock venezolano; uso no comercial)'
MORIBUNDOS = {'inactive_domain', 'navigation_failed', 'empty_content', 'challenge'}
REDES = re.compile(r'(facebook|fb\.com|instagram|twitter|x\.com|tiktok|youtube|youtu\.be|myspace|'
                   r'soundcloud|bandcamp|spotify|apple\.com|deezer|discogs|last\.fm|vk\.com|'
                   r'linktr\.ee|tumblr|pinterest|patreon|reverbnation|songkick|bandsintown|'
                   r'web\.archive\.org|archive\.org|wikipedia|google|doubleclick|googletag)', re.I)
ANCLA_WEB = re.compile(r'\b(web|sitio|site|official|oficial|homepage)\b', re.I)


def now():
    return datetime.now(timezone.utc).isoformat()


def fold(text):
    return re.sub(r'[^a-z0-9]+', ' ', unicodedata.normalize('NFKD', text or '')
                  .encode('ascii', 'ignore').decode().lower()).strip()


def descargar(url, timeout=45):
    for intento in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=timeout) as respuesta:
                return respuesta.read(2_500_000)
        except (urllib.error.URLError, TimeoutError):
            continue
    return b''


def pedir_json(url, timeout=45):
    try:
        return json.loads(descargar(url, timeout).decode('utf-8', 'replace'))
    except (json.JSONDecodeError, ValueError):
        return []


def cdx(host):
    params = urllib.parse.urlencode({'url': host, 'output': 'json', 'limit': '8',
                                     'filter': 'statuscode:200', 'collapse': 'timestamp:6'})
    datos = pedir_json(f'http://web.archive.org/cdx/search/cdx?{params}')
    if not isinstance(datos, list) or len(datos) < 2:
        return []
    cabecera, filas = datos[0], datos[1:]
    return [dict(zip(cabecera, fila)) for fila in filas]


def texto(raw):
    raw = re.sub(r'(?is)<(script|style|noscript|svg|head)\b.*?</\1>', ' ', raw)
    raw = re.sub(r'(?s)<[^>]+>', ' ', raw)
    return re.sub(r'\s+', ' ', raw).strip()


def analizar(caso):
    host = urllib.parse.urlsplit(caso['url']).hostname or ''
    fila = {'artistId': caso['artistId'], 'name': caso['name'], 'url': caso['url'], 'host': host,
            'consultado': now(), 'copias': 0, 'candidatos': []}
    copias = cdx(host)
    fila['copias'] = len(copias)
    if not copias:
        fila['resultado'] = 'sin_copias'
        return fila
    ultima = copias[-1]
    sello = ultima['timestamp']
    destino = f'https://web.archive.org/web/{sello}id_/{ultima["original"]}'
    html = descargar(destino).decode('utf-8', 'replace')
    if not html:
        fila['resultado'] = 'copia_ilegible'
        return fila
    titulo = re.search(r'(?is)<title[^>]*>(.*?)</title>', html)
    cuerpo = texto(html)
    fila.update(fecha=sello, titulo=(re.sub(r'\s+', ' ', titulo.group(1)).strip()[:160] if titulo else ''),
                texto=len(cuerpo), extracto=cuerpo[:600])
    nombres = [t for t in fold(caso['name']).split() if len(t) >= 4]
    menciona = bool(nombres) and all(t in fold(cuerpo[:8000]) for t in nombres[:2])
    fila['mencionaArtista'] = menciona
    anclas = re.findall(r'(?is)<a[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>', html)
    vistos = set()
    for enlace, etiqueta in anclas:
        if REDES.search(enlace):
            continue
        limpio = texto(etiqueta)[:80]
        host_enlace = urllib.parse.urlsplit(enlace).hostname or ''
        if not host_enlace or host_enlace == host:
            continue
        etiqueta_fold = fold(limpio)
        nombre_host = fold(host_enlace.split('.')[0])
        propio = any(t in nombre_host for t in nombres) if nombres else False
        if not (propio or ANCLA_WEB.search(etiqueta_fold + ' ' + limpio)):
            continue
        clave = enlace.rstrip('/').lower()
        if clave in vistos:
            continue
        vistos.add(clave)
        fila['candidatos'].append({'url': enlace, 'ancla': limpio, 'host': host_enlace, 'parecePropio': propio})
    fila['resultado'] = 'leida' if menciona else 'dominio_ajeno'
    return fila


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workers', type=int, default=5)
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    casos = {}
    for carpeta in (REV / 'reintento/visitas', REV / 'reintento/extra/visitas'):
        for archivo in carpeta.glob('*.json'):
            visita = json.loads(archivo.read_text())
            if visita.get('outcome') in MORIBUNDOS:
                casos[(visita['artistId'], visita['requestedUrl'])] = {
                    'artistId': visita['artistId'], 'name': visita['name'], 'url': visita['requestedUrl']}
    filas = list(casos.values())
    print(json.dumps({'casos': len(filas)}), flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        resultados = list(pool.map(analizar, filas))
    (OUT / 'fichas.json').write_text(json.dumps(resultados, ensure_ascii=False, indent=1) + '\n')
    candidatos, vistos = [], set()
    for fila in resultados:
        for candidato in fila.get('candidatos', []):
            clave = (fila['artistId'], candidato['url'].rstrip('/').lower())
            if clave in vistos:
                continue
            vistos.add(clave)
            candidatos.append({'artistId': fila['artistId'], 'name': fila['name'], 'url': candidato['url'],
                               'fuente': 'wayback', 'ancla': candidato['ancla'], 'parecePropio': candidato['parecePropio']})
    (OUT / 'candidatos.json').write_text(json.dumps(candidatos, ensure_ascii=False, indent=1) + '\n')
    resumen = {'generatedAt': now(), 'casos': len(filas),
               'conCopias': sum(1 for f in resultados if f.get('copias')),
               'leidas': sum(1 for f in resultados if f.get('resultado') == 'leida'),
               'mencionanAlArtista': sum(1 for f in resultados if f.get('mencionaArtista')),
               'dominioAjeno': sum(1 for f in resultados if f.get('resultado') == 'dominio_ajeno'),
               'sinCopias': sum(1 for f in resultados if f.get('resultado') == 'sin_copias'),
               'candidatos': len(candidatos)}
    (OUT / 'resumen.json').write_text(json.dumps(resumen, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(resumen, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
