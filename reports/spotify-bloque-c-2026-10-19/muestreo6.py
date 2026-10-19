#!/usr/bin/env python3
"""Reintento del bloque C — v6: sesión + búsqueda por DOM + perfil por queryArtistOverview.

Por qué así: con sesión, la búsqueda ya no emite `searchDesktop` (usa `searchTopResultsList`), pero
el DOM sí trae los artistas en enlaces `/intl-XX/artist/<id>`. El perfil se lee con
`queryArtistOverview` (hash capturado en vivo), que con sesión devuelve nombre, oyentes, nº de
álbumes y los 10 top tracks. Identidad = pista del catálogo entre los top tracks (los títulos de
canción sobreviven a las reediciones) o disco con título+año.

Uso: ~/.venvs/scrapling/bin/python muestreo6.py [muestra.json] [resultados-sesion.jsonl]
"""
import json
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

from playwright.sync_api import sync_playwright

DEST = Path("/tmp/crv-muestreo-c")
MUESTRA = DEST / "muestra.json"
SALIDA = DEST / "resultados-sesion.jsonl"
LOG = DEST / "muestra.log"
CDP = "http://127.0.0.1:9333"

JS_DOM = """
() => {
  const out = [];
  for (const a of document.querySelectorAll('a[href*="/artist/"]')) {
    const m = (a.getAttribute('href')||'').match(/\\/artist\\/([A-Za-z0-9]{22})/);
    if (!m) continue;
    const t = (a.getAttribute('aria-label') || a.innerText || '').trim();
    if (t) out.push({id: m[1], name: t.slice(0, 80)});
  }
  return out;
}
"""

JS_PERFIL = """
async ([token, hash, uri, locale]) => {
  const r = await fetch('https://api-partner.spotify.com/pathfinder/v2/query', {method:'POST',
    headers:{authorization: token, 'content-type':'application/json', 'app-platform':'WebPlayer'},
    body: JSON.stringify({variables:{uri, locale, preReleaseV2:false}, operationName:'queryArtistOverview',
      extensions:{persistedQuery:{version:1, sha256Hash: hash}}})});
  const d = await r.json().catch(() => null);
  const a = d?.data?.artistUnion;
  if (!a) return {status: r.status, vacio: true};
  const g = a.discography ?? {};
  const tops = (g.topTracks?.items ?? []).map(x => x?.track?.name || x?.name).filter(Boolean);
  const albs = Object.keys(g).filter(k => ['albums','singles','compilations','popularReleasesAlbums'].includes(k))
    .flatMap(k => (g[k]?.items ?? []).flatMap(it => it?.releases?.items ?? []))
    .map(x => ({t: x.name, y: x.date?.year ?? null, tipo: x.type}));
  return {status: r.status, name: a.profile?.name, listeners: a.stats?.monthlyListeners,
          tops, albumes: albs};
}
"""


def norm(t: str) -> str:
    s = unicodedata.normalize("NFD", t or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def log(msg: str) -> None:
    linea = time.strftime("%H:%M:%S ") + msg
    print(linea, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(linea + "\n")


def pistas_catalogo(ids: list) -> dict:
    sql = ("select a.artist_id, coalesce(json_agg(t.title),'[]') from public.tracks t "
           "join public.albums a on a.id=t.album_id where a.artist_id in ("
           + ",".join(map(str, ids)) + ") group by 1")
    out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tA", "-F", "|", "-c", sql],
                         capture_output=True, text=True).stdout
    d = {}
    for l in out.splitlines():
        if l.strip():
            aid, js = l.split("|", 1)
            d[int(aid)] = {norm(x) for x in json.loads(js) if x}
    return d


def main() -> int:
    global MUESTRA, SALIDA
    if len(sys.argv) > 1:
        MUESTRA = Path(sys.argv[1])
    if len(sys.argv) > 2:
        SALIDA = Path(sys.argv[2])
    muestra = json.loads(MUESTRA.read_text())
    hechos = set()
    if SALIDA.exists():
        for l in SALIDA.read_text().splitlines():
            if l.strip():
                try:
                    hechos.add(json.loads(l)["artistId"])
                except (ValueError, KeyError):
                    pass
    pend = [a for a in muestra if a["id"] not in hechos]
    pistas = pistas_catalogo([a["id"] for a in pend])
    log(f"muestra {len(muestra)} · hechos {len(hechos)} · a procesar {len(pend)}")

    est = {"token": None, "hash": None, "locale": "intl-es"}

    def cap(req):
        if "api-partner.spotify.com" not in req.url:
            return
        h = req.headers.get("authorization")
        if h:
            est["token"] = h
        if req.method == "POST" and req.post_data:
            try:
                b = json.loads(req.post_data)
            except ValueError:
                return
            if b.get("operationName") == "queryArtistOverview":
                est["hash"] = (b.get("extensions") or {}).get("persistedQuery", {}).get("sha256Hash")
                v = b.get("variables") or {}
                if v.get("locale"):
                    est["locale"] = v["locale"]

    with SALIDA.open("a", encoding="utf-8") as out, sync_playwright() as p:
        nav = p.chromium.connect_over_cdp(CDP)
        ctx = nav.contexts[0]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.on("request", cap)
        page.goto("https://open.spotify.com/artist/7JSjaPoP5m1qwwxn1HRoP7", wait_until="domcontentloaded", timeout=45000)
        for _ in range(40):
            if est["token"] and est["hash"]:
                break
            page.wait_for_timeout(500)
        if not (est["token"] and est["hash"]):
            log("sin token u overview hash")
            return 1
        log(f"overview capturado · hash {est['hash'][:10]}… · locale {est['locale']}")

        for n, a in enumerate(pend, start=1):
            # reciclar la pestaña cada 25 artistas: Chrome acumula memoria y acaba crasheando
            if n % 25 == 0:
                try:
                    page.close()
                except Exception:  # noqa: BLE001
                    pass
                page = ctx.new_page()
            nombres = {norm(a["name"])} | {norm(x) for x in (a.get("aliases") or [])}
            res = {"artistId": a["id"], "name": a["name"], "discos_cat": len(a.get("discos") or []),
                   "pistas_cat": len(pistas.get(a["id"], set()))}
            try:
                page.goto("https://open.spotify.com/search/" + a["name"].replace(" ", "%20"),
                          wait_until="domcontentloaded", timeout=45000)
                arts, vistos = [], set()
                for espera in (0, 2, 3):
                    if espera:
                        page.wait_for_timeout(espera * 1000)
                    for x in page.evaluate(JS_DOM):
                        if x["id"] not in vistos:
                            vistos.add(x["id"])
                            arts.append(x)
                    if any(norm(x["name"]) in nombres for x in arts):
                        break
                exactos = [x for x in arts if norm(x["name"]) in nombres]
                # dedupe por nombre: la misma ficha puede repetirse en varias filas
                uniq = {}
                for x in exactos:
                    uniq.setdefault(norm(x["name"]), x)
                exactos = list(uniq.values())
                res["resultados_dom"] = len(arts)
                res["candidatos"] = exactos[:4]
                confirmado, perfiles = None, []
                for c in exactos[:3]:
                    d = page.evaluate(JS_PERFIL, [est["token"], est["hash"], f"spotify:artist:{c['id']}", est["locale"]])
                    if d.get("status") != 200 or d.get("vacio"):
                        perfiles.append({"id": c["id"], "error": d.get("status")})
                        continue
                    hits_t = sorted({t for t in d.get("tops") or [] if norm(t) in pistas.get(a["id"], set())})
                    hits_a = [al for al in d.get("albumes") or []
                              if any(norm(al["t"]) == norm(x["title"]) for x in a.get("discos") or [])]
                    perfiles.append({"id": c["id"], "name": d.get("name"), "oyentes": d.get("listeners"),
                                     "tops": (d.get("tops") or [])[:10], "n_albumes": len(d.get("albumes") or []),
                                     "pistas_comunes": hits_t[:8], "albumes_comunes": [x["t"] for x in hits_a[:5]]})
                    if (hits_t or hits_a) and not confirmado:
                        confirmado = {"spotifyId": c["id"], "spotifyName": d.get("name"),
                                      "via": "pista" if hits_t else "disco",
                                      "pistas": hits_t[:8], "albumes": [x["t"] for x in hits_a[:5]],
                                      "oyentes": d.get("listeners"), "n_albumes": len(d.get("albumes") or [])}
                res["perfiles"] = perfiles
                if confirmado:
                    res.update(hallado=True, motivo=f"confirmado por {confirmado['via']} en común", **confirmado)
                elif not exactos:
                    res.update(hallado=False, motivo="sin perfil con nombre exacto")
                elif len(exactos) == 1:
                    res.update(hallado=None, motivo="perfil único sin repertorio en común")
                else:
                    res.update(hallado=False, motivo=f"{len(exactos)} homónimos sin repertorio en común")
            except Exception as e:  # noqa: BLE001
                res.update(hallado=None, motivo=f"error: {str(e)[:120]}")
            out.write(json.dumps(res, ensure_ascii=False) + "\n")
            out.flush()
            marca = "SÍ " if res.get("hallado") else ("?  " if res.get("hallado") is None else "no ")
            extra = f" · {len(res.get('pistas') or [])} pistas" if res.get("hallado") else ""
            log(f"[{n}/{len(pend)}] {marca} {a['name']}: {res['motivo']}{extra}")
            try:
                page.wait_for_timeout(300)
            except Exception:  # noqa: BLE001 — pestaña muerta: se reabre y se sigue
                try:
                    page = ctx.new_page()
                except Exception:  # noqa: BLE001
                    pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
