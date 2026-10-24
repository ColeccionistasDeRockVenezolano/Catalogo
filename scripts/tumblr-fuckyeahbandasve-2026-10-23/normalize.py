#!/usr/bin/env python3
"""Normaliza la cosecha Tumblr de fuckyeahbandasve a registros identificables.

Entrada : data/raw/tumblr-fuckyeahbandasve-2026-10-23/posts.jsonl  (crudo API v2 NPF)
Salida  : data/raw/tumblr-fuckyeahbandasve-2026-10-23/derived/
            posts.jsonl    un registro por post (texto, tags, fechas, conteos)
            videos.jsonl   un registro por vídeo (YouTube/Vimeo/Vevo/Tumblr)
            audios.jsonl   un registro por audio (SoundCloud/Bandcamp/Tumblr)
            images.jsonl   un registro por imagen (URL máxima resolución)
            links.jsonl    un registro por enlace externo encontrado en el texto
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path
from urllib.parse import urlparse, parse_qs

CAMPAIGN = Path("/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/"
                "tumblr-fuckyeahbandasve-2026-10-23")
DERIVED = CAMPAIGN / "derived"

TAG_RE = re.compile(r"<[^>]+>")
HREF_RE = re.compile(r"""href=["']([^"']+)["']""", re.I)
YT_RE = re.compile(r"(?:youtube\.com/(?:watch\?v=|embed/|v/)|youtu\.be/)([A-Za-z0-9_-]{11})")
VIMEO_RE = re.compile(r"vimeo\.com/(?:video/)?(\d+)")

PLATFORM_PATTERNS = [
    ("youtube", re.compile(r"(?:youtube\.com|youtu\.be)")),
    ("vimeo", re.compile(r"vimeo\.com")),
    ("soundcloud", re.compile(r"soundcloud\.com")),
    ("bandcamp", re.compile(r"bandcamp\.com")),
    ("spotify", re.compile(r"open\.spotify\.com|spoti\.fi")),
    ("apple_music", re.compile(r"music\.apple\.com|itunes\.apple\.com")),
    ("deezer", re.compile(r"deezer\.com")),
    ("instagram", re.compile(r"instagram\.com")),
    ("facebook", re.compile(r"facebook\.com|fb\.com|fb\.me")),
    ("twitter", re.compile(r"twitter\.com|//x\.com")),
    ("tiktok", re.compile(r"tiktok\.com")),
    ("tumblr", re.compile(r"tumblr\.com")),
    ("linktree", re.compile(r"linktr\.ee")),
    ("reverbnation", re.compile(r"reverbnation\.com")),
    ("myspace", re.compile(r"myspace\.com")),
    ("wikipedia", re.compile(r"wikipedia\.org")),
    ("discogs", re.compile(r"discogs\.com")),
]

# Etiquetas de formato (no son artistas)
FORMAT_TAGS = {
    "audio", "videoclip", "video", "toque", "gif", "descargar", "nuevo", "nueva",
    "evento", "queue", "submission", "banda", "bandas", "venezuela", "rock",
    "rock nacional", "rock venezolano", "música", "musica", "music", "caracas",
    "maracaibo", "valencia", "rock venezolano", "rocknacional", "live", "en vivo",
    "entrevista", "concierto", "flyer", "afiche", "portada", "cover", "disco",
    "album", "single", "sencillo", "ep", "demo", "video oficial", "estreno",
    "bandasve", "noticia", "crónica", "cronica", "reseña", "resena", "opinion",
    "foto", "fotos", "fotografía", "fotografia", "promo", "concurso", "regalo",
    "sorteo", "descarga", "streaming", "full album", "disco completo",
}


def clean_text(s: str) -> str:
    s = TAG_RE.sub("", s or "")
    s = html.unescape(s)
    return re.sub(r"[ \t]+", " ", s).strip()


def blocks_of(post: dict):
    """Devuelve (block, origen) para el contenido propio y toda la cadena de reblogs."""
    for b in post.get("content") or []:
        yield b, "own"
    for i, t in enumerate(post.get("trail") or []):
        for b in t.get("content") or []:
            yield b, f"trail{i}"


def platform_of(url: str) -> str | None:
    u = url.lower()
    for name, rx in PLATFORM_PATTERNS:
        if rx.search(u):
            return name
    return "web"


def best_image(media: list) -> dict | None:
    if not media:
        return None
    return max(media, key=lambda m: (m.get("width") or 0) * (m.get("height") or 0))


def yt_id(url: str) -> str | None:
    m = YT_RE.search(url or "")
    if m:
        return m.group(1)
    try:
        q = parse_qs(urlparse(url).query)
        if "v" in q and re.fullmatch(r"[A-Za-z0-9_-]{11}", q["v"][0]):
            return q["v"][0]
    except Exception:
        pass
    return None


def main() -> int:
    DERIVED.mkdir(parents=True, exist_ok=True)
    posts = [json.loads(l) for l in (CAMPAIGN / "posts.jsonl").open()]
    fh = {n: (DERIVED / f"{n}.jsonl").open("w") for n in
          ("posts", "videos", "audios", "images", "links")}
    n_img = n_vid = n_aud = n_link = 0

    for p in posts:
        pid = int(p["id"])
        url = p.get("postUrl")
        own_text, trail_text, tags = [], [], p.get("tags") or []
        imgs, vids, auds, links = [], [], [], []

        for b, src in blocks_of(p):
            t = b.get("type")
            if t == "text":
                txt = clean_text(b.get("text", ""))
                if txt:
                    (own_text if src == "own" else trail_text).append(txt)
                for h in HREF_RE.findall(b.get("text", "")):
                    links.append({"url": html.unescape(h), "src": src})
            elif t == "image":
                bi = best_image(b.get("media") or [])
                if bi:
                    imgs.append({"url": bi["url"], "w": bi.get("width"),
                                 "h": bi.get("height"), "src": src})
            elif t == "video":
                prov = (b.get("provider") or "").lower()
                vurl = b.get("url") or ""
                meta = b.get("metadata") or {}
                title = meta.get("title")
                if not title:
                    m = re.search(r'title="([^"]+)"', b.get("embedHtml") or "")
                    title = html.unescape(m.group(1)) if m else None
                vids.append({"provider": prov, "url": vurl,
                             "video_key": yt_id(vurl) or (VIMEO_RE.search(vurl).group(1)
                                                          if VIMEO_RE.search(vurl) else meta.get("id")),
                             "title": clean_text(title) if title else None,
                             "duration": meta.get("duration"), "src": src})
            elif t == "audio":
                auds.append({"provider": (b.get("provider") or "").lower(),
                             "url": b.get("url"), "title": b.get("title"),
                             "artist": b.get("artist"), "album": b.get("album"),
                             "src": src})
            elif t == "link":
                lu = b.get("url") or ""
                links.append({"url": lu, "title": b.get("title"),
                              "description": clean_text(b.get("description") or ""),
                              "src": src})
                bi = best_image(b.get("poster") or [])
                if bi:
                    imgs.append({"url": bi["url"], "w": bi.get("width"),
                                 "h": bi.get("height"), "src": src, "role": "poster_link"})

        # enlaces dentro de los bloques de tipo link también cuentan como enlace externo
        all_urls = []
        for l in links:
            u = l["url"]
            if not u.startswith("http"):
                continue
            all_urls.append(u)
            rec = {"post_id": pid, "post_url": url, "date": p.get("date"),
                   "platform": platform_of(u), "url": u, "src": l["src"],
                   "title": l.get("title"), "description": l.get("description")}
            if platform_of(u) == "youtube":
                rec["video_key"] = yt_id(u)
            fh["links"].write(json.dumps(rec, ensure_ascii=False) + "\n")
            n_link += 1

        for v in vids:
            rec = {"post_id": pid, "post_url": url, "date": p.get("date"),
                   "provider": v["provider"], "video_url": v["url"],
                   "video_key": v["video_key"], "title": v["title"],
                   "duration": v["duration"], "src": v["src"]}
            fh["videos"].write(json.dumps(rec, ensure_ascii=False) + "\n")
            n_vid += 1
        for a in auds:
            rec = {"post_id": pid, "post_url": url, "date": p.get("date"), **a}
            fh["audios"].write(json.dumps(rec, ensure_ascii=False) + "\n")
            n_aud += 1
        for im in imgs:
            rec = {"post_id": pid, "post_url": url, "date": p.get("date"), **im}
            fh["images"].write(json.dumps(rec, ensure_ascii=False) + "\n")
            n_img += 1

        text_all = " \n".join(own_text + trail_text)
        rec = {
            "post_id": pid, "post_url": url, "date": p.get("date"),
            "timestamp": p.get("timestamp"), "post_type": p.get("originalType"),
            "is_reblog": bool(p.get("rebloggedFromName")),
            "reblog_root": p.get("rebloggedRootName"),
            "notes": p.get("noteCount"),
            "tags": tags,
            "format_tags": sorted({t.strip().lower() for t in tags
                                   if t.strip().lower() in FORMAT_TAGS}),
            "own_text": "\n".join(own_text)[:4000],
            "trail_text": "\n".join(trail_text)[:4000],
            "slug": p.get("slug"),
            "n_images": len(imgs), "n_videos": len(vids), "n_audios": len(auds),
            "video_titles": [v["title"] for v in vids if v["title"]],
            "audio_titles": [a["title"] for a in auds if a["title"]],
            "n_links": len(all_urls),
        }
        fh["posts"].write(json.dumps(rec, ensure_ascii=False) + "\n")

    for f in fh.values():
        f.close()
    print(f"posts={len(posts)} videos={n_vid} audios={n_aud} images={n_img} links={n_link}")
    print("salida:", DERIVED)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
