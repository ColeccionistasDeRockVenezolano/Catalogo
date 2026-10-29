"""Parser de las fichas de rockhechovenezuela.com (directorio multisitio).

Lee el HTML ya capturado (deep-rhv-com-2026-10-25) y produce una ficha
estructurada por artista: biografía, foto, redes, roles de la biografía y
discografía con la PESTAÑA de origen (LP, CD, EP, Sencillos, Demos,
Cassettes, Recopilaciones, Digital), sello y n.º de catálogo, portadas,
formación, invitados, temas por lado/CD, bonus, notas y enlaces.

No infiere nada que la ficha no diga. Uso:
  python3 -I scripts/rhv-directorio-parse.py <salida.jsonl>
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

CAP = Path("/mnt/1tb/Shared/coleccionistas-rock-venezolano/data/raw/deep-rhv-com-2026-10-25")
EMPTY_PANEL = re.compile(r"^[\s—\-–.]*$")
YEAR = r"(?:1[89]\d[\d?x]|20[0-3]\d|s/f|S/F|\d{3}\?)"
# «Título (1992) -Sello, 123- (Álbum)»: el año entre paréntesis separa título y resto.
HEADER = re.compile(rf"^(?P<title>.+?)\s*\((?P<years>{YEAR}(?:\s*[,/y-]\s*{YEAR})*)\)\s*(?P<rest>.*)$")
FIELD = re.compile(r"^(?P<key>[A-Za-zÁÉÍÓÚáéíóúñÑ ]{2,40}?)\s*:\s*(?P<value>.*)$", re.S)
APPEAR = re.compile(r"^Temas?\s+(?:interpretados?\s+por|de)\s+(?P<who>[^:]{1,80}?)\s*:\s*(?P<value>.*)$", re.I | re.S)
SIDE = re.compile(r"^(?:Lado|Side)\s+([A-H])$", re.I)
DISC = re.compile(r"^(?:CD|Disco|Disc|DVD)\s*(\d)$", re.I)
FORMAT_WORDS = {
    "cd": "CD", "lp": "LP", "dvd": "DVD", "vcd": "VCD", "digital": "Digital", "cassette": "Cassette",
    "casete": "Cassette", "mc": "Cassette", "ep": "EP", "álbum": None, "album": None, "sencillo": None,
    "single": None, "45 rpm": "7\"", "45 r.p.m.": "7\"", "doble lp": "2xLP", "2 lp": "2xLP", "2 cd": "2xCD",
    "doble cd": "2xCD", "12″": "12\"", "12\"": "12\"", "7″": "7\"", "7\"": "7\"", "maxi single": "12\"",
    "demo": None, "en vivo": None, "vinilo": "LP", "usb": "USB", "k7": "Cassette", "blu-ray": "Blu-ray",
}
TYPE_WORDS = {"álbum": "album", "album": "album", "sencillo": "single", "single": "single", "ep": "ep",
              "demo": "demo", "en vivo": "live", "maxi single": "single", "45 rpm": "single", "45 r.p.m.": "single"}
SOCIAL_SKIP = re.compile(r"^https?://-+/?$|^#|^$")


def clean(text: str) -> str:
    text = unicodedata.normalize("NFC", text.replace("\xa0", " ").replace("​", ""))
    return re.sub(r"\s+", " ", text).strip()


def strip_end(text: str) -> str:
    return clean(text).strip(" .;,").strip()


def split_list(value: str) -> list[str]:
    """Separa por comas fuera de paréntesis/comillas; el último «y X» también separa."""
    out, depth, buf = [], 0, []
    for ch in value:
        if ch in "(«[":
            depth += 1
        elif ch in ")»]":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            out.append("".join(buf)); buf = []
            continue
        buf.append(ch)
    out.append("".join(buf))
    items = [strip_end(x) for x in out]
    return [x for x in items if x and not EMPTY_PANEL.match(x)]


def split_people(value: str) -> list[dict]:
    people = []
    for item in split_list(value):
        # «A y B» al final de la lista de formación
        parts = re.split(r"\s+y\s+(?=[A-ZÁÉÍÓÚÑ])", item) if "(" not in item else [item]
        for part in parts:
            part = strip_end(part)
            m = re.match(r"^(?P<name>[^()]+?)\s*\((?P<role>[^)]*)\)\s*(?P<tail>.*)$", part)
            if m:
                name, role = strip_end(m.group("name")), strip_end(m.group("role"))
            else:
                name, role = part, ""
            if name and len(name) <= 80:
                people.append({"name": name, "role": role})
    return people


def panel_lines(panel: Tag) -> list[tuple[str, list[dict]]]:
    """Convierte el panel en líneas; cada línea conserva sus imágenes y enlaces."""
    for br in panel.find_all("br"):
        br.replace_with(NavigableString("\n"))
    lines: list[tuple[str, list[dict]]] = []
    buf: list[str] = []
    extras: list[dict] = []

    def flush():
        nonlocal buf, extras
        text = "".join(buf)
        for i, chunk in enumerate(text.split("\n")):
            lines.append((clean(chunk), extras if i == 0 else []))
        buf, extras = [], []

    def walk(node):
        nonlocal buf, extras
        for child in node.children:
            if isinstance(child, NavigableString):
                buf.append(str(child))
            elif isinstance(child, Tag):
                if child.name == "img":
                    src = child.get("src") or child.get("data-src") or ""
                    if src:
                        flush()
                        lines.append(("", [{"img": src}]))
                    continue
                if child.name == "a" and child.get("href"):
                    extras.append({"href": child["href"], "text": clean(child.get_text(" "))})
                block = child.name in ("p", "h1", "h2", "h3", "h4", "h5", "h6", "div", "li", "ul", "ol", "table", "tr")
                if block:
                    flush()
                walk(child)
                if block:
                    flush()
        return

    walk(panel)
    flush()
    return [(t, e) for t, e in lines if t or e]


def parse_rest(rest: str) -> dict:
    """«-RCA Victor, 3-10521- (45 rpm)» → sellos, n.º de catálogo, formato y tipo declarados."""
    rest = clean(rest).strip()
    paren = []
    while True:
        m = re.search(r"\(([^()]*)\)\s*$", rest)
        if not m or not rest.endswith(")"):
            break
        # «SONORODVEN (415)-» no acaba en ")"; solo quitar los paréntesis finales tras el bloque de guiones
        before = rest[: m.start()].rstrip()
        if not before.endswith(("-", "–", "—")) and before:
            break
        paren.insert(0, clean(m.group(1)))
        rest = before
    seg = rest.strip(" -–—")
    pieces = [seg] if seg else []
    pieces += paren
    labels, catnos, formats, types, notes = [], [], [], [], []
    for piece in pieces:
        low = piece.lower().strip(" .")
        if not low:
            continue
        sub = [s.strip() for s in re.split(r",\s*", piece)]
        if all(s.lower().strip(" .") in FORMAT_WORDS or re.fullmatch(r"\d\s*(cd|lp)s?", s.lower()) for s in sub if s):
            for s in sub:
                k = s.lower().strip(" .")
                if FORMAT_WORDS.get(k):
                    formats.append(FORMAT_WORDS[k])
                elif re.fullmatch(r"(\d)\s*(cd|lp)s?", k):
                    n, f = re.fullmatch(r"(\d)\s*(cd|lp)s?", k).groups()
                    formats.append(f"{n}x{f.upper()}")
                if k in TYPE_WORDS:
                    types.append(TYPE_WORDS[k])
            continue
        if re.search(r"edici[oó]n|reedici|remaster|grabado|incluye|bonus|exclusiv", low):
            notes.append(piece)
            continue
        # «Sello (catálogo)» o «Sello, catálogo» o «Sello catálogo-con-dígitos»
        m = re.match(r"^(?P<label>[^(]+?)\s*\((?P<cat>[^)]*\d[^)]*)\)\s*$", piece)
        if m:
            lab, cat = m.group("label"), m.group("cat")
        else:
            parts = [p.strip() for p in piece.split(",")]
            lab = parts[0]
            rest_parts = [p for p in parts[1:] if p]
            cat = ", ".join(p for p in rest_parts if re.search(r"\d", p)) or ""
            for p in rest_parts:
                k = p.lower().strip(" .")
                if k in FORMAT_WORDS and FORMAT_WORDS[k]:
                    formats.append(FORMAT_WORDS[k])
                if k in TYPE_WORDS:
                    types.append(TYPE_WORDS[k])
        lab = lab.strip(" -–—.")
        if lab.lower() in FORMAT_WORDS:
            if FORMAT_WORDS[lab.lower()]:
                formats.append(FORMAT_WORDS[lab.lower()])
            if lab.lower() in TYPE_WORDS:
                types.append(TYPE_WORDS[lab.lower()])
            lab = ""
        for one in re.split(r"\s*/\s*", lab) if lab else []:
            if one and not re.fullmatch(r"[\d\s\-.]+", one):
                labels.append(one)
        if cat:
            catnos.append(cat.strip(" -–—."))
    return {"labels": labels, "catalog": catnos, "formats": formats, "types": types, "notes": notes, "raw": clean(rest)}


def is_header(text: str) -> re.Match | None:
    if FIELD.match(text) and not HEADER.match(text.split(":", 1)[0] + ":"):
        key = FIELD.match(text).group("key").lower()
        if key.startswith(("tema", "formaci", "lado", "músic", "music", "nota", "bonus", "cd", "disco", "invitad", "link", "label", "side", "producci", "grabad", "track")):
            return None
    m = HEADER.match(text)
    if not m:
        return None
    title = m.group("title")
    if len(title) > 160 or title.lower().startswith(("temas", "formación", "tema ", "lado ")):
        return None
    return m


def parse_tracks(value: str) -> list[str]:
    value = re.sub(r"\s*\.\s*$", "", clean(value))
    return [t for t in split_list(value) if t and len(t) < 200]


def parse_panel(tab: str, panel: Tag) -> list[dict]:
    albums: list[dict] = []
    cur: dict | None = None
    pending_imgs: list[str] = []
    side_disc = {"A": 1, "B": 1, "C": 2, "D": 2, "E": 3, "F": 3, "G": 4, "H": 4}
    for text, extras in panel_lines(panel):
        imgs = [e["img"] for e in extras if "img" in e]
        links = [e for e in extras if "href" in e]
        if imgs and not text:
            (cur["covers"] if cur else pending_imgs).extend(imgs)
            continue
        if not text:
            continue
        m = is_header(text)
        if m:
            cur = {
                "tab": tab, "title": strip_end(m.group("title")).strip("«»\"“”"), "years_raw": m.group("years"),
                "header": text, "covers": pending_imgs, "lineup": [], "guests": [], "tracks": [],
                "appearance": None, "notes": [], "links": [], **parse_rest(m.group("rest")),
            }
            pending_imgs = []
            albums.append(cur)
            cur["links"].extend(links)
            continue
        if cur is None:
            continue
        cur["links"].extend(links)
        ap = APPEAR.match(text)
        if ap:
            cur["appearance"] = strip_end(ap.group("who"))
            for t in parse_tracks(ap.group("value")):
                cur["tracks"].append({"title": t, "disc": 1})
            continue
        if re.match(r"^(?:Link|Enlace)s?\b", text, re.I) or re.fullmatch(r"Reseña\.?", text, re.I):
            continue
        if re.fullmatch(r"[-–—].*[-–—](?:\s*\(.*\))?", text) and not cur["labels"] and not cur["formats"]:
            parsed = parse_rest(text)
            for k in ("labels", "catalog", "formats", "types", "notes"):
                cur[k].extend(parsed[k])
            cur["raw"] = (cur["raw"] + " " + parsed["raw"]).strip()
            continue
        f = FIELD.match(text)
        key = f.group("key").strip().lower() if f else ""
        value = f.group("value") if f else ""
        if f and key in ("formación", "ormación", "formacion", "músicos", "musicos", "integrantes"):
            cur["lineup"].extend(split_people(value))
        elif f and re.match(r"^m[uú]sicoo?s? invitados?$|^invitados?$", key):
            cur["guests"].extend(split_people(value))
        elif f and SIDE.match(f.group("key").strip()):
            side = SIDE.match(f.group("key").strip()).group(1).upper()
            for t in parse_tracks(value):
                cur["tracks"].append({"title": t, "side": side, "disc": side_disc[side]})
        elif f and DISC.match(f.group("key").strip()):
            d = int(DISC.match(f.group("key").strip()).group(1))
            for t in parse_tracks(value):
                cur["tracks"].append({"title": t, "disc": d})
        elif f and re.match(r"^bonus|^temas? extras?$", key):
            disc = cur["tracks"][-1]["disc"] if cur["tracks"] else 1
            for t in parse_tracks(value):
                cur["tracks"].append({"title": t, "disc": disc, "bonus": True})
        elif f and re.match(r"^temas? interpretados? por|^temas? de ", key):
            who = re.sub(r"^temas? interpretados? por\s*|^temas? de\s*", "", f.group("key").strip(), flags=re.I)
            cur["appearance"] = strip_end(who)
            for t in parse_tracks(value):
                cur["tracks"].append({"title": t, "disc": 1})
        elif f and key in ("temas", "tema", "track list", "tracklist", "lista de temas"):
            for t in parse_tracks(value):
                cur["tracks"].append({"title": t, "disc": 1})
        elif f and key.startswith("nota"):
            cur["notes"].append(clean(value))
        elif f and key.startswith("link"):
            pass
        else:
            # Línea libre: nota de edición («Reedición en CD…», «Grabado en vivo…»)
            if not re.fullmatch(r"agradecimientos:?", text, re.I):
                cur["notes"].append(text)
    return albums


POSTPOSED = re.compile(r"^(?P<base>.+?),\s*(?P<art>Los|Las|La|El|The|Grupo|Banda|Proyecto|La Banda(?: De| de)?|Orquesta|Dúo|Trío)\s*$", re.I)


def display_name(name: str) -> str:
    """«Amigos Invisibles, Los» → «Los Amigos Invisibles»; «Big Landin Orquesta (La)» → «La Big Landin Orquesta»."""
    name = clean(name)
    m = re.match(r"^(?P<base>.+?)\s*\((?P<art>Los|Las|La|El|The)\)\s*$", name) or POSTPOSED.match(name)
    if not m:
        return name
    art = m.group("art")
    return f"{art[0].upper()}{art[1:]} {m.group('base')}"


def bio_roles(paragraphs: list[str]) -> dict[str, list[str]]:
    """«Daniel Reyes (guitarra), Robin Morán (voz líder)» → roles por persona, en orden."""
    roles: dict[str, list[str]] = {}
    for p in paragraphs:
        for m in re.finditer(r"([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑüÜ'’.«»\" -]{2,60}?)\s*\(([^()]{2,90})\)", p):
            name = clean(m.group(1))
            name = re.sub(r"^(?:y|e|por|con|a|de|integrada por|formada por|junto a)\s+", "", name, flags=re.I)
            name = re.split(r"\s(?:y|e|por|con|junto a|integrad[ao] por|formad[ao] por)\s", name)[-1].strip()
            role = clean(m.group(2))
            if re.search(r"\d{4}", role) or len(name.split()) > 6 or not re.match(r"[A-ZÁÉÍÓÚÑ]", name):
                continue
            roles.setdefault(name, [])
            if role not in roles[name]:
                roles[name].append(role)
    return roles


def parse_ficha(path: Path, url: str) -> dict:
    soup = BeautifulSoup(path.read_text("utf-8"), "lxml")
    titles = {t.get("aria-controls"): clean(t.get_text(" ")) for t in soup.select(".elementor-tab-desktop-title")}
    name = ""
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        name = clean(re.sub(r"\s*[-|–]\s*(Rock Hecho en Venezuela|Directorio.*)$", "", og["content"]))
    h1s = [clean(h.get_text(" ")) for h in soup.select("h1.elementor-heading-title")]
    content = soup.select_one(".elementor-widget-theme-post-content .elementor-widget-container")
    paragraphs = []
    bio_links = []
    if content:
        for el in content.find_all(["p", "h2", "h3", "h4", "li"], recursive=True):
            t = clean(el.get_text(" "))
            if not t or re.match(r"^Directorio\s*«", t) or re.fullmatch(r"_+", t):
                continue
            if el.name in ("h2", "h3", "h4"):
                paragraphs.append(f"## {t}")
            else:
                paragraphs.append(t)
            for a in el.find_all("a", href=True):
                bio_links.append({"href": a["href"], "text": clean(a.get_text(" "))})
    feat = soup.select_one(".elementor-widget-theme-post-featured-image img")
    socials = []
    for a in soup.select("a.elementor-social-icon"):
        href = (a.get("href") or "").strip()
        if SOCIAL_SKIP.match(href):
            continue
        cls = [c for c in a.get("class", []) if c.startswith("elementor-social-icon-")]
        socials.append({"platform": cls[0].replace("elementor-social-icon-", "") if cls else "", "url": href})
    added = None
    for strong in soup.find_all(string=re.compile(r"Añadido\(a\) el")):
        sec = strong.find_parent("section")
        if sec:
            added = clean(sec.get_text(" ").split("el:")[-1])
    albums = []
    for panel in soup.select(".elementor-tab-content"):
        tab = titles.get(panel.get("id"), "?")
        if EMPTY_PANEL.match(clean(panel.get_text(" "))):
            continue
        albums.extend(parse_panel(tab, panel))
    text_paragraphs = [p for p in paragraphs if not p.startswith("## ")]
    return {
        "url": url, "name": display_name(name), "site_name": name, "h1": h1s, "picture": feat.get("src") if feat else None,
        "bio": paragraphs, "bio_roles": bio_roles(text_paragraphs), "bio_links": bio_links,
        "socials": socials, "added": added, "albums": albums,
    }


def main(out: str) -> None:
    idx = [json.loads(l) for l in open(CAP / "index.jsonl")]
    with open(out, "w", encoding="utf-8") as fh:
        for r in idx:
            ficha = parse_ficha(CAP / f"{r['sha256']}.html", r["url"])
            ficha["sha256"] = r["sha256"]
            ficha["letter"] = r["letra"]
            ficha["slug"] = r["slug"]
            fh.write(json.dumps(ficha, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
