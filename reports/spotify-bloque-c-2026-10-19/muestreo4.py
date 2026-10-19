#!/usr/bin/env python3
"""Muestreo bloque C sin API — v4 (definitivo).

La web anónima de Spotify no sirve discografías completas (medido), pero su búsqueda interna
`searchDesktop` devuelve artistas, álbumes (albumsV2) y pistas con su artista creditado. Se mide:
  - ¿hay perfil con nombre exacto (o alias)?
  - ¿ese perfil tiene al menos un disco del catálogo (título normalizado, año ±1) entre lo visible?
Nada se escribe en la base.

Uso: ~/.venvs/scrapling/bin/python muestreo4.py [muestra.json] [resultados.jsonl]
"""
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

from playwright.sync_api import sync_playwright

DEST = Path("/tmp/crv-muestreo-c")
MUESTRA = DEST / "muestra.json"
SALIDA = DEST / "resultados.jsonl"
LOG = DEST / "muestra.log"
CDP = "http://127.0.0.1:9333"

JS_BUSCAR = """
async ([token, hash, base, term]) => {
  const v = {...base, searchTerm: term, offset: 0, limit: 40, numberOfTopResults: 5};
  const r = await fetch('https://api-partner.spotify.com/pathfinder/v2/query', {method:'POST',
    headers:{authorization: token, 'content-type':'application/json', 'app-platform':'WebPlayer'},
    body: JSON.stringify({variables: v, operationName:'searchDesktop',
      extensions:{persistedQuery:{version:1, sha256Hash: hash}}})});
  const d = await r.json().catch(() => null);
  const s = d?.data?.searchV2 ?? {};
  const arts = (s.artists?.items ?? []).map(it => {
    const x = it?.data ?? {};
    return {uri: x.uri || null, name: x.profile?.name || null};
  });
  const albs = (s.albumsV2?.items ?? []).map(it => {
    const x = it?.data ?? {};
    return {name: x.name || null, year: x.date?.year ?? null,
            artists: (x.artists?.items ?? []).map(a => a?.uri || a?.data?.uri || '')};
  });
  const trs = (s.tracksV2?.items ?? []).map(it => {
    const x = it?.item?.data ?? it?.data ?? {};
    return {name: x.name || null, album: x.albumOfTrack?.name || null,
            year: x.albumOfTrack?.date?.year ?? null,
            artists: (x.artists?.items ?? []).map(a => a?.uri || a?.data?.uri || '')};
  });
  return {status: r.status, arts, albs, trs};
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
    log(f"muestra {len(muestra)} · hechos {len(hechos)} · a procesar {len(pend)}")

    est = {"token": None, "hash": None, "base": None}

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
            if b.get("operationName") == "searchDesktop":
                est["hash"] = b["extensions"]["persistedQuery"]["sha256Hash"]
                est["base"] = b["variables"]

    with SALIDA.open("a", encoding="utf-8") as out, sync_playwright() as p:
        nav = p.chromium.connect_over_cdp(CDP)
        ctx = nav.contexts[0]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.on("request", cap)
        page.goto("https://open.spotify.com/search/" + muestra[0]["name"].replace(" ", "%20"),
                  wait_until="domcontentloaded", timeout=45000)
        for _ in range(40):
            if est["token"] and est["hash"] and est["base"]:
                break
            page.wait_for_timeout(500)
        if not (est["token"] and est["hash"] and est["base"]):
            log("no se pudo capturar searchDesktop")
            return 1
        base = {k: v for k, v in est["base"].items() if k != "searchTerm"}
        log("searchDesktop capturada · hash " + est["hash"][:12] + "…")

        for n, a in enumerate(pend, start=1):
            nombres = {norm(a["name"])} | {norm(x) for x in (a.get("aliases") or [])}
            res = {"artistId": a["id"], "name": a["name"], "discos_cat": len(a.get("discos") or [])}
            try:
                r = page.evaluate(JS_BUSCAR, [est["token"], est["hash"], base, a["name"]])
                res["status"] = r["status"]
                exactos = [x for x in r["arts"] if x.get("uri") and x.get("name") and norm(x["name"]) in nombres]
                ids = {x["uri"].split(":")[-1] for x in exactos}
                res["candidatos"] = [{"id": x["uri"].split(":")[-1], "name": x["name"]} for x in exactos[:4]]
                # repertorio visible del candidato: álbumes creditados + álbumes de sus pistas
                visibles = {}
                for al in r["albs"]:
                    if al.get("name") and any(u.split(":")[-1] in ids for u in al.get("artists") or []):
                        visibles.setdefault(norm(al["name"]), []).append({"t": al["name"], "y": al.get("year"), "via": "album"})
                for tr in r["trs"]:
                    if tr.get("album") and any(u.split(":")[-1] in ids for u in tr.get("artists") or []):
                        visibles.setdefault(norm(tr["album"]), []).append({"t": tr["album"], "y": tr.get("year"), "via": "track"})
                res["repertorio_visible"] = sum(len(v) for v in visibles.values())
                res["visibles"] = [x for v in visibles.values() for x in v][:60]
                res["pistas_visibles"] = [tr["name"] for tr in r["trs"]
                                          if tr.get("name") and any(u.split(":")[-1] in ids for u in tr.get("artists") or [])][:40]
                hitos = []
                for d in a.get("discos") or []:
                    for al in visibles.get(norm(d["title"]), []):
                        if d.get("year") and al.get("y") and abs(int(d["year"]) - int(al["y"])) > 1:
                            continue
                        hitos.append({"catalogo": d["title"], "anio_cat": d.get("year"),
                                      "spotify": al["t"], "anio_spotify": al.get("y"), "via": al["via"]})
                        break
                if not exactos:
                    res.update(hallado=False, motivo="sin perfil con nombre exacto")
                elif hitos:
                    res.update(hallado=True, motivo="perfil + disco en común", comunes=hitos[:5],
                               n_comunes=len(hitos), spotifyId=exactos[0]["uri"].split(":")[-1])
                elif len(exactos) > 1:
                    res.update(hallado=False, motivo=f"{len(exactos)} homónimos exactos sin disco en común")
                else:
                    res.update(hallado=None, motivo="perfil único, sin disco en común visible",
                               spotifyId=exactos[0]["uri"].split(":")[-1])
            except Exception as e:  # noqa: BLE001
                res.update(hallado=None, motivo=f"error: {str(e)[:120]}")
            out.write(json.dumps(res, ensure_ascii=False) + "\n")
            out.flush()
            marca = "SÍ " if res.get("hallado") else ("?  " if res.get("hallado") is None else "no ")
            log(f"[{n}/{len(pend)}] {marca} {a['name']}: {res['motivo']}")
            page.wait_for_timeout(600)
    return 0


if __name__ == "__main__":
    sys.exit(main())
