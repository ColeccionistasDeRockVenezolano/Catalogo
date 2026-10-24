#!/usr/bin/env python3
"""Genera los artefactos listos para catálogo a partir de la cosecha normalizada.

Salidas en derived/:
  audiovisual_candidates.csv  un vídeo único por artista (YouTube/Vimeo/Vevo/Tumblr)
  audio_candidates.csv        un audio único por artista (SoundCloud/Bandcamp/Tumblr)
  nuevos_artistas_candidatos.csv  nombres del blog que NO están en el catálogo
"""
from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

D = Path("/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/"
         "tumblr-fuckyeahbandasve-2026-10-23/derived")

NO_ARTISTA = {
    "venezuela", "audio", "banda", "bandas", "toque", "toques", "musica", "music",
    "maracaibo", "caracas", "videoclip", "video", "videos", "bandasve", "san cristobal",
    "rock", "rock venezolano", "rock nacional", "the", "bandas", "descargar", "nuevo",
    "nueva", "album", "disco", "ep", "single", "sencillo", "demo", "punk", "ska",
    "reggae", "metal", "pop", "indie", "alternativo", "experimental", "rockabilly",
    "fnb", "festival", "festivales", "gira", "tour", "showcase", "teaser", "trailer",
    "tracklist", "album cover", "sesiones", "revista", "tlx", "np", "queue",
    "submission", "giveaway", "concierto", "evento", "premios", "nominados",
    "ganador", "ganadora", "concurso", "sorteo", "crónica", "cronica", "entrevista",
    "estreno", "lanzamiento", "nuevo album", "nueva cancion", "preventa", "entradas",
    "gratis", "liberado", "descarga", "streaming", "playlist", "letra", "lyrics",
    "portada", "cover", "foto", "fotos", "flyer", "afiche", "promo", "programa",
    "programacion", "cartel", "afiche", "line up", "lineup", "horarios", "ticket",
    "los galpones", "centro cultural bod", "la mega", "el nacional", "tal cual",
}

RUIDO = re.compile(
    r"(bar\b|teatro|centro cultural|sala\b|galp[oó]n|club|rockeria|rokeria|quinta|"
    r"hotel|plaza|parque|auditorio|molino rojo|punto fijo|la mega|festival|fest\b|"
    r"concierto|gira|showcase|taller|concurso|fundaci[oó]n|nuevas bandas|"
    r"producciones|revista|el nacional|rockenart|sclamotion|rock ?and ?mau|"
    r"fuckyeahbandasve|tlx|^np$|queue|submission|giveaway|premios|discos|records|"
    r"records|sello|instagram|facebook|twitter|youtube|soundcloud|bandcamp)", re.I)


def load(name: str):
    return [json.loads(l) for l in (D / name).open()]


def main() -> int:
    posts = {p["post_id"]: p for p in load("posts.jsonl")}
    pa = {p["post_id"]: p for p in load("posts_artists.jsonl")}
    videos = load("videos.jsonl")
    audios = load("audios.jsonl")
    links = load("links.jsonl")

    # --- vídeos únicos por (artista, video_key)
    seen = {}
    # los posts de tipo enlace también traen vídeos de YouTube (bloque `link`)
    extra_videos = [{"post_id": l["post_id"], "post_url": l.get("post_url"),
                     "date": l.get("date"), "provider": "youtube",
                     "video_url": l["url"], "video_key": l["video_key"],
                     "title": l.get("title") or l.get("anchor"), "src": "bloque_enlace"}
                    for l in links
                    if l.get("platform") == "youtube" and l.get("video_key")]
    for v in videos + extra_videos:
        key = v.get("video_key") or v.get("video_url")
        if not key:
            continue
        p = posts.get(v["post_id"], {})
        artists = pa.get(v["post_id"], {}).get("artists") or []
        if not artists:
            artists = [{"artist_id": "", "name": "", "conf": ""}]
        for a in artists:
            k = (a["artist_id"], key)
            if k in seen:
                continue
            seen[k] = {
                "artist_id": a["artist_id"], "artist": a["name"],
                "conf": a.get("conf", ""), "provider": v.get("provider"),
                "video_key": v.get("video_key") or "", "video_url": v.get("video_url"),
                "title": v.get("title") or "", "post_date": (v.get("date") or "")[:10],
                "post_url": v.get("post_url"), "notes": p.get("notes", ""),
                "source_key": f"tumblr:fuckyeahbandasve:post:{v['post_id']}",
            }
    rows = sorted(seen.values(), key=lambda r: (r["artist"] or "~", r["post_date"]))
    with (D / "audiovisual_candidates.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"audiovisual_candidates.csv {len(rows)} filas "
          f"(con artista {sum(1 for r in rows if r['artist_id'] != '')})")

    # --- audios únicos por (artista, url sin query)
    seen = {}
    for a in audios:
        prov = (a.get("provider") or "").lower()
        raw_url = a.get("url") or a.get("media_url") or ""
        # en Tumblr alojado la URL lleva play_key: se conserva entera
        url = raw_url if prov == "tumblr" else raw_url.split("?")[0]
        if not url:
            continue
        artists = pa.get(a["post_id"], {}).get("artists") or []
        if not artists:
            artists = [{"artist_id": "", "name": "", "conf": ""}]
        for art in artists:
            k = (art["artist_id"], url)
            if k in seen:
                continue
            seen[k] = {
                "artist_id": art["artist_id"], "artist": art["name"],
                "conf": art.get("conf", ""), "provider": prov,
                "url": url, "media_url": a.get("media_url") or "",
                "title": a.get("title") or "",
                "audio_artist": a.get("artist") or "",
                "post_date": (a.get("date") or "")[:10], "post_url": a.get("post_url"),
                "source_key": f"tumblr:fuckyeahbandasve:post:{a['post_id']}",
            }
    rows = sorted(seen.values(), key=lambda r: (r["artist"] or "~", r["post_date"]))
    with (D / "audio_candidates.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"audio_candidates.csv {len(rows)} filas "
          f"(con artista {sum(1 for r in rows if r['artist_id'] != '')})")

    # --- nombres del blog que no están en el catálogo
    cat_names = set()
    with (D / "artists.csv").open() as fh:
        for r in csv.DictReader(fh):
            cat_names.add(re.sub(r"[^a-z0-9 ]", "", r["name"].lower().strip()))
    with (D / "aliases.csv").open() as fh:
        for r in csv.DictReader(fh):
            cat_names.add(re.sub(r"[^a-z0-9 ]", "", r["alias"].lower().strip()))

    cand = defaultdict(lambda: {"n": 0, "tag": 0, "texto": 0, "tipos": set(), "posts": []})
    for pid, p in posts.items():
        if pa[pid]["artists"]:
            continue
        txt = (p.get("own_text") or "").strip()
        head = re.split(r"\s+[-–—|]\s+|\s*//\s*", txt)[0].strip(" .:;\"'()[]") if txt else ""
        names = []
        if 2 < len(head) < 45 and not RUIDO.search(head) and not re.search(r"[.!?]$", head):
            names.append((head, "texto"))
        for t in p.get("tags") or []:
            if 2 < len(t) < 45 and not RUIDO.search(t) and not t.isdigit():
                names.append((t, "tag"))
        for raw, via in names:
            n = re.sub(r"[^a-z0-9 ]", "", raw.lower().strip())
            n = re.sub(r"\s+", " ", n)
            if not n or n in NO_ARTISTA or n in cat_names or len(n) < 3:
                continue
            c = cand[raw.strip()]
            c["n"] += 1
            c[via] += 1
            c["tipos"].add(p["post_type"])
            if len(c["posts"]) < 3:
                c["posts"].append(p["post_url"])
            if len(c.setdefault("textos", [])) < 2 and txt:
                c["textos"].append(txt.replace("\n", " / ")[:120])
    out = sorted(cand.items(), key=lambda kv: -kv[1]["n"])
    with (D / "nuevos_artistas_candidatos.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["candidato", "apariciones", "como_tag", "como_texto", "tipos",
                    "ejemplo_texto", "posts"])
        for name, c in out:
            w.writerow([name, c["n"], c["tag"], c["texto"], ",".join(sorted(c["tipos"])),
                        (c.get("textos") or [""])[0], " ".join(c["posts"])])
    print(f"nuevos_artistas_candidatos.csv {len(out)} nombres "
          f"(>=3 apariciones: {sum(1 for _, c in out if c['n'] >= 3)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
