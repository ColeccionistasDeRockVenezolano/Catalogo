#!/usr/bin/env python3
"""RYM v4 — re-parseo OFFLINE de las páginas de RYM ya capturadas (pages/*.html).

El extractor v3 guardó .json (recorte, con un campo `info` contaminado por el
CSS/JS de la página) y además el .html completo. De ahí se saca offline, sin
volver a RYM y sin riesgo de muro:

  Por ÁLBUM (pages/rel_*.html):
    · meta description → tipo, año, sello, catalog no., formato
    · tabla Info (th.info_hdr) → Type / Released / Genres / Descriptors…
    · sellos reales: a.label[href^="/label/"] (nombre + slug → entidad RYM)
    · tracklist: nº, título, duración (segundos + texto), Total length
    · créditos generales (ul.credits) y nota de cada fila, si existen
  Por ARTISTA (pages/<slug>.html):
    · sección Info (.section_artist_info) → pares th/td (Genres, Descriptors…)
    · géneros del DOM
    · discografía listada (rows del .json) + join de sus álbumes capturados
      (por el slug de artista del path del release)

Salidas:
  reports/rym-v4-<AAAA-MM-DD>/albumes.jsonl   1 línea por álbum (todos los campos)
  reports/rym-v4-<AAAA-MM-DD>/artistas.jsonl  1 línea por artista + sus álbumes
  reports/rym-v4-<AAAA-MM-DD>/resumen.md      conteos y cobertura

Uso:
  python3 scripts/rym-v4-reparse.py [--pages DIR] [--out DIR] [--limit N]
Requiere bs4 + lxml (el python3 del sistema los tiene).
"""
import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import date

from bs4 import BeautifulSoup, Tag
from rym_reglas import norm_href, slug_artist, slug_release
from rym_release_credits import extract_credits
from rym_release_tracks import extract_tracks

DEF_PAGES = "/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/fuentes-web-2026-10-01/rym-nuevos/pages"
DEF_OUT = f"/home/brian/apps/Coleccionistas De Rock Venezolano/reports/rym-v4-{date.today().isoformat()}"


def txt(el, limit=300):
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True))[:limit] if el else None


def parse_release(html, meta):
    """Página de disco → registro limpio."""
    soup = BeautifulSoup(html, "lxml")
    out = {
        "slug": meta.get("slug"),
        "href": meta.get("href"),
        "url": "https://rateyourmusic.com" + (meta.get("href") or ""),
        "capturedAt": meta.get("capturedAt"),
        "wall": meta.get("wall"),
        "titulo": meta.get("name"),
        "artista": None,
        "artista_slug": None,
        "artista_url": None,
        "tipo": None,
        "tipo_desc": None,
        "released_text": None,
        "anio": None,
        "formato": None,
        "labels": [],
        "catalog_no": None,
        "generos": [],
        "descriptores": None,
        "pistas": [],
        "n_pistas": 0,
        "total_text": None,
        "total_seg": None,
        "creditos": [],
        "desc": None,
        "rating": None,
        "n_ratings": 0,
        "n_reviews": 0,
    }

    md = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
    md_ok = md if isinstance(md, Tag) else None
    desc = str(md_ok.get("content") or "") if md_ok else ""
    out["desc"] = desc[:600]

    m = re.search(r",\s+an?\s+(.+?)\s+by\s", desc)
    if m:
        out["tipo_desc"] = m.group(1).strip()[:40]
    m = re.search(r"Released\s+([^.;]{2,60})", desc)
    if m:
        rel = m.group(1).strip()
        out["released_text"] = rel
        ya = re.search(r"\b(18|19|20)\d{2}\b", rel)
        if ya:
            out["anio"] = int(ya.group(0))
    m = re.search(r"catalog no\.\s*([^;)]+)", desc)
    if m:
        out["catalog_no"] = m.group(1).strip()[:40]
    m = re.search(r";\s*([^)]{2,40})\)", desc)
    if m:
        out["formato"] = m.group(1).strip()

    # tabla Info del body
    info = {}
    for tr in [t for t in soup.find_all("tr") if isinstance(t, Tag)]:
        th = tr.find("th", class_="info_hdr")
        td = tr.find("td")
        if th is not None and td is not None:
            k = txt(th, 60)
            if k and k not in info:
                info[k] = txt(td, 300)
    if info.get("Type"):
        out["tipo"] = info["Type"][:40]
    if not out["released_text"] and info.get("Released"):
        out["released_text"] = info["Released"]
        ya = re.search(r"\b(18|19|20)\d{2}\b", info["Released"] or "")
        if ya and not out["anio"]:
            out["anio"] = int(ya.group(0))
    if not out["tipo"] and out["tipo_desc"]:
        out["tipo"] = out["tipo_desc"]
    if info.get("Descriptors"):
        out["descriptores"] = info["Descriptors"][:200]

    # artista principal
    a = soup.select_one('.release_page_header a[href^="/artist/"], a.artist[href^="/artist/"], a[href^="/artist/"]')
    if a:
        out["artista"] = txt(a, 140)
        out["artista_url"] = a.get("href")
    m = re.match(r"/release/[^/]+/([^/]+)/", meta.get("href") or "")
    if m:
        out["artista_slug"] = m.group(1)

    # sellos (entidad RYM real)
    seen = set()
    for a in soup.select('a.label[href^="/label/"]'):
        nom = txt(a, 80)
        if not nom or nom.lower() in ("n/a", "na"):
            continue
        if nom not in seen:
            seen.add(nom)
            out["labels"].append({"nombre": nom, "slug": str(a.get("href") or "").strip("/").split("/")[-1]})

    # géneros desde el DOM
    g = []
    for a in soup.select('.release_genres a[href^="/genre/"], a[href^="/genre/"]'):
        t = txt(a, 60)
        if t and t not in g:
            g.append(t)
    out["generos"] = g[:20]

    # puntuación agregada de RYM (media sobre 5 y nº de puntuaciones) y contador de reviews
    avg = soup.select_one("span.avg_rating")
    if avg is not None:
        m = re.fullmatch(r"\s*([0-5](?:\.\d+)?)\s*", avg.get_text())
        out["rating"] = float(m.group(1)) if m else None
    num = soup.select_one("span.num_ratings")
    if num is not None:
        m = re.search(r"([\d.,]+)", num.get_text())
        out["n_ratings"] = int(re.sub(r"[.,]", "", m.group(1))) if m else 0
    mh = re.search(r"<h2[^>]*>\s*([\d,]+)\s*Reviews?", html, re.I)
    if mh:
        out["n_reviews"] = int(mh.group(1).replace(",", ""))

    out.update(extract_tracks(html))

    # créditos generales
    out['creditos'] = extract_credits(html)

    return out


def parse_artist(html, meta):
    """Página de artista → registro limpio (info + géneros; discos se juntan después)."""
    soup = BeautifulSoup(html, "lxml")
    out = {
        "slug": meta.get("slug"),
        "href": meta.get("href"),
        "url": "https://rateyourmusic.com" + (meta.get("href") or ""),
        "nombre": meta.get("name"),
        "formed": meta.get("formed"),
        "foto": meta.get("photo"),
        "og": meta.get("og"),
        "generos": meta.get("genres") or [],
        "info": {},
        "generos_dom": [],
        "n_listados": len(meta.get("rows") or []),
        "discografia_listada": meta.get("rows") or [],
        "n_albumes_capturados": 0,
        "albumes": [],
        "wall": meta.get("wall"),
    }
    cont = soup.select_one(".artist_info_main") or soup.select_one(".artist_info")
    if cont is not None:
        key = None
        for it in [t for t in cont.find_all(recursive=False) if isinstance(t, Tag)]:
            cl = " ".join(str(c) for c in (it.get("class") or []))
            if "info_hdr" in cl:
                key = txt(it, 60)
            elif "info_content" in cl and key:
                val = txt(it, 8000 if key in ('Members', 'Also Known As') else 1000)
                if val and key not in out["info"]:
                    out["info"][key] = val
                key = None
    g = list(out["generos"])
    for a in soup.select('a[href^="/genre/"]'):
        t = txt(a, 60)
        if t and t not in g:
            g.append(t)
    out["generos_dom"] = g[:20]
    return out


def refresh_track_summaries(out, albums):
    """Keep artist projections and coverage consistent after a track-only reparse."""
    from rym_reglas import escribir_atomico
    artists_path = os.path.join(out, 'artistas.jsonl')
    artists = [json.loads(line) for line in open(artists_path, encoding='utf-8') if line.strip()]
    by_url = {norm_href(album['url']): album for album in albums}
    for artist in artists:
        for projected in artist.get('albumes', []):
            source = by_url.get(norm_href(projected['url']))
            if source:
                for field in ('n_pistas', 'total_seg'):
                    projected[field] = source[field]
    escribir_atomico(artists_path, ''.join(json.dumps(artist, ensure_ascii=False)+'\n' for artist in artists))
    summary_path = os.path.join(out, 'resumen.md')
    if os.path.exists(summary_path):
        tracks = [track for album in albums for track in album['pistas']]
        seconds = sum(track.get('seg') or 0 for track in tracks)
        replacement = f'- pistas: {len(tracks)} (con duración: {sum(bool(track.get("seg")) for track in tracks)}) · duración acumulada: {seconds // 3600} h {(seconds % 3600) // 60} min'
        with open(summary_path, encoding='utf-8') as source:
            lines = source.read().splitlines()
        lines = [replacement if line.startswith('- pistas:') else line for line in lines]
        escribir_atomico(summary_path, '\n'.join(lines)+'\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", default=DEF_PAGES)
    ap.add_argument("--out", default=DEF_OUT)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument('--credits-only', action='store_true', help='Reanudar solo extracción de créditos sobre el reparseo existente')
    ap.add_argument('--tracks-only', action='store_true', help='Reanudar solo títulos, posiciones y duraciones sobre el reparseo existente')
    ap.add_argument('--attributes-only', action='store_true', help='Recuperar características documentadas de publicación sin cambiar pistas ni créditos')
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    if args.attributes_only:
        from lxml import html as lxml_html
        from rym_release_tracks import publication_attributes
        from rym_reglas import escribir_atomico
        albums_path = os.path.join(args.out, 'albumes.jsonl')
        albums = [json.loads(line) for line in open(albums_path, encoding='utf-8') if line.strip()]
        for album in albums:
            with open(os.path.join(args.pages, album['slug']+'.html'), encoding='utf-8') as source:
                album['publication_attributes'] = publication_attributes(lxml_html.fromstring(source.read()))
        escribir_atomico(albums_path, ''.join(json.dumps(album, ensure_ascii=False)+'\n' for album in albums))
        print(f'Características de publicación recuperadas: {sum(bool(album["publication_attributes"]) for album in albums)} de {len(albums)}')
        return
    if args.tracks_only:
        from rym_reglas import escribir_atomico
        albums_path = os.path.join(args.out, 'albumes.jsonl')
        albums = [json.loads(line) for line in open(albums_path, encoding='utf-8') if line.strip()]
        changed = 0
        for album in albums:
            filename = os.path.join(args.pages, album['slug']+'.html')
            with open(filename, encoding='utf-8') as source:
                tracks = extract_tracks(source.read())
            if tracks['pistas'] != album['pistas']:
                changed += 1
            album.update(tracks)
        escribir_atomico(albums_path, ''.join(json.dumps(album, ensure_ascii=False)+'\n' for album in albums))
        refresh_track_summaries(args.out, albums)
        print(f'Pistas reextraídas de {len(albums)} publicaciones; {changed} listados actualizados; {sum(album["n_pistas"] for album in albums)} filas conservadas')
        return
    if args.credits_only:
        from rym_reglas import escribir_atomico
        albums_path = os.path.join(args.out,'albumes.jsonl')
        albums = [json.loads(line) for line in open(albums_path,encoding='utf-8') if line.strip()]
        for album in albums:
            filename = os.path.join(args.pages,album['slug']+'.html')
            with open(filename,encoding='utf-8') as source:
                album['creditos'] = extract_credits(source.read())
        escribir_atomico(albums_path, ''.join(json.dumps(album,ensure_ascii=False)+'\n' for album in albums))
        artists_path = os.path.join(args.out,'artistas.jsonl')
        artists = [json.loads(line) for line in open(artists_path,encoding='utf-8') if line.strip()]
        counts = {norm_href(album['url']):len(album['creditos']) for album in albums}
        for artist in artists:
            for album in artist.get('albumes',[]):
                album['n_creditos'] = counts.get(norm_href(album['url']),album.get('n_creditos',0))
        escribir_atomico(artists_path,''.join(json.dumps(artist,ensure_ascii=False)+'\n' for artist in artists))
        print(f'Créditos reextraídos de {len(albums)} publicaciones: {sum(len(album["creditos"]) for album in albums)} filas con alcance, sin duplicados de presentación')
        return
    names = sorted(fn for fn in os.listdir(args.pages) if fn.endswith(".json"))

    metas = {}
    for fn in names:
        slug = fn[:-5]
        try:
            d = json.load(open(os.path.join(args.pages, fn), encoding="utf-8"))
        except Exception:
            continue
        rec = d.get("rec") or {}
        metas[slug] = {
            "slug": slug,
            "href": d.get("href"),
            "capturedAt": d.get("capturedAt"),
            "kind": rec.get("kind") or ("release" if slug.startswith("rel_") else "artist"),
            "name": rec.get("name"),
            "formed": rec.get("formed"),
            "photo": rec.get("photo") if isinstance(rec.get("photo"), str) else ((rec.get("photo") or {}).get("src") if rec.get("photo") else None),
            "og": rec.get("og"),
            "genres": rec.get("genres") or [],
            "rows": rec.get("rows") or [],
            "wall": rec.get("wall"),
        }

    # Canonical URL is the identity. Legacy filenames remain on disk for old
    # evidence links but cannot create duplicate publications in a reparse.
    by_href = {}
    for meta in metas.values():
        href = norm_href(meta.get('href'))
        if not href:
            continue
        expected = slug_release(href) if meta['kind']=='release' else slug_artist(href)
        if href not in by_href or meta['slug']==expected:
            by_href[href] = meta
    metas = {meta['slug']:meta for meta in by_href.values()}
    albumes, artistas, errores = [], {}, []
    rel_metas = [m for m in metas.values() if m["kind"] == "release"]
    art_metas = [m for m in metas.values() if m["kind"] == "artist"]
    if args.limit:
        rel_metas = rel_metas[: args.limit]
        art_metas = art_metas[: args.limit]
    print(f"metas: {len(metas)} | releases: {len(rel_metas)} | artistas: {len(art_metas)}", flush=True)

    for i, m in enumerate(rel_metas, 1):
        hp = os.path.join(args.pages, m["slug"] + ".html")
        if not os.path.exists(hp):
            continue
        try:
            html = open(hp, encoding="utf-8", errors="replace").read()
            albumes.append(parse_release(html, m))
        except Exception as exc:
            errores.append((m["slug"], str(exc)[:120]))
        if i % 500 == 0:
            print(f"  releases parseados: {i}", flush=True)

    por_artista = {}
    for alb in albumes:
        if alb.get("artista_slug"):
            por_artista.setdefault(alb["artista_slug"], []).append(alb)

    for m in art_metas:
        hp = os.path.join(args.pages, m["slug"] + ".html")
        art = parse_artist(open(hp, encoding="utf-8", errors="replace").read(), m) if os.path.exists(hp) else parse_artist("<html></html>", m)
        artist_path_slug = norm_href(m['href']).removeprefix('/artist/')
        mis = por_artista.get(artist_path_slug, [])
        art["n_albumes_capturados"] = len(mis)
        art["albumes"] = [
            {
                "titulo": a["titulo"], "anio": a["anio"], "tipo": a["tipo"],
                "labels": [l["nombre"] for l in a["labels"]], "catalog_no": a["catalog_no"],
                "n_pistas": a["n_pistas"], "total_seg": a["total_seg"], "url": a["url"],
                "n_creditos": len(a["creditos"]),
            }
            for a in mis
        ]
        artistas[m["slug"]] = art

    huerfanos = [a for a in albumes if not a.get("artista_slug") or a["artista_slug"] not in artistas]

    def jl(path, rows):
        with open(path, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")

    jl(os.path.join(args.out, "albumes.jsonl"), albumes)
    jl(os.path.join(args.out, "artistas.jsonl"), list(artistas.values()))

    n_pistas = sum(a["n_pistas"] for a in albumes)
    con_seg = sum(1 for a in albumes for p in a["pistas"] if p["seg"])
    tot_seg = sum(p["seg"] or 0 for a in albumes for p in a["pistas"])
    con_lb = sum(1 for a in albumes if a["labels"])
    con_cat = sum(1 for a in albumes if a["catalog_no"])
    con_anio = sum(1 for a in albumes if a["anio"])
    con_tipo = sum(1 for a in albumes if a["tipo"])
    con_total = sum(1 for a in albumes if a["total_seg"])
    top_lb = Counter(l["nombre"] for a in albumes for l in a["labels"])

    res = []
    res.append(f"# RYM v4 — re-parseo offline ({date.today().isoformat()})")
    res.append("")
    res.append(f"- páginas origen: `{args.pages}`")
    res.append(f"- artistas: **{len(artistas)}** con página · álbumes parseados: **{len(albumes)}** · huérfanos (sin artista local): {len(huerfanos)} · errores: {len(errores)}")
    res.append(f"- pistas: {n_pistas} (con duración: {con_seg}) · duración acumulada: {tot_seg // 3600} h {(tot_seg % 3600) // 60} min")
    res.append(f"- álbumes con año: {con_anio} · con tipo: {con_tipo} · con sello: {con_lb} · con catalog no.: {con_cat} · con total de duración: {con_total}")
    res.append("")
    res.append("## Top sellos (por nº de discos)")
    for k, v in top_lb.most_common(20):
        res.append(f"- {k}: {v}")
    if errores:
        res.append("")
        res.append("## Errores")
        for s, e in errores[:20]:
            res.append(f"- {s}: {e}")
    with open(os.path.join(args.out, "resumen.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(res) + "\n")

    print("\n".join(res))
    print(f"\nescrito en {args.out}", flush=True)


if __name__ == "__main__":
    main()
