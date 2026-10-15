import subprocess, json, concurrent.futures as cf

def hay(slug):
    url = f"https://archive.org/wayback/available?url=myspace.com/{slug}"
    for _ in range(2):
        try:
            out = subprocess.run(["curl", "-s", "--max-time", "20", url], capture_output=True, text=True, timeout=25).stdout.strip()
            d = json.loads(out)
            s = d.get("archived_snapshots", {}).get("closest")
            if s and s.get("available"):
                return (slug, s.get("timestamp"), s.get("url"))
        except Exception:
            pass
    return (slug, None, None)

grupos = {
    "amigos_2hd": ["distrust", "dischordccs", "catarsisve", "cortexmetalband", "lenguajexcaustico",
                   "coleramorbus", "aleisterpgd", "bloodyburp", "faustband2", "heimdallrwar",
                   "lautimapalabradedios", "losvandersrocks", "neurosisinc", "blasphemybanda",
                   "black_bible", "aplaceforim"],
    "bandas_catalogo": ["distrust", "catarsis", "cortex", "coleramorbus", "aleister", "bloodyburp",
                        "heimdallr", "neurosisinc", "kilometrocero", "necrofago", "sepulcro",
                        "blackbible", "sentencia", "kharma", "funebria", "roraima", "cultopagano",
                        "mermer", "zombies", "arkangel"],
}

res = {}
for g, slugs in grupos.items():
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        filas = list(ex.map(hay, slugs))
    ok = [f for f in filas if f[1]]
    res[g] = {"probados": len(slugs), "con_snapshot": len(ok), "detalle": filas}
    print(f"{g}: {len(ok)}/{len(slugs)} con snapshot")
    for slug, ts, url in ok:
        print(f"   OK myspace.com/{slug} → {url}")

json.dump(res, open("/tmp/myspace-2hd/cobertura-availability.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
