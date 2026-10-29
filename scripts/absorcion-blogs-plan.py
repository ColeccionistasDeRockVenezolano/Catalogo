#!/usr/bin/env python3
"""Genera el plan de absorción de los blogs (antologiavenezuela + venezuelademo).

Salida: reports/2026-10-26-absorcion-plan.jsonl, una línea por acción tipada.
El plan es determinista y no escribe nada en la base: lo aplica
`scripts/absorber-blogs-2026-10-26.ts` con las garantías del operador
(withOperatorRun + claims + merge + journal).

Reglas de seguridad que aplica este planificador:
  * Nunca sobrescribe: sólo rellena columnas vacías.
  * Nunca crea un disco que ya exista por título/repertorio (filtro de duplicados).
  * Nunca crea pistas en discos que ya tienen pistas (evita renumerar).
  * Créditos de compositor sólo para personas que YA existen en `persons`.
  * Artistas nuevos NO se crean aquí: van a un fichero de revisión aparte.
  * Portadas: sólo el primer archivo de cada post, y sólo si el fichero existe.
"""
import collections
import csv
import difflib
import importlib.util
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAP = os.path.join(ROOT, "data/raw/antologiavenezuela-blogspot")
OUT = os.path.join(ROOT, "reports/2026-10-26-absorcion-plan.jsonl")
REVIEW_ARTISTS = os.path.join(ROOT, "reports/2026-10-26-absorcion-artistas-revision.csv")
REVIEW_PARTIAL = os.path.join(ROOT, "reports/2026-10-26-absorcion-tracklist-parcial.csv")
VD_CSV = os.path.join(ROOT, "reports/2026-10-26-venezuelademo-mapeo-pistas.csv")
PSQL = ["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-t", "-A", "-F", "\x1f", "-c"]

spec = importlib.util.spec_from_file_location("cruce", os.path.join(ROOT, "scripts/antologia-blogspot-cruce.py"))
assert spec and spec.loader
cruce = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cruce)  # parse_title / parse_tracks / keys / norm

JUNK_COMPOSER = {"d r", "d en d", "anonimo", "folklore", "folclore", "popular", "tradicional", "d d",
                 "desconocido", "autor desconocido", "recopilacion", "recopilacion de", ""}

# Discos que el planificador no empareja por título pero que YA están fichados con
# otro título; verificado a mano contra la base (2026-10-26). Sin esta lista se
# reintentan en cada pasada y el ER los rechaza igual: dejarlos fuera mantiene el
# plan en cero y documenta la decisión.
DUPLICADOS_VERIFICADOS = {
    # (artist_id, título del blog): álbum existente con otro título
    (4287, "el disco de oro"): "El disco de oro de Ángel C. Loyola (álbum 14680, 16 pistas)",
    (1910, "vol ii"): "Los Darts Vol. II (álbum 4866, 12 pistas)",
}


def q(sql):
    r = subprocess.run(PSQL + [sql], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("psql: " + r.stderr[:400])
    return [l.split("\x1f") for l in r.stdout.splitlines() if l.strip()]


def catalog_code(raw, album_title):
    """Código de catálogo: token con pinta de serial al final del título."""
    if not raw:
        return None
    tail = raw.strip(" -,.")
    # quita el año suelto o paréntesis de remaster
    tail = re.sub(r"\((?:19|20)\d{2}\)", " ", tail)
    cands = re.findall(r"[A-Z]{1,5}[ .\-]{0,3}\d[\w.\-/]*|\d{2,}[\w.\-/]*", tail.upper())
    for c in cands:
        c = re.sub(r"\s+", " ", c).strip()
        if 3 <= len(c) <= 24 and re.search(r"\d", c) and not re.fullmatch(r"(19|20)\d{2}", c):
            return c
    return None


def media_format(*texts):
    blob = " ".join(t or "" for t in texts)
    if re.search(r"\bCD\b|\bC\.D\.", blob, re.I):
        return "CD"
    if re.search(r"\bLP\b|\bL\.P\.", blob, re.I):
        return "LP"
    return None


def main():
    posts = [json.loads(l) for l in open(os.path.join(CAP, "posts.jsonl"), encoding="utf-8")]

    # portada = primera imagen listada del post
    covers = {}
    for line in open(os.path.join(CAP, "images.jsonl"), encoding="utf-8"):
        img = json.loads(line)
        if img.get("status") != "ok" or not img.get("file"):
            continue
        for url in img.get("posts") or []:
            covers.setdefault(url, img["file"])

    artists = q("select id,name from artists")
    idx = collections.defaultdict(list)
    for aid, name in artists:
        for k in cruce.keys(name):
            idx[k].append((int(aid), name))

    albums = collections.defaultdict(dict)
    album_rows = {}
    for aid, art, title, yr, lab, cat, cov, fmt, ntr in q(
            "select a.id,a.artist_id,a.title,coalesce(a.release_year::text,''),coalesce(a.label_id::text,''),"
            "coalesce(a.catalog_id,''),coalesce(a.cover_url,''),coalesce(a.media_format,''),"
            "coalesce((select count(*) from tracks t where t.album_id=a.id),0) from albums a"):
        rec = {"id": int(aid), "title": title, "year": yr, "label": lab, "catalog": cat,
               "cover": cov, "format": fmt, "tracks": int(ntr)}
        album_rows[int(aid)] = rec
        for k in cruce.keys(title):
            albums[int(art)].setdefault(k, rec)

    tracks_by_album = collections.defaultdict(set)
    track_pos = collections.defaultdict(dict)
    album_artist = {}
    albums_of_artist = collections.defaultdict(set)
    for aid, art, num, title in q("select a.id,a.artist_id,t.track_number,t.title from tracks t "
                                  "join albums a on a.id=t.album_id order by a.id,t.track_number"):
        tracks_by_album[int(aid)].add(cruce.norm(title))
        track_pos[int(aid)].setdefault(int(num), title)
        album_artist[int(aid)] = int(art)
        albums_of_artist[int(art)].add(int(aid))

    persons, person_compact = {}, {}
    for pid, name in q("select id,name from persons"):
        persons.setdefault(cruce.norm(name), (int(pid), name))
        person_compact.setdefault(cruce.norm(name).replace(" ", ""), (int(pid), name))

    labels = [(int(lid), name) for lid, name in q(
        "select id,name from organizations where organization_type='record_label'")]

    def find_label(raw):
        k = cruce.norm(raw or "")
        if not k:
            return None
        words = k.split()
        for n in range(min(6, len(words)), 0, -1):
            cand = " ".join(words[:n])
            for lid, name in labels:
                if cruce.norm(name) == cand:
                    return lid
        return None

    def find_person(raw):
        k = cruce.norm(raw or "")
        if not k or k in JUNK_COMPOSER or len(k) < 4:
            return None
        hit = persons.get(k) or person_compact.get(k.replace(" ", ""))
        return hit[0] if hit else None

    plan = []
    review_artists, review_partial, review_tracks = [], [], []
    stats = collections.Counter()

    def clean_tracks(tr, url, artist_name, album_title):
        """Descarta pistas con título vacío o desmesurado (fallo de parseo del post).

        El listado del blog separa temas por `N.-`; cuando una línea no trae título
        o el corte se come media ficha, la pista resultante no sirve. Se quita, se
        anota en el CSV de revisión y el disco se crea con las demás.
        """
        ok = []
        for t in tr:
            title = (t.get("title") or "").strip()
            if not title or len(title) > 120:
                review_tracks.append({"artist": artist_name, "album": album_title, "n": t["n"],
                                      "motivo": "vacío" if not title else "demasiado largo",
                                      "crudo": (t.get("raw") or "")[:300], "url": url})
                stats["pista_descartada"] += 1
                continue
            ok.append(t)
        return ok

    for post in posts:
        url = post.get("url")
        title = post.get("title") or ""
        artist_raw, album_title, year, tail = cruce.parse_title(title)
        tr = cruce.parse_tracks(post.get("content_text"))
        tr = clean_tracks(tr, url, cruce.norm(artist_raw), cruce.norm(album_title))
        if not artist_raw or not album_title or len(tr) < 3:
            stats["descartado_sin_ficha"] += 1
            continue
        ks = cruce.keys(artist_raw)
        hit = next((idx[k][0] for k in ks if k in idx), None)
        tier = "exacto" if (ks and ks[0] in idx) else ("variante" if hit else None)
        if hit is None and len(ks[0]) >= 6:
            pre = ks[0].replace(" ", "")[:4]
            pool = [p for p in idx if p.replace(" ", "").startswith(pre)]
            m = difflib.get_close_matches(ks[0].replace(" ", ""), [p.replace(" ", "") for p in pool], n=1, cutoff=0.94)
            if m:
                hit = idx[pool[[p.replace(" ", "") for p in pool].index(m[0])]][0]
                tier = "fuzzy"
        if hit is None:
            review_artists.append({"artist": artist_raw, "album": album_title, "year": year or "",
                                   "tracks": len(tr), "url": url})
            stats["artista_fuera"] += 1
            continue
        artist_id = hit[0]

        alb = None
        for k in cruce.keys(album_title):
            alb = albums[artist_id].get(k)
            if alb:
                break
        cover = covers.get(url)

        if alb:
            fields = {}
            if not alb["year"] and year:
                fields["release_year"] = int(year)
            code = catalog_code(tail, album_title)
            if not alb["catalog"] and code:
                fields["catalog_id"] = code
            lid = find_label(tail)
            if not alb["label"] and lid:
                fields["label_id"] = lid
            if not alb["format"]:
                fmt = media_format(tail, title)
                if fmt:
                    fields["media_format"] = fmt
            if not alb["cover"] and cover:
                fields["cover_file"] = cover
            if fields:
                plan.append({"kind": "album_fields", "album_id": alb["id"], "fields": fields, "src": url})
                stats["album_relleno"] += 1
            # tracklist: sólo si el disco está vacío (nunca renumerar uno parcial)
            if alb["tracks"] == 0:
                plan.append({"kind": "album_tracks", "album_id": alb["id"],
                             "tracks": [{"n": t["n"], "title": t["title"]} for t in tr], "src": url})
                stats["album_tracks_nuevo"] += 1
            else:
                # Disco ya fichado: sólo se añaden posiciones LIBRES cuyo título no
                # esté ya en el disco. Nunca se renumera ni se pisa lo existente.
                ocupadas = track_pos.get(alb["id"], {})
                presentes = tracks_by_album.get(alb["id"], set())
                faltan = [{"n": t["n"], "title": t["title"]} for t in tr
                          if t["n"] not in ocupadas and cruce.norm(t["title"]) not in presentes]
                if faltan:
                    plan.append({"kind": "album_tracks_add", "album_id": alb["id"], "tracks": faltan, "src": url})
                    stats["album_tracks_ampliado"] += 1
                    stats["album_tracks_ampliado_pistas"] += len(faltan)
                if len(tr) > alb["tracks"]:
                    review_partial.append({"album_id": alb["id"], "artist": hit[1], "album": alb["title"],
                                           "tracks_db": alb["tracks"], "tracks_blog": len(tr), "url": url})
                    stats["tracklist_parcial"] += 1
            # compositor: sólo pistas que existen y persona ya fichada
            for t in tr:
                pid = find_person(t.get("composer"))
                if pid and t["n"] in track_pos.get(alb["id"], {}):
                    plan.append({"kind": "composer_credit", "album_id": alb["id"], "track_number": t["n"],
                                 "person_id": pid, "composer": t.get("composer"), "src": url})
                    stats["compositor_cruzado"] += 1
            continue

        # disco candidato nuevo: descartar duplicados por repertorio/título
        bt = {cruce.norm(t["title"]) for t in tr if t.get("title")}
        best, score = None, 0.0
        for aid2 in albums_of_artist.get(artist_id, ()):
            s = tracks_by_album.get(aid2)
            if s:
                sc = len(bt & s) / max(len(bt), len(s))
                if sc > score:
                    best, score = aid2, sc
        best_title = album_rows[best]["title"] if best in album_rows else ""

        def clean(x):
            x = re.sub(r"\b(vol|volume|volumen|cd|disc|disco|edicion|especial|remasterizado|serie)\b", " ", cruce.norm(x))
            return re.sub(r"\s+", " ", x).strip()

        sim = difflib.SequenceMatcher(None, clean(album_title), clean(best_title)).ratio()
        if score >= 0.9 or sim >= 0.85 or (score >= 0.6 and sim >= 0.6):
            stats["duplicado_descartado"] += 1
            continue
        if (artist_id, cruce.norm(album_title)) in DUPLICADOS_VERIFICADOS:
            stats["duplicado_verificado"] += 1
            continue

        fields = {"title": album_title}
        if year:
            fields["release_year"] = int(year)
        code = catalog_code(tail, album_title)
        if code:
            fields["catalog_id"] = code
        lid = find_label(tail)
        if lid:
            fields["label_id"] = lid
        fmt = media_format(tail, title)
        if fmt:
            fields["media_format"] = fmt
        plan.append({"kind": "album_new", "artist_id": artist_id, "artist": hit[1], "fields": fields,
                     "cover_file": cover, "src": url,
                     "tracks": [{"n": t["n"], "title": t["title"],
                                 "composer_person_id": find_person(t.get("composer"))} for t in tr]})
        stats["album_nuevo"] += 1

    # VenezuelaDemo: créditos de intérprete por pista sobre compilaciones ya fichadas
    vd = 0
    if os.path.exists(VD_CSV):
        vd_tracks = collections.defaultdict(dict)
        for row in q("select a.title,t.track_number,t.id from tracks t join albums a on a.id=t.album_id "
                     "where a.title ilike 'venezuelademo%'"):
            vd_tracks[int(re.search(r"(\d+)", row[0]).group(1))][int(row[1])] = int(row[2])
        vd_album = {}
        for row in q("select id,title from albums where title ilike 'venezuelademo%'"):
            vd_album[int(re.search(r"(\d+)", row[1]).group(1))] = int(row[0])
        for r in csv.DictReader(open(VD_CSV, encoding="utf-8")):
            if not r["artist_id_crv"] or r["match"] != "exacto":
                continue
            vol, num = int(r["volumen"]), int(r["pista"])
            tid = vd_tracks.get(vol, {}).get(num)
            if not tid:
                continue
            plan.append({"kind": "vd_credit", "album_id": vd_album[vol], "track_id": tid,
                         "artist_id": int(r["artist_id_crv"]), "person_id": find_person(r["autor"]),
                         "src": f"https://web.archive.org/web/2012/http://www.venezuelademo.com/discos/VD_info_CD{vol}.pdf"})
            vd += 1
    stats["vd_credito"] = vd

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        for item in plan:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
    with open(REVIEW_ARTISTS, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["artist", "album", "year", "tracks", "url"])
        w.writeheader()
        w.writerows(review_artists)
    with open(REVIEW_PARTIAL, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["album_id", "artist", "album", "tracks_db", "tracks_blog", "url"])
        w.writeheader()
        w.writerows(review_partial)
    REVIEW_TRACKS = os.path.join(ROOT, "reports/2026-10-26-absorcion-pistas-revisar.csv")
    with open(REVIEW_TRACKS, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["artist", "album", "n", "motivo", "crudo", "url"])
        w.writeheader()
        w.writerows(review_tracks)

    print("plan:", OUT)
    for k, v in stats.most_common():
        print(f"  {k:24s} {v}")
    print("nuevos discos con label:", sum(1 for p in plan if p["kind"] == "album_new" and "label_id" in p["fields"]))
    print("nuevos discos con catalogo:", sum(1 for p in plan if p["kind"] == "album_new" and "catalog_id" in p["fields"]))
    print("nuevos discos con portada:", sum(1 for p in plan if p["kind"] == "album_new" and p.get("cover_file")))
    print("pistas a crear:", sum(len(p["tracks"]) for p in plan if p["kind"] in ("album_new", "album_tracks")))
    print("compositores resolubles en pistas nuevas:",
          sum(1 for p in plan if p["kind"] == "album_new" for t in p["tracks"] if t["composer_person_id"]))
    print("revision artistas:", REVIEW_ARTISTS, len(review_artists))
    print("revision tracklist parcial:", REVIEW_PARTIAL, len(review_partial))


if __name__ == "__main__":
    main()
