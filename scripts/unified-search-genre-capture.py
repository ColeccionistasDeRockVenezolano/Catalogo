#!/usr/bin/env python3
"""Captura páginas de Wikipedia candidatas para el mapa descriptivo de géneros.

Uso: unified-search-genre-capture.py SALIDA.json es:Sangueo en:Flamenco ...

Guarda el HTML exacto en un directorio de preparación (por defecto el
scratchpad indicado con --staging) con nombre <Título>-<sha12>.html y escribe
SALIDA.json con la identidad documental (URL final/canónica, h1, huella, bytes,
fecha UTC) y el texto del artículo por secciones para su lectura humana.

No escribe en la base ni en el manifiesto: incorporar una captura al
manifiesto es una decisión posterior, tras leerla y comprobar que acredita la
acepción que usa el catálogo. Una página sin artículo legible, una
desambiguación o una redirección a otro tema se informan como tales.
"""
import argparse, concurrent.futures, datetime, hashlib, json, pathlib, re, sys, time, urllib.parse, urllib.request
from bs4 import BeautifulSoup

UA = "CRV-documentary-research/1.0"

def capture(spec: str, staging: pathlib.Path) -> dict:
    lang, _, title = spec.partition(":")
    url = f"https://{lang}.wikipedia.org/wiki/{title}"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                body, final = r.read(), r.url
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"spec": spec, "failed": "404"}
            if attempt == 2:
                return {"spec": spec, "failed": f"http {e.code}"}
        except Exception as e:  # red/timeout: reintento con espera
            if attempt == 2:
                return {"spec": spec, "failed": str(e)}
        time.sleep(2 * (attempt + 1))
    soup = BeautifulSoup(body, "html.parser")
    h1 = soup.find("h1")
    articles = soup.select(".mw-parser-output")
    article = max(articles, key=lambda n: len(n.select("p")), default=None)
    if not h1 or article is None or not article.find("p"):
        return {"spec": spec, "failed": "missing readable article"}
    canonical = soup.select_one("link[rel=canonical]")
    canonical = canonical["href"] if canonical else final
    digest = hashlib.sha256(body).hexdigest()
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", urllib.parse.unquote(title))
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", safe.encode("ascii", "ignore").decode()) or "page"
    file = staging / f"{safe}-{digest[:12]}.html"
    file.write_bytes(body)
    sections, current = [], {"id": None, "heading": "Introducción", "text": []}
    for node in article.find_all(["h2", "h3", "p", "li"], recursive=True):
        if node.name in ("h2", "h3"):
            if current["text"]:
                sections.append(current)
            inner = node.find(attrs={"id": True})
            hid = node.get("id") or (inner.get("id") if inner else None)
            current = {"id": hid, "heading": node.get_text(" ", strip=True), "text": []}
        else:
            t = re.sub(r"\[\d+\]", "", node.get_text(" ", strip=True))
            if len(t) > 30:
                current["text"].append(t)
    if current["text"]:
        sections.append(current)
    disambiguation = bool(soup.select_one("#disambigbox, .dmbox, #disambig")) or "desambiguación" in h1.get_text().lower()
    return {
        "spec": spec, "requestedUrl": url, "finalUrl": final, "canonicalUrl": canonical,
        "title": re.sub(r"\s+", " ", h1.get_text()).strip(), "stagedHtml": str(file), "fileName": file.name,
        "sha256": digest, "bytes": len(body),
        "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "disambiguation": disambiguation,
        "sections": [{"id": s["id"], "heading": s["heading"], "text": " ".join(s["text"])[:4000]} for s in sections],
    }

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("specs", nargs="+")
    ap.add_argument("--staging", required=True)
    a = ap.parse_args()
    staging = pathlib.Path(a.staging); staging.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(lambda s: capture(s, staging), a.specs))
    pathlib.Path(a.out).write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    for r in rows:
        print(r["spec"], "->", r.get("failed") or f'{r["title"]} | {r["canonicalUrl"]} | disamb={r["disambiguation"]} | secciones={len(r["sections"])}')

if __name__ == "__main__":
    sys.exit(main())
