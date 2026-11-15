#!/usr/bin/env python3
"""CRV · Lectura normalizada de Lobotoradio para la absorción del 2026-11-12.

Parte de la relectura del cotejo (`reports/lobotoradio-cotejo-2026-10-26/reparsed`,
con membresías recuperadas) y corrige lo que esa lectura no resolvía:

  · nombre vacío cuando el encabezado es el logo de la banda (30 bandas y
    6 personas): se toma del índice del sitio o del <title>;
  · logo de banda/persona (`img.artist-logo`), que la descarga no bajó;
  · biografías basura (restos del nombre, «test»);
  · fechas «22 abril 1990 (Caracas, …)» → valor ISO parcial + lugar;
  · periodos de membresía literales «(2009–Presente)»;
  · créditos «rol, rol : Nombre (A1, B2), Nombre» → pares rol/nombre/enlace.

Solo lee. Escribe `fichas.json` en el directorio que recibe.
  python3 scripts/lobotoradio-absorb-parse.py OUT_DIR
"""
import gzip
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data/raw/lobotoradio-2026-10-26"
REPARSED = ROOT / "reports/lobotoradio-cotejo-2026-10-26/reparsed"
MEDIA = ROOT / "tmp-analysis/lobotoradio-2026-10-26/media.jsonl"
OUT = Path(sys.argv[1])

MONTHS = {m: i for i, m in enumerate(
    "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split(), 1)}
KIND_DIR = {"banda": "bandas", "artist": "artistas", "release": "discos", "empresa": "empresa", "event": "events"}
TEST_SLUGS = {"artists-test"}
# Nombre estilizado en la ficha; la biografía da la grafía normal (la estilizada queda de alias).
STYLIZED = {"epoca-de-recluta": "Época de Recluta"}


def rows(name):
    return [json.loads(line) for line in (REPARSED / f"{name}.ndjson").open(encoding="utf-8")]


def html_of(kind, slug):
    path = RAW / KIND_DIR[kind] / f"{slug}.html.gz"
    return gzip.decompress(path.read_bytes()).decode("utf-8", "replace") if path.exists() else ""


def logo_of(html):
    m = re.search(r'<img[^>]+src="([^"]+)"[^>]*class="artist-logo"', html) or re.search(r'class="artist-logo"[^>]*src="([^"]+)"', html)
    return m.group(1) if m else None


def name_of(rec):
    name = (rec.get("name") or rec.get("h1") or "").strip()
    if name:
        return name
    if (rec.get("idx_name") or "").strip():
        return rec["idx_name"].strip()
    return re.sub(r"\s*[–-]\s*Lobotoradio\s*$", "", rec.get("title_tag") or "").replace("&#8211;", "–").strip()


def parse_date(raw):
    """«22 abril 1990 (Caracas, Distrito Capital, Venezuela)» → ('1990-04-22', 'Caracas, Distrito Capital, Venezuela')."""
    if not raw:
        return None, None
    place = None
    m = re.search(r"\(([^)]*)\)\s*$", raw)
    if m:
        place = m.group(1).strip()
        raw = raw[: m.start()].strip()
        if re.match(r"(?i)lugar desconocido", place):
            place = None
    value = None
    m = re.match(r"(?i)^(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})$", raw)
    if m and m.group(2).lower() in MONTHS:
        value = f"{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    else:
        m = re.match(r"(?i)^([a-záéíóú]+)\s+(\d{4})$", raw)
        if m and m.group(1).lower() in MONTHS:
            value = f"{m.group(2)}-{MONTHS[m.group(1).lower()]:02d}"
        elif re.match(r"^\d{4}$", raw):
            value = raw
    if value and not 1850 <= int(value[:4]) <= 2026:
        value = None  # «7 noviembre 0000»: fecha de relleno del sitio
    return value, place


def period(tail):
    """«(2009–Presente),» → {'from': 2009, 'to': None, 'current': True, 'raw': '2009–Presente'}."""
    m = re.search(r"\(([^)]*)\)", tail or "")
    if not m:
        return None
    raw = m.group(1).strip()
    years = [int(y) for y in re.findall(r"(?<!\d)(1[89]\d\d|20[0-3]\d)(?!\d)", raw)]
    current = bool(re.search(r"(?i)presente|actualidad", raw))
    if not years:
        return {"raw": raw, "from": None, "to": None, "current": current}
    spans = re.split(r"\s*,\s*", raw)
    return {"raw": raw, "from": min(years), "to": None if current else max(years), "current": current, "spans": len(spans)}


def meta_links(rec, label):
    for row in rec.get("meta_order") or []:
        if row["label"] == label:
            return row.get("links") or []
    return []


def clean_bio(bio, name):
    bio = (bio or "").strip()
    if len(bio) < 80 or bio.lower() in {"test", "new test"}:
        return None
    return bio


def years_of(raw):
    years = [int(y) for y in re.findall(r"(?<!\d)(1[89]\d\d|20[0-3]\d)(?!\d)", raw or "")]
    return (min(years) if years else None), (None if re.search(r"(?i)presente", raw or "") or not years or len(years) < 2 else max(years))


media = {}
for line in MEDIA.open(encoding="utf-8"):
    item = json.loads(line)
    if item.get("status") == 200:
        media.setdefault((item["kind"], item["slug"], item["role"]), []).append(item)


def local(kind, slug, role):
    return [{"url": m["url"], "file": f"raw/lobotoradio-2026-10-26/{m['file']}", "sha256": m["sha256"]} for m in media.get((kind, slug, role), [])]


def person_like(rec, kind):
    html = html_of(kind, rec["slug"])
    meta = rec.get("meta") or {}
    links = {row["label"]: row.get("links") or [] for row in rec.get("meta_order") or []}
    born, born_place = parse_date(meta.get("nacimiento"))
    died, died_place = parse_date(meta.get("fallecimiento"))
    tipo = meta.get("tipo") or ""
    gender = {"(M)": "male", "(F)": "female"}.get((re.search(r"\([A-Z]\)", tipo) or [None])[0] or "", None) if kind == "artist" else None
    stylized = STYLIZED.get(rec["slug"]) if kind == "banda" else None
    groups = []
    for link in links.get("bandas" if kind == "artist" else "miembros", []):
        groups.append({"name": link["text"].strip(), "url": link["href"].rstrip("/"), "period": period(link.get("tail"))})
    formed, ended = years_of(meta.get("duración"))
    return {
        "kind": kind, "slug": rec["slug"], "url": rec["url"].rstrip("/"), "name": stylized or name_of(rec),
        "headlineWasLogo": not (rec.get("name") or "").strip(),
        "fullName": (meta.get("nombre completo") or "").strip() or None,
        "aliases": [a.strip() for a in re.split(r"\s*,\s*", meta.get("alias") or "") if a.strip()] + ([name_of(rec)] if stylized else []),
        "origin": (meta.get("origen") or "").strip() or None,
        "duration": meta.get("duración"), "formed": formed, "ended": ended,
        "activity": meta.get("actividad"),
        "gender": gender, "unknownKind": "(D)" in tipo or "(A)" in tipo,
        "birth": born, "birthPlace": born_place, "death": died, "deathPlace": died_place, "deceased": bool(meta.get("fallecimiento")),
        "instruments": [i.strip() for i in re.split(r"\s*,\s*", meta.get("instrumentos") or "") if i.strip()],
        "roles": meta.get("roles"),
        "genres": [g.strip() for g in re.split(r"\s*,\s*", meta.get("géneros") or "") if g.strip()],
        "links": [{"text": l["text"], "href": l["href"]} for l in links.get("enlaces", [])],
        "groups": groups,
        "bio": clean_bio(rec.get("bio"), name_of(rec)),
        "photo": local("artist" if kind == "artist" else "banda", rec["slug"], "foto"),
        "photoUrl": rec.get("image_full") or rec.get("image") or None,
        "logoUrl": logo_of(html),
        "discography": [{"section": d["section"], "title": d["title"], "url": d["href"].rstrip("/"), "year": d.get("year"), "role": d.get("role")} for d in rec.get("discography") or []],
        "events": rec.get("participants") or [],
    }


ROLE_SPLIT = re.compile(r"\s*,\s*(?![^\[]*\])(?![^(]*\))")


def role_of(raw):
    """«saxofón (A1, A3)» → ('saxofón', ['A1', 'A3']); «guitarra [solo] (2, 6)» → ('guitarra [solo]', ['2', '6'])."""
    m = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", raw)
    if not m:
        return {"role": raw, "positions": []}
    return {"role": m.group(1).strip(), "positions": [p.strip() for p in m.group(2).split(",") if p.strip()]}


def parse_credit(section, text, links):
    """«producido por, mezclado por : Andrés Melo (A1), Otro» → [{role, name, href, positions}]."""
    out = []
    for line in re.split(r"\s*;\s*(?=[^:;]+:)", text):
        if ":" not in line:
            continue
        left, right = line.split(":", 1)
        roles = [role_of(r.strip()) for r in ROLE_SPLIT.split(left) if r.strip()]
        right = right.strip()
        names = []
        if section == "Empresas":
            # «grabado en : Estudios Intersonido C.A. , Caracas, Venezuela»: el destino es el enlace.
            for link in links:
                if link["text"] and link["text"] in right:
                    names.append({"name": link["text"].strip(), "href": link["href"].rstrip("/"), "positions": []})
            if not names and right:
                names.append({"name": right.split(" , ")[0].strip(), "href": None, "positions": []})
        else:
            for piece in re.split(r",\s*(?![^()]*\))", right):
                piece = piece.strip()
                if not piece:
                    continue
                m = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", piece)
                name, pos = (m.group(1).strip(), [p.strip() for p in m.group(2).split(",") if p.strip()]) if m else (piece, [])
                href = next((l["href"].rstrip("/") for l in links if l["text"].strip() == name), None)
                names.append({"name": name, "href": href, "positions": pos})
        for name in names:
            out.append({"section": section, "roles": roles, **name, "raw": line.strip()})
    return out


def info_of(rec):
    flat = {}
    for group in rec.get("info") or []:
        for item in group:
            flat.setdefault(item["label"], item)
    return flat


def release(rec):
    info = info_of(rec)
    principal = info.get("Artista principal del disco", {})
    pais = (info.get("país", {}).get("value") or "")
    m = re.match(r"^(.*?)\s*\((\d{4})\)\s*$", pais)
    country, year = (m.group(1).strip(), int(m.group(2))) if m else (pais.strip() or None, None)
    if year is None:
        y = re.search(r"(1[89]\d\d|20[0-3]\d)", rec.get("idx_descriptor") or "")
        year = int(y.group(1)) if y else None
    label = info.get("disquera", {})
    catalog = (info.get("número de catálogo", {}).get("value") or "").strip()
    deposit = (info.get("depósito legal", {}).get("value") or "").strip()
    formats = [f.strip() for f in (info.get("formatos", {}).get("value") or "").split("·") if f.strip()]
    tracks = []
    for t in rec.get("tracks") or []:
        length = t.get("length") or ""
        lm = re.match(r"^(?:(\d+):)?(\d{1,2}):(\d\d)$", length)
        seconds = (int(lm.group(1) or 0) * 3600 + int(lm.group(2)) * 60 + int(lm.group(3))) if lm else None
        tracks.append({"num": t.get("num"), "title": (t.get("title") or "").strip(), "seconds": seconds,
                       "composer": t.get("composer") or "", "composerLinks": t.get("composer_links") or []})
    credits = []
    for c in rec.get("credits") or []:
        credits.extend(parse_credit(c["section"], c["text"], c.get("links") or []))
    return {
        "kind": "release", "slug": rec["slug"], "url": rec["url"].rstrip("/"), "title": (rec.get("title") or rec.get("h1") or "").strip(),
        "subtitle": rec.get("subtitle") or None,
        "artists": [{"name": l["text"].strip(), "url": l["href"].rstrip("/")} for l in principal.get("links") or []],
        "artistText": principal.get("value"),
        "country": country, "year": year, "duration": info.get("duración", {}).get("value"),
        "formats": formats, "otherFormats": info.get("otros formatos", {}).get("value"),
        "label": None if not label.get("value") else {"name": label["value"].strip(), "url": (label.get("links") or [{}])[0].get("href", "").rstrip("/") or None},
        "catalog": None if re.match(r"(?i)^(sin cat[aá]logo|)$", catalog) else catalog,
        "deposit": None if re.match(r"(?i)^(sin dep[oó]sito|)$", deposit) else deposit,
        "genres": [g.strip() for g in (info.get("géneros", {}).get("value") or "").split("·") if g.strip()],
        "tracks": tracks, "credits": credits, "review": rec.get("review") or None,
        "cover": local("release", rec["slug"], "portada"),
        "coverUrl": (rec.get("images_full") or rec.get("images") or [None])[0],
    }


def company(rec):
    meta = rec.get("meta") or {}
    tipo = meta.get("tipo") or ""
    t = re.match(r"^(\w+)\s*(.*)$", tipo)
    rel = {k: [{"name": l["text"].strip(), "url": l["href"].rstrip("/")} for l in meta_links(rec, k)] or
           ([{"name": v.strip(), "url": None} for v in re.split(r"\s*,\s*", meta.get(k) or "") if v.strip()])
           for k in ("matriz", "filiales", "sister companies")}
    return {
        "kind": "empresa", "slug": rec["slug"], "url": rec["url"].rstrip("/"), "name": name_of(rec),
        "type": t.group(1) if t else None, "years": (t.group(2) or None) if t else None,
        "address": meta.get("dirección"), "description": meta.get("descripción"),
        "relations": rel, "logo": local("empresa", rec["slug"], "logo"),
    }


bands = [person_like(r, "banda") for r in rows("bandas")]
persons = [person_like(r, "artist") for r in rows("artistas") if r["slug"] not in TEST_SLUGS]
releases = [release(r) for r in rows("discos")]
companies = [company(r) for r in rows("empresa")]
events = [{"slug": r["slug"], "url": r["url"], "name": name_of(r), "meta": r.get("meta"), "participants": r.get("participants")} for r in rows("events")]

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "fichas.json").write_text(json.dumps({"bands": bands, "persons": persons, "releases": releases, "companies": companies, "events": events}, ensure_ascii=False))
print(json.dumps({
    "bands": len(bands), "bandsLogoHeadline": sum(b["headlineWasLogo"] for b in bands), "bandLogos": sum(bool(b["logoUrl"]) for b in bands),
    "bandsNoName": [b["slug"] for b in bands if not b["name"]],
    "persons": len(persons), "personLogos": sum(bool(p["logoUrl"]) for p in persons), "personsNoName": [p["slug"] for p in persons if not p["name"]],
    "personBios": sum(bool(p["bio"]) for p in persons), "bandBios": sum(bool(b["bio"]) for b in bands),
    "births": sum(bool(p["birth"]) for p in persons), "deaths": sum(p["deceased"] for p in persons),
    "releases": len(releases), "credits": sum(len(r["credits"]) for r in releases), "creditsNoHref": sum(1 for r in releases for c in r["credits"] if not c["href"]),
    "companies": len(companies), "events": len(events),
}, ensure_ascii=False, indent=1))
