#!/usr/bin/env python3
"""Prueba dominios derivados del nombre del artista (otra fuente: el propio DNS).

Para cada ficha sin web y sin coincidencia, genera variantes del nombre
(sin espacios y con guiones, con y sin artículo inicial) sobre TLD habituales
y comprueba si el dominio existe y responde. No publica nada: los dominios que
responden pasan por la captura y la evaluación de identidad de siempre.

Descarta dominios aparcados, en venta y los que ya estaban entre los candidatos.

Salida: revision-990/dominios/{candidatos.json,sondeo.json,resumen.json}
Uso: python3 scripts/webs-oficiales/fuentes-dominios.py [--ids=1,2] [--workers=24]
"""
from __future__ import annotations

import argparse, concurrent.futures, json, re, socket, subprocess, unicodedata, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'reports/webs-oficiales-2026-10-18'
REV = BASE / 'revision-990'
OUT = REV / 'dominios'
TLDS = ('.com', '.com.ve', '.ve', '.net', '.org', '.band', '.music', '.rocks')
ARTICULOS = ('los ', 'las ', 'la ', 'el ')
APARCADO = re.compile(r'siteindices|rilds|sedoparking|sedo\.com|afternic|hugedomains|dan\.com|'
                      r'domainmarket|buydomains|parkingcrew|bodis|above\.com|undeveloped', re.I)
EN_VENTA = re.compile(r'domain (?:is|may be) for sale|buy this domain|dominio en venta|'
                      r'this domain is parked|domain registered|en construcción', re.I)


def now():
    return datetime.now(timezone.utc).isoformat()


def fold(text):
    return re.sub(r'[^a-z0-9]+', ' ', unicodedata.normalize('NFKD', text or '')
                  .encode('ascii', 'ignore').decode().lower()).strip()


def slugs(nombre):
    base = fold(nombre)
    variantes = {base, base.replace(' ', ''), base.replace(' ', '-')}
    for articulo in ARTICULOS:
        if base.startswith(articulo):
            corto = base[len(articulo):]
            variantes |= {corto, corto.replace(' ', ''), corto.replace(' ', '-')}
    return {v for v in variantes if len(v.replace('-', '')) >= 4 and ' ' not in v}


def distintivo(nombre):
    """Un nombre de una sola palabra choca con marcas y palabras comunes.

    Solo se prueban dominios cuando el nombre tiene dos o más palabras propias
    o es largo: ahí el dominio derivado sí identifica al artista.
    """
    base = fold(nombre)
    for articulo in ARTICULOS:
        if base.startswith(articulo):
            base = base[len(articulo):]
    palabras = [p for p in base.split() if p not in ('de', 'del', 'y', 'la', 'el', 'los', 'las')]
    return len(palabras) >= 2 or len(base.replace(' ', '')) >= 12


def sitios_publicados():
    consulta = "select artist_id from public.social_links where platform='website'"
    salida = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tAc', consulta],
                            capture_output=True, text=True, check=True).stdout
    return {int(x) for x in salida.split()}


def ya_visitados():
    urls = set()
    for carpeta in (REV / 'scrapling/visitas', REV / 'reintento/visitas', REV / 'reintento/extra/visitas'):
        for archivo in carpeta.glob('*.json'):
            try:
                urls.add(json.loads(archivo.read_text())['requestedUrl'].rstrip('/').lower())
            except Exception:  # noqa: BLE001
                pass
    for archivo in (BASE / 'omitidos-coincidencia-dominio.json', REV / 'reintento/candidatos-extra.json'):
        if archivo.exists():
            for c in json.loads(archivo.read_text()):
                urls.add(c['url'].rstrip('/').lower())
    return urls


def resolver(host):
    try:
        direcciones = {a[4][0] for a in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)}
        return bool(direcciones)
    except OSError:
        return False


def sondear(url):
    """Una lectura mínima: existe, responde y no es un anuncio de venta."""
    peticion = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; CRV-catalogo/1.0; uso no comercial)',
        'Accept': 'text/html,application/xhtml+xml'})
    try:
        with urllib.request.urlopen(peticion, timeout=12) as respuesta:
            cuerpo = respuesta.read(400_000).decode('utf-8', 'replace')
            estado = respuesta.status
            final = respuesta.geturl()
    except urllib.error.HTTPError as exc:
        return {'url': url, 'estado': exc.code, 'descartado': 'http_error'}
    except Exception as exc:  # noqa: BLE001
        return {'url': url, 'estado': 0, 'descartado': f'sin_respuesta: {type(exc).__name__}'}
    titulo = re.search(r'(?is)<title[^>]*>(.*?)</title>', cuerpo)
    titulo = re.sub(r'\s+', ' ', titulo.group(1)).strip()[:160] if titulo else ''
    texto = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', cuerpo)
    texto = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', texto)).strip()
    if APARCADO.search(final) or EN_VENTA.search(titulo + ' ' + texto[:600]):
        return {'url': url, 'estado': estado, 'titulo': titulo, 'descartado': 'aparcado_o_en_venta'}
    if len(texto) < 200:
        return {'url': url, 'estado': estado, 'titulo': titulo, 'descartado': 'sin_texto'}
    return {'url': url, 'estado': estado, 'titulo': titulo, 'final': final, 'texto': len(texto)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ids', help='Lista de artistId separada por comas')
    parser.add_argument('--workers', type=int, default=24)
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    catalogo = {a['id']: a for a in json.loads((BASE / 'catalogo-990.json').read_text())}
    nombres = {}
    for c in json.loads((REV / 'scrapling/pendientes.json').read_text()):
        nombres.setdefault(c['artistId'], c['name'])
    publicados = sitios_publicados()
    visitados = ya_visitados()
    # Sólo fichas de este lote que siguen sin web publicada.
    objetivo = sorted(a for a in nombres if a not in publicados)
    if args.ids:
        queridos = {int(x) for x in args.ids.split(',')}
        objetivo = [a for a in objetivo if a in queridos]
    pruebas = []
    omitidos_por_generico = 0
    for artist_id in objetivo:
        nombre = nombres[artist_id]
        if not distintivo(nombre):
            omitidos_por_generico += 1
            continue
        for slug in slugs(nombre):
            for tld in TLDS:
                host = f'{slug}{tld}'
                url = f'https://{host}/'
                if url.rstrip('/').lower() in visitados:
                    continue
                pruebas.append({'artistId': artist_id, 'name': nombre, 'host': host, 'url': url})
    vistos = set()
    unicos = []
    for prueba in pruebas:
        if prueba['host'] in vistos:
            continue
        vistos.add(prueba['host'])
        unicos.append(prueba)
    pruebas = unicos
    print(json.dumps({'artistas': len(objetivo), 'dominiosAProbar': len(pruebas)}), flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        resuelven = {p['host']: ok for p, ok in zip(pruebas, pool.map(lambda p: resolver(p['host']), pruebas))}
    vivos = [p for p in pruebas if resuelven.get(p['host'])]
    print(json.dumps({'resuelven': len(vivos)}), flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(args.workers, 12)) as pool:
        sondeos = list(pool.map(lambda p: sondear(p['url']), vivos))
    candidatos, descartes = [], []
    for prueba, sondeo in zip(vivos, sondeos):
        fila = {**prueba, **{k: v for k, v in sondeo.items() if k != 'url'}}
        if sondeo.get('descartado'):
            descartes.append(fila)
        else:
            candidatos.append({'artistId': prueba['artistId'], 'name': prueba['name'], 'url': sondeo.get('final') or prueba['url'],
                               'fuente': 'dominio_probado', 'estadoHttp': sondeo.get('estado'), 'titulo': sondeo.get('titulo', '')})
    (OUT / 'sondeo.json').write_text(json.dumps(descartes, ensure_ascii=False, indent=1) + '\n')
    (OUT / 'candidatos.json').write_text(json.dumps(candidatos, ensure_ascii=False, indent=1) + '\n')
    resumen = {'generatedAt': now(), 'artistas': len(objetivo), 'nombresGenericosOmitidos': omitidos_por_generico,
               'dominiosProbados': len(pruebas), 'resuelven': len(vivos), 'candidatos': len(candidatos),
               'descartados': len(descartes),
               'porMotivo': {m: sum(1 for d in descartes if d.get('descartado') == m)
                             for m in {d.get('descartado') for d in descartes}}}
    (OUT / 'resumen.json').write_text(json.dumps(resumen, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(resumen, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
