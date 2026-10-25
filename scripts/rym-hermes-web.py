#!/usr/bin/env python3
"""Run a bounded Hermes research batch using process-local public HTTP tools.

No Hermes config changes, database tools, API search subscriptions or browser
sessions. Capture evidence on SSD; publish the campaign with staging.py later.
"""
import argparse
import datetime
import hashlib
from html.parser import HTMLParser
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import threading
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


def public_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Only public HTTP(S) URLs without credentials are accepted')
    if parsed.port not in (None, 80, 443):
        raise ValueError('Nonstandard port rejected')
    addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == 'https' else 80))
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise ValueError('Private, local or reserved destination rejected')
    return url


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class PageText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden = 0
        self.text = []
        self.title = []
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'):
            self.hidden += 1
        if tag == 'title':
            self.in_title = True

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript'):
            self.hidden = max(0, self.hidden - 1)
        if tag == 'title':
            self.in_title = False

    def handle_data(self, text):
        if self.hidden:
            return
        text = ' '.join(text.split())
        if text:
            self.text.append(text)
            if self.in_title:
                self.title.append(text)


class EvidenceHTTP:
    def __init__(self, out, max_fetches=24, max_searches=10, external_search=False, catalog=None):
        self.out = out
        self.folder = out / 'fuentes'
        self.folder.mkdir(exist_ok=True)
        self.cache = {}
        self.lock = threading.Lock()
        self.fetches = 0
        self.searches = 0
        self.max_fetches = max_fetches
        self.max_searches = max_searches
        self.external_search = external_search
        self.catalog = json.loads(catalog.read_text()) if catalog else None
        person_context = catalog.parent / 'catalogo-personas-ampliado.json' if catalog else None
        if self.catalog and person_context.is_file():
            people = {p['id']: p for p in json.loads(person_context.read_text())['persons']}
            self.catalog['persons'] = [{**p, **people.get(p['id'], {})} for p in self.catalog['persons']]
        policy_path = catalog.parent / 'politica-editorial.json' if catalog else None
        self.policy = json.loads(policy_path.read_text()) if policy_path and policy_path.exists() else {}
        self.service_state = (catalog.parent if catalog else out) / 'tavily-suspendido.json'
        self.opener = urllib.request.build_opener(PublicRedirect())
        local_index = out / 'evidencia-local.json'
        self.local = {r['url'].rstrip('/'): r for r in json.loads(local_index.read_text())} if local_index.exists() else {}

    def tavily(self, endpoint, payload):
        """Use the permanently configured credential; never persist request secrets."""
        if self.service_state.exists():
            state = json.loads(self.service_state.read_text())
            if state.get('status') == 432 or state.get('retryAfterEpoch', 0) > datetime.datetime.now().timestamp():
                return None
        try:
            from agent.web_search_provider import get_provider_env
            key = get_provider_env('TAVILY_API_KEY')
            if not key:
                return None
            request = urllib.request.Request('https://api.tavily.com/' + endpoint,
                data=json.dumps({**payload, 'api_key': key}).encode(),
                headers={'Content-Type': 'application/json'}, method='POST')
            with urllib.request.urlopen(request, timeout=45) as response:
                data = json.load(response)
            with self.lock:
                sequence = len(list(self.folder.glob('tavily-response-*.json'))) + 1
                record = self.folder / f'tavily-response-{sequence:03d}.json'
                record.write_text(json.dumps({'endpoint': endpoint, 'parameters': payload, 'response': data}, ensure_ascii=False) + '\n')
            return data
        except Exception as error:
            # Exception strings can contain request context; retain only the type/status.
            with self.lock:
                with (self.out / 'tavily-errors.jsonl').open('a') as log:
                    log.write(json.dumps({'endpoint': endpoint, 'errorType': type(error).__name__, 'status': getattr(error, 'code', None)}) + '\n')
            status = getattr(error, 'code', None)
            if status in (429, 432):
                state = {'status': status, 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'reason': 'Plan usage limit' if status == 432 else 'Rate limit',
                    'retryAfterEpoch': datetime.datetime.now().timestamp() + 120}
                temporary = self.service_state.with_name(self.service_state.name + '.' + str(os.getpid()))
                temporary.write_text(json.dumps(state) + '\n')
                temporary.replace(self.service_state)
            return None

    def fetch(self, url):
        local = self.local.get(url.rstrip('/'))
        if local:
            original = Path(local['sourcePath'])
            if hashlib.sha256(original.read_bytes()).hexdigest() != local['sha256']:
                raise ValueError('Local source hash changed')
            with self.lock:
                with (self.out / 'lecturas-locales.jsonl').open('a') as journal:
                    journal.write(json.dumps({'url': url, 'sourcePath': str(original), 'sha256': local['sha256']}) + '\n')
            return {'url': url, 'title': local['title'], 'content': local['text'],
                    'raw_content': local['text'], 'metadata': {k: v for k, v in local.items() if k != 'text'}}
        key = hashlib.sha256(url.encode()).hexdigest()[:24]
        saved = self.folder / (key + '.json')
        if saved.exists():
            record = json.loads(saved.read_text())
            raw = self.folder / (record.get('sourceFile') or record.get('htmlFile', ''))
            text_file = self.folder / record.get('textFile', '')
            if not record.get('error') and record.get('status') == 200 and raw.is_file() and text_file.is_file():
                intact = hashlib.sha256(raw.read_bytes()).hexdigest() == record.get('sha256')
                intact = intact and (not record.get('textSha256') or hashlib.sha256(text_file.read_bytes()).hexdigest() == record['textSha256'])
                if intact:
                    text = text_file.read_text()
                    return {'url': url, 'title': record.get('title', ''), 'content': text[:24000], 'raw_content': text[:24000], 'metadata': record}
        public_url(url)
        with self.lock:
            if url in self.cache:
                return self.cache[url]
            if self.fetches >= self.max_fetches:
                raise ValueError('Run fetched-URL limit reached')
            self.fetches += 1
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; CRV-evidence/1.0)'})
        record = {'url': url, 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        try:
            with self.opener.open(request, timeout=18) as response:
                max_bytes = 8_000_000 if (urllib.parse.urlsplit(url).hostname or '').lower() in ('youtube.com','www.youtube.com','m.youtube.com') else 3_000_000
                body = response.read(max_bytes + 1)
                if len(body) > max_bytes:
                    raise ValueError('Page exceeds capture limit')
                content_type = response.headers.get('Content-Type', '')
                if not any(kind in content_type for kind in ('text/', 'xml', 'json', 'application/pdf')):
                    raise ValueError('Non-text response rejected')
                record.update(status=response.status, finalUrl=response.url, contentType=content_type,
                              sha256=hashlib.sha256(body).hexdigest(), bytes=len(body))
                text = body.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
                (self.folder / (key + '.html')).write_bytes(body)
                parser = PageText()
                parser.feed(text)
                readable = '\n'.join(parser.text)
                if 'json' in content_type or 'text/plain' in content_type:
                    readable = text
                if 'application/pdf' in content_type:
                    result_pdf = subprocess.run(['pdftotext', '-layout', str(self.folder / (key + '.html')), '-'],
                        capture_output=True, timeout=25, check=True)
                    readable = result_pdf.stdout.decode('utf-8', errors='replace')
                if 'youtube.com' in (urllib.parse.urlsplit(url).hostname or ''):
                    match = re.search(r'ytInitialPlayerResponse\s*=\s*', text)
                    if match:
                        try:
                            player, _ = json.JSONDecoder().raw_decode(text[match.end():])
                            details = player.get('videoDetails', {})
                            readable = '\n'.join(k+': '+str(details[k]) for k in ('videoId', 'title', 'author', 'channelId', 'shortDescription') if k in details) + '\n' + readable
                        except (ValueError, TypeError):
                            pass
                record.update(title=' '.join(parser.title), textFile=key + '.txt', htmlFile=key + '.html')
                (self.folder / record['textFile']).write_text(readable)
                record['textSha256'] = hashlib.sha256(readable.encode()).hexdigest()
                result = {'url': url, 'title': record['title'], 'content': readable[:24000],
                          'raw_content': readable[:24000], 'metadata': record, '_body': text}
                if record['title'].strip().lower() in ('client challenge', 'just a moment...', 'security check required') or response.status != 200:
                    record['error'] = 'Blocked/challenge response is not source evidence'
                    result.update(error=record['error'], content='', raw_content='')
        except Exception as error:
            record['error'] = f'{type(error).__name__}: {error}'[:400]
            result = {'url': url, 'title': '', 'content': '', 'raw_content': '',
                      'metadata': record, 'error': record['error']}
        if result.get('error'):
            extracted = self.tavily('extract', {'urls': [url], 'format': 'text', 'extract_depth': 'basic', 'include_images': False})
            documents = (extracted or {}).get('results', [])
            if documents and documents[0].get('raw_content'):
                (self.folder / (key + '-http-error.json')).write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
                document = documents[0]
                text = document['raw_content']
                name = key + '.tavily.txt'
                (self.folder / name).write_text(text)
                record = {'url': url, 'finalUrl': document.get('url', url), 'status': 200,
                          'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                          'provenance': 'tavily-extract', 'title': document.get('title') or '',
                          'contentType': 'text/plain', 'sourceFile': name, 'textFile': name,
                          'sha256': hashlib.sha256(text.encode()).hexdigest(), 'bytes': len(text.encode())}
                record['textSha256'] = record['sha256']
                result = {'url': url, 'title': record['title'], 'content': text[:24000],
                          'raw_content': text[:24000], 'metadata': record}
        (self.folder / (key + '.json')).write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
        with self.lock:
            self.cache[url] = result
            with (self.out / 'consultas.jsonl').open('a') as journal:
                journal.write(json.dumps(record, ensure_ascii=False) + '\n')
        return result

    def search(self, query, limit=5):
        if query.upper().startswith('CRV-CATALOG:') and self.catalog:
            return self.catalog_lookup(query.split(':', 1)[1].strip())
        self.searches += 1
        if self.searches > self.max_searches:
            return {'success': False, 'error': 'Search limit reached; use known official links or return unresolved'}
        def words(value):
            normalized = ''.join(c for c in unicodedata.normalize('NFD', value.lower()) if unicodedata.category(c) != 'Mn')
            return {w for w in re.findall(r'\w+', normalized) if len(w) >= 4}
        terms = words(query)
        local_hits = [r for r in self.local.values() if terms & words(r['title'])]
        external_hits = [r for r in local_hits if 'rateyourmusic.com' not in r['url']]
        if external_hits and not self.external_search:
            return {'success': True, 'data': {'web': [{'title': r['title'], 'url': r['url'],
                    'description': 'Preserved local source with verified SHA-256; open with web_extract.',
                    'position': i + 1} for i, r in enumerate(external_hits[:5])]}}
        # Existing project metasearch service: no model or paid API required.
        # Fixed loopback destination is deliberately separate from public fetch.
        try:
            request = urllib.request.Request('http://127.0.0.1:8888/search?' + urllib.parse.urlencode({'q': query, 'format': 'json'}))
            with urllib.request.urlopen(request, timeout=25) as response:
                data = json.load(response)
            results = [{'title': r.get('title', ''), 'url': r['url'], 'description': r.get('content', '')[:1200], 'position': i + 1}
                for i, r in enumerate(data.get('results', [])[:min(int(limit), 5)])]
            with self.lock:
                with (self.out / 'busquedas-locales.jsonl').open('a') as log:
                    log.write(json.dumps({'query': query, 'results': results, 'provider': 'project-searxng',
                        'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}, ensure_ascii=False) + '\n')
            if results:
                return {'success': True, 'data': {'web': results}}
        except (OSError, ValueError):
            pass
        discovered = self.tavily('search', {'query': query, 'max_results': min(int(limit), 5),
                                           'search_depth': 'basic', 'include_raw_content': False, 'include_images': False})
        if discovered is not None:
            return {'success': True, 'data': {'web': [{'title': r.get('title', ''), 'url': r['url'],
                    'description': r.get('content', '')[:1200], 'position': i + 1}
                    for i, r in enumerate(discovered.get('results', []))]}}
        url = 'https://www.bing.com/search?format=rss&q=' + urllib.parse.quote(query)
        page = self.fetch(url)
        if page.get('error'):
            return {'success': False, 'error': page['error']}
        try:
            items = ET.fromstring(page['_body']).findall('.//item')
            results = [{'title': item.findtext('title', ''), 'url': item.findtext('link', ''),
                        'description': item.findtext('description', '')[:800], 'position': i + 1}
                       for i, item in enumerate(items[:min(int(limit), 5)])]
            results = [r for r in results if terms & words(r['title'] + ' ' + r['description'])]
            if not results:
                return {'success': False, 'error': 'Search returned no RSS results; use supplied official links'}
            return {'success': True, 'data': {'web': results}}
        except ET.ParseError:
            return {'success': False, 'error': 'Search is blocked or returned non-RSS content'}

    def catalog_lookup(self, name):
        """Local candidate discovery only; never treat catalogue text as evidence."""
        def key(text):
            text = ''.join(c for c in unicodedata.normalize('NFKD', str(text).lower()) if unicodedata.category(c) != 'Mn')
            return ' '.join(re.findall(r'\w+', text))
        wanted = key(name)
        if len(wanted) < 3:
            return {'success': False, 'error': 'Use a specific full name or documented alias'}
        result = []
        for kind, table, aliases, idfield in [('artist', 'artists', 'artistAliases', 'artist_id'), ('person', 'persons', 'personAliases', 'person_id')]:
            base = {r['id']: r for r in self.catalog[table]}
            if kind == 'artist':
                for ref in self.policy.get('policies', []):
                    snapshot = ref.get('snapshot') or {}
                    base.setdefault(ref['artist_id'], {**(snapshot.get('artist') or {}), 'id': ref['artist_id'],
                        'name': ref['name'], 'editorialReference': True,
                        'editorialPolicy': {k: ref.get(k) for k in ('disposition', 'reference_kind', 'reason')},
                        'catalogAlbums': snapshot.get('albums', [])[:20], 'catalogMembers': snapshot.get('members', [])[:20]})
            names = {i: [r['name']] for i, r in base.items()}
            if kind == 'person':
                for i,r in base.items():
                    if r.get('real_name'):
                        names[i].append(r['real_name'])
            for r in self.catalog[aliases]:
                if r[idfield] in names:
                    names[r[idfield]].append(r['alias'])
            exact = [i for i, ns in names.items() if any(key(n) == wanted for n in ns)]
            ids = exact or [i for i, ns in names.items() if len(wanted.split()) >= 2 and any(' ' + wanted + ' ' in ' ' + key(n) + ' ' for n in ns)]
            for i in ids[:10]:
                r = {**base[i], 'kind': kind, 'aliases': names[i]}
                if kind == 'artist':
                    r['artistId'] = i
                    r['biography'] = (r.get('biography') or '')[:1800]
                    r['catalogAlbums'] = r.get('catalogAlbums') or [a for a in self.catalog['albums'] if a['artist_id'] == i][:30]
                    persons = {p['id']: p for p in self.catalog['persons']}
                    r['catalogMembers'] = r.get('catalogMembers') or [{**persons[m['person_id']], 'role': m['role']} for m in self.catalog['members'] if m['artist_id'] == i and m['person_id'] in persons][:25]
                    r['verifiedLinks'] = [l for l in self.catalog['social'] + self.catalog['streaming'] if l['artist_id'] == i][:12]
                else:
                    r['biography'] = (r.get('biography') or '')[:2800]
                    artists = {a['id']: a['name'] for a in self.catalog['artists']}
                    r['catalogMemberships'] = [{**m, 'artistName': artists[m['artist_id']]} for m in self.catalog['members'] if m['person_id'] == i and m['artist_id'] in artists]
                    refs = {a['artist_id']: a for a in self.policy.get('policies', [])}
                    r['editorialReferenceMemberships'] = [{'artistId': m['artist_id'], 'artistName': refs[m['artist_id']]['name'],
                        'editorialReference': True, 'snapshot': refs[m['artist_id']].get('snapshot')}
                        for m in self.policy.get('persons', []) if m['person_id'] == i and m['artist_id'] in refs]
                result.append(r)
        with self.lock:
            with (self.out / 'catalog-lookups.jsonl').open('a') as log:
                log.write(json.dumps({'query': name, 'results': result, 'readOnly': True}, ensure_ascii=False) + '\n')
        return {'success': True, 'localCatalogueOnly': True, 'warning': 'Candidates only, not external evidence; no writes. Propose an ID only with documentary identity proof.', 'candidates': result}


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--out', type=Path, required=True)
    args.add_argument('--prompt', type=Path)
    args.add_argument('--probe', action='store_true')
    args.add_argument('--max-turns', type=int, default=14)
    args.add_argument('--max-fetches', type=int, default=24)
    args.add_argument('--max-searches', type=int, default=10)
    args.add_argument('--external-search', action='store_true', help='Discover fresh sources even when local sources match')
    args.add_argument('--catalog', type=Path, help='Read-only pinned snapshot for CRV-CATALOG: lookups')
    options = args.parse_args()
    out = options.out.resolve()
    if not out.is_dir() or not out.is_relative_to(Path.home() / 'crv-staging'):
        raise SystemExit('Use an existing SSD staging campaign')
    http = EvidenceHTTP(out, options.max_fetches, options.max_searches, options.external_search, options.catalog)
    if options.probe:
        for url in ['https://ababajah.bandcamp.com/album/amanecer',
                    'https://algodonegipcio.bandcamp.com/album/la-lucha-constante']:
            page = http.fetch(url)
            print(json.dumps({'url': url, 'status': page['metadata'].get('status'),
                              'error': page.get('error'), 'textChars': len(page['content'])}))
        result = http.search('"Ababajah" "Amanecer"')
        print(json.dumps(result, ensure_ascii=False)[:2000])
        return
    if not options.prompt:
        raise SystemExit('--prompt required')
    hermes = Path.home() / '.hermes/hermes-agent'
    sys.path.insert(0, str(hermes))
    from agent.web_search_provider import WebSearchProvider
    from agent.web_search_registry import register_provider

    class CRVPublicHTTP(WebSearchProvider):
        @property
        def name(self):
            return 'crv-public-http'

        def is_available(self):
            return True

        def supports_extract(self):
            return True

        def search(self, query, limit=5):
            return http.search(query, limit)

        def extract(self, urls, **kwargs):
            results = []
            for url in urls[:6]:
                try:
                    result = http.fetch(url).copy()
                    result.pop('_body', None)
                    results.append(result)
                except Exception as error:
                    results.append({'url': url, 'error': str(error)[:300], 'content': ''})
            return results

    register_provider(CRVPublicHTTP())
    from tools import web_tools
    web_tools._get_search_backend = lambda: 'crv-public-http'
    web_tools._get_extract_backend = lambda: 'crv-public-http'
    from hermes_cli.main import main as hermes_main
    os.environ['HERMES_IGNORE_RULES'] = '1'
    query = options.prompt.read_text()
    criteria = options.catalog.parent / 'criterios-identidad.txt' if options.catalog else None
    if criteria and criteria.is_file():
        criteria_text = criteria.read_text()
        print('criteria_sha256: ' + hashlib.sha256(criteria_text.encode()).hexdigest(), file=sys.stderr)
        query = criteria_text + '\n\n' + query
    sys.argv = ['hermes', '--ignore-rules', '--reasoning', 'low', 'chat', '--toolsets', 'web',
                '--max-turns', str(options.max_turns), '--quiet', '--query', query]
    hermes_main()


if __name__ == '__main__':
    main()
