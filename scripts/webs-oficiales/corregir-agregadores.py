#!/usr/bin/env python3
"""Corrige webs publicadas que en realidad son agregadores de descarga.

Un agregador (SkySound7, Muzce, OuvirMusica, SonicHits) genera una ficha por
artista con sus pistas y un reproductor, pero no es una publicación del artista
ni su web. La revisión anterior las aceptó como «artist_site»; aquí se lee la
página, se conserva la captura y se registra la corrección como evidencia con
estado «unrelated» y revisión manual, de modo que no se vuelvan a publicar.

Uso: python3 scripts/webs-oficiales/corregir-agregadores.py [--apply]
Sin --apply solo escribe la corrección y el plan de retiro.
"""
import argparse, hashlib, json, re, subprocess, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'reports/webs-oficiales-2026-10-18'
OUT = BASE / 'revision-990/reintento/correcciones'
AGREGADORES = re.compile(
    r'skysound7\.com|muzce\.com|ouvirmusica|sonichits|palcomp3|letras\.mus\.br|'
    r'baixarmusicas|suamusica|mp3download|songslover', re.I)
SENALES = re.compile(
    r'скачать mp3|download mp3|baixar m[úu]sica|ouvir m[úu]sica|letras? de canciones|'
    r'song lyrics|free mp3|música gr[áa]tis para descargar|artista invitado al azar', re.I)


def now():
    return datetime.now(timezone.utc).isoformat()


def texto(raw):
    raw = re.sub(r'(?is)<(script|style|noscript|svg|head)\b.*?</\1>', ' ', raw)
    raw = re.sub(r'(?s)<[^>]+>', ' ', raw)
    return re.sub(r'\s+', ' ', raw).strip()


def titulo(raw):
    found = re.search(r'(?is)<title[^>]*>(.*?)</title>', raw)
    return re.sub(r'\s+', ' ', found.group(1)).strip() if found else ''


def webs_publicadas():
    query = ("select artist_id||E'\\t'||url||E'\\t'||coalesce(a.name,'') from public.social_links l "
             "join public.artists a on a.id=l.artist_id where l.platform='website' order by 1")
    out = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tAc', query],
                         capture_output=True, text=True, check=True).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split('\t')
        if len(parts) == 3 and AGREGADORES.search(parts[1]):
            rows.append({'artistId': int(parts[0]), 'url': parts[1], 'name': parts[2]})
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Retira los enlaces además de documentar')
    args = parser.parse_args()
    (OUT / 'capturas').mkdir(parents=True, exist_ok=True)
    webs = webs_publicadas()
    correcciones = []
    for w in webs:
        key = f"{w['artistId']}-{hashlib.sha256(w['url'].encode()).hexdigest()[:18]}"
        try:
            request = urllib.request.Request(w['url'], headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)'} )
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read(3_000_000).decode('utf-8', 'replace')
                status = response.status
        except Exception as exc:  # noqa: BLE001
            raw, status = '', 0
            print(json.dumps({'artistId': w['artistId'], 'error': str(exc)[:200]}, ensure_ascii=False))
        head = titulo(raw)
        body = texto(raw)
        senal = SENALES.search(head + ' ' + body[:6000])
        html = (f'<html><head><title>{w["name"]} — {w["url"]}</title></head><body><h1>{head}</h1>'
                f'<p>{body[:120000]}</p></body></html>').encode()
        dest = OUT / 'capturas' / f'{key}.html'
        dest.write_bytes(html)
        quote = head[:300] if head else body[:300]
        record = {
            'artistId': w['artistId'], 'name': w['name'], 'url': w['url'],
            'status': 'unrelated', 'siteType': 'third_party', 'manualReview': True,
            'reason': (f'«{w["url"]}» es una ficha generada por un agregador de descargas '
                       f'({senal.group(0) if senal else "sin señal textual"}), no una web del artista. '
                       'La revisión anterior la aceptó por contener su nombre y su repertorio; '
                       'se corrige con la página leída y se bloquea su publicación.'),
            'evidence': [{'quote': quote, 'basis': 'different_identity',
                          'catalogValue': f'{w["name"]} — sin dominio propio verificado'}],
            'pages': [{'url': w['url'], 'status': status, 'capture': str(dest.relative_to(ROOT)),
                       'sha256': hashlib.sha256(html).hexdigest(), 'complete': True,
                       'method': 'http_correccion', 'capturedAt': now(), 'content': f'URL: {w["url"]}\n{head}\n{body[:60000]}'}],
            'fuente': 'detección de agregadores sobre public.social_links',
            'checkedAt': now(), 'reviewVersion': 4,
        }
        path = OUT / f'{key}.json'
        path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
        correcciones.append({'artistId': w['artistId'], 'name': w['name'], 'url': w['url'],
                             'senal': senal.group(0) if senal else None,
                             'evidenceRecord': str(path.relative_to(ROOT))})
        print(json.dumps(correcciones[-1], ensure_ascii=False))
    (OUT / 'resumen.json').write_text(json.dumps({'generatedAt': now(), 'total': len(correcciones),
                                                  'correcciones': correcciones}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'dryRun': not args.apply, 'documentadas': len(correcciones)}))


if __name__ == '__main__':
    main()
