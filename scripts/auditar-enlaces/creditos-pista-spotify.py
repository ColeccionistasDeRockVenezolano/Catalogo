#!/usr/bin/env python3
"""Vuelve a leer el embed público de Spotify de los enlaces con veredicto disco_ajeno
para guardar los créditos por pista: el crédito del álbum solo nombra al principal,
así que una colaboración real parecería un disco ajeno. Reanudable.
Uso: creditos-pista-spotify.py DIR"""
import json, os, re, sys, time, urllib.request

d = sys.argv[1]
sal = os.path.join(d, "creditos-pista-spotify.jsonl")
hechos = set()
if os.path.exists(sal):
    hechos = {json.loads(l)["id"] for l in open(sal)}
filas = [json.loads(l) for l in open(os.path.join(d, "veredictos.jsonl"))]
filas = [f for f in filas if f["platform"] == "spotify" and f["v"] == "disco_ajeno" and f["id"] not in hechos]
print("por leer", len(filas), flush=True)
with open(sal, "a") as o:
    for f in filas:
        try:
            r = urllib.request.Request(f"https://open.spotify.com/embed/album/{f['external_id']}", headers={"User-Agent": "CRV-auditoria-enlaces/1.0"})
            b = urllib.request.urlopen(r, timeout=25).read().decode()
            m = re.search(r'__NEXT_DATA__"[^>]*>(.*?)</script>', b, re.S)
            e = json.loads(m.group(1))["props"]["pageProps"]["state"]["data"]["entity"]
            cred = sorted({c.strip() for t in (e.get("trackList") or []) for c in (t.get("subtitle") or "").replace("\xa0", " ").split(",") if c.strip()})
            o.write(json.dumps({"id": f["id"], "creditos_pista": cred}, ensure_ascii=False) + "\n")
        except Exception as x:
            o.write(json.dumps({"id": f["id"], "err": str(x)[:100]}, ensure_ascii=False) + "\n")
        o.flush()
        time.sleep(0.5)
print("FIN", flush=True)
