#!/usr/bin/env python3
"""Reintento dirigido de los casos sin resolver de la revisión Scrapling.

Método por caso, del más barato al más caro:
  1. Dominio aparcado, DNS inexistente o redirección a un servicio de parking:
     se clasifica sin abrir navegador.
  2. Blog en WordPress.com o Blogger: se lee por la API pública de WordPress.com
     o por el feed JSON de Blogger, sin el muro antibot que bloquea al navegador.
  3. Resto: StealthySession con Chrome real, resolución de Cloudflare, espera de
     red inactiva, texto renderizado (innerText) y reintento sobre la raíz del
     dominio. Se acepta el contenido aunque el código HTTP sea de error si la
     página tiene texto suficiente, y se conserva el DOM parcial si la carga no
     termina.
  4. Si la portada es breve, se leen hasta dos páginas internas de biografía,
     discografía o historia del mismo dominio.

Conserva DOM, texto renderizado, hash, estado HTTP, URL final y errores de cada intento.
"""
import argparse, concurrent.futures, hashlib, importlib.metadata, ipaddress, json, logging
import multiprocessing, os, re, socket, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'reports/webs-oficiales-2026-10-18'
ORIGEN = BASE / 'revision-990/scrapling'
OUT = Path(os.environ['WEBS_RETRY_DIR']).resolve() if os.environ.get('WEBS_RETRY_DIR') else BASE / 'revision-990/reintento'
SESSION = None

PARKING_HOST = re.compile(
    r'(siteindices\.com|rilds\.com|sedoparking|sedo\.com|afternic|hugedomains|dan\.com|'
    r'domainmarket|buydomains|parkingcrew|bodis\.com|above\.com|undeveloped\.com|'
    r'smartname|domainsponsor|parklogic|rookmedia|skysound7\.com|muzce\.com)$', re.I)
PARKING_TEXT = re.compile(
    r'domain (?:is|may be) for sale|buy this domain|this domain is parked|parked domain|'
    r'dominio en venta|domeinnaam|domain registered|hugedomains|sedoparking'
    r'|domain has expired|dominio expirado|site not found', re.I)
CHALLENGE_TEXT = re.compile(
    r'just a moment|checking your browser|verify you are human|attention required|'
    r'access denied|security check|cf-chl|captcha|enable javascript and cookies|'
    r'un momento|verificando (?:que eres|tu navegador)', re.I)
FEED_HOST = re.compile(r'(\.wordpress\.com|\.blogspot\.com)$', re.I)


def now():
    return datetime.now(timezone.utc).isoformat()


def key(c):
    return f"{c['artistId']}-{hashlib.sha256(c['url'].encode()).hexdigest()[:18]}"


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    tmp.replace(path)


def text_of(raw):
    """Texto visible aproximado del HTML estático; la evaluación usa innerText si existe."""
    raw = re.sub(r'(?is)<(script|style|noscript|svg|head)\b.*?</\1>', ' ', raw)
    raw = re.sub(r'(?s)<[^>]+>', ' ', raw)
    return re.sub(r'\s+', ' ', raw).strip()


def public_host(host):
    try:
        if not host or host == 'localhost' or host.endswith(('.local', '.internal', '.localhost')):
            return False
        addresses = {a[4][0] for a in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)}
        return bool(addresses) and all(ipaddress.ip_address(ip).is_global for ip in addresses)
    except (OSError, ValueError):
        return False


def permitted(raw):
    try:
        u = urlsplit(raw)
        if u.scheme not in ('http', 'https') or u.username or u.password or u.port not in (None, 80, 443):
            return False
        if not u.hostname or u.hostname == 'localhost' or u.hostname.endswith(('.local', '.internal', '.localhost')):
            return False
        try:
            return ipaddress.ip_address(u.hostname).is_global
        except ValueError:
            return not re.fullmatch(r'(?:10|127|169\.254|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+\.\d+', u.hostname)
    except ValueError:
        return False


def request(url, timeout=30, limit=6_000_000):
    """Lectura HTTP simple para API y feeds públicos."""
    req = urllib.request.Request(url, headers={
        'Accept': 'application/json,application/xml,text/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-VE,es;q=0.9,en;q=0.8',
    })
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read(limit + 1)
        if len(body) > limit:
            raise ValueError('Respuesta demasiado grande')
        return response.status, response.geturl(), body


# ---------------------------------------------------------------- feeds

def wordpress_pages(host):
    """API pública de WordPress.com: información del sitio y sus entradas."""
    site = host if host.lower().endswith('.wordpress.com') else f'{host}.wordpress.com'
    notes = []
    info = {}
    try:
        status, _, body = request(f'https://public-api.wordpress.com/rest/v1.1/sites/{site}')
        data = json.loads(body)
        info = {'name': data.get('name'), 'description': data.get('description'),
                'URL': data.get('URL'), 'subscribers': data.get('subscribers_count')}
        notes.append({'api': f'sites/{site}', 'status': status})
    except Exception as exc:  # noqa: BLE001
        notes.append({'api': f'sites/{site}', 'error': str(exc)[:300]})
    parts, total = [], 0
    for page in range(1, 3):
        url = (f'https://public-api.wordpress.com/rest/v1.1/sites/{site}/posts/'
               f'?number=20&page={page}&fields=title,content,excerpt,date,URL')
        try:
            status, final, body = request(url)
            data = json.loads(body)
        except Exception as exc:  # noqa: BLE001
            notes.append({'api': f'posts página {page}', 'error': str(exc)[:300]})
            break
        posts = data.get('posts') or []
        notes.append({'api': f'posts página {page}', 'status': status, 'posts': len(posts), 'found': data.get('found')})
        for post in posts:
            title = (post.get('title') or '').strip()
            text = text_of(post.get('content') or post.get('excerpt') or '')[:3000]
            if not title and not text:
                continue
            parts.append(f'<article><h3>{title}</h3><p>{text}</p></article>')
            total += 1
        if len(posts) < 20:
            break
    if not (info.get('name') or parts):
        return [], notes
    title = info.get('name') or site
    html = (f'<html><head><title>{title} — {host}</title></head><body><h1>{title}</h1>'
            f'<p>{info.get("description") or ""}</p>{"".join(parts)}</body></html>')
    return [{'url': f'https://{host}/', 'status': 200, 'html': html, 'method': 'wordpress_public_api',
             'complete': True, 'text': text_of(html), 'title': str(title), 'usable': True,
             'blocked': False, 'partial': False,
             'api': 'public-api.wordpress.com/rest/v1.1', 'posts': total}], notes


def blogspot_pages(host):
    url = f'https://{host}/feeds/posts/default?alt=json&max-results=25'
    notes = []
    try:
        status, final, body = request(url)
        feed = json.loads(body.decode('utf-8', 'replace'))['feed']
    except Exception as exc:  # noqa: BLE001
        return [], [{'feed': url, 'error': str(exc)[:300]}]
    site = (feed.get('title', {}).get('$t') or '').strip()
    desc = text_of(feed.get('subtitle', {}).get('$t') or '')
    parts, total = [], 0
    for entry in feed.get('entry', []):
        title = (entry.get('title', {}).get('$t') or '').strip()
        content = (entry.get('content', {}).get('$t') or entry.get('summary', {}).get('$t') or '')
        text = text_of(content)[:3000]
        if not title and not text:
            continue
        parts.append(f'<article><h3>{title}</h3><p>{text}</p></article>')
        total += 1
        if total >= 20:
            break
    notes.append({'feed': url, 'items': total})
    if not (site or parts) or len(text_of(html_of(site, desc, parts))) < 120:
        return [], notes
    html = html_of(site, desc, parts)
    return [{'url': f'https://{host}/', 'status': 200, 'html': html, 'method': 'blogspot_feed',
             'complete': True, 'text': text_of(html), 'title': site, 'usable': True,
             'blocked': False, 'partial': False}], notes


def html_of(site, desc, parts):
    """Envuelve el contenido del feed en un HTML mínimo y evaluable."""
    return (f'<html><head><title>{site}</title></head><body><h1>{site}</h1>'
            f'<p>{desc}</p>{"".join(parts)}</body></html>')


def feed_pages(c):
    host = urlsplit(c['url']).hostname or ''
    if 'wordpress.com' in host.lower():
        return wordpress_pages(host)
    if 'blogspot.com' in host.lower():
        return blogspot_pages(host)
    return [], []


# ---------------------------------------------------------------- navegador

def init_worker():
    global SESSION
    from scrapling.fetchers import StealthySession
    logging.getLogger('scrapling').setLevel(logging.CRITICAL)
    SESSION = StealthySession(headless=True, max_pages=1, timeout=30000, retries=1,
        solve_cloudflare=True, real_chrome=True, network_idle=True, block_webrtc=True,
        load_dom=True, google_search=False, locale='es-VE',
        additional_args={'accept_downloads': False, 'ignore_https_errors': True, 'service_workers': 'block'})
    SESSION.start()
    from multiprocessing.util import Finalize
    Finalize(None, close_session, exitpriority=10)


def close_session():
    if SESSION:
        try:
            SESSION.close()
        except Exception:  # noqa: BLE001
            pass


def browser_page(url, attempts):
    """Una visita; devuelve el mejor candidato con contenido (aunque el HTTP sea de error)."""
    global SESSION
    target = urlsplit(url)
    variants = [url]
    root = f'{target.scheme}://{target.netloc}/'
    if root != url:
        variants.append(root)
    swapped = target._replace(scheme='https' if target.scheme == 'http' else 'http').geturl()
    if swapped not in variants:
        variants.append(swapped)
    best = None
    for attempt_url in variants:
        if not permitted(attempt_url):
            attempts.append({'url': attempt_url, 'status': 'dns_or_address_unavailable', 'at': now()})
            continue
        holder, handlers = {}, []

        def snapshot(page):
            try:
                holder['html'] = page.content()
                holder['url'] = page.url
                holder['text'] = page.evaluate('() => document.body ? document.body.innerText : ""')
                holder['at'] = now()
            except Exception:  # noqa: BLE001
                pass

        def setup(page):
            def guard(route):
                req = route.request
                # Se bloquean solo recursos pesados; el muro antibot puede exigir POST.
                if req.resource_type in ('image', 'media', 'font', 'websocket'):
                    return route.abort()
                if not permitted(req.url):
                    return route.abort()
                return route.continue_()
            page.route('**/*', guard)
            page.route_web_socket('**/*', lambda ws: ws.close())
            handler = lambda: snapshot(page)  # noqa: E731
            page.on('domcontentloaded', handler)
            handlers.append((page, 'domcontentloaded', handler))

            def response(r):
                if r.request.is_navigation_request() and r.frame == page.main_frame:
                    holder['status'] = r.status
                    holder['finalUrl'] = r.url
            page.on('response', response)
            handlers.append((page, 'response', response))

        def action(page):
            page.wait_for_timeout(1500)
            # Aplicaciones de una sola página: se espera texto real, no solo el esqueleto.
            for _ in range(4):
                for fraction in (0.5, 1):
                    page.evaluate('(f) => window.scrollTo(0, document.body.scrollHeight * f)', fraction)
                    page.wait_for_timeout(400)
                size = page.evaluate('() => document.body ? document.body.innerText.trim().length : 0')
                if size and size > 300:
                    break
            snapshot(page)
        started = time.time()
        error = None
        try:
            SESSION.fetch(attempt_url, timeout=30000, network_idle=True, wait=2500,
                          page_setup=setup, page_action=action)
        except Exception as exc:  # noqa: BLE001
            error = re.sub(r'\s+', ' ', str(exc))[:600]
        finally:
            for page, event, handler in handlers:
                try:
                    page.remove_listener(event, handler)
                except Exception:  # noqa: BLE001
                    pass
        if holder.get('html'):
            html = holder['html']
            rendered = re.sub(r'[ \t\u00a0]+', ' ', holder.get('text') or '').strip()
            # Aplicaciones de una sola página: título y meta descripción siguen siendo evidencia.
            meta = ' '.join(re.findall(r'(?is)<meta[^>]+content=["\']([^"\']{3,300})', html))
            static = f'{meta} {text_of(html)}'.strip()
            text = rendered if len(rendered) > len(static) else static
            title = (re.search(r'(?is)<title[^>]*>(.*?)</title>', html) or [None, ''])[1]
            title = text_of(title)[:200]
            status = int(holder.get('status') or 0)
            attempt = {'url': attempt_url, 'finalUrl': holder.get('url'), 'httpStatus': status,
                       'bytes': len(html), 'textLength': len(text), 'title': title,
                       'at': holder.get('at'), 'seconds': round(time.time() - started, 1)}
            if error:
                attempt['partialError'] = error
            attempts.append(attempt)
            # Un muro antibot se reconoce por el título o por un cuerpo mínimo con la señal;
            # una página real puede mencionar «captcha» o «acceso denegado» sin ser un muro.
            challenge = bool(CHALLENGE_TEXT.search(title[:120])) or (len(text) < 700 and bool(CHALLENGE_TEXT.search(text[:1500])))
            usable = not challenge and len(text) >= 120 and (200 <= status < 300 or len(text) >= 700)
            score = (usable, 200 <= status < 300, len(text))
            if best is None or score > best[0]:
                best = (score, {'html': html, 'url': holder.get('url') or attempt_url, 'status': status,
                               'title': title, 'text': text, 'method': 'stealthy_real_chrome',
                               'blocked': challenge, 'usable': usable,
                               'partial': bool(error) and status == 0})
            if usable and 200 <= status < 300:
                break
            if 200 <= status < 300 and len(html) > 20000:
                break  # la página cargó; repetir con otro esquema no aporta
        else:
            attempts.append({'url': attempt_url, 'error': error or 'sin contenido',
                             'at': now(), 'seconds': round(time.time() - started, 1)})
        try:
            SESSION.close_pages()
        except Exception:  # noqa: BLE001
            pass
    return best[1] if best else None


def internal_pages(page, attempts, limit=2):
    """Lee biografía/discografía del mismo dominio cuando la portada es breve."""
    base = urlsplit(page['url'])
    links = []
    for href in re.findall(r'(?i)href=["\']([^"\'#]+)', page['html']):
        try:
            full = urljoin(page['url'], href)
            u = urlsplit(full)
        except ValueError:
            continue
        if u.scheme not in ('http', 'https') or u.netloc != base.netloc:
            continue
        if not re.search(r'bio|about|discograf|discograph|music|musica|nosotros|historia|sobre|quienes', u.path, re.I):
            continue
        if full.rstrip('/') == page['url'].rstrip('/'):
            continue
        if full not in links:
            links.append(full)
    out = []
    for url in links[:limit]:
        candidate = browser_page(url, attempts)
        if candidate and candidate['usable'] and len(candidate['text']) >= 120:
            out.append(candidate)
    return out


def parking_or_dead(c):
    """Clasificación sin navegador: aparcamiento, DNS inexistente o host no público."""
    host = (urlsplit(c['url']).hostname or '').lower()
    if PARKING_HOST.search(host):
        return 'parking_service', f'El host «{host}» pertenece a un servicio de aparcamiento o índice de dominios; no es una web del artista.'
    try:
        addresses = {a[4][0] for a in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)}
    except OSError as exc:
        return 'dns_unresolved', f'El dominio no resuelve ({type(exc).__name__}); no hay web que leer.'
    if not addresses or not all(ipaddress.ip_address(ip).is_global for ip in addresses):
        return 'non_public_address', f'El dominio resuelve a una dirección no pública ({", ".join(sorted(str(a) for a in addresses))}).'
    return None


def store(key_id, page, suffix=''):
    dest = OUT / 'capturas' / f'{key_id}{suffix}.html'
    dest.parent.mkdir(parents=True, exist_ok=True)
    payload = page['html'].encode('utf-8')
    dest.write_bytes(payload)
    return {'url': page['url'], 'status': page['status'], 'capture': str(dest.relative_to(ROOT)),
            'sha256': hashlib.sha256(payload).hexdigest(), 'complete': not page.get('partial', False),
            'method': page['method'], 'capturedAt': now(), 'title': page['title'],
            'textLength': len(page['text']), 'renderedText': page['text'][:120000]}


def process(c):
    key_id = key(c)
    record = {'artistId': c['artistId'], 'name': c['name'], 'requestedUrl': c['url'],
              'tool': 'Scrapling', 'toolVersion': importlib.metadata.version('scrapling'),
              'engine': 'StealthySession real_chrome + solve_cloudflare', 'captureVersion': 3,
              'startedAt': now(), 'attempts': [], 'pages': []}
    static = parking_or_dead(c)
    if static:
        record.update(outcome='inactive_domain', staticReason=static[0], staticDetail=static[1],
                      finishedAt=now(), browserAttempted=False)
        atomic(OUT / 'visitas' / f'{key_id}.json', record)
        return {'key': key_id, 'name': c['name'], 'outcome': record['outcome'], 'pages': 0}

    pages, notes = [], []
    if FEED_HOST.search(urlsplit(c['url']).hostname or ''):
        try:
            pages, notes = feed_pages(c)
        except Exception as exc:  # noqa: BLE001
            notes = [{'feed': 'excepción', 'error': str(exc)[:300]}]
    if not pages:
        best = browser_page(c['url'], record['attempts'])
        if best and best['usable']:
            pages.append(best)
            if len(best['text']) < 1200:
                pages.extend(internal_pages(best, record['attempts']))
        elif best:
            pages.append(best)  # se conserva para evidencia aunque no sea usable
    if notes:
        record['feeds'] = notes

    if pages:
        main = pages[0]
        for index, page in enumerate(pages):
            record['pages'].append(store(key_id, page, '' if index == 0 else f'-{index}'))
        usable = main['usable']
        record.update(outcome=('readable' if 200 <= main['status'] < 300 else 'http_error') if usable else
                      ('challenge' if main['blocked'] else 'empty_content'),
                      httpStatus=main['status'], finalUrl=main['url'], title=main['title'],
                      browserAttempted=any('finalUrl' in a for a in record['attempts']))
        if usable and PARKING_TEXT.search(main['title'] + ' ' + main['text'][:3000]):
            record['outcome'] = 'inactive_domain'
            record['staticDetail'] = 'La página abierta es un anuncio de dominio en venta o aparcado.'
    else:
        challenge = any(CHALLENGE_TEXT.search(str(a.get('title', ''))) for a in record['attempts'])
        record.update(outcome='challenge' if challenge else 'navigation_failed',
                      browserAttempted=bool(record['attempts']))
    record['finishedAt'] = now()
    atomic(OUT / 'visitas' / f'{key_id}.json', record)
    return {'key': key_id, 'name': c['name'], 'outcome': record['outcome'], 'pages': len(record['pages'])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workers', type=int, default=5)
    parser.add_argument('--ids', help='Lista de artistId separada por comas')
    parser.add_argument('--skip-file', help='JSON con {artistId: motivo} que no se visitan')
    parser.add_argument('--force', action='store_true', help='Repite aunque exista la visita')
    parser.add_argument('--candidates', help='JSON con [{artistId,name,url}] (por defecto, los 221 pendientes)')
    args = parser.parse_args()
    for folder in ('visitas', 'capturas'):
        (OUT / folder).mkdir(parents=True, exist_ok=True)
    pending = json.loads(Path(args.candidates).read_text()) if args.candidates else json.loads((ORIGEN / 'pendientes.json').read_text())
    skip = json.loads(Path(args.skip_file).read_text()) if args.skip_file else {}
    if args.ids:
        wanted = {int(x) for x in args.ids.split(',')}
        pending = [c for c in pending if c['artistId'] in wanted]
    queue = []
    for c in pending:
        if str(c['artistId']) in skip:
            continue
        path = OUT / 'visitas' / f'{key(c)}.json'
        if path.exists() and not args.force:
            continue
        queue.append(c)
    print(json.dumps({'total': len(pending), 'queued': len(queue), 'skipped': len(skip)}), flush=True)
    done = 0
    if queue:
        with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers,
                mp_context=multiprocessing.get_context('spawn'), initializer=init_worker) as pool:
            futures = {pool.submit(process, c): c for c in queue}
            for future in concurrent.futures.as_completed(futures):
                c = futures[future]
                try:
                    result = future.result()
                except Exception as exc:  # noqa: BLE001
                    result = {'key': key(c), 'name': c['name'], 'outcome': 'worker_error', 'error': str(exc)[:500]}
                    atomic(OUT / 'visitas' / f'{key(c)}.json', {'artistId': c['artistId'], 'name': c['name'],
                            'requestedUrl': c['url'], 'captureVersion': 3, 'outcome': 'worker_error',
                            'error': str(exc)[:800], 'finishedAt': now()})
                done += 1
                atomic(OUT / 'progreso.json', {'total': len(queue), 'done': done, 'updatedAt': now(), 'last': result})
                if done % 5 == 0 or done == len(queue):
                    print(json.dumps({'done': done, 'total': len(queue), **result}, ensure_ascii=False), flush=True)
    print(json.dumps({'finished': True, 'done': done}), flush=True)


if __name__ == '__main__':
    main()
