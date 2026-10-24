#!/usr/bin/env python3
"""Identifica a qué artista del catálogo CRV corresponde cada post de Tumblr.

Candidatos por post (con la evidencia de origen):
  tag            etiqueta del post
  texto "<A> - <T>"   parte izquierda del texto propio
  titulo_video   parte izquierda del título del vídeo/audio
  soundcloud     handle del perfil de SoundCloud
  mencion        @handle en el texto

Reglas de identificación (precisión antes que cobertura):
  exacto     nombre canónico o alias idéntico tras normalizar            conf 1.00
  articulo   idéntico ignorando artículo inicial (el/la/los/las/the)     conf 0.97
  compacto   idéntico ignorando espacios y puntuación                    conf 0.95
  difuso     ambos lados >=2 tokens y uno contiene al otro               conf 0.80

Salidas en derived/:
  posts_artists.jsonl    un registro por post con sus artistas y la evidencia
  match_review.csv       coincidencias no exactas para revisión manual
  unmatched_candidates.csv  candidatos NO encontrados en el catálogo, por frecuencia
  artist_summary.jsonl   agregado por artista (posts, vídeos, audios, imágenes, fechas)
"""
from __future__ import annotations

import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

BASE = Path("/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/"
            "tumblr-fuckyeahbandasve-2026-10-23")
D = BASE / "derived"

ARTICLES = {"el", "la", "los", "las", "the", "un", "una"}

# Artistas de relleno del catálogo que nunca deben asignarse por parecido
PLACEHOLDER = {"various artists", "varios artistas", "desconocido", "unknown",
               "por confirmar", "sin artista"}

STOP = {
    # geografía
    "venezuela", "vzla", "caracas", "maracaibo", "valencia", "barquisimeto",
    "san cristobal", "puerto ordaz", "merida", "maracay", "acarigua", "lecheria",
    "chacao", "carabobo", "zulia", "tachira", "mexico", "colombia", "chile",
    "argentina", "españa", "espana", "panama", "costa rica", "pais",
    # formato / tipo de contenido
    "banda", "bandas", "rock", "rock nacional", "rock venezolano", "rock en n",
    "musica", "music", "audio", "videoclip", "video", "videos", "oficial",
    "video oficial", "en vivo", "live", "toque", "toques", "evento", "eventos",
    "concierto", "conciertos", "concert", "festival", "festivales", "gira", "tour",
    "nuevo", "nueva", "single", "sencillo", "album", "disco", "ep", "demo",
    "descargar", "descarga", "gif", "queue", "submission", "entrevista",
    "resena", "cronica", "portada", "cover", "flyer", "afiche", "promo", "fotos",
    "foto", "photography", "fotografia", "concurso", "sorteo", "regalo",
    "estreno", "noticia", "noticias", "opinion", "bandasve", "indie", "punk",
    "metal", "ska", "reggae", "pop", "hip hop", "electronica", "alternativo",
    "band", "cancion", "canciones", "tema", "letra", "lyrics", "subtitulado",
    "nuevo album", "disco completo", "album completo", "full album", "streaming",
    "playlist", "lista", "top", "mejores", "clasico", "historia", "parte", "vol",
    "edicion", "edicion especial", "reedicion", "remix", "acustico", "unplugged",
    "instrumental", "hd", "1080", "720", "official", "official video",
    "music video", "tributo", "tribute", "aniversario", "preventa", "entradas",
    "tickets", "invitados", "invitado", "feat", "ft", "colaboracion", "nacional",
    "internacional", "independiente", "estudio", "directo", "sesion", "sessions",
    "1era edicion", "2da edicion", "nueva cancion", "todo en domingo",
    "black and white", "blanco y negro", "concurso de bandas", "telonero",
    "tributo", "especial", "reportaje", "documental", "entrada", "liberado",
    "gratis", "gratuito", "sold out", "agotado", "masivo", "acceso",
    # plataformas
    "spotify", "bandcamp", "soundcloud", "youtube", "itunes", "apple music",
    "deezer", "tidal", "instagram", "facebook", "twitter", "tumblr", "linktree",
    "reverbnation", "myspace", "wikipedia", "discogs", "vimeo", "que viva",
    # palabras vacías
    "the", "la", "el", "los", "las", "de", "del", "y", "a", "en", "con", "por",
    "para", "una", "un", "al", "se", "su", "sus", "lo", "le", "les", "mi", "tu",
    "no", "si", "mas", "ya", "hoy", "aun", "todo", "todos", "http", "https",
    "www", "com", "org", "net", "por confirmar", "sin confirmar",
}

SPLIT_FEAT = re.compile(r"\s+(?:ft\.?|feat\.?|featuring|con|&|vs\.?)\s+", re.I)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def compact(s: str) -> str:
    return norm(s).replace(" ", "")


def sin_articulo(n: str) -> str:
    toks = n.split()
    if len(toks) > 1 and toks[0] in ARTICLES:
        return " ".join(toks[1:])
    return n


def load_catalog():
    """Índices de artistas reales del catálogo (sin placeholders)."""
    by_key: dict[str, dict] = {}
    names: dict[int, dict] = {}

    def add(a: dict, raw: str, alias: str | None):
        if norm(a["name"]) in PLACEHOLDER:
            return
        n = norm(raw)
        if not n or n in PLACEHOLDER or len(n) < 3:
            return
        by_key.setdefault(n, {**a, "alias": alias, "key_kind": "exacto"})
        sa = sin_articulo(n)
        if sa != n:
            by_key.setdefault(sa, {**a, "alias": alias, "key_kind": "articulo"})
        by_key.setdefault(compact(raw), {**a, "alias": alias, "key_kind": "compacto"})
        multi = {k for k, v in by_key.items() if len(k.split()) >= 2}
        if len(n.split()) >= 2:
            multi.add(n)

    with (D / "artists.csv").open() as fh:
        for r in csv.DictReader(fh):
            a = {"id": int(r["id"]), "name": r["name"], "atype": r["atype"],
                 "status": r["status"], "city": r["city"]}
            names[a["id"]] = a
            add(a, r["name"], None)
    with (D / "aliases.csv").open() as fh:
        for r in csv.DictReader(fh):
            aid = int(r["artist_id"])
            if aid not in names:
                continue
            add(names[aid], r["alias"], r["alias"])
    return by_key, names


def candidates(post: dict, vids: list, auds: list) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for t in post.get("tags") or []:
        out.append((t.strip(), "tag"))
    for seg in re.split(r"\s+[-–—|]\s+|\s*//\s*|\n", post.get("own_text") or ""):
        seg = seg.strip(" .:;\"'()[]")
        if 2 < len(seg) < 70:
            out.append((seg, "texto"))
    for t in post.get("video_titles") or []:
        head = re.split(r"\s+[-–—|]\s+", t)[0].strip(" .:;\"'()[]")
        if 2 < len(head) < 70:
            out.append((head, "titulo_video"))
    for a in post.get("audio_titles") or []:
        head = re.split(r"\s+[-–—|]\s+", a)[0].strip(" .:;\"'()[]")
        if 2 < len(head) < 70:
            out.append((head, "titulo_audio"))
    for a in auds:
        u = a.get("url") or ""
        m = re.match(r"https?://(?:www\.)?soundcloud\.com/([^/?#]+)", u)
        if m and m.group(1) not in ("discover", "search", "you"):
            out.append((m.group(1).replace("-", " "), "soundcloud"))
    for m in re.finditer(r"@([A-Za-z0-9_]{3,30})", post.get("own_text") or ""):
        out.append((m.group(1).replace("_", " "), "mencion"))
    # separar colaboraciones: "A ft. B" -> A y B
    extra = []
    for cand, meth in out:
        if SPLIT_FEAT.search(cand):
            for part in SPLIT_FEAT.split(cand):
                part = part.strip(" .:;\"'()[]")
                if 2 < len(part) < 70:
                    extra.append((part, meth + "_feat"))
    return out + extra


def is_candidate_ok(s: str) -> bool:
    n = norm(s)
    if len(n) < 3 or n in STOP:
        return False
    if re.fullmatch(r"[\d\s]+", n):
        return False
    if len(n.split()) == 1 and len(n) < 4:
        return False
    return True


def match_one(cand: str, by_key: dict) -> list[dict]:
    n = norm(cand)
    hit = by_key.get(n)
    if hit:
        conf = {"exacto": 1.0, "articulo": 0.97}.get(hit["key_kind"], 0.95)
        return [{"artist_id": hit["id"], "name": hit["name"], "method": hit["key_kind"],
                 "conf": conf, "via_alias": hit["alias"]}]
    hit = by_key.get(compact(cand))
    if hit:
        return [{"artist_id": hit["id"], "name": hit["name"], "method": "compacto",
                 "conf": 0.95, "via_alias": hit["alias"]}]
    if not is_candidate_ok(cand):
        return []
    toks = set(n.split())
    if len(toks) < 2:
        return []
    best = None
    for key, a in by_key.items():
        if a["key_kind"] not in ("exacto", "articulo"):
            continue
        atoks = set(key.split())
        if len(atoks) < 2:
            continue
        if toks <= atoks or atoks <= toks:
            shared = len(toks & atoks)
            if shared >= 2:
                if best is None or shared > best[0]:
                    best = (shared, a)
    if best:
        a = best[1]
        return [{"artist_id": a["id"], "name": a["name"], "method": "difuso",
                 "conf": 0.80, "via_alias": a["alias"]}]
    return []


def main() -> int:
    by_key, names = load_catalog()
    posts = [json.loads(l) for l in (D / "posts.jsonl").open()]
    vids_by_post = defaultdict(list)
    for l in (D / "videos.jsonl").open():
        v = json.loads(l)
        vids_by_post[v["post_id"]].append(v)
    auds_by_post = defaultdict(list)
    for l in (D / "audios.jsonl").open():
        a = json.loads(l)
        auds_by_post[a["post_id"]].append(a)
    imgs_by_post = defaultdict(list)
    for l in (D / "images.jsonl").open():
        i = json.loads(l)
        imgs_by_post[i["post_id"]].append(i)

    out = (D / "posts_artists.jsonl").open("w")
    review = []
    unmatched: dict[str, Counter] = defaultdict(Counter)
    unmatched_examples = defaultdict(list)
    per_artist = defaultdict(lambda: {"posts": set(), "videos": set(), "audios": set(),
                                      "images": set(), "dates": [], "multi": 0})
    n_hit = 0
    for p in posts:
        pid = p["post_id"]
        found: dict[int, dict] = {}
        for cand, meth in candidates(p, vids_by_post[pid], auds_by_post[pid]):
            if not cand or not is_candidate_ok(cand):
                continue
            hits = match_one(cand, by_key)
            if not hits:
                n = norm(cand)
                unmatched[n][meth] += 1
                if len(unmatched_examples[n]) < 2:
                    unmatched_examples[n].append(pid)
                continue
            for h in hits:
                h = dict(h, via=meth, cand=cand)
                # el texto libre genera frases, no nombres: solo se acepta exacto ahí
                if h["conf"] < 0.95 and meth == "texto":
                    continue
                # las coincidencias difusas (0.80) quedan como sugerencia, no se atribuyen
                if h["conf"] < 0.95:
                    review.append({"post_id": pid, "date": p["date"][:10],
                                   "tag_o_texto": h["cand"], "via": h["via"],
                                   "artista_catalogo": h["name"],
                                   "artist_id": h["artist_id"],
                                   "metodo": h["method"], "conf": h["conf"]})
                    continue
                prev = found.get(h["artist_id"])
                if prev is None or h["conf"] > prev["conf"]:
                    found[h["artist_id"]] = h
        out.write(json.dumps({
            "post_id": pid, "post_url": p["post_url"], "date": p["date"],
            "post_type": p["post_type"], "tags": p["tags"],
            "artists": sorted(found.values(), key=lambda h: -h["conf"]),
        }, ensure_ascii=False) + "\n")
        if found:
            n_hit += 1
        for h in found.values():
            if h["conf"] < 1.0:
                review.append({"post_id": pid, "date": p["date"][:10],
                               "tag_o_texto": h["cand"], "via": h["via"],
                               "artista_catalogo": h["name"], "artist_id": h["artist_id"],
                               "metodo": h["method"], "conf": h["conf"]})
            agg = per_artist[h["artist_id"]]
            agg["name"] = h["name"]
            agg["posts"].add(pid)
            agg["dates"].append(p["date"][:10])
            for v in vids_by_post[pid]:
                if v.get("video_key"):
                    agg["videos"].add(v["video_key"])
            for a in auds_by_post[pid]:
                if a.get("url"):
                    agg["audios"].add(a["url"].split("?")[0])
            for i in imgs_by_post[pid]:
                agg["images"].add(i["url"].split("?")[0])
        if len(found) > 1:
            for aid in found:
                per_artist[aid]["multi"] += 1
    out.close()

    with (D / "match_review.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["post_id", "date", "tag_o_texto", "via",
                                           "artista_catalogo", "artist_id", "metodo", "conf"])
        w.writeheader()
        seen = set()
        for r in review:
            k = (r["post_id"], r["tag_o_texto"], r["artist_id"])
            if k in seen:
                continue
            seen.add(k)
            w.writerow(r)

    with (D / "unmatched_candidates.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["candidato", "total", "tag", "texto", "titulo", "soundcloud_mencion",
                    "ejemplo_post_id"])
        for n, c in sorted(unmatched.items(), key=lambda kv: -sum(kv[1].values())):
            titulo = sum(v for k, v in c.items() if k.startswith("titulo"))
            otros = sum(v for k, v in c.items() if k in ("soundcloud", "mencion"))
            w.writerow([n, sum(c.values()), c.get("tag", 0), c.get("texto", 0), titulo, otros,
                        ",".join(map(str, unmatched_examples[n]))])

    rows = []
    for aid, agg in per_artist.items():
        d = sorted(agg["dates"])
        rows.append({"artist_id": aid, "name": agg["name"],
                     "posts": len(agg["posts"]), "videos": len(agg["videos"]),
                     "audios": len(agg["audios"]), "images": len(agg["images"]),
                     "posts_compartidos": agg["multi"],
                     "first": d[0] if d else None, "last": d[-1] if d else None})
    rows.sort(key=lambda r: -r["posts"])
    with (D / "artist_summary.jsonl").open("w") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"posts={len(posts)} con_artista={n_hit} ({100*n_hit/len(posts):.1f}%) "
          f"artistas_catalogo={len(per_artist)} no_exactas={len(review)} "
          f"desconocidos={len(unmatched)}")
    print("top:", [(r['name'], r['posts'], r['videos'], r['audios'], r['images']) for r in rows[:15]])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
