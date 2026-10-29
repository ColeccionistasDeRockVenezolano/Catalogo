#!/usr/bin/env python3
"""Cruza la captura de antologiavenezuela.blogspot.com contra el catálogo CRV.

Uso:
    python3 scripts/antologia-blogspot-cruce.py [--csv reports/...]

Lee `data/raw/antologiavenezuela-blogspot/posts.jsonl` (captura con la skill
blogger-blog-capture), parsea cada ficha (`ARTISTA - DISCO (AÑO) SELLO CATÁLOGO` +
tracklist tema/género/compositor/intérprete) y la cruza con la base `crv`:

  * artista emparejado (exacto, compacto, variante, fuzzy) y disco ya fichado
  * artista emparejado y disco candidato nuevo (validado contra el repertorio ya
    fichado del artista: descarta reediciones y "éxitos" con otro título)
  * artista sin coincidencia

Escribe un CSV con los discos nuevos del eje rock/pop y un resumen por consola.
"""
import argparse
import collections
import csv
import difflib
import json
import os
import re
import subprocess
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAPTURE = os.path.join(ROOT, "data/raw/antologiavenezuela-blogspot/posts.jsonl")
PSQL = ["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-t", "-A", "-F", "\x1f", "-c"]
ART = re.compile(r"^(la|las|los|el|the)\s+")
TRACK_RE = re.compile(r"(?:(?<=^)|(?<=\s))(\d{1,2})\s*[.\-–]\s*")
ROCK = re.compile(r"rock|pop|beat|punk|metal|ska|reggae|alternativ|indie|grunge|hardcore|new wave", re.I)
TRAD = re.compile(r"tradicional|folklor|llaner|salsa|bolero|balada|gaita|merengue|tropical|joropo|son\b|navide|aguinaldo", re.I)
VA = re.compile(r"^(v a|va|varios|varios interpretes|vv aa|artistas varios|sin sonido)$")


def q(sql):
    r = subprocess.run(PSQL + [sql], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("psql: " + r.stderr[:400])
    return [l.split("\x1f") for l in r.stdout.splitlines() if l.strip()]


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("&", " y ")
    s = re.sub(r"\b(y|and|e)\b", " ", s)
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s)).strip()


def keys(name):
    """Claves de emparejamiento: con/sin artículo, singular, sin 'y su orquesta'…"""
    b = norm(name)
    out = []
    for cand in (b, ART.sub("", b)):
        c = cand[:-1] if cand.endswith("s") else cand
        for v in (cand, c, re.sub(r"\s+(y\s+)?su(s)?\s+(orquesta|conjunto|grupo|combo|banda)$", "", c).strip()):
            if v:
                out += [v, v.replace(" ", "")]
    return list(dict.fromkeys(out))


def parse_title(title):
    t = re.sub(r"\s+", " ", title or "").strip()
    m = re.match(r"^(.*?)\s+-\s+(.*)$", t)
    artist, rest = (m.group(1).strip(), m.group(2).strip()) if m else ("", t)
    year, label_raw = None, None
    ym = re.search(r"\((\d{4})(?:\s*[-/]\s*\d{4})?\)", rest)
    if ym:
        year = int(ym.group(1))
        album = rest[: ym.start()].strip(" -")
        label_raw = rest[ym.end():].strip(" -,") or None
    else:
        album = rest
        ym2 = re.search(r"\s(\d{4})$", rest)
        if ym2:
            year = int(ym2.group(1))
            album = rest[: ym2.start()].strip(" -")
    return artist, album, year, label_raw


def parse_tracks(text):
    """Preserve explicit CD/disc boundaries instead of losing repeated positions."""
    headings = list(re.finditer(r"(?im)^[ \t]*(?:CD|Disco)[ \t]+(\d+)[ \t]*:?[ \t]*$", text or ""))
    if not headings:
        return [dict(row, disc=1) for row in _parse_track_disc(text)]
    out = []
    prefix = (text or "")[:headings[0].start()]
    out.extend(dict(row, disc=1) for row in _parse_track_disc(prefix))
    for i, heading in enumerate(headings):
        disc = int(heading.group(1))
        body = text[heading.end():headings[i + 1].start() if i + 1 < len(headings) else len(text)]
        # A documented variant writes «12.-1 Dulce Cantar» for CD 1.
        # Only strip the suffix when it agrees with the explicit disc heading.
        body = re.sub(r"(?m)^(\s*\d{1,2}\s*\.-)" + str(disc) + r"(?=\s)", r"\1", body)
        out.extend(dict(row, disc=disc) for row in _parse_track_disc(body))
    return out


def _parse_track_disc(text):
    """Tema, género entrecomillado, compositor entre paréntesis e intérprete.

    El blog escribe `1.- Tema "Género" (Compositor) Canta: Fulano`. Ninguno de los
    tres campos es obligatorio: hay fichas sin género, sin compositor y sin
    intérprete. El último paréntesis de la línea se toma como compositor salvo que
    sea una aclaración de edición (`Parte 1`, `Versión ...`), y se conserva el
    texto crudo en `raw` para poder auditar el recorte.
    """
    # Keep evidence that a word was a standalone heading before flattening lines.
    # A song called «Los Músicos» must not be truncated just for containing that word.
    t = (text or "").replace("Nuevo Reproductor", " ")
    t = re.sub(r"(?im)^[ \t]*(?:Integrantes|M[uú]sicos|Cr[eé]ditos|Personal|Formaci[oó]n)[ \t]*:?[ \t]*$",
               lambda m: "\ufff0" + m.group(0), t)
    t = re.sub(r"\s+", " ", t)
    t = re.split(r"Archivos? (?:Cedidos?|Digitalizados?|de|Subidos?)|(?:Enviado|Subido) Por\s*:|Fuente:|Cortes[ií]a de|Agradec", t, maxsplit=1, flags=re.I)[0]
    marks = list(TRACK_RE.finditer(t))
    technical_start = t.find("\ufff0")
    if technical_start >= 0:
        marks = [m for m in marks if m.start() < technical_start]
    out = []
    expected = int(marks[0].group(1)) if marks else 1
    for i, m in enumerate(marks):
        num = int(m.group(1))
        # El blog numera 1..N; algunas fichas se saltan un número (4, 6…). Se
        # acepta el salto corto y se conserva el número de la fuente como
        # posición real de la pista.
        if not (expected <= num <= expected + 3):
            continue
        chunk = t[m.end(): marks[i + 1].start() if i + 1 < len(marks) else len(t)].strip(" .-–")
        if len(chunk) < 2:
            expected = num + 1
            continue
        expected = num + 1
        raw = chunk.replace("\ufff0", "")
        # Cola de créditos pegada al último tema: "… Integrantes: Voz: … Bajo: …".
        # Se corta antes de parsear para no convertir la ficha técnica en título.
        # Technical blocks are metadata even when the author omits the colon,
        # and even when the resulting corrupt title would be shorter than 120.
        # Require preceding whitespace: a numbered track named «Créditos» remains a track.
        boundary = re.search(r"\s+(?:\ufff0|Integrantes\s*:|M[uú]sicos\s*:|Personal\s*:|Cr[eé]ditos\s*:|"
                             r"Formaci[oó]n\s*:|Acompa[ñn]antes\s*:|Acompa[ñn]amiento\s*:|"
                             r"Conjunto\s*:|Todas Las Pistas\b|Todos Los Temas\b|Autor De Todos Los Temas\b|"
                             r"Cantantes?(?: Invitados?)?\s*:|Invitad[oa]s? Especial(?:es)?\s*:|Con Agrupaci[oó]n\s*:|"
                             r"Acompañado Por Su Quinteto\b|Aesor Musical\b|"
                             r"(?:Bajo Y Cuatro|Guitarra, Voz|Violín|Arr\.)\s*:)", chunk, re.I)
        technical_credits = chunk[boundary.start():].replace("\ufff0", "").strip() if boundary else None
        if boundary:
            chunk = chunk[:boundary.start()].strip()
        performer = None
        pm = re.search(r"\b(?:Cantan|Canta|Interpretan|Interpreta|Int[ée]rprete|Interprete)\b\s*:\s*(.+)$", chunk, re.I)
        if pm:
            performer = re.split(r"\s{2,}", pm.group(1))[0].strip(" .;,")
            chunk = chunk[: pm.start()].strip(" .-–")
        genre = None
        qm = re.search(r"[“\"]([^”\"]{2,40})[”\"]", chunk)
        if qm:
            genre = qm.group(1).strip()
            chunk = (chunk[: qm.start()] + " " + chunk[qm.end():]).strip(" .-–")
        composer = None
        parens = list(re.finditer(r"\(([^()]{2,60})\)", chunk))
        if parens:
            last = parens[-1]
            cand = last.group(1).strip()
            if (re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]", cand)
                    and not re.match(r"^(parte|part\.?|vol|v\d+|n[ºo°]|version|versión|en vivo|remix|instrumental|vocal|bonus|tema|pista)\b", cand, re.I)
                    and not re.fullmatch(r"(19|20)\d{2}", cand)):
                composer = cand
                chunk = (chunk[: last.start()] + " " + chunk[last.end():]).strip(" .-–")
        title = re.sub(r"\s+", " ", chunk).strip(" .-–")
        if len(title) > 120:
            # Bloque de músicos sin la palabra «Integrantes»: cortar en el primer rol.
            title = re.split(r"\b(?:Voz|Voces|Bajo|Bater[ií]a|Guitarra|Piano|Teclados?|Samplers?|Saxo|"
                             r"Flauta|Percusi[oó]n|Coros?|Trompeta|Tromb[oó]n|Viol[ií]n|Cuatro|Maracas|"
                             r"Arpa|Contrabajo|Cantante|Director|Arreglos?|Producci[oó]n)\s*:", title, maxsplit=1)[0]
            title = re.sub(r"\s+", " ", title).strip(" .-–")
        out.append({"n": num, "title": title, "genre": genre,
                    "composer": composer, "performer": performer, "raw": raw,
                    "technical_credits": technical_credits})
    return out


def load_db():
    artists = q("select id,name from artists")
    idx = collections.defaultdict(list)
    for aid, name in artists:
        for k in keys(name):
            idx[k].append((int(aid), name))
    albums = collections.defaultdict(dict)
    for aid, art, title, yr, lab, cat, cov, ntr in q(
            "select a.id,a.artist_id,a.title,coalesce(a.release_year::text,''),coalesce(a.label_id::text,''),"
            "coalesce(a.catalog_id,''),coalesce(a.cover_url,''),coalesce((select count(*) from tracks t "
            "where t.album_id=a.id),0) from albums a"):
        rec = {"id": int(aid), "title": title, "year": yr, "label": lab, "catalog": cat, "cover": cov, "tracks": int(ntr)}
        for k in keys(title):
            albums[int(art)].setdefault(k, rec)
    tracks = collections.defaultdict(lambda: collections.defaultdict(set))
    for row in q("select a.artist_id,t.album_id,t.title from tracks t join albums a on a.id=t.album_id"):
        tracks[int(row[0])][int(row[1])].add(norm(row[2]))
    labels = []
    for lid, name in q("select id,name from organizations where organization_type='record_label'"):
        labels.append((int(lid), name, norm(name)))
    return artists, idx, albums, tracks, labels


def find_label(raw, labels):
    k = norm(raw)
    if not k:
        return None, None
    words = k.split()
    for n in range(min(6, len(words)), 0, -1):
        cand = " ".join(words[:n])
        for lid, name, key in labels:
            if key == cand:
                return (lid, name), " ".join(words[n:]).upper() or None
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=os.path.join(ROOT, "reports/2026-10-26-antologia-discos-nuevos-rock.csv"))
    args = ap.parse_args()
    rows = [json.loads(l) for l in open(CAPTURE, encoding="utf-8")]
    artists, idx, albums, tracks, labels = load_db()

    recs = []
    for r in rows:
        artist, album, year, label_raw = parse_title(r.get("title"))
        tr = parse_tracks(r.get("content_text"))
        rec = {"id": r.get("id"), "url": r.get("url"), "title": r.get("title"), "categories": r.get("categories"),
               "artist_raw": artist, "album": album, "album_norm": norm(album), "year": year,
               "n_tracks": len(tr), "tracks": tr}
        hit = tier = None
        ks = keys(artist) or [""]
        for i, k in enumerate(ks):
            if k in idx:
                hit, tier = idx[k][0], "exacto" if i == 0 else "variante"
                break
        if not hit and len(ks[0]) >= 6:
            pre = ks[0].replace(" ", "")[:4]
            pool = [p for p in idx if p.replace(" ", "").startswith(pre)]
            m = difflib.get_close_matches(ks[0].replace(" ", ""), [p.replace(" ", "") for p in pool], n=1, cutoff=0.94)
            if m:
                hit, tier = idx[pool[[p.replace(" ", "") for p in pool].index(m[0])]][0], "fuzzy"
        rec.update(artist_id=hit[0] if hit else None, artist_name=hit[1] if hit else None, tier=tier,
                   album_id=None, album_db=None, album_tracks_db=None, label_id=None, catalog=None)
        if hit:
            for k in keys(album):
                a = albums[hit[0]].get(k)
                if a:
                    rec.update(album_id=a["id"], album_db=a["title"], album_tracks_db=a["tracks"])
                    break
        lab, code = find_label(label_raw, labels)
        if lab:
            rec["label_id"], rec["label_name"] = lab
        rec["catalog"] = code
        if not rec["catalog"] and label_raw:
            m = re.search(r"\b([A-Z]{2,4}[\s.\-]*\d[\w.\-/]*)", label_raw, re.I)
            rec["catalog"] = m.group(1).upper() if m else None
        cats = " ".join(r.get("categories") or []) + " " + (album or "")
        rec["bucket"] = "rock/pop" if ROCK.search(cats) else ("tradicional/otro" if TRAD.search(cats) else "sin etiqueta")
        recs.append(rec)

    # validar candidatos nuevos contra el repertorio del propio artista
    for r in recs:
        if r["album_id"] or not r["artist_id"]:
            continue
        bt = {norm(t["title"]) for t in r["tracks"] if t.get("title")}
        best, score = None, 0.0
        for aid, s in tracks.get(r["artist_id"], {}).items():
            if s:
                sc = len(bt & s) / max(len(bt), len(s))
                if sc > score:
                    best, score = aid, sc
        title_db = next((a["title"] for a in albums.get(r["artist_id"], {}).values() if a["id"] == best), "")

        def clean(t):
            t = re.sub(r"\b(vol|volume|volumen|cd|disc|disco|edicion|especial|remasterizado|serie)\b", " ", norm(t))
            return re.sub(r"\s+", " ", t).strip()

        sim = difflib.SequenceMatcher(None, clean(r["album"]), clean(title_db)).ratio()
        r["dup_score"] = round(score, 3)
        r["dup"] = score >= 0.9 or sim >= 0.85 or (score >= 0.6 and sim >= 0.6)
        r["dup_title"] = title_db

    st = collections.Counter()
    for r in recs:
        st["disco_en_BD" if r["album_id"] else ("disco_nuevo" if r["artist_id"] else "artista_fuera")] += 1
    nuevos = [r for r in recs if r["artist_id"] and not r["album_id"] and not r["dup"]]
    dudosos = [r for r in recs if r["artist_id"] and not r["album_id"] and not r["dup"] and r.get("dup_score", 0) >= 0.6]
    rock = [r for r in nuevos if r["bucket"] == "rock/pop"]

    print(f"posts: {len(recs)} | pistas parseadas: {sum(r['n_tracks'] for r in recs)}")
    print("estado:", dict(st))
    print(f"discos nuevos validados: {len(nuevos)} ({sum(r['n_tracks'] for r in nuevos)} pistas) "
          f"| descartados por duplicado: {sum(1 for r in recs if r['artist_id'] and not r['album_id'] and r['dup'])}"
          f" | comparten 60-90% de repertorio (revisar): {len(dudosos)}")
    print(f"  rock/pop: {len(rock)} discos / {sum(r['n_tracks'] for r in rock)} pistas")
    for b in ("rock/pop", "tradicional/otro", "sin etiqueta"):
        sub = [r for r in nuevos if r["bucket"] == b]
        print(f"    {b:18s} {len(sub):4d} discos / {sum(x['n_tracks'] for x in sub):5d} pistas / "
              f"{len({x['artist_id'] for x in sub})} artistas")

    os.makedirs(os.path.dirname(args.csv), exist_ok=True)
    with open(args.csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["artist_crv", "artist_blog", "album", "year", "sello", "catalogo", "pistas", "url"])
        for r in sorted(rock, key=lambda x: (x["artist_name"], x["year"] or 0)):
            w.writerow([r["artist_name"], r["artist_raw"], r["album"], r["year"] or "",
                        r.get("label_name") or "", r["catalog"] or "", r["n_tracks"], r["url"]])
    print("csv:", args.csv)


if __name__ == "__main__":
    main()
