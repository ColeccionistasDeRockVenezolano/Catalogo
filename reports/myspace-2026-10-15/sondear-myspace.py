import subprocess, json, re, sys, time, urllib.parse

# bandas: de la captura MA con ficha en catalogo (muestra amplia) + amigos del MySpace de 2hd
bandas_ma = []
for l in open("/home/brian/apps/Coleccionistas De Rock Venezolano/data/raw/metal-archives-ve-2026-10-01/band-details-full.jsonl", encoding="utf-8"):
    d = json.loads(l)
    b = d.get("band") or d.get("name")
    if b:
        bandas_ma.append(b)

def slug_variants(nombre):
    base = nombre.lower()
    base = re.sub(r"[^a-z0-9]+", "", base)
    otras = set()
    otras.add(re.sub(r"[^a-z0-9]+", "", nombre.lower().replace(" ", "")))
    otras.add(re.sub(r"[^a-z0-9]+", "_", nombre.lower()).strip("_"))
    otras.add(re.sub(r"[^a-z0-9]+", "-", nombre.lower()).strip("-"))
    otras.discard(base)
    return [base] + sorted(otras)

def cdx_ok(slug):
    url = f"http://web.archive.org/cdx/search/cdx?url=myspace.com/{urllib.parse.quote(slug)}&output=text&fl=timestamp,statuscode,length&limit=3&filter=statuscode:200"
    for intento in (1,):
        try:
            out = subprocess.run(["curl", "-s", "--max-time", "12", url], capture_output=True, text=True, timeout=30).stdout.strip()
        except Exception:
            out = ""
        filas = [l.split() for l in out.splitlines() if l.strip()]
        filas = [f for f in filas if len(f) >= 3 and f[0].isdigit()]
        if filas:
            mejor = max(filas, key=lambda f: int(f[2] or 0))
            return {"timestamp": mejor[0], "bytes": int(mejor[2] or 0), "variante": slug}
        time.sleep(1)
    return None

nombres = sys.argv[1:]
res = {"con_perfil": [], "sin_perfil": []}
for nombre in nombres:
    hit = None
    for slug in slug_variants(nombre):
        hit = cdx_ok(slug)
        if hit:
            break
    (res["con_perfil"] if hit else res["sin_perfil"]).append({"banda": nombre, **(hit or {})})

print(f"probadas: {len(nombres)} · con perfil archivado: {len(res['con_perfil'])} · sin: {len(res['sin_perfil'])}")
for r in res["con_perfil"]:
    print(f"  OK {r['banda']} → myspace.com/{r['variante']} ({r['bytes']} B, {r['timestamp']})")
print("sin perfil:", ", ".join(r["banda"] for r in res["sin_perfil"])[:300])
json.dump(res, open("/tmp/myspace-2hd/sondeo-myspace.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
