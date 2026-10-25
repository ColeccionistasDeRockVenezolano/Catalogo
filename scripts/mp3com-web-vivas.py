#!/usr/bin/env python3
"""Comprueba si las webs que los artistas declararon en MP3.com (2003) siguen en línea.

Entrada : data/raw/mp3com-2003/links-venezolanos.jsonl
Salida  : /tmp/mp3com-web-vivas.json  {"http://...": true|false}
Sólo se sigue el redirect final; 2xx/3xx = viva. Timeout corto: es una cortesía.
"""
import json, os, ssl, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

RAW = '/mnt/1tb/Shared/coleccionistas-rock-venezolano/data/raw/mp3com-2003'
OUT = '/tmp/mp3com-web-vivas.json'
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
UA = 'Mozilla/5.0 (compatible; CRV-archivo/1.0)'


def viva(url):
    for method in ('HEAD', 'GET'):
        try:
            req = urllib.request.Request(url, method=method, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=12, context=CTX) as r:
                return 200 <= r.status < 400
        except urllib.error.HTTPError as e:
            if 200 <= e.code < 400:
                return True
        except Exception:
            continue
    return False


def main():
    urls = []
    for line in open(os.path.join(RAW, 'links-venezolanos.jsonl'), encoding='utf-8'):
        w = json.loads(line).get('website')
        if w and w not in urls:
            urls.append(w)
    print('webs a comprobar:', len(urls), flush=True)
    res = {}
    with ThreadPoolExecutor(max_workers=16) as ex:
        for u, ok in zip(urls, ex.map(viva, urls)):
            res[u] = ok
    json.dump(res, open(OUT, 'w'), indent=0)
    print(json.dumps({'vivas': sum(res.values()), 'muertas': len(res) - sum(res.values())}))


if __name__ == '__main__':
    main()
