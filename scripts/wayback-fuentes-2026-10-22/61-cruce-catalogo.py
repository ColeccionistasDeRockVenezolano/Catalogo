#!/usr/bin/env python3
"""Segunda pasada: números limpios por fuente, sin filas basura."""
import difflib
import json
import re
import subprocess
import unicodedata
from pathlib import Path
from urllib.parse import urlsplit

REPO = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
ENT = Path("/mnt/1tb/Shared/coleccionistas-rock-venezolano/reports/wayback-fuentes-2026-10-22/entidades")


def consulta(sql):
    t = (REPO / ".env").read_text(errors="replace")
    p = urlsplit(re.search(r"^DATABASE_URL=(.+)$", t, re.M).group(1).strip().strip('"'))
    r = subprocess.run(["docker", "exec", "-i", "crv-postgres", "psql", "-U", p.username,
                        "-d", p.path.lstrip("/"), "-t", "-A", "-F", "\t", "-c", sql],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(r.stderr[:300])
    return [l.split("\t") for l in r.stdout.splitlines() if l.strip()]


def norm(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\((?:[^)]*)\)", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def basura(n):
    return (len(n) < 3 or ":::" in n or "musica com ve" in n or n.lower().startswith(("-", "home")))


artistas = {norm(n): n for _, n in consulta("select id, name from artists")}
albumes = consulta("select ar.name, a.title, coalesce(a.release_year::text,'') "
                   "from albums a join artists ar on ar.id=a.artist_id")
por_titulo: dict[str, list[tuple[str, str]]] = {}
for ar, ti, an in albumes:
    por_titulo.setdefault(norm(ti), []).append((ar, an))

b = [json.loads(l) for l in open(ENT / "bandas.jsonl", encoding="utf-8")]
limpio = {}
for x in b:
    k = norm(x["nombre"])
    if not basura(k):
        limpio.setdefault(k, x)

exact = [k for k in limpio if k in artistas]
fuzzy = {k: difflib.get_close_matches(k, list(artistas), n=1, cutoff=0.88) for k in limpio if k not in artistas}
fuzzy_ok = {k: v[0] for k, v in fuzzy.items() if v}
nuevas = [limpio[k]["nombre"] for k in limpio if k not in artistas and not fuzzy_ok.get(k)]
print(f"BANDAS · filas {len(b)} · únicas limpias {len(limpio)}")
print(f"  ya en catálogo (exacto) {len(exact)} · mismo nombre con otra grafía {len(fuzzy_ok)} · nuevas {len(nuevas)}")
print("  nuevas (muestra):", nuevas[:10])

o = [json.loads(l) for l in open(ENT / "obras.jsonl", encoding="utf-8")]
for fuente in ("lagaleriadelrock", "caracaspunk"):
    sub = {}
    for x in o:
        if x["fuente"] != fuente or x.get("tipo") == "banda" or not x["obra"]:
            continue
        sub.setdefault((norm(x["banda"]), norm(x["obra"])), x)
    con_anio = sum(1 for x in sub.values() if x["anio"])
    match = sum(1 for (nb, nt), x in sub.items()
                if any(x["anio"] and x["anio"] == an for _, an in por_titulo.get(nt, [])))
    titulo_otro = sum(1 for (nb, nt), x in sub.items() if por_titulo.get(nt) and not match)
    print(f"OBRAS {fuente} · únicas {len(sub)} · con año {con_anio} · "
          f"ya en catálogo (título+año) {match} · título existe otro año {titulo_otro} · "
          f"nuevas {len(sub) - match - titulo_otro}")

bandas_cp = {x["banda"] for x in o if x["fuente"] == "caracaspunk" and x.get("tipo") == "banda"}
print(f"caracaspunk · índice de bandas (mp3.asp): {len(bandas_cp)} · muestra: {sorted(bandas_cp)[:12]}")
