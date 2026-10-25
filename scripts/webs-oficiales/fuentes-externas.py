#!/usr/bin/env python3
"""Busca la web oficial declarada por fuentes externas (MusicBrainz y Wikidata).

No relee la URL candidata: pregunta a bases de relaciones musicales cuál es el
sitio oficial del artista y exige que la identidad coincida con la ficha del
catálogo (nombre exacto + país Venezuela o área venezolana). Cada hallazgo
conserva la fuente, el identificador (MBID/QID) y el tipo declarado.

MusicBrainz exige 1 req/s y User-Agent identificado.

Salida: revision-990/fuentes-externas/{fuentes.json,candidatos.json,progreso.json}
Uso: python3 scripts/webs-oficiales/fuentes-externas.py [--ids=1,2,3] [--force]
"""
from __future__ import annotations

import argparse, json, re, time, unicodedata, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'reports/webs-oficiales-2026-10-18'
REV = BASE / 'revision-990'
OUT = REV / 'fuentes-externas'
MB_API = 'https://musicbrainz.org/ws/2/'
MB_UA = 'CRV-catalogo/1.0 (catalogo de rock venezolano; uso no comercial)'
WD_API = 'https://www.wikidata.org/w/api.php'
DELAY_MB = 1.1
Q_VENEZUELA = 'Q717'
OFICIOS_MUSICALES = {'Q639669', 'Q177220', 'Q36834', 'Q215380', 'Q488205', 'Q855091',
                     'Q158852', 'Q13219637', 'Q753110', 'Q1064701'}
TIPOS_MB = ('official homepage', 'bandcamp', 'discogs', 'youtube', 'soundcloud',
            'social network', 'myspace', 'other databases', 'lyrics')


def now():
    return datetime.now(timezone.utc).isoformat()


def fold(text):
    return re.sub(r'[^a-z0-9]+', ' ', unicodedata.normalize('NFKD', text or '')
                  .encode('ascii', 'ignore').decode().lower()).strip()


def http_json(url, headers=None, timeout=40, tries=4):
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers=headers or {'Accept': 'application/json'})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode('utf-8', 'replace'))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return {}
            if exc.code in (429, 500, 502, 503, 504):
                time.sleep(2 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            time.sleep(2 * (attempt + 1))
    return {}


def mb(path):
    data = http_json(MB_API + path, {'User-Agent': MB_UA, 'Accept': 'application/json'})
    time.sleep(DELAY_MB)
    return data


def mb_buscar(nombre):
    query = urllib.parse.urlencode({'query': f'artist:"{nombre}"', 'fmt': 'json', 'limit': 12})
    return mb(f'artist?{query}')


def mb_relaciones(mbid):
    return mb(f'artist/{mbid}?inc=url-rels&fmt=json')


def venezolano_mb(artist):
    country = (artist.get('country') or '').upper()
    area = ((artist.get('area') or {}).get('name') or '').lower()
    inicio = ((artist.get('begin-area') or {}).get('name') or '').lower()
    return country == 'VE' or 'venezuela' in area or 'venezuela' in inicio


def buscar_musicbrainz(nombre, alias):
    """Devuelve (mbid, artista, enlaces) del homónimo venezolano con nombre exacto."""
    vistas = set()
    for termino in [nombre] + ([a for a in alias if fold(a) != fold(nombre)][:2]):
        data = mb_buscar(termino)
        for artist in data.get('artists', []):
            mbid = artist.get('id')
            if mbid in vistas:
                continue
            vistas.add(mbid)
            nombres = {fold(artist.get('name')), *(fold(x.get('name')) for x in artist.get('aliases', []))}
            if fold(termino) not in nombres:
                continue
            if not venezolano_mb(artist):
                continue
            detalle = mb_relaciones(mbid)
            enlaces = []
            for rel in detalle.get('relations', []):
                if rel.get('type') not in TIPOS_MB:
                    continue
                recurso = (rel.get('url') or {}).get('resource')
                if not recurso:
                    continue
                enlaces.append({'tipo': rel['type'], 'url': recurso,
                                'oficial': rel['type'] == 'official homepage'})
            return mbid, artist, enlaces
    return None, None, []


def wd_get(ids):
    params = urllib.parse.urlencode({'action': 'wbgetentities', 'format': 'json', 'ids': '|'.join(ids),
                                     'props': 'claims|labels|descriptions', 'languages': 'es|en'})
    return http_json(f'{WD_API}?{params}', {'User-Agent': MB_UA, 'Accept': 'application/json'})


def buscar_wikidata(nombre):
    params = urllib.parse.urlencode({'action': 'wbsearchentities', 'format': 'json', 'language': 'es',
                                     'uselang': 'es', 'search': nombre, 'limit': 8, 'origin': '*'})
    data = http_json(f'{WD_API}?{params}', {'User-Agent': MB_UA, 'Accept': 'application/json'})
    ids = [hit['id'] for hit in data.get('search', []) if hit.get('id')]
    if not ids:
        return None, None
    entities = wd_get(ids).get('entities', {})
    for qid in ids:
        ent = entities.get(qid) or {}
        etiquetas = {fold(ent.get('labels', {}).get(k, {}).get('value')) for k in ('es', 'en')}
        if fold(nombre) not in etiquetas:
            continue
        claims = ent.get('claims', {})
        def valores(prop):
            salida = []
            for claim in claims.get(prop, []):
                valor = claim['mainsnak'].get('datavalue', {}).get('value')
                salida.append(valor.get('id') if isinstance(valor, dict) else valor)
            return salida
        sitios = [v for v in valores('P856') if isinstance(v, str)]
        if not sitios:
            continue
        paises = set(valores('P27')) | set(valores('P495'))
        oficios = set(valores('P106'))
        descripcion = ' '.join((ent.get('descriptions', {}).get(k, {}).get('value') or '') for k in ('es', 'en')).lower()
        musical = bool(oficios & OFICIOS_MUSICALES) or bool(re.search(r'm[uú]sic|cantante|compositor|banda|grupo|rapero|productor', descripcion))
        venezolano = Q_VENEZUELA in paises or 'venezolan' in descripcion
        if musical and venezolano:
            return qid, {'sitios': sitios, 'descripcion': descripcion[:200]}
    return None, None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ids', help='Lista de artistId separada por comas')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--sin-musicbrainz', action='store_true', help='Solo Wikidata (rápido)')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    catalogo = {a['id']: a for a in json.loads((BASE / 'catalogo-990.json').read_text())}
    pendientes = json.loads((REV / 'scrapling/pendientes.json').read_text())
    nombres = {}
    for c in pendientes:
        nombres.setdefault(c['artistId'], c['name'])
    objetivo = sorted(nombres)
    if args.ids:
        queridos = {int(x) for x in args.ids.split(',')}
        objetivo = [i for i in objetivo if i in queridos]
    previos = {}
    archivo = OUT / 'fuentes.json'
    if archivo.exists() and not args.force:
        previos = {int(k): v for k, v in json.loads(archivo.read_text()).items()}
    resultados, candidatos = previos, []
    for posicion, artist_id in enumerate(objetivo, 1):
        previo = resultados.get(artist_id)
        if previo and not args.force:
            # En modo Wikidata se reintentan solo los que fallaron por el bug de P27.
            if not (args.sin_musicbrainz and not previo.get('wikidata')):
                continue
        nombre = nombres[artist_id]
        ficha = catalogo.get(artist_id, {})
        fila = {'artistId': artist_id, 'name': nombre,
                'musicbrainz': (previo or {}).get('musicbrainz'), 'wikidata': None,
                'consultado': now()}
        if not args.sin_musicbrainz:
            fila['musicbrainzConsultado'] = True
            try:
                mbid, artista, enlaces = buscar_musicbrainz(nombre, ficha.get('aliases') or [])
                if mbid:
                    fila['musicbrainz'] = {'mbid': mbid, 'nombre': artista.get('name'),
                                           'tipo': artista.get('type'), 'pais': artista.get('country'),
                                           'area': (artista.get('area') or {}).get('name'), 'enlaces': enlaces}
            except Exception as exc:  # noqa: BLE001
                fila['musicbrainzError'] = str(exc)[:300]
        try:
            qid, datos = buscar_wikidata(nombre)
            if qid:
                fila['wikidata'] = {'qid': qid, **datos}
        except Exception as exc:  # noqa: BLE001
            fila['wikidataError'] = str(exc)[:300]
        resultados[artist_id] = fila
        if posicion % 5 == 0 or posicion == len(objetivo):
            archivo.write_text(json.dumps({str(k): v for k, v in resultados.items()}, ensure_ascii=False, indent=1) + '\n')
            (OUT / 'progreso.json').write_text(json.dumps({'done': len(resultados), 'total': len(objetivo),
                                                            'updatedAt': now(), 'last': nombre}, ensure_ascii=False, indent=1) + '\n')
            print(json.dumps({'done': len(resultados), 'total': len(objetivo), 'name': nombre}, ensure_ascii=False), flush=True)
    vistos = set()
    for artist_id, fila in sorted(resultados.items()):
        fuentes = []
        mb = fila.get('musicbrainz') or {}
        for enlace in mb.get('enlaces', []):
            if enlace['oficial'] or enlace['tipo'] in ('bandcamp', 'other databases'):
                fuentes.append({'url': enlace['url'], 'fuente': 'musicbrainz', 'tipo': enlace['tipo'],
                                'declarado_oficial': enlace['oficial'], 'id': mb.get('mbid')})
        wd = fila.get('wikidata') or {}
        for sitio in wd.get('sitios', []):
            fuentes.append({'url': sitio, 'fuente': 'wikidata', 'tipo': 'P856',
                            'declarado_oficial': True, 'id': wd.get('qid')})
        for fuente in fuentes:
            clave = (artist_id, fuente['url'].rstrip('/').lower())
            if clave in vistos:
                continue
            vistos.add(clave)
            candidatos.append({'artistId': artist_id, 'name': fila['name'], 'url': fuente['url'],
                               'fuente': fuente['fuente'], 'tipo': fuente['tipo'],
                               'declaradoOficial': fuente['declarado_oficial'], 'idExterno': fuente['id']})
    (OUT / 'candidatos.json').write_text(json.dumps(candidatos, ensure_ascii=False, indent=1) + '\n')
    resumen = {'generatedAt': now(), 'artistasConsultados': len(resultados),
               'conMusicBrainz': sum(1 for f in resultados.values() if f.get('musicbrainz')),
               'conWikidata': sum(1 for f in resultados.values() if f.get('wikidata')),
               'candidatos': len(candidatos),
               'oficialesDeclarados': sum(1 for c in candidatos if c['declaradoOficial'])}
    (OUT / 'resumen.json').write_text(json.dumps(resumen, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(resumen, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
