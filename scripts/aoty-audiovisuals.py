#!/usr/bin/env python3
"""Alta de videoclips de AOTY en media.artist_audiovisuals (solo los que faltan)."""
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

AOTY = Path("/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/aoty-2026-10-19")
CRUCE = json.loads(Path("/tmp/aoty/cruce-catalogo.json").read_text())
APPLY = "--confirm" in sys.argv


def key(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())


def psql(sql):
    r = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv",
                        "-X", "-A", "-t", "-c", sql], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[:300])
    return [l for l in r.stdout.splitlines() if l.strip()]


videos = [json.loads(l) for l in (AOTY / "videos.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
matched = {norm(k): v for k, v in CRUCE["matched"].items()}

existentes = set()
for r in psql("select artist_id||'|'||title_key from media.artist_audiovisuals"):
    existentes.add(r)

plan = []
for v in videos:
    aid = matched.get(norm(v.get("artist")))
    if not aid:
        continue
    tk = key(v.get("title"))
    if not tk or f"{aid}|{tk}" in existentes:
        continue
    year = None
    m = re.search(r"(19|20)\d\d", v.get("release_date") or "")
    if m:
        year = int(m.group(0))
    m_id = re.search(r"/album/(\d+)-", v["url"])
    if not m_id:
        continue
    plan.append({"artist_id": aid, "title": (v.get("title") or "").strip(), "title_key": tk,
                 "year": year, "source_key": "aoty:" + m_id.group(1),
                 "youtube": v.get("youtube"), "url": v["url"]})

print(f"videos AOTY: {len(videos)} | con ficha CRV: {sum(1 for v in videos if matched.get(norm(v.get('artist'))))} "
      f"| a insertar: {len(plan)}")
for p in plan[:8]:
    print(f"  {p['artist_id']:>6} {p['title'][:40]:40} {p['year']} {p['source_key']}")
if not APPLY:
    print("dry-run: nada insertado (usar --confirm)")
    sys.exit(0)

ins = []
for p in plan:
    meta = json.dumps({"aoty_url": p["url"], "youtube": p["youtube"], "source": "albumoftheyear"}, ensure_ascii=False)
    t = p["title"].replace("'", "''")
    m = meta.replace("'", "''")
    sql = ("insert into media.artist_audiovisuals(artist_id,source_key,title,title_key,release_year,kind,"
           "source_type,allows_music_release,metadata) values "
           f"({p['artist_id']},'{p['source_key']}','{t}','{p['title_key']}',"
           f"{p['year'] if p['year'] else 'null'},'music_video','Music Video',false,'{m}'::jsonb) "
           "on conflict (artist_id,source_key) do nothing returning id")
    out = psql(sql)
    if out:
        ins.append(int(out[0]))

print(f"insertados: {len(ins)}")
Path("/home/brian/apps/Coleccionistas De Rock Venezolano/reports/aoty-2026-10-19/audiovisuales-reversion.json").write_text(
    json.dumps({"ids": ins, "source_key_prefix": "aoty:"}, indent=1), encoding="utf-8")
print("reversión: reports/aoty-2026-10-19/audiovisuales-reversion.json")
print("verificación:", psql("select count(*) from media.artist_audiovisuals where source_key like 'aoty:%'"))
