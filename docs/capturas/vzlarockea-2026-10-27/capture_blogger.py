#!/usr/bin/env python3
"""Captura integral de un blog Blogger por sus feeds Atom.

Uso:
    python3 capture_blogger.py https://<blog>.blogspot.com [nombre-campana]

Guarda en $CRV_STAGING/data/raw/<nombre> y $CRV_STAGING/web/public/media/<nombre>.
Reanudable: todo se salta si el destino ya existe con tamano util.
"""
import gzip
import hashlib
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit, urlunsplit
from urllib.request import Request, urlopen

if __name__ == "__main__" and len(sys.argv) < 2:
    sys.exit("uso: capture_blogger.py <url-del-blog> [nombre-campana]")

BLOG = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else ""
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
STG = os.environ.get("CRV_STAGING", os.path.expanduser("~/crv-staging"))
NAME = (sys.argv[2] if len(sys.argv) > 2
        else re.sub(r"[^a-z0-9]+", "-", BLOG.split("//")[-1].split(".")[0].lower()) + "-blogspot")
RAW = os.path.join(STG, "data/raw", NAME)
MEDIA = os.path.join(STG, "web/public/media", NAME)
FEEDS = os.path.join(RAW, "feeds")
HTML = os.path.join(RAW, "html")
WORKERS = int(os.environ.get("WORKERS", "6"))

_lock = threading.Lock()
_stats = {}


def log(*a):
    msg = " ".join(str(x) for x in a)
    with _lock:
        print(msg, flush=True)


def bump(key, n=1):
    with _lock:
        _stats[key] = _stats.get(key, 0) + n


def fetch(url, tries=4, timeout=70):
    last = None
    for attempt in range(tries):
        try:
            req = Request(url, headers={
                "User-Agent": UA,
                "Accept": "*/*",
                "Accept-Encoding": "gzip, identity",
                "Accept-Language": "es-VE,es;q=0.9,en;q=0.8",
            })
            with urlopen(req, timeout=timeout) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return raw, r.status, dict(r.headers)
        except HTTPError as e:
            last = e
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(2 * (attempt + 1) + 0.4 * attempt)
                continue
            raise
        except (URLError, TimeoutError, OSError) as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise last


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def write_jsonl(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


# ---------- fase 1: feeds ----------

def download_feeds():
    state = {}
    # posts
    total = None
    start = 1
    while True:
        p = os.path.join(FEEDS, "posts-%05d.json" % start)
        if os.path.exists(p) and os.path.getsize(p) > 5000:
            d = json.load(open(p, encoding="utf-8"))
        else:
            url = "%s/feeds/posts/default?alt=json&max-results=150&start-index=%d" % (BLOG, start)
            raw, st, _ = fetch(url)
            save(p, raw)
            d = json.loads(raw.decode("utf-8"))
            log("feed posts start=%d bytes=%d" % (start, len(raw)))
        f = d["feed"]
        total = int(f["openSearch$totalResults"]["$t"])
        n = len(f.get("entry", []))
        if n == 0:
            break
        start += n
        if start > total:
            break
    state["posts_total"] = total
    state["posts_start_last"] = start - 1

    # pages
    p = os.path.join(FEEDS, "pages.json")
    if not (os.path.exists(p) and os.path.getsize(p) > 5000):
        raw, st, _ = fetch("%s/feeds/pages/default?alt=json&max-results=500" % BLOG)
        save(p, raw)
        log("feed pages bytes=%d" % len(raw))
    d = json.load(open(p, encoding="utf-8"))
    state["pages_total"] = int(d["feed"]["openSearch$totalResults"]["$t"])

    # comments
    ctotal = None
    start = 1
    while True:
        p = os.path.join(FEEDS, "comments-%05d.json" % start)
        if os.path.exists(p) and os.path.getsize(p) > 2000:
            d = json.load(open(p, encoding="utf-8"))
        else:
            url = "%s/feeds/comments/default?alt=json&max-results=500&start-index=%d" % (BLOG, start)
            raw, st, _ = fetch(url)
            save(p, raw)
            d = json.loads(raw.decode("utf-8"))
            log("feed comments start=%d bytes=%d" % (start, len(raw)))
        f = d["feed"]
        ctotal = int(f["openSearch$totalResults"]["$t"])
        n = len(f.get("entry", []))
        if n == 0:
            break
        start += n
        if start > ctotal:
            break
    state["comments_total"] = ctotal

    # sitemap: descubrir el indice real y bajar TODAS sus paginas
    p = os.path.join(FEEDS, "sitemap-index.xml")
    if not (os.path.exists(p) and os.path.getsize(p) > 200):
        raw, st, _ = fetch("%s/sitemap.xml" % BLOG)
        save(p, raw)
    idx = open(p, encoding="utf-8", errors="replace").read()
    pages = sorted({int(m) for m in re.findall(r"sitemap\.xml\?page=(\d+)", idx)}) or [1]
    state["sitemap_pages"] = pages
    sitemap_urls = set()
    for page in pages:
        p = os.path.join(FEEDS, "sitemap-%d.xml" % page)
        if not (os.path.exists(p) and os.path.getsize(p) > 200):
            raw, st, _ = fetch("%s/sitemap.xml?page=%d" % (BLOG, page))
            save(p, raw)
        for loc in re.findall(r"<loc>([^<]+)</loc>", open(p, encoding="utf-8", errors="replace").read()):
            sitemap_urls.add(loc.strip())
    with open(os.path.join(FEEDS, "sitemap-urls.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(sitemap_urls)) + "\n")
    state["sitemap_urls"] = len(sitemap_urls)
    for extra, name in [("/", "home.html"), ("/robots.txt", "robots.txt")]:
        p = os.path.join(FEEDS, name)
        if not (os.path.exists(p) and os.path.getsize(p) > 500):
            raw, st, _ = fetch(BLOG + extra)
            save(p, raw)
    log("fase 1 OK", json.dumps(state))
    return state


# ---------- fase 2: normalizacion ----------

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"[ \t\r\f\v]+")
NL_RE = re.compile(r"\n{3,}")


def plain(html_text):
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", html_text)
    t = re.sub(r"(?i)<br\s*/?>", "\n", t)
    t = re.sub(r"(?i)</(p|div|li|tr|h[1-6])>", "\n", t)
    t = TAG_RE.sub(" ", t)
    import html as htmlmod
    t = htmlmod.unescape(t)
    t = WS_RE.sub(" ", t)
    t = NL_RE.sub("\n\n", t)
    return t.strip()


def entry_common(e):
    links = e.get("link", [])
    alt = next((l["href"] for l in links if l.get("rel") == "alternate"), None)
    replies = next((l.get("href") for l in links if l.get("rel") == "replies"), None)
    content = e.get("content", {}).get("$t", "")
    thumb = e.get("media$thumbnail", {}).get("url") if e.get("media$thumbnail") else None
    return {
        "id": e.get("id", {}).get("$t"),
        "url": alt,
        "comments_feed": replies,
        "title": e.get("title", {}).get("$t", ""),
        "published": e.get("published", {}).get("$t"),
        "updated": e.get("updated", {}).get("$t"),
        "author": (e.get("author") or [{}])[0].get("name", {}).get("$t"),
        "categories": [c.get("term") for c in e.get("category", []) if c.get("term")],
        "thumbnail": thumb,
        "comments_total": int((e.get("thr$total") or {}).get("$t", 0) or 0),
        "content_html": content,
        "content_text": plain(content),
        "content_bytes": len(content),
    }


def normalize(state):
    posts, seen = [], set()
    for name in sorted(os.listdir(FEEDS)):
        if not re.match(r"posts-\d+\.json$", name):
            continue
        d = json.load(open(os.path.join(FEEDS, name), encoding="utf-8"))
        for e in d["feed"].get("entry", []):
            row = entry_common(e)
            if row["id"] in seen:
                continue
            seen.add(row["id"])
            posts.append(row)
    posts.sort(key=lambda r: r["published"] or "")
    write_jsonl(os.path.join(RAW, "posts.jsonl"), posts)
    log("posts normalizados:", len(posts))

    d = json.load(open(os.path.join(FEEDS, "pages.json"), encoding="utf-8"))
    pages = [entry_common(e) for e in d["feed"].get("entry", [])]
    write_jsonl(os.path.join(RAW, "pages.jsonl"), pages)
    log("paginas normalizadas:", len(pages))

    comments, seen = [], set()
    for name in sorted(os.listdir(FEEDS)):
        if not re.match(r"comments-\d+\.json$", name):
            continue
        d = json.load(open(os.path.join(FEEDS, name), encoding="utf-8"))
        for e in d["feed"].get("entry", []):
            cid = e.get("id", {}).get("$t")
            if cid in seen:
                continue
            seen.add(cid)
            irt = (e.get("thr$in-reply-to") or {})
            comments.append({
                "id": cid,
                "post_id": irt.get("ref"),
                "post_url": irt.get("href"),
                "title": e.get("title", {}).get("$t", ""),
                "author": (e.get("author") or [{}])[0].get("name", {}).get("$t"),
                "published": e.get("published", {}).get("$t"),
                "updated": e.get("updated", {}).get("$t"),
                "content_html": e.get("content", {}).get("$t", ""),
                "content_text": plain(e.get("content", {}).get("$t", "")),
            })
    comments.sort(key=lambda r: r["published"] or "")
    write_jsonl(os.path.join(RAW, "comments.jsonl"), comments)
    log("comentarios normalizados:", len(comments))
    return posts, pages, comments


# ---------- fase 4: imagenes ----------

IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.I)
A_RE = re.compile(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.I | re.S)
SIZE_SEG = re.compile(r"/(?:s\d+|w\d+|h\d+)(?:-[a-z0-9]+)*/")
SIZE_Q = re.compile(r"=(?:s\d+|w\d+|h\d+)(?:-[a-z0-9]+)*$")


def asset_key(url):
    """Identidad del asset sin segmento de tamano."""
    sp = urlsplit(url)
    path = sp.path
    path = SIZE_SEG.sub("/", path)
    path = SIZE_Q.sub("", path)
    return urlunsplit((sp.scheme, sp.netloc, path, "", ""))


def original_url(url):
    sp = urlsplit(url)
    path = SIZE_Q.sub("=s0", SIZE_SEG.sub("/s0/", sp.path))
    q = sp.query
    return urlunsplit((sp.scheme, sp.netloc, path, q, sp.fragment))


MAGIC = {
    b"\xff\xd8\xff": "jpg",
    b"\x89PNG": "png",
    b"GIF8": "gif",
    b"RIFF": "webp",
    b"BM": "bmp",
}
BAD = re.compile(r"^(text/html|application/xhtml|text/xml|application/json)", re.I)


def sniff_ext(data, url):
    for sig, ext in MAGIC.items():
        if data.startswith(sig):
            if ext == "webp" and not data[8:12] == b"WEBP":
                continue
            return ext
    base = unquote(urlsplit(url).path.rsplit("/", 1)[-1])
    if "." in base:
        e = base.rsplit(".", 1)[-1].lower()
        if e in ("jpg", "jpeg", "png", "gif", "webp", "bmp"):
            return "jpg" if e == "jpeg" else e
    return "bin"


def collect_images(posts, pages):
    by_key = {}
    for row in posts + pages:
        for src in IMG_RE.findall(row["content_html"]):
            src = src.replace("&amp;", "&")
            if not src.startswith("http"):
                continue
            k = asset_key(src)
            rec = by_key.setdefault(k, {"key": k, "urls": set(), "posts": set()})
            rec["urls"].add(src)
            rec["posts"].add(row["url"])
        if row.get("thumbnail"):
            src = row["thumbnail"]
            k = asset_key(src)
            rec = by_key.setdefault(k, {"key": k, "urls": set(), "posts": set()})
            rec["urls"].add(src)
            rec["posts"].add(row["url"])
    return by_key


def download_images(by_key):
    manifest = []
    jobs = []
    for k, rec in by_key.items():
        original = original_url(sorted(rec["urls"])[0])
        h = hashlib.sha1(k.encode()).hexdigest()
        ext_guess = ""
        base = unquote(urlsplit(k).path.rsplit("/", 1)[-1])
        if "." in base:
            ext_guess = "." + base.rsplit(".", 1)[-1].lower().replace("jpeg", "jpg")
        dest_dir = os.path.join(MEDIA, h[:2])
        dest = os.path.join(dest_dir, h + ext_guess)
        if os.path.exists(dest) and os.path.getsize(dest) > 1024:
            bump("img_skip")
            manifest.append({"key": k, "file": os.path.relpath(dest, MEDIA), "bytes": os.path.getsize(dest),
                             "status": "cached", "posts": sorted(rec["posts"])})
            continue
        jobs.append((k, original, rec, h, ext_guess))

    def work(job):
        k, original, rec, h, ext_guess = job
        try:
            data, st, hdrs = fetch(original, tries=3)
        except Exception as e:
            return {"key": k, "file": None, "bytes": 0, "status": "error:%s" % e, "posts": sorted(rec["posts"])}
        ctype = hdrs.get("Content-Type", "")
        if BAD.match(ctype) or len(data) < 512:
            return {"key": k, "file": None, "bytes": len(data), "status": "not-image: %s" % ctype,
                    "posts": sorted(rec["posts"])}
        ext = sniff_ext(data, original)
        if ext == "bin" and ext_guess:
            ext = ext_guess.lstrip(".")
        dest_dir = os.path.join(MEDIA, h[:2])
        dest = os.path.join(dest_dir, h + "." + ext)
        save(dest, data)
        return {"key": k, "file": os.path.relpath(dest, MEDIA), "bytes": len(data),
                "status": "ok", "content_type": ctype,
                "sha256": hashlib.sha256(data).hexdigest(),
                "posts": sorted(rec["posts"])}

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(work, j) for j in jobs]
        done = 0
        for fut in as_completed(futs):
            r = fut.result()
            manifest.append(r)
            done += 1
            if done % 100 == 0:
                log("imagenes %d/%d" % (done, len(jobs)))
    manifest.sort(key=lambda r: r["key"])
    write_jsonl(os.path.join(RAW, "images.jsonl"), manifest)
    ok = sum(1 for m in manifest if m.get("file"))
    log("imagenes OK:", ok, "de", len(manifest))
    return manifest


# ---------- fase 5: enlaces ----------

def collect_links(posts, pages):
    rows = []
    for row in posts + pages:
        for href, anchor in A_RE.findall(row["content_html"]):
            href = href.replace("&amp;", "&")
            if not href.startswith("http"):
                continue
            host = urlsplit(href).netloc.lower()
            if "blogspot.com" in host or "blogger.com" in host or host.startswith("google"):
                continue
            rows.append({
                "post_url": row["url"],
                "post_title": row["title"],
                "href": href,
                "host": host,
                "anchor": plain(anchor)[:300],
            })
    write_jsonl(os.path.join(RAW, "links.jsonl"), rows)
    log("enlaces externos:", len(rows))
    return rows


# ---------- fase 3: html ----------

def download_html(rows, kind):
    jobs = []
    seen = {}
    for row in rows:
        if not row.get("url"):
            continue
        slug = row["url"].rstrip("/").rsplit("/", 1)[-1]
        slug = re.sub(r"\.html$", "", slug)[:120]
        # colisiones de slug (mismo titulo en anos distintos): sufijo estable por URL
        if slug in seen and seen[slug] != row["url"]:
            slug = "%s--%s" % (slug, hashlib.sha1(row["url"].encode()).hexdigest()[:10])
        seen.setdefault(slug.split("--")[0], row["url"])
        seen[slug] = row["url"]
        dest = os.path.join(HTML, kind, slug + ".html")
        if os.path.exists(dest) and os.path.getsize(dest) > 20000:
            bump("html_skip")
            continue
        jobs.append((row["url"], dest))

    def work(job):
        url, dest = job
        try:
            data, st, hdrs = fetch(url, tries=3)
        except Exception as e:
            return (url, "error:%s" % e, 0)
        if len(data) < 5000:
            return (url, "short", len(data))
        save(dest, data)
        return (url, "ok", len(data))

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(work, j) for j in jobs]
        done = 0
        for fut in as_completed(futs):
            url, status, n = fut.result()
            if status != "ok":
                log("HTML fallo", status, url)
                bump("html_error")
            done += 1
            if done % 100 == 0:
                log("html %s %d/%d" % (kind, done, len(jobs)))
    log("html %s listo (%d tareas)" % (kind, len(jobs)))


def main():
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(MEDIA, exist_ok=True)
    t0 = time.time()
    state = download_feeds()
    posts, pages, comments = normalize(state)
    collect_links(posts, pages)
    by_key = collect_images(posts, pages)
    log("imagenes unicas:", len(by_key))
    download_images(by_key)
    download_html(posts, "posts")
    download_html(pages, "pages")

    # inventario final
    inv = {
        "blog": BLOG,
        "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "seconds": round(time.time() - t0, 1),
        "feeds": state,
        "posts": len(posts),
        "pages": len(pages),
        "comments": len(comments),
        "images_unique": len(by_key),
        "stats": _stats,
    }
    for root, label in ((RAW, "raw"), (MEDIA, "media")):
        files = bytes_ = 0
        for dp, dn, fn in os.walk(root):
            for f in fn:
                fp = os.path.join(dp, f)
                files += 1
                bytes_ += os.path.getsize(fp)
        inv[label + "_files"] = files
        inv[label + "_bytes"] = bytes_
    with open(os.path.join(RAW, "_inventario.json"), "w", encoding="utf-8") as f:
        json.dump(inv, f, ensure_ascii=False, indent=2)
    log("INVENTARIO", json.dumps(inv["stats"]),
        "raw_files=%d raw_MB=%.1f media_files=%d media_MB=%.1f segundos=%.0f" % (
            inv["raw_files"], inv["raw_bytes"] / 1e6, inv["media_files"],
            inv["media_bytes"] / 1e6, inv["seconds"]))


if __name__ == "__main__":
    main()
