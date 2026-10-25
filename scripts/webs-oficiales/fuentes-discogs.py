#!/usr/bin/env python3
"""Lee la web declarada en Discogs (campo «Website» de la ficha del artista).

Discogs documenta el sitio oficial en `urls` de cada artista. Se busca por
nombre, se exige que el título de la ficha coincida con el nombre del catálogo
y se descartan redes sociales, Bandcamp y el propio Discogs: solo quedan los
dominios que pueden ser la web del artista.

Límite autenticado: 60 peticiones/minuto (1,05 s entre llamadas).

Salida: revision-990/discogs/{fichas.json,candidatos.json,resumen.json}
Uso: python3 scripts/webs-oficiales/fuentes-discogs.py [--ids=1,2] [--force]
"""
from __future__ import annotations

import argparse, json, re, time, unicodedata, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'reports/webs-oficiales-2026-10-18'
REV = BASE / 'revision-990'
OUT = REV / 'discogs'
API = 'https://api.discogs.com'
UA = 'CRV-catalogo/1.0 +https://coleccionistasderock.org'
DELAY = 1.05
REDES = re.compile(r'(facebook|fb\.com|instagram|twitter|x\.com|tiktok|youtube|youtu\.be|myspace|'
                   r'soundcloud|bandcamp|spotify|apple\.com|deezer|discogs|last\.fm|vk\.com|'
                   r'linktr\.ee|tumblr|pinterest|patreon|reverbnation|songkick|bandsintown)', re.I)


def now():
    return datetime.now(timezone.utc).isoformat()


def fold(text):
    return re.sub(r'[^a-z0-9]+', ' ', unicodedata.normalize('NFKD', text or '')
                  .encode('ascii', 'ignore').decode().lower()).strip()


def token():
    for linea in (ROOT / '.env').read_text().splitlines():
        if linea.startswith('DISCOGS_TOKEN='):
            return linea.split('=', 1)[1].strip().strip('"').strip("'")
    return ''


TOKEN = token()


def pedir(path, params=None):
    params = dict(params or {})
    params['token'] = TOKEN
    url = f'{API}{path}?{urllib.parse.urlencode(params)}'
    for intento in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=30) as respuesta:
                return json.loads(respuesta.read().decode('utf-8', 'replace'))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return {}
            if exc.code == 429:
                time.sleep(5 * (intento + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            time.sleep(2 * (intento + 1))
    return {}


def buscar(nombre):
    datos = pedir('/database/search', {'q': nombre, 'type': 'artist', 'per_page': 10})
    return datos.get('results', [])


def ficha(artist_id):
    return pedir(f'/artists/{artist_id}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ids', help='Lista de artistId separada por comas')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    if not TOKEN:
        raise SystemExit('Falta DISCOGS_TOKEN en .env')
    OUT.mkdir(parents=True, exist_ok=True)
    archivo = OUT / 'fichas.json'
    previos = {}
    if archivo.exists() and not args.force:
        previos = {int(k): v for k, v in json.loads(archivo.read_text()).items()}
    nombres = {}
    for c in json.loads((REV / 'scrapling/pendientes.json').read_text()):
        nombres.setdefault(c['artistId'], c['name'])
    objetivo = sorted(nombres)
    if args.ids:
        queridos = {int(x) for x in args.ids.split(',')}
        objetivo = [a for a in objetivo if a in queridos]
    resultados = previos
    for posicion, artist_id in enumerate(objetivo, 1):
        if artist_id in resultados:
            continue
        nombre = nombres[artist_id]
        fila = {'artistId': artist_id, 'name': nombre, 'consultado': now(), 'fichas': []}
        try:
            candidatos = buscar(nombre)
            buscado = fold(nombre)
            for resultado in candidatos[:10]:
                titulo = resultado.get('title') or ''
                if fold(titulo) != buscado:
                    continue
                detalle = ficha(resultado.get('id'))
                urls = [u for u in (detalle.get('urls') or []) if isinstance(u, str)]
                fila['fichas'].append({'id': resultado.get('id'), 'titulo': titulo,
                                       'perfil': (detalle.get('profile') or '')[:600], 'urls': urls})
                time.sleep(DELAY)
                if len(fila['fichas']) >= 2:
                    break
        except Exception as exc:  # noqa: BLE001
            fila['error'] = str(exc)[:300]
        resultados[artist_id] = fila
        time.sleep(DELAY)
        if posicion % 5 == 0 or posicion == len(objetivo):
            archivo.write_text(json.dumps({str(k): v for k, v in resultados.items()}, ensure_ascii=False, indent=1) + '\n')
            (OUT / 'progreso.json').write_text(json.dumps({'done': len(resultados), 'total': len(objetivo),
                                                            'updatedAt': now(), 'last': nombre}, ensure_ascii=False) + '\n')
            print(json.dumps({'done': len(resultados), 'total': len(objetivo), 'name': nombre}, ensure_ascii=False), flush=True)
    candidatos = []
    vistos = set()
    for artist_id, fila in sorted(resultados.items()):
        for ficha_artista in fila.get('fichas', []):
            for url in ficha_artista.get('urls', []):
                if REDES.search(url) or not re.match(r'^https?://', url):
                    continue
                clave = (artist_id, url.rstrip('/').lower())
                if clave in vistos:
                    continue
                vistos.add(clave)
                candidatos.append({'artistId': artist_id, 'name': fila['name'], 'url': url,
                                   'fuente': 'discogs', 'idExterno': ficha_artista['id'],
                                   'tituloDiscogs': ficha_artista['titulo']})
    (OUT / 'candidatos.json').write_text(json.dumps(candidatos, ensure_ascii=False, indent=1) + '\n')
    resumen = {'generatedAt': now(), 'artistasConsultados': len(resultados),
               'conFicha': sum(1 for f in resultados.values() if f.get('fichas')),
               'candidatos': len(candidatos)}
    (OUT / 'resumen.json').write_text(json.dumps(resumen, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(resumen, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
