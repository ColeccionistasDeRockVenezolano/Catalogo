#!/usr/bin/env python3
"""Campaña «resto»: criba barata de los 7.640 candidatos sin comprobar.

Para cada URL candidata del inventario:
  1. Descarta redes, agregadores y hosts de aparcamiento (sin red).
  2. Resuelve DNS; los dominios inexistentes quedan como «caido».
  3. Lee la página por HTTP con navegador simulado (sin Chrome): estado, título,
     texto y si el nombre del artista aparece en la página.
  4. Clasifica: `posible` (nombre + contexto musical), `nombre_sin_musica`,
     `sin_nombre`, `caido`, `aparcado`, `bloqueado`.

Solo `posible` y `nombre_sin_musica` pasan a captura con Chrome y evaluación.

Salida: reports/webs-oficiales-2026-10-18/campana/{triage.jsonl,resumen.json,candidatos.json}
Uso: python3 scripts/webs-oficiales/campana-resto.py [--workers=16] [--limite=N] [--ids=1,2]
"""
from __future__ import annotations

import argparse, concurrent.futures, json, re, socket, unicodedata, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'reports/webs-oficiales-2026-10-18'
OUT = BASE / 'campana'
REDES = re.compile(r'(youtube|youtu\.be|facebook|fb\.com|instagram|twitter|x\.com|tiktok|spotify|'
                   r'music\.apple|itunes|deezer|soundcloud|bandcamp|discogs|last\.fm|wikipedia|'
                   r'allmusic|rateyourmusic|amazon|ebay|mercadolibre|google|bing\.|patreon|linktr|'
                   r'songkick|bandsintown|eventbrite|ticketmaster|imdb|musicbrainz|genius|letras|'
                   r'lyrics|soundbetter|fiverr|vimeo|dailymotion|pinterest|linkedin|tumblr|vk\.com|'
                   r'archive\.org|myspace|reverbnation|lyrks|ok\.ru|vkvideo|merchbar|esmusicas|'
                   r'sonichits|skysound7|muzce|ouvirmusica|siteindices|rilds|susana|vzlarockea)', re.I)
APARCADO = re.compile(r'siteindices|rilds|sedoparking|sedo\.com|afternic|hugedomains|dan\.com|'
                      r'domainmarket|buydomains|parkingcrew|bodis|above\.com|undeveloped', re.I)
EN_VENTA = re.compile(r'domain (?:is|may be) for sale|buy this domain|dominio en venta|'
                      r'this domain is parked|domain registered|dominio aparcado', re.I)
MUSICA = re.compile(r'\b(banda|grupo|m[uú]sica|m[uú]sico|disco|álbum|album|discograf|canci[oó]n|'
                    r'rock|metal|pop|punk|salsa|joropo|gaita|concierto|gira|tour|single|ep\b|'
                    r'band|music|album|record|guitar|vocal|drum|bass|lyrics|spotify)', re.I)
# Dominios que por su naturaleza nunca son la web del artista: letras, acordes,
# prensa, merchandising ajeno, bases de datos y agregadores de descarga.
TERCEROS = re.compile(r'(chordu|cifraclub|tuletra|lyrks|letras|lyrics|songlyrics|azlyrics|'
                      r'metaldaze|metalneverdie|metalarchives|rockdevzla|rockzuela|'
                      r'lanetaneta|elbuho|tshirtslayer|kickassforever|recuerdosdeminfancia|'
                      r'nofuncionamusica|esmusicas|merchbar|sonichits|lyricsfreak|'
                      r'musixmatch|genius\.com|shazam|last\.fm|allmusic|discogs|rateyourmusic|'
                      r'wikipedia|wikidata|fandom|ecured|sites\.google|maps\.google|'
                      r'eldiario|eluniversal|elnacional|noticias24|ultimasnoticias|talcual|'
                      r'efectococuyo|monitorprod|alaveranoticias|diariolasamericas|'
                      r'elestimulo|prodavinci|cinco8|revistadominical|cochinopop|'
                      r'el-nacional|elimpulso|elprogreso|laverdad|globovision|vtv|telesur|'
                      r'instagram|facebook|tiktok|youtube|x\.com|twitter)', re.I)


def now():
    return datetime.now(timezone.utc).isoformat()


def fold(text):
    return re.sub(r'[^a-z0-9]+', ' ', unicodedata.normalize('NFKD', text or '')
                  .encode('ascii', 'ignore').decode().lower()).strip()


def resolver(host):
    try:
        return bool(socket.getaddrinfo(host, None, type=socket.SOCK_STREAM))
    except OSError:
        return False


def texto(raw):
    raw = re.sub(r'(?is)<(script|style|noscript|svg|head)\b.*?</\1>', ' ', raw)
    raw = re.sub(r'(?s)<[^>]+>', ' ', raw)
    return re.sub(r'\s+', ' ', raw).strip()


def leer(item):
    url = item['url']
    peticion = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
                      'Chrome/140.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'es-VE,es;q=0.9,en;q=0.8'})
    try:
        with urllib.request.urlopen(peticion, timeout=18) as respuesta:
            estado = respuesta.status
            final = respuesta.geturl()
            crudo = respuesta.read(600_000).decode('utf-8', 'replace')
    except urllib.error.HTTPError as exc:
        return {**item, 'estado': exc.code, 'clase': 'bloqueado' if exc.code in (401, 403, 429, 451, 503) else 'caido'}
    except Exception as exc:  # noqa: BLE001
        return {**item, 'estado': 0, 'clase': 'caido', 'error': type(exc).__name__}
    titulo = re.search(r'(?is)<title[^>]*>(.*?)</title>', crudo)
    titulo = re.sub(r'\s+', ' ', titulo.group(1)).strip()[:180] if titulo else ''
    cuerpo = texto(crudo)
    if EN_VENTA.search(titulo + ' ' + cuerpo[:500]) or APARCADO.search(final):
        return {**item, 'estado': estado, 'titulo': titulo, 'clase': 'aparcado'}
    nombre = fold(item['name'])
    tokens = [t for t in nombre.split() if len(t) >= 4]
    compacto = nombre.replace(' ', '')
    buscable = fold(titulo + ' ' + cuerpo[:60000])
    compacto_buscable = buscable.replace(' ', '')
    conNombre = bool(tokens) and all(t in buscable for t in tokens[:2]) or (len(compacto) >= 8 and compacto in compacto_buscable)
    conMusica = bool(MUSICA.search(titulo + ' ' + cuerpo[:20000]))
    enlaces = sum(1 for social in item.get('sociales', []) if social in crudo)
    oficial = bool(re.search(r'official|oficial', titulo + ' ' + cuerpo[:400], re.I))
    dominio_propio = any(t in fold(item['host'].split('.')[0]) for t in tokens) if tokens else False
    # Solo se evalúa lo que puede ser la web del artista: dominio propio, marca de
    # sitio oficial o la propia página enlazando sus perfiles verificados.
    if conNombre and conMusica and (dominio_propio or oficial or enlaces >= 1):
        clase = 'posible'
    elif conNombre and conMusica:
        clase = 'mencion_tercero'
    else:
        clase = 'nombre_sin_musica' if conNombre else 'sin_nombre'
    if clase in ('posible', 'mencion_tercero', 'nombre_sin_musica') and TERCEROS.search(item['host']):
        clase = 'tercero'
    return {**item, 'estado': estado, 'final': final, 'titulo': titulo, 'clase': clase,
            'texto': len(cuerpo), 'conNombre': conNombre, 'conMusica': conMusica,
            'dominioPropio': dominio_propio, 'oficial': oficial, 'enlacesPropios': enlaces}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workers', type=int, default=16)
    parser.add_argument('--limite', type=int, help='Corta tras N URLs (pruebas)')
    parser.add_argument('--ids', help='Solo estos artistId')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    resultados = json.loads((BASE / 'resultados.json').read_text())
    queridos = {int(x) for x in args.ids.split(',')} if args.ids else None
    vistos = set()
    for archivo in ('omitidos-coincidencia-dominio.json', 'revision-990/reintento/candidatos-extra.json',
                    'revision-990/reintento/fuentes/candidatos.json'):
        ruta = BASE / archivo
        if ruta.exists():
            for c in json.loads(ruta.read_text()):
                vistos.add(c['url'].rstrip('/').lower())
    if (OUT / 'leidas.jsonl').exists():
        for linea in (OUT / 'leidas.jsonl').read_text().splitlines():
            try:
                vistos.add(json.loads(linea)['url'].rstrip('/').lower())
            except Exception:  # noqa: BLE001
                pass
    items, sociales = [], 0
    # Perfiles verificados por artista: si la página los enlaza, es suya o la representa.
    import subprocess
    consulta = ("select artist_id||E'\\t'||url from public.social_links where verified "
                "and platform in ('website','facebook','instagram','youtube','twitter','bandcamp','spotify','soundcloud','tiktok')")
    salida = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tAc', consulta],
                            capture_output=True, text=True).stdout
    perfiles = {}
    for linea in salida.splitlines():
        partes = linea.split('\t')
        if len(partes) == 2 and partes[1].startswith('http'):
            perfiles.setdefault(int(partes[0]), []).append(partes[1].rstrip('/'))
    for fila in resultados:
        if queridos and fila['artistId'] not in queridos:
            continue
        propios = perfiles.get(fila['artistId'], [])
        for url in fila.get('uncheckedCandidates', []):
            try:
                host = url.split('/')[2].lower()
            except IndexError:
                continue
            if REDES.search(host) or APARCADO.search(host):
                sociales += 1
                continue
            if url.rstrip('/').lower() in vistos:
                continue
            items.append({'artistId': fila['artistId'], 'name': fila['name'], 'url': url, 'host': host,
                          'sociales': propios})
    if args.limite:
        items = items[:args.limite]
    print(json.dumps({'candidatos': len(items), 'descartadosPorRedOAparcamiento': sociales}), flush=True)
    hosts = sorted({i['host'] for i in items})
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        vivos = set(h for h, ok in zip(hosts, pool.map(resolver, hosts)) if ok)
    vivos_items = [i for i in items if i['host'] in vivos]
    sin_dns = [i for i in items if i['host'] not in vivos]
    print(json.dumps({'conDns': len(vivos_items), 'sinDns': len(sin_dns)}), flush=True)
    leidas = []
    with open(OUT / 'leidas.jsonl', 'a') as registro:
        for i in sin_dns:
            registro.write(json.dumps({**i, 'clase': 'caido', 'estado': 0}, ensure_ascii=False) + '\n')
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            for posicion, fila in enumerate(pool.map(leer, vivos_items), 1):
                registro.write(json.dumps(fila, ensure_ascii=False) + '\n')
                leidas.append(fila)
                if posicion % 200 == 0:
                    registro.flush()
                    print(json.dumps({'leidas': posicion, 'total': len(vivos_items)}), flush=True)
    clases = {}
    for fila in leidas + sin_dns:
        clases[fila['clase']] = clases.get(fila['clase'], 0) + 1
    resumen = {'generatedAt': now(), 'candidatos': len(items), 'sinDns': len(sin_dns),
               'leidas': len(leidas), 'clases': clases}
    (OUT / 'resumen-criba.json').write_text(json.dumps(resumen, ensure_ascii=False, indent=2) + '\n')
    posibles = [{'artistId': f['artistId'], 'name': f['name'], 'url': f.get('final') or f['url'],
                 'fuente': 'criba', 'clase': f['clase'], 'titulo': f.get('titulo', '')}
                for f in leidas if f['clase'] == 'posible']
    bloqueados = [{'artistId': f['artistId'], 'name': f['name'], 'url': f['url'],
                   'fuente': 'criba', 'clase': 'bloqueado'} for f in leidas if f['clase'] == 'bloqueado']
    (OUT / 'candidatos.json').write_text(json.dumps(posibles, ensure_ascii=False, indent=1) + '\n')
    (OUT / 'candidatos-bloqueados.json').write_text(json.dumps(bloqueados, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps(resumen, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
