#!/usr/bin/env python3
"""Muestra de 50 artistas del bloque C pendientes (sin API): los que el diario aún no tocó.

Bloque C = artista de la cola del 13 oct con discos, SIN perfil Spotify verificado y SIN perfil
verificado de ninguna otra plataforma. Se muestrea aleatorio (semilla fija) entre los pendientes y
se guardan sus discos del catálogo para verificar identidad por repertorio.
"""
import glob
import json
import random
import subprocess
from pathlib import Path

ROOT = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
EMB = ROOT / "reports/streaming-embeds-2026-10-13"
DEST = Path("/tmp/crv-muestreo-c")
DEST.mkdir(exist_ok=True)

cola = [json.loads(l)["id"] for l in (EMB / "entrada/artistas.jsonl").read_text().splitlines() if l.strip()]
hechos = {int(Path(p).stem.split("-")[1]) for p in glob.glob(str(EMB / "spotify/a-*.json"))}

sql = """
select json_agg(x) from (
 select a.id, a.name,
   coalesce((select json_agg(al.alias) from ingest.artist_aliases al where al.artist_id=a.id and al.is_primary is not true),'[]') aliases,
   exists(select 1 from public.streaming_links s where s.artist_id=a.id and s.platform='spotify' and s.verified) sp,
   exists(select 1 from public.streaming_links s where s.artist_id=a.id and s.platform<>'spotify' and s.verified) otra,
   (select json_agg(json_build_object('id',al.id,'title',al.title,'year',al.release_year) order by al.release_year nulls last)
      from public.albums al where al.artist_id=a.id) discos
 from public.artists a where a.id in ({ids})
) x
""".format(ids=",".join(map(str, cola)))
out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tA", "-c", sql],
                     capture_output=True, text=True).stdout
datos = {d["id"]: d for d in json.loads(out)}

c_pend = [i for i in cola if i not in hechos and i in datos and not datos[i]["sp"] and not datos[i]["otra"]]
print(f"cola {len(cola)} · hechos {len(hechos)} · C pendientes {len(c_pend)}")

random.seed(42)
muestra = random.sample(c_pend, min(50, len(c_pend)))
# ordenar por nº de discos desc para que la corrida cubra primero los casos con más material
muestra.sort(key=lambda i: -len(datos[i]["discos"] or []))

json.dump([datos[i] for i in muestra], open(DEST / "muestra.json", "w"), ensure_ascii=False, indent=1)
print(f"muestra: {len(muestra)} artistas · {sum(len(datos[i]['discos'] or []) for i in muestra)} discos")
print("primeros:", ", ".join(f"{datos[i]['name']} ({len(datos[i]['discos'] or [])})" for i in muestra[:8]))
