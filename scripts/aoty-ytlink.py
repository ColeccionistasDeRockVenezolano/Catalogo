#!/usr/bin/env python3
"""Enlaza los audiovisuales de AOTY con media.youtube_videos para que sean reproducibles."""
import json
import re
import subprocess
import sys
from pathlib import Path

AOTY = Path("/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/aoty-2026-10-19")
APPLY = "--confirm" in sys.argv


def psql(sql):
    r = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv",
                        "-X", "-A", "-t", "-c", sql], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[:300])
    return [l for l in r.stdout.splitlines() if l.strip()]


videos = [json.loads(l) for l in (AOTY / "videos.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
pend = []
for v in videos:
    yt = v.get("youtube") or ""
    m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", yt)
    if not m:
        continue
    mid = re.search(r"/album/(\d+)-", v["url"])
    if not mid:
        continue
    pend.append({"ytid": m.group(1), "source_key": "aoty:" + mid.group(1),
                 "title": (v.get("title") or "").strip()})

print(f"videos con YouTube: {len(pend)}")
sin_av = []
for p in pend:
    if not psql(f"select id from media.artist_audiovisuals where source_key='{p['source_key']}' and video_id is null"):
        continue
    sin_av.append(p)
print(f"audiovisuales AOTY sin enlace reproducible: {len(sin_av)}")
if not APPLY:
    print("dry-run: nada escrito (usar --confirm)")
    sys.exit(0)

linked = 0
for p in sin_av:
    t = p["title"].replace("'", "''")
    ytid = p["ytid"]
    vid = psql("insert into media.youtube_videos(video_id,url,title,thumbnail_url,publication_status,metadata) values "
               f"('{ytid}','https://www.youtube.com/watch?v={ytid}','{t}',"
               f"'https://i.ytimg.com/vi/{ytid}/hqdefault.jpg','unknown','{{\"source\":\"albumoftheyear\"}}'::jsonb) "
               "on conflict (video_id) do update set title=coalesce(media.youtube_videos.title,excluded.title) returning id")
    if not vid:
        vid = psql(f"select id from media.youtube_videos where video_id='{ytid}'")
    if not vid:
        print(f"  ! sin fila de video para {ytid}")
        continue
    psql(f"update media.artist_audiovisuals set video_id={vid[0]}, updated_at=now() "
         f"where source_key='{p['source_key']}' and video_id is null")
    linked += 1

print(f"enlazados: {linked}")
print("verificación (AOTY con video_id):", psql(
    "select count(*) from media.artist_audiovisuals where source_key like 'aoty:%' and video_id is not null"))
