#!/usr/bin/env python3
"""Captura cruda de COMENTARIOS de Last.fm para revisión editorial.

Last.fm usa /music/<nombre> para homónimos distintos. Esta captura no verifica
identidad ni autoriza la carga al catálogo. Se exige una opción explícita para
evitar que la búsqueda por nombre vuelva a ejecutarse por accidente.

Usa el Chrome copiado (chrome-lfm.service, puerto CDP 9333) con las cookies del dueño
(la web de Last.fm bloquea a curl/headless: «Client Challenge»; con su sesión, 200 real).

Por entidad: /music/<slug>/+shoutbox con paginación hasta agotar (tope 40 páginas).
Salidas reanudables (reports/lastfm-shouts-2026-10-16/):
  shouts.jsonl    — 1 línea por entidad con sus shouts (autor, fecha, texto)
  no_encontrados.jsonl — entidades sin shoutbox o sin shoutbox con contenido
  crudo/<kind>-<id>.html — HTML de la última página (re-parseo offline)

Uso: python3 scripts/lastfm-shouts-capture-2026-10-16.py --verified-only
     Solo para auditar capturas antiguas: --capture-unverified-for-review
"""
from __future__ import annotations

raise SystemExit('+shoutbox retirado por Brian (2026-10-16): no realizar nuevas capturas; conservar solo el archivo histórico.')

import json
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
OUT = ROOT / 'reports' / 'lastfm-shouts-2026-10-16'
VERIFIED_ONLY = '--verified-only' in sys.argv
SHOUTS = OUT / ('shouts-verified-source.jsonl' if VERIFIED_ONLY else 'shouts.jsonl')
MISS = OUT / ('no_encontrados-verified-source.jsonl' if VERIFIED_ONLY else 'no_encontrados.jsonl')
CRUDO = OUT / 'crudo'
LOG = OUT / 'captura.log'
CDP = 'http://127.0.0.1:9333'
BASE = 'https://www.last.fm'
MAX_PAG = 40
PAUSA = 1.2

OUT.mkdir(parents=True, exist_ok=True)
CRUDO.mkdir(parents=True, exist_ok=True)


def log(msg: str) -> None:
    with open(LOG, 'a') as f:
        f.write(f'{time.strftime("%H:%M:%S")} {msg}\n')


SEP = chr(31)  # separador de campos para psql -tA -F


def psql(sql: str) -> str:
    o = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-F', SEP, '-c', sql], capture_output=True, text=True)
    if o.returncode:
        raise RuntimeError(f'consulta SQL falló: {o.stderr[-300:]}')
    return o.stdout.strip()


def hechos(path: Path) -> set:
    out = set()
    if path.exists():
        for l in open(path):
            try:
                d = json.loads(l)
                out.add((d['kind'], d['id']))
            except Exception:
                pass
    return out


def slug(s: str) -> str:
    return urllib.parse.quote_plus(s)


def extraer_shouts(page) -> list:
    return page.evaluate('''() => {
        const out = [];
        for (const s of document.querySelectorAll('.shout')) {
            const a = s.querySelector('a[href^="/user/"]');
            const t = s.querySelector('.shout-body, .shout-message, .user-shout-body, p, div');
            out.push({
                author: a ? a.textContent.trim() : null,
                when: (s.querySelector('.shout-timestamp, time, .date, abbr') || {}).textContent || null,
                text: (t ? t.textContent : s.textContent).trim().slice(0, 2000),
                html_len: s.innerHTML.length,
            });
        }
        return out;
    }''')


def capturar_entidad(page, kind: str, eid: int, nombre: str, url_extra: str = '', verified_url: str = '') -> None:
    base = verified_url.rstrip('/') if verified_url else f'{BASE}/music/{slug(nombre)}' + url_extra
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme != 'https' or parsed.hostname not in ('last.fm', 'www.last.fm') or not parsed.path.startswith('/music/'):
        raise ValueError(f'URL de Last.fm inválida para {eid}')
    u = f'{base}/+shoutbox'
    todos = []
    npags = 0
    for p in range(1, MAX_PAG + 1):
        url = u if p == 1 else f'{u}?page={p}'
        r = page.goto(url, wait_until='domcontentloaded', timeout=90000)
        time.sleep(PAUSA)
        html = page.content()
        if p == 1:
            (CRUDO / f'{"verified-" if VERIFIED_ONLY else ""}{kind}-{eid}.html').write_text(html)
        if 'Client Challenge' in html:
            raise RuntimeError('Client Challenge (sesión caída): abortar para no quemar la sesión')
        if r and r.status == 404:
            break
        page_shouts = extraer_shouts(page)
        if not page_shouts:
            break
        todos.extend(page_shouts)
        npags = p
        hay_mas = page.evaluate('''() => [...document.querySelectorAll('a')].some(a => (a.getAttribute('href')||'').includes('page=' + (Number(new URLSearchParams(location.search).get('page')||1) + 1)))''')
        if not hay_mas:
            break
    reg = {'kind': kind, 'id': eid, 'name': nombre, 'url': u, 'paginas': npags, 'n': len(todos), 'shouts': todos}
    with open(SHOUTS, 'a') as fh:
        fh.write(json.dumps(reg, ensure_ascii=False) + '\n')
    if not todos:
        with open(MISS, 'a') as fh:
            fh.write(json.dumps({'kind': kind, 'id': eid, 'name': nombre, 'url': u}, ensure_ascii=False) + '\n')


def fase(kind: str) -> None:
    if VERIFIED_ONLY:
        if kind != 'artistas':
            raise SystemExit('La captura verificada solo admite artistas; los discos necesitan su propia identidad')
        filas = [l.split(SEP) for l in psql("SELECT a.id,a.name,v.lastfm_url FROM ingest.lastfm_artist_verifications v JOIN public.artists a ON a.id=v.artist_id ORDER BY a.id").split('\n') if l.strip()]
        url_extra = ''
    elif kind == 'artistas':
        filas = [l.split(SEP) for l in psql("SELECT id, name FROM public.artists ORDER BY id").split('\n') if l.strip()]
        url_extra = ''
    else:
        filas = [l.split(SEP) for l in psql(
            "SELECT al.id, ar.name, al.title FROM public.albums al JOIN public.artists ar ON ar.id = al.artist_id ORDER BY al.id").split('\n') if l.strip()]
        url_extra = None  # se arma por fila
    hechos_set = hechos(SHOUTS) | hechos(MISS)
    pend = [f for f in filas if (kind, int(f[0])) not in hechos_set]
    log(f'{kind.upper()}: {len(filas)} total, {len(hechos_set)} hechos, {len(pend)} pendientes')
    if VERIFIED_ONLY and not pend:
        log('Sin URLs verificadas pendientes; no se abre Chrome')
        return
    p = sync_playwright().start()
    b = p.chromium.connect_over_cdp(CDP)
    ctx = b.contexts[0] if b.contexts else b.new_context()
    page = ctx.new_page()
    t0 = time.time()
    n = 0
    fallos_seguidos = 0
    try:
        for f in pend:
            eid = int(f[0])
            try:
                if kind == 'artistas':
                    capturar_entidad(page, kind, eid, f[1], verified_url=f[2] if VERIFIED_ONLY else '')
                else:
                    capturar_entidad(page, kind, eid, f[1], '/' + urllib.parse.quote(f[2].replace('/', '-')))
                fallos_seguidos = 0
            except Exception as e:
                fallos_seguidos += 1
                log(f'{kind} {eid} ({f[1]}): EXC {e}')
                if 'Page crashed' in str(e):
                    try:
                        page.close()
                    except Exception:
                        pass
                    page = ctx.new_page()
                    fallos_seguidos = 0
                if fallos_seguidos >= 6:
                    log('6 fallos seguidos: abortar (¿Chrome copiado caído? relanzar chrome-lfm)')
                    break
            n += 1
            if n % 50 == 0:
                try:
                    page.close()
                except Exception:
                    pass
                page = ctx.new_page()
            if n % 25 == 0:
                el = time.time() - t0
                log(f'{kind.upper()} {len(hechos_set)+n}/{len(filas)} · {el/60:.1f} min · ETA {el/n*(len(pend)-n)/60:.1f} min')
            time.sleep(PAUSA)
    finally:
        page.close()
        b.close()
        p.stop()
    log(f'{kind.upper()} FIN: {n} en {(time.time()-t0)/60:.1f} min')


if __name__ == '__main__':
    if VERIFIED_ONLY == ('--capture-unverified-for-review' in sys.argv):
        raise SystemExit('Elegir --verified-only o --capture-unverified-for-review. La búsqueda por nombre solo produce captura cruda sin publicar.')
    which = 'artistas'
    for a in sys.argv[1:]:
        if a.startswith('--fase='):
            which = a.split('=', 1)[1]
    log(f'INICIO {which}')
    fase(which)
    log(f'FIN {which}')
