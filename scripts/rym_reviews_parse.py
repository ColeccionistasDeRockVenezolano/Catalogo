"""Parseo único de páginas de reviews de RYM.

Lo comparten el capturador histórico (scripts/rym-reviews-captura.py) y el
capturador de la campaña 2026-10-20 (scripts/rym-reviews-bajar.py). Una sola
definición de los selectores: si RYM cambia el HTML se corrige aquí.
"""
from __future__ import annotations

import html as htmlmod
import re

RE_SHELL = re.compile(r'<div id="review_shell_std_(\d+)"')
RE_PAG = re.compile(r"/reviews/(\d+)/")
RE_TOTAL = re.compile(r"<h2>\s*([\d,]+)\s*Reviews?</h2>")
RE_USER = re.compile(r'class="review_user">\s*<a class="user" href="([^"]+)"[^>]*>([^<]*)</a>')
RE_FECHA = re.compile(r'class="review_date">\s*<a href="([^"]+)"[^>]*>\s*([^<]*?)\s*</a>')
RE_RATING = re.compile(r'class="review_rating">\s*<img[^>]*alt="([^"]*)"')
RE_VOTOS = re.compile(r'class="review_vote_count">([^<]*)<')
RE_TITULO = re.compile(r'class="review_title">([^<]*)<')
RE_TEXTO = re.compile(r'class="rendered_text">(.*?)</span>', re.S)
RE_TRACK = re.compile(
    r'track_rating_disp"><img[^>]*alt="([^"]*)"[^>]*>.*?tracklist_num">\s*(\d+)\s*<.*?'
    r'tracklist_title">\s*<span class="rendered_text">(.*?)</span>', re.S)


def limpiar_texto(h: str) -> str:
    h = re.sub(r"<br\s*/?>", "\n", h)
    h = re.sub(r"<[^>]+>", "", h)
    return htmlmod.unescape(h).strip()


def parsear_reviews(html: str):
    """Devuelve (total_declarado, [reviews])."""
    m = RE_TOTAL.search(html)
    total = int(m.group(1).replace(",", "")) if m else None
    trozos = RE_SHELL.split(html)
    out = []
    for i in range(1, len(trozos) - 1, 2):
        rid, bloque = trozos[i], trozos[i + 1]
        # recortar la review a su propio bloque: el trozo se lleva el resto del documento
        # (tracklist del disco incluido) y el rating por pista se colaba de ahí.
        bloque = re.split(r"<!-- @@_review_|<div id=\"review_shell_std_", bloque)[0]
        ru = RE_USER.search(bloque)
        rf = RE_FECHA.search(bloque)
        rr = RE_RATING.search(bloque)
        rv = RE_VOTOS.search(bloque)
        rt = RE_TITULO.search(bloque)
        sin_tracks = re.sub(r'<ul class="tracks".*?</ul>', "", bloque, flags=re.S)
        rtx = RE_TEXTO.search(sin_tracks)
        # rating por pista SOLO si la review trae su bloque propio (id ligado al review_id):
        # así no se cuela el tracklist del disco cuando la página no delimita la review.
        m_tr = re.search(rf'<div id="review_track_rating_{rid}"[^>]*>.*?</ul>', bloque, re.S)
        tracks = [
            {"rating": limpiar_texto(a).replace(" stars", ""), "num": int(b), "titulo": limpiar_texto(c)}
            for a, b, c in RE_TRACK.findall(m_tr.group(0) if m_tr else "")
        ]
        out.append({
            "review_id": int(rid),
            "usuario": ru.group(2).strip() if ru else None,
            "usuario_url": ru.group(1) if ru else None,
            "fecha": rf.group(2) if rf else None,
            "review_url": ("https://rateyourmusic.com" + rf.group(1)) if rf else None,
            "rating": (limpiar_texto(rr.group(1)).replace(" stars", "") if rr else None),
            "votos": (rv.group(1).strip() or "") if rv else "",
            "titulo": limpiar_texto(rt.group(1)) if rt else None,
            "texto": limpiar_texto(rtx.group(1)) if rtx else None,
            "tracks": tracks,
        })
    return total, out
