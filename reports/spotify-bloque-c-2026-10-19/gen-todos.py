#!/usr/bin/env python3
"""Vuelca TODOS los pendientes del bloque C (322) con sus discos, para reintentarlos con sesión."""
import glob
import json
import subprocess
from pathlib import Path

ROOT = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
EMB = ROOT / "reports/streaming-embeds-2026-10-13"

cola = [json.loads(l)["id"] for l in (EMB / "entrada/artistas.jsonl").read_text().splitlines() if l.strip()]
hechos = {int(Path(p).stem.split("-")[1]) for p in glob.glob(str(EMB / "spotify/a-*.json"))}
ya = {json.loads(l)["artistId"] for l in open("/tmp/crv-muestreo-c/resultados-sesion.jsonl") if l.strip()}
pend = [i for i in cola if i not in hechos and i not in ya]

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
""".format(ids=",".join(map(str, pend)))
out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tA", "-c", sql],
                     capture_output=True, text=True).stdout
datos = [d for d in json.loads(out) if not d["sp"] and not d["otra"]]
json.dump(datos, open("/tmp/crv-muestreo-c/muestra-todos.json", "w"), ensure_ascii=False, indent=1)
print(f"pendientes C: {len(datos)} artistas · {sum(len(d['discos'] or []) for d in datos)} discos")
