import subprocess, json, concurrent.futures as cf, urllib.parse, sys

def clasico(slug):
    url = ("http://web.archive.org/cdx/search/cdx?url=myspace.com/" + urllib.parse.quote(slug) +
           "&from=2004&to=2012&output=text&fl=timestamp,statuscode,length&limit=8&filter=statuscode:200")
    for _ in range(2):
        try:
            out = subprocess.run(["curl", "-s", "--max-time", "40", url], capture_output=True, text=True, timeout=50).stdout
        except Exception:
            out = ""
        filas = [l.split() for l in out.splitlines() if l.strip()]
        filas = [f for f in filas if len(f) >= 3 and f[0].isdigit() and f[0][:4].isdigit() and 2004 <= int(f[0][:4]) <= 2012]
        if filas:
            mejor = max(filas, key=lambda f: int(f[2] or 0))
            return {"slug": slug, "timestamp": mejor[0], "bytes": int(mejor[2] or 0), "snaps": len(filas)}
    return {"slug": slug, "timestamp": None, "bytes": 0, "snaps": 0}

slugs = sys.argv[1:]
with cf.ThreadPoolExecutor(max_workers=5) as ex:
    filas = list(ex.map(clasico, slugs))
ok = [f for f in filas if f["timestamp"]]
print(f"probados: {len(filas)} · con snapshot clasico 2004-2012: {len(ok)}")
for f in ok:
    print(f"  OK myspace.com/{f['slug']} ({f['bytes']} B, {f['timestamp']}, {f['snaps']} snaps)")
print("sin clasico:", ", ".join(f["slug"] for f in filas if not f["timestamp"]))
json.dump(filas, open("/tmp/myspace-2hd/cobertura-clasica.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
