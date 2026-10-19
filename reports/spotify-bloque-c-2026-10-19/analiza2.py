#!/usr/bin/env python3
"""Análisis final del muestreo C: perfil localizado + confirmación por repertorio (disco o pista)."""
import json
import re
import subprocess
import unicodedata
from collections import Counter, defaultdict

filas = [json.loads(l) for l in open("/tmp/crv-muestreo-c/resultados.jsonl") if l.strip()]
ids = [d["artistId"] for d in filas]


def norm(t):
    s = unicodedata.normalize("NFD", t or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


sql = ("select a.artist_id, coalesce(json_agg(t.title),'[]') from public.tracks t "
       "join public.albums a on a.id=t.album_id where a.artist_id in (" + ",".join(map(str, ids)) + ") group by 1")
out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tA", "-F", "|", "-c", sql],
                     capture_output=True, text=True).stdout
pistas = {}
for l in out.splitlines():
    if l.strip():
        aid, js = l.split("|", 1)
        pistas[int(aid)] = {norm(x) for x in json.loads(js) if x}

grupos = Counter()
por_grupo = defaultdict(lambda: Counter())
detalle = []
for d in filas:
    cands = d.get("candidatos") or []
    if d.get("hallado") is True:
        g = "confirmado (disco)"
    elif not cands:
        g = "sin perfil"
    elif len(cands) == 1:
        g = "perfil único"
    else:
        g = "homónimos"
    vis = [x["t"] for x in d.get("visibles") or []]
    disco_ok = bool(d.get("n_comunes"))
    pista_ok = bool(pistas.get(d["artistId"]) and {norm(x) for x in d.get("pistas_visibles") or []} & pistas[d["artistId"]])
    conf = disco_ok or pista_ok
    grupos[g] += 1
    por_grupo[g]["total"] += 1
    if conf:
        por_grupo[g]["confirmado"] += 1
    detalle.append((d["name"], g, len(cands), d.get("repertorio_visible"), disco_ok, pista_ok, vis[:4]))

print("grupo                        n   confirmados  %")
for g in ("perfil único", "homónimos", "sin perfil", "confirmado (disco)"):
    if g in grupos:
        n = grupos[g]
        c = por_grupo[g].get("confirmado", 0) + (n if g == "confirmado (disco)" else 0)
        print(f"{g:28} {n:3}   {c:3}        {(c*100//n):2}%")

tot = len(filas)
con_perfil = tot - grupos["sin perfil"]
conf_tot = sum(1 for x in detalle if x[4] or x[5]) + grupos["confirmado (disco)"]
print(f"\ntotal: {tot} · con perfil localizado {con_perfil} ({con_perfil*100//tot}%) · confirmados por repertorio {conf_tot} ({conf_tot*100//tot}%)")

print("\ndetalle (nombre | grupo | homónimos | álbumes vis | disco | pista):")
for x in sorted(detalle, key=lambda y: (y[1], y[0])):
    print(f"  {x[0][:34]:34} {x[1]:12} {x[2]:2} {str(x[3]):>3}  {'D' if x[4] else '-'}{'P' if x[5] else '-'}  {x[6]}")
