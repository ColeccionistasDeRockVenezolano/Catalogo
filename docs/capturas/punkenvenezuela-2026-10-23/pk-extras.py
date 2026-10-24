import json, os, re, html, subprocess, urllib.parse as up, concurrent.futures as cf

ROOT = "/home/brian/crv-staging/data/raw/punkenvenezuela-2026-10-23"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
os.makedirs(ROOT + "/extras/bandcamp", exist_ok=True)

def get(url, dest=None, timeout=90):
    cmd = ["curl", "-sSL", "-m", str(timeout), "-A", UA,
           "-H", "Accept-Language: es-VE,es;q=0.9,en;q=0.8",
           "-w", "\n%{http_code} %{size_download}"]
    if dest:
        cmd += ["-o", dest]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    body = r.stdout
    code = body.rsplit("\n", 1)[-1]
    body = body.rsplit("\n", 1)[0]
    return body, code

emb = json.load(open(ROOT + "/structured/embeds.json"))
albums = {}
for r in emb["bandcamp"]:
    u = r["url"]
    if "/album/" in u:
        u = u.replace("http://", "https://")
        albums.setdefault(u, r["pagina"])

out = []
def work(item):
    u, page = item
    slug = u.rstrip("/").split("/")[-1]
    fp = f"{ROOT}/extras/bandcamp/{slug}.html"
    body, code = get(u, fp)
    rec = {"url": u, "pagina": page, "status": code.strip(), "slug": slug,
           "archivo": os.path.relpath(fp, ROOT)}
    try:
        h = open(fp, encoding="utf-8", errors="replace").read()
        m = re.search(r'data-tralbum="([^"]+)"', h)
        if m:
            tr = json.loads(html.unescape(m.group(1)))
            cur = tr.get("current", {})
            rec.update(
                titulo=cur.get("title"), artista=cur.get("artist") or (tr.get("artist") or {}).get("name") if isinstance(tr.get("artist"), dict) else cur.get("artist"),
                publicado=cur.get("publish_date"), sello=cur.get("label"),
                pistas=[{"n": t.get("track_num"), "titulo": t.get("title"),
                         "dur": t.get("duration"), "letra": bool(t.get("lyrics"))}
                        for t in tr.get("trackinfo", [])],
                creditos=cur.get("credits"),
                acerca=re.sub(r"<[^>]+>", " ", cur.get("about") or "")[:3000],
                precio=None)
            if isinstance(tr.get("artist"), dict):
                rec["artista"] = tr["artist"].get("name") or rec.get("artista")
        else:
            rec["error"] = "sin data-tralbum"
            rec["titulo"] = (re.search(r'<title>(.*?)</title>', h, re.S) or [None, None])[1]
    except Exception as e:
        rec["error"] = repr(e)
    print(rec["slug"], rec.get("status"), rec.get("titulo"))
    return rec

with cf.ThreadPoolExecutor(4) as ex:
    out = list(ex.map(work, albums.items()))

with open(ROOT + "/extras/bandcamp.jsonl", "w", encoding="utf-8") as f:
    for r in out:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

# YouTube oEmbed
yt = []
for r in {x["url"]: x for x in emb["youtube"]}.values():
    u = r["url"]
    if "/channel/" in u:
        yt.append({"url": u, "pagina": r["pagina"], "tipo": "canal"})
        continue
    q = "https://www.youtube.com/oembed?format=json&url=" + up.quote(u, safe="")
    body, code = get(q)
    rec = {"url": u, "pagina": r["pagina"], "video_id": r["video_id"], "status": code.strip()}
    try:
        d = json.loads(body)
        rec.update(titulo=d.get("title"), autor=d.get("author_name"),
                   autor_url=d.get("author_url"), thumb=d.get("thumbnail_url"))
    except Exception as e:
        rec["error"] = repr(e)
    yt.append(rec)

# mega.nz metadatos públicos
mega = {}
for r in emb["otros"]:
    u = r["url"]
    m = re.search(r"mega\.nz/#!([A-Za-z0-9_-]+)!([A-Za-z0-9_-]+)", u)
    if not m:
        continue
    nid = m.group(1)
    q = f"https://g.api.mega.co.nz/cs?id=0&n={nid}"
    body, code = get(q)
    try:
        d = json.loads(body)
        if isinstance(d, list) and d:
            mega = {k: d[0].get(k) for k in ("n", "s", "g", "at", "m")}
            mega["url"] = u
            mega["api_status"] = code.strip()
            mega["nombre"] = mega.get("at") and __import__("base64").b64decode(mega["at"] + "==").decode("utf-8", "replace")
    except Exception as e:
        mega = {"url": u, "error": repr(e)}

json.dump({"youtube": yt, "mega": mega}, open(ROOT + "/extras/media-externa.json", "w"),
          ensure_ascii=False, indent=1)
print("bandcamp albums:", len(out), "youtube:", len(yt), "mega:", mega)
