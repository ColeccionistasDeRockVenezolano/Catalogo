#!/usr/bin/env python3
"""Audita la absorción de los blogs contra el plan: qué entró, qué falta y qué no cuadra.

Carga el catálogo en tres consultas y compara en memoria (sin una consulta por
acción). No escribe en la base.

Uso: python3 scripts/absorcion-blogs-audit.py
"""
import collections
import json
import os
import re
import subprocess
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = os.path.join(ROOT, "reports/2026-10-26-absorcion-plan.jsonl")
PSQL = ["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-t", "-A", "-F", "\x1f", "-c"]


def q(sql):
    r = subprocess.run(PSQL + [sql], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("psql: " + r.stderr[:400])
    return [l.split("\x1f") for l in r.stdout.splitlines() if l.strip()]


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s)).strip()


def main():
    plan = [json.loads(l) for l in open(PLAN, encoding="utf-8")]

    albums = {}
    for aid, art, title, cover, fmt, lab, cat, year, ntr in q(
            "select a.id,a.artist_id,a.title,coalesce(a.cover_url,''),coalesce(a.media_format,''),"
            "coalesce(a.label_id::text,''),coalesce(a.catalog_id,''),coalesce(a.release_year::text,''),"
            "coalesce((select count(*) from tracks t where t.album_id=a.id),0) from albums a"):
        albums[(int(art), norm(title))] = {"id": int(aid), "title": title, "cover": cover, "format": fmt,
                                           "label": lab, "catalog": cat, "year": year, "tracks": int(ntr)}

    titles = collections.defaultdict(dict)
    for aid, num, title in q("select album_id,track_number,title from tracks order by album_id,track_number"):
        titles[int(aid)][int(num)] = title

    credits_person = set()
    credits_artist = set()
    track_pos_of = {}
    for cid, pid, artid, album_id, tnum, tid in q(
            "select c.id,coalesce(c.person_id::text,''),coalesce(c.artist_id::text,''),t.album_id,t.track_number,t.id "
            "from track_credits c join tracks t on t.id=c.track_id"):
        track_pos_of[int(tid)] = (int(album_id), int(tnum))
        if pid:
            credits_person.add((int(album_id), int(tnum), int(pid)))
        if artid:
            credits_artist.add((int(album_id), int(tnum), int(artid)))

    stats = collections.Counter()
    problems = []
    for item in plan:
        if item["kind"] == "album_new":
            alb = albums.get((item["artist_id"], norm(item["fields"]["title"])))
            if not alb:
                stats["album_falta"] += 1
                if len(problems) < 30:
                    problems.append({"tipo": "album_falta", "artist": item["artist"],
                                     "album": item["fields"]["title"], "plan_tracks": len(item["tracks"])})
                continue
            stats["album_presente"] += 1
            esperadas = {t["n"]: t["title"] for t in item["tracks"]}
            reales = titles.get(alb["id"], {})
            faltan = [n for n in esperadas if n not in reales]
            if faltan:
                stats["album_incompleto"] += 1
                problems.append({"tipo": "pistas_faltan", "album_id": alb["id"], "album": alb["title"],
                                 "faltan": faltan[:8], "db": len(reales), "plan": len(esperadas)})
            for n, title in esperadas.items():
                if n in reales and norm(reales[n]) != norm(title):
                    stats["pista_titulo_distinto"] += 1
            if item.get("cover_file") and not alb["cover"]:
                stats["album_sin_portada"] += 1
                problems.append({"tipo": "portada_falta", "album_id": alb["id"], "album": alb["title"]})
            for t in item["tracks"]:
                if t.get("composer_person_id") and (alb["id"], t["n"], t["composer_person_id"]) not in credits_person:
                    stats["compositor_pista_falta"] += 1
        elif item["kind"] == "album_fields":
            key = next((v for v in albums.values() if v["id"] == item["album_id"]), None)
            if not key:
                stats["campo_album_inexistente"] += 1
                continue
            for field, value in item["fields"].items():
                if field == "cover_file":
                    if not key["cover"]:
                        stats["campo_portada_falta"] += 1
                    continue
                actual = {"release_year": key["year"], "label_id": key["label"],
                          "catalog_id": key["catalog"], "media_format": key["format"]}.get(field)
                if str(actual) != str(value):
                    stats[f"campo_{field}_distinto"] += 1
                else:
                    stats[f"campo_{field}_ok"] += 1
        elif item["kind"] == "composer_credit":
            if (item["album_id"], item["track_number"], item["person_id"]) in credits_person:
                stats["compositor_ok"] += 1
            else:
                stats["compositor_falta"] += 1
        elif item["kind"] == "vd_credit":
            pos = track_pos_of.get(item["track_id"])
            ok = pos is not None and (pos[0], pos[1], item["artist_id"]) in credits_artist
            stats["vd_interprete_ok" if ok else "vd_interprete_falta"] += 1
            if item["person_id"]:
                pc = pos is not None and (pos[0], pos[1], item["person_id"]) in credits_person
                stats["vd_compositor_ok" if pc else "vd_compositor_falta"] += 1

    print("== estado del plan")
    for k, v in stats.most_common():
        print(f"  {k:30s} {v}")
    if problems:
        print("\n== incidencias")
        for p in problems:
            print(" ", json.dumps(p, ensure_ascii=False)[:220])

    print("\n== invariantes del catálogo")
    for label, sql in [
        ("álbumes sin pista", "select count(*) from albums a where not exists(select 1 from tracks t where t.album_id=a.id)"),
        ("pistas fuera de rango", "select count(*) from tracks where track_number < 1 or disc_number < 1"),
        ("duplicados artista+título", "select count(*) from (select artist_id,lower(btrim(title)),count(*) c from albums group by 1,2 having count(*)>1) x"),
        ("duplicados album+posición", "select count(*) from (select album_id,disc_number,track_number,count(*) c from tracks group by 1,2,3 having count(*)>1) x"),
        ("créditos huérfanos", "select count(*) from track_credits c where not exists(select 1 from tracks t where t.id=c.track_id)"),
        ("álbumes hoy", "select count(*) from albums where created_at>current_date"),
    ]:
        print(f"  {label:30s} {q(sql)[0][0]}")
    sys.exit(0)


if __name__ == "__main__":
    main()
