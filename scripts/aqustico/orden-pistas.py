#!/usr/bin/env python3
"""Plan Aqustico · E5 (D4) — orden de pistas de otra fuente para discos de varias canciones.

Aqustico no da el número de pista y el orden en que lista las canciones no es el
del disco (14 de 270 discos comparados), así que un disco de varias canciones
solo entra si otra fuente da el orden (decisión D4, valor por defecto).

Para cada disco H7 de 2+ canciones y cada H8 (disco de CRV sin pistas) busca en
Deezer y luego en MusicBrainz una edición con:
  * artista y título exactos (misma clave compacta que el normalizador del repo);
  * TODAS las canciones de Aqustico presentes, cada una en una sola posición.
Sin edición así, el disco queda en espera. Solo lectura de la base; escribe
orden-pistas.json junto a la tabla maestra (AQ_OUT, por defecto la del volcado
del 2026-10-14). El campo `orden` del detalle de álbum de ese volcado no sirve
como fuente: contradice a CRV en 6 de 15 discos comparables y repite posiciones.

  python3 -I scripts/aqustico/orden-pistas.py
"""
import json, os, re, sys, time, unicodedata, urllib.parse, urllib.request

ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano"
DIR = os.path.join(ROOT, os.environ.get("AQ_OUT", "reports/aqustico-2026-10-14"))
RAW = os.path.join(ROOT, os.environ.get("AQ_RAW", "/mnt/1tb/Shared/aqustico-assets/_raw/api-2026-10-14"))
UA = "CRV-completar/1.0 (+coleccionistasderockvenezolano.com)"
GAP = {"deezer": 0.15, "musicbrainz": 1.1}
_last = {}


def key(value):
    """Equivale a compactSecondaryKey de src/normalization/entity-name.ts."""
    s = unicodedata.normalize("NFKC", value or "")
    s = re.sub("[“”„«»]", '"', s)
    s = re.sub("[‘’ʼʻ´`]", "'", s)
    s = re.sub("[‐-―−]", "-", s)
    s = s.replace("&", " y ").lower().replace("'", "")
    s = "".join(" " if unicodedata.category(c)[0] in "PS" else c for c in s)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", "", s)


def get(service, url):
    wait = GAP[service] - (time.time() - _last.get(service, 0))
    if wait > 0:
        time.sleep(wait)
    _last[service] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                print(f"  ! {service}: {e}", file=sys.stderr)
                return None
            time.sleep(3 * (attempt + 1))


def match_order(songs, tracks):
    """songs: [(songId,title)], tracks: [(disc,n,title,seconds)] → {songId: (disc,n,seconds)} o None."""
    by = {}
    for t in tracks:
        by.setdefault(key(t[2]), []).append(t)
    out = {}
    for sid, title in songs:
        hits = by.get(key(title), [])
        if len(hits) != 1:
            return None
        t = hits[0]
        out[sid] = {"disc": t[0], "n": t[1], "title": t[2], "seconds": t[3]}
    if len({(v["disc"], v["n"]) for v in out.values()}) != len(out):
        return None
    return out


def deezer(artist, title, songs):
    q = urllib.parse.quote(f'artist:"{artist}" album:"{title}"')
    res = get("deezer", f"https://api.deezer.com/search/album?q={q}&limit=25") or {}
    for alb in res.get("data", []):
        if key(alb.get("title")) != key(title) or key(alb.get("artist", {}).get("name")) != key(artist):
            continue
        tr = get("deezer", f"https://api.deezer.com/album/{alb['id']}/tracks?limit=200") or {}
        tracks = [(t.get("disk_number") or 1, t.get("track_position"), t.get("title"), t.get("duration")) for t in tr.get("data", [])]
        if not tracks or any(t[1] is None for t in tracks):
            continue
        order = match_order(songs, tracks)
        if order:
            return {"source": "deezer", "url": f"https://www.deezer.com/album/{alb['id']}", "externalTitle": alb.get("title"),
                    "externalTracks": len(tracks), "order": order}
    return None


def musicbrainz(artist, title, songs):
    q = urllib.parse.quote(f'release:"{title}" AND artist:"{artist}"')
    res = get("musicbrainz", f"https://musicbrainz.org/ws/2/release/?query={q}&fmt=json&limit=15") or {}
    for rel in res.get("releases", []):
        credit = "".join((c.get("name") or "") + (c.get("joinphrase") or "") for c in rel.get("artist-credit", []))
        if key(rel.get("title")) != key(title) or key(credit) != key(artist):
            continue
        full = get("musicbrainz", f"https://musicbrainz.org/ws/2/release/{rel['id']}?inc=recordings&fmt=json") or {}
        tracks = []
        for medium in full.get("media", []):
            for t in medium.get("tracks", []):
                tracks.append((medium.get("position") or 1, t.get("position"), t.get("title"),
                               round(t["length"] / 1000) if t.get("length") else None))
        if not tracks:
            continue
        order = match_order(songs, tracks)
        if order:
            return {"source": "musicbrainz", "url": f"https://musicbrainz.org/release/{rel['id']}", "externalTitle": rel.get("title"),
                    "externalTracks": len(tracks), "order": order}
    return None


def main():
    huecos = json.load(open(f"{DIR}/tabla-maestra.json"))["huecos"]
    artistas = {}
    for line in open(f"{DIR}/cruces-artistas.tsv", encoding="utf-8").read().splitlines()[1:]:
        p = line.split("\t")
        if p[2]:
            artistas[int(p[2])] = p[3]
    discos = {}
    for line in open(f"{DIR}/cruces-discos.tsv", encoding="utf-8").read().splitlines()[1:]:
        p = line.split("\t")
        discos[p[2]] = p  # aq_album_ids → fila
    todo = []
    for h in huecos:
        if h["hueco"] == "H7" and len(h["valor"]["canciones"]) > 1:
            songs = [(c["songId"], c["title"]) for c in h["valor"]["canciones"]]
            todo.append({"hueco": "H7", "aqIds": h["aqId"], "crvArtistId": h["crvId"], "artist": artistas.get(h["crvId"]),
                         "title": h["valor"]["title"], "songs": songs})
        elif h["hueco"] == "H8":
            p = discos.get(h["aqId"])
            todo.append({"hueco": "H8", "aqIds": h["aqId"], "crvAlbumId": h["crvId"], "artist": (artistas.get(int(p[6])) or p[1]) if p and p[6] else (p[1] if p else None),
                         "title": p[8] if p else None, "songs": None, "titles": h["valor"]})
    # H8: las canciones con id salen del volcado
    raw = f"{RAW}/songs"
    by_album = {}
    for fn in os.listdir(raw):
        text = open(f"{raw}/{fn}").read().strip()
        for s in (json.loads(text) if text else None) or []:
            by_album.setdefault(str(s["album_id"]), []).append((s["id"], s["song_name"]))
    for t in todo:
        if t["songs"] is None:
            seen, songs = set(), []
            for aid in t["aqIds"].split(","):
                for sid, title in by_album.get(aid, []):
                    if key(title) not in seen:
                        seen.add(key(title)); songs.append((sid, title))
            t["songs"] = songs
    result = []
    for i, t in enumerate(todo, 1):
        found = None
        names = [t["artist"]] if t["artist"] else []
        for name in names:
            found = deezer(name, t["title"], t["songs"]) or musicbrainz(name, t["title"], t["songs"])
            if found:
                break
        t["orden"] = found
        result.append(t)
        print(f"[{i}/{len(todo)}] {t['hueco']} {t['artist']} — {t['title']}: {found['source'] if found else 'sin orden'}", flush=True)
    json.dump({"generado": time.strftime("%Y-%m-%dT%H:%M:%S"), "discos": result}, open(f"{DIR}/orden-pistas.json", "w"), ensure_ascii=False, indent=1)
    ok = [r for r in result if r["orden"]]
    print(f"con orden: {len(ok)} de {len(result)} ({sum(1 for r in ok if r['hueco']=='H7')} H7, {sum(1 for r in ok if r['hueco']=='H8')} H8)")


if __name__ == "__main__":
    main()
