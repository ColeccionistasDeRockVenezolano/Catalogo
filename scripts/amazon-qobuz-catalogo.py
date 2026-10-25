#!/usr/bin/env python3
"""Búsqueda reanudable de todo el catálogo. No escribe en la BD.

Qobuz: búsqueda pública → discografía → ficha de cada disco coincidente.
Amazon: buscador local; candidatos ocultos hasta verificar la ficha.
Conserva respuestas comprimidas, errores, ambiguos y discos pendientes.
"""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
import re
import threading
import time
import unicodedata
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup


def norm(value):
    value = unicodedata.normalize('NFD', value or '').lower()
    return ' '.join(''.join(c if c.isalnum() else ' ' for c in value
                            if unicodedata.category(c) != 'Mn').split())


def compatible(title, year, album):
    return norm(title) == norm(album['title']) and not (
        year and album.get('year') and year != album['year'])


class Collector:
    def __init__(self, root, searx):
        self.root = root
        self.searx = searx
        self.local = threading.local()

    def get(self, url):
        cache = self.root / 'paginas' / (hashlib.sha256(url.encode()).hexdigest() + '.json.gz')
        if cache.exists():
            with gzip.open(cache, 'rt') as f:
                return json.load(f)['body']
        if not hasattr(self.local, 'session'):
            self.local.session = requests.Session()
            self.local.session.headers['User-Agent'] = 'CRV-catalog-research/1.0 (+https://coleccionistasderockvenezolano.com)'
        for attempt in range(3):
            response = self.local.session.get(url, timeout=30)
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < 2:
                    time.sleep(min(60, max(5, int(response.headers.get('Retry-After', '10')))))
                    continue
            response.raise_for_status()
            cache.parent.mkdir(parents=True, exist_ok=True)
            with gzip.open(cache, 'wt') as f:
                json.dump({'url': url, 'finalUrl': response.url, 'capturedAt': time.time(),
                           'status': response.status_code, 'body': response.text}, f)
            return response.text
        raise RuntimeError('request exhausted')

    def qobuz(self, artist):
        result = {'artistId': artist['id'], 'name': artist['name'], 'artist_links': [],
                  'album_links': [], 'review': [], 'errors': [], 'evaluatedAlbums': len(artist['albums'])}
        search = 'https://www.qobuz.com/us-en/search?q=' + quote(artist['name'])
        soup = BeautifulSoup(self.get(search), 'html.parser')
        if not soup.select_one('main'):
            raise RuntimeError('Qobuz: respuesta sin catálogo')
        profiles = sorted({urljoin(search, a['href']) for a in soup.select('a[href*="/interpreter/"]')
                           if norm(a.get_text(' ', strip=True)) == norm(artist['name'])})
        # No se elige arbitrariamente entre perfiles homónimos.
        matches = {}
        for profile in profiles:
            found = {}
            pending = [profile]
            visited = set()
            while pending:
                page = pending.pop(0)
                if page in visited:
                    continue
                visited.add(page)
                doc = BeautifulSoup(self.get(page), 'html.parser')
                for card in doc.select('.product__item'):
                    title = card.select_one('.product__name')
                    who = card.select_one('.product__artist a')
                    if not title or not who or norm(who.get_text()) != norm(artist['name']):
                        continue
                    anchor = title.find_parent('a')
                    if anchor:
                        url = urljoin(page, anchor['href'])
                        found[url] = {'title': title.get('data-title') or title.get_text(' ', strip=True), 'url': url}
                for a in doc.select('a[href]'):
                    href = urljoin(page, a['href'])
                    profile_path = urlparse(profile).path
                    if ((urlparse(href).path == profile_path and re.search(r'[?&]page=\d+', href)
                         or re.fullmatch(re.escape(profile_path) + r'/page/\d+', urlparse(href).path))
                            and urlparse(href).netloc == 'www.qobuz.com' and href not in visited):
                        pending.append(href)
            exact = []
            for candidate in found.values():
                albums = [a for a in artist['albums'] if norm(a['title']) == norm(candidate['title'])]
                if not albums:
                    continue
                try:
                    detail = BeautifulSoup(self.get(candidate['url']), 'html.parser')
                    products = []
                    for script in detail.select('script[type="application/ld+json"]'):
                        try:
                            obj = json.loads(script.string or script.get_text())
                            products.extend(obj if isinstance(obj, list) else [obj])
                        except (ValueError, TypeError):
                            pass
                    product = next((p for p in products if p.get('@type') == 'Product'), None)
                    if not product or norm((product.get('brand') or {}).get('name')) != norm(artist['name']):
                        result['review'].append({'reason': 'ficha sin identidad exacta', **candidate})
                        continue
                    date = product.get('releaseDate') or ''
                    year = int(date[:4]) if re.match(r'^\d{4}', date) else None
                    canonical_matches = [a for a in albums if compatible(product['name'], year, a)]
                    if len(canonical_matches) > 1:
                        result['review'].append({'reason': 'varias fichas del catálogo compatibles',
                                                 'albumIds': [a['id'] for a in canonical_matches], **candidate})
                        continue
                    for album in albums:
                        link = {'platform': 'qobuz', 'albumId': album['id'], 'url': candidate['url'],
                                'id': candidate['url'].rstrip('/').split('/')[-1], 'method': 'exact',
                                'source': 'qobuz-public-catalog', 'name_plat': product['brand']['name'],
                                'title_plat': product['name'], 'year_plat': year, 'profile_url': profile,
                                'score': 1}
                        if compatible(product['name'], year, album):
                            exact.append(link)
                        else:
                            result['review'].append({'reason': 'título/año incompatible', **link})
                except Exception as error:
                    result['errors'].append({'url': candidate['url'], 'error': str(error)})
            if exact:
                matches[profile] = exact
        if len(matches) == 1:
            profile, links = next(iter(matches.items()))
            result['artist_links'] = [{'platform': 'qobuz', 'url': profile, 'id': profile.split('/')[-1],
                                      'method': 'exact', 'source': 'qobuz-public-catalog',
                                      'name_plat': artist['name'], 'score': 1}]
            for album in artist['albums']:
                choices = {l['url']: l for l in links if l['albumId'] == album['id']}
                if len(choices) == 1:
                    result['album_links'].extend(choices.values())
                elif choices:
                    result['review'].append({'albumId': album['id'], 'reason': 'varias ediciones', 'choices': list(choices.values())})
            # Un perfil requiere al menos un disco inequívoco.
            if not result['album_links']:
                result['artist_links'] = []
        elif matches:
            result['review'].append({'reason': 'perfiles homónimos con repertorio coincidente', 'profiles': matches})
        else:
            result['review'].append({'reason': 'sin identidad por repertorio', 'profiles': profiles})
        linked = {l['albumId'] for l in result['album_links']}
        result['pendingAlbums'] = [a['id'] for a in artist['albums'] if a['id'] not in linked]
        result['status'] = 'partial_error' if result['errors'] else 'completed'
        return result

    def amazon(self, artist):
        query = f'site:music.amazon.com "{artist["name"]}"'
        queries = [query] + [f'site:music.amazon.com/albums/ "{artist["name"]}" "{album["title"]}"'
                             for album in artist['albums']]
        results, errors, engines = {}, [], []
        for index, text in enumerate(dict.fromkeys(queries), 1):
            url = self.searx.rstrip('/') + '/search?' + requests.compat.urlencode(
                {'q': text, 'format': 'json', 'engines': 'bing', 'categories': 'general'})
            try:
                data = json.loads(self.get(url))
                engines.extend(data.get('unresponsive_engines', []))
                for hit in data.get('results', []):
                    results[hit['url']] = hit
            except Exception as error:
                errors.append({'query': text, 'error': str(error)})
            if index == 1 or index % 10 == 0 or index == len(queries):
                progress = {'artistId': artist['id'], 'name': artist['name'],
                            'completedQueries': index, 'totalQueries': len(queries),
                            'hits': len(results), 'errors': len(errors), 'updatedAt': time.time()}
                (self.root / 'amazon-progreso.json').write_text(json.dumps(progress, ensure_ascii=False, indent=2))
                print(json.dumps(progress, ensure_ascii=False), flush=True)
            time.sleep(1.5)
        hits = [h for h in results.values() if
                re.match(r'^https://music\.amazon\.[a-z.]+/(?:[a-z]{2}-[a-z]{2}/)?(?:artists|albums|tracks)/', h['url'])]
        profiles, albums = {}, {}
        for hit in hits:
            title = hit.get('title', '')
            if '/artists/' in hit['url']:
                name = re.split(r' on Amazon| en Amazon| - Amazon', title, flags=re.I)[0]
                if norm(name) == norm(artist['name']):
                    profiles[hit['url']] = {'platform': 'amazon_music', 'url': hit['url'],
                        'id': hit['url'].split('/artists/')[1].split('/')[0], 'method': 'exact',
                        'source': 'amazon-web-search', 'name_plat': name}
            if '/albums/' in hit['url']:
                match = re.match(r'^(?:Play |Listen to )?(.+?) by (.+?) on Amazon', title, flags=re.I)
                if match and norm(match[2]) == norm(artist['name']):
                    for album in artist['albums']:
                        if norm(match[1]) == norm(album['title']):
                            albums.setdefault(album['id'], {})[hit['url']] = {
                                'platform': 'amazon_music', 'albumId': album['id'], 'url': hit['url'],
                                'id': hit['url'].split('/albums/')[1].split('/')[0], 'method': 'exact',
                                'source': 'amazon-web-search', 'title_plat': match[1], 'name_plat': match[2]}
        # Los snippets son evidencia de descubrimiento; no confirman la identidad.
        return {'artistId': artist['id'], 'name': artist['name'],
                'artist_links': list(profiles.values()) if len(profiles) == 1 else [],
                'album_links': [next(iter(v.values())) for v in albums.values() if len(v) == 1],
                'status': 'partial_error' if errors else 'search_degraded' if engines else 'completed',
                'queries': queries, 'hits': hits, 'unresponsive_engines': engines, 'errors': errors,
                'evaluatedAlbums': len(artist['albums']), 'pendingAlbums': [a['id'] for a in artist['albums']],
                'review': [{'reason': 'Amazon requiere verificación de ficha; no publicar snippets como confirmados',
                            'url': h['url'], 'title': h.get('title'), 'content': h.get('content')} for h in hits]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('platform', choices=['qobuz', 'amazon'])
    parser.add_argument('--dir', type=Path, default=Path('reports/amazon-qobuz-2026-10-18'))
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--refresh', action='store_true', help='Recalcular resultados desde las respuestas conservadas')
    parser.add_argument('--retry-errors', action='store_true', help='Reintentar artistas con errores; no omite la caché')
    parser.add_argument('--status', action='store_true', help='Mostrar el avance sin hacer consultas')
    parser.add_argument('--searx', default='http://127.0.0.1:8888')
    args = parser.parse_args()
    artists = [json.loads(l) for l in (args.dir / 'catalogo.jsonl').read_text().splitlines() if l.strip()]
    output = args.dir / args.platform
    output.mkdir(parents=True, exist_ok=True)
    todo = []
    for artist in artists:
        file = output / f'links-{artist["id"]}.json'
        retry = args.retry_errors and file.exists() and json.loads(file.read_text())['status'] != 'completed'
        if args.refresh or not file.exists() or retry:
            todo.append(artist)
    if args.limit:
        todo = todo[:args.limit]
    collector = Collector(args.dir, args.searx)

    def work(artist):
        try:
            result = getattr(collector, args.platform)(artist)
        except Exception as error:
            result = {'artistId': artist['id'], 'name': artist['name'], 'status': 'error',
                      'error': str(error), 'artist_links': [], 'album_links': []}
        dest = output / f'links-{artist["id"]}.json'
        temp = dest.with_suffix('.tmp')
        temp.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        temp.replace(dest)
        return result

    if not args.status:
        print(json.dumps({'platform': args.platform, 'totalArtists': len(artists), 'totalAlbums': sum(len(a['albums']) for a in artists), 'todo': len(todo)}), flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(work, artist) for artist in todo]
            for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
                result = future.result()
                print(json.dumps({'done': i, 'artistId': result['artistId'], 'name': result['name'],
                                  'status': result['status'], 'albums': len(result['album_links'])}, ensure_ascii=False), flush=True)
    results = [json.loads(p.read_text()) for p in output.glob('links-*.json')]
    summary = {'platform': args.platform, 'totalArtists': len(artists), 'totalAlbums': sum(len(a['albums']) for a in artists),
               'processedArtists': len(results), 'remainingArtists': len(artists) - len(results),
               'evaluatedAlbums': sum(r.get('evaluatedAlbums', 0) for r in results),
               'profiles': sum(len(r['artist_links']) for r in results),
               'albums': sum(len(r['album_links']) for r in results),
               'errors': sum(r['status'] in ('error', 'partial_error', 'search_degraded') for r in results),
               'review': sum(len(r.get('review', [])) for r in results)}
    if not args.status:
        (args.dir / f'{args.platform}-resumen.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    main()
