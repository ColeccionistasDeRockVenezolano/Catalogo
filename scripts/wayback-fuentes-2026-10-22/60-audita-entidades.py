#!/usr/bin/env python3
"""Auditoría de calidad de las entidades extraídas de Wayback (sin tocar la base)."""
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ENT = Path("/mnt/1tb/Shared/coleccionistas-rock-venezolano/reports/wayback-fuentes-2026-10-22/entidades")


def carga(n):
    p = ENT / n
    return [json.loads(l) for l in open(p, encoding="utf-8")] if p.exists() else []


def norm(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def mojibake(s):
    return any(m in (s or "") for m in ("Ã", "Â", "â€"))


b = carga("bandas.jsonl")
print(f"== BANDAS: {len(b)}")
print("  bio>200:", sum(1 for x in b if len(x["biografia"]) > 200),
      "| bio 1-200:", sum(1 for x in b if 0 < len(x["biografia"]) <= 200),
      "| sin bio:", sum(1 for x in b if not x["biografia"]))
print("  integrantes:", sum(1 for x in b if x["integrantes"]),
      "| web:", sum(1 for x in b if x["web"]),
      "| telefono:", sum(1 for x in b if x.get("telefono")),
      "| ciudad:", sum(1 for x in b if x.get("ciudad")))
print("  mojibake:", sum(1 for x in b if mojibake(x["biografia"]) or mojibake(x["nombre"])))
sosp = [x["nombre"] for x in b if len(x["nombre"]) < 3 or "::" in x["nombre"]
        or x["nombre"].lower().startswith(("-", "home", "index")) or "bandas" in x["nombre"].lower()]
print("  nombres sospechosos:", len(sosp), sosp[:6])
nombres = Counter(norm(x["nombre"]) for x in b)
dups = {k: v for k, v in nombres.items() if v > 1 and k}
print("  nombres duplicados:", len(dups), list(dups.items())[:5])
ricos = sum(1 for x in b if sum(bool(x.get(c)) for c in
           ("biografia", "integrantes", "web", "telefono", "links", "miscelanea", "fotos")) >= 4)
print("  fichas con >=4 campos:", ricos)
print("  muestra:", [x["nombre"][:28] for x in b[100:105]])

o = carga("obras.jsonl")
print(f"\n== OBRAS: {len(o)}")
triples = Counter((norm(x["banda"]), norm(x["obra"]), x["anio"]) for x in o)
print("  únicas (banda,obra,año):", len(triples), "| duplicadas:", sum(v - 1 for v in triples.values() if v > 1))
print("  por fuente:", dict(Counter(x["fuente"] for x in o)))
anios = Counter(x["anio"] for x in o if x["anio"])
fuera = [a for a in anios if not a.isdigit() or not (1950 <= int(a) <= 2026)]
print("  años fuera de rango:", fuera[:6], "| sin año:", sum(1 for x in o if not x["anio"]))
print("  rango:", min(anios), "-", max(anios), "| años distintos:", len(anios))
malos = [x["obra"] for x in o if re.search(r"(?i)men[úu]|nosotros|videos|dise[ñn]|sube tu|\|", x["obra"])]
print("  títulos contaminados:", len(malos), malos[:5])
print("  tipo:", dict(Counter(x.get("tipo", "") for x in o)))

t = carga("tracklists.jsonl")
print(f"\n== TRACKLISTS: {len(t)}")
print("  fechas:", len({x["fecha_programa"] for x in t}), "| artistas:", len({norm(x['artista']) for x in t}),
      "| sellos:", len({x['sello'] for x in t if x['sello']}))
exact = Counter((x["fecha_programa"], norm(x["artista"]), norm(x["tema"])) for x in t)
print("  duplicados exactos:", sum(v - 1 for v in exact.values() if v > 1))
print("  muestra fechas:", sorted({x["fecha_programa"] for x in t})[:5])

print("\n== PERFILES:", len(carga("perfiles.jsonl")), "| == TOQUES:", len(carga("eventos.jsonl")))
