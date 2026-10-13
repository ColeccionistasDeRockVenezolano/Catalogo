#!/usr/bin/env python3
"""CRV · Cosecha de reproductores por disco (2026-10-13).

Brian: «deezer+tidal+spotify+ytcanal+ytmusic+soundcloud, todas las que se puedan, como un switch
de plataformas». Deezer y Apple Music ya tienen sus discos (campaña 2026-10-04); aquí se buscan
los que faltan para poder insertar el reproductor de cada plataforma:

  spotify   — perfil del artista (el verificado, o búsqueda por nombre exacto) y sus discos.
  ytmusic   — álbumes de YouTube Music (su lista OLAK5uy_… se inserta con el reproductor de
              YouTube) y la lista «Canciones» del artista.
  bandcamp  — discos de los perfiles de Bandcamp ya verificados (el reproductor pide el id).
  tidal     — discos por búsqueda en la API oficial (openapi.tidal.com/v2).

Identidad (mismas reglas que la campaña de enlaces): el nombre del artista debe coincidir
EXACTO (normalizado, o con uno de sus alias) y el perfil solo vale si casa al menos un disco
del catálogo. Discos: título idéntico normalizado (nunca prefijos ni parecidos); con varios
candidatos gana el del mismo año.

Reanudable: un archivo <plataforma>/a-<artistId>.json por artista; lo hecho se salta.
Uso:
  ~/.venvs/crv-embeds/bin/python -I scripts/streaming-embeds-cosecha.py spotify \
      --dir reports/streaming-embeds-2026-10-13
"""
import argparse
import base64
import html
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "CRV-reproductores/1.0 (+coleccionistasderockvenezolano.com)"}


def env(name):
    value = os.environ.get(name, "").strip()
    if value:
        return value
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            k, sep, val = line.strip().partition("=")
            if sep and k.strip() == name:
                return val.strip().strip('"').strip("'")
    return ""


def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("&", " y ")
    return " ".join("".join(ch if ch.isalnum() else " " for ch in s).split())


def year_of(s):
    try:
        return int(str(s)[:4])
    except Exception:
        return None


def http(url, data=None, headers=None, timeout=30, as_json=True):
    h = dict(UA)
    h.update(headers or {})
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=h)
    for intento in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return json.loads(raw) if as_json else raw.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 429 and intento < 3:
                espera = int(e.headers.get("Retry-After") or 0) or (10, 30, 90)[intento]
                if espera > 600:
                    raise RuntimeError(f"rate-limit largo ({espera} s)")
                time.sleep(espera + 1)
                continue
            if e.code in (500, 502, 503) and intento < 3:
                time.sleep(5 * (intento + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if intento < 3:
                time.sleep(5 * (intento + 1))
                continue
            raise
    return None


def pick(album, cands):
    """Candidato de título idéntico; con varios, el del mismo año (o el primero)."""
    t = norm(album["title"])
    iguales = [c for c in cands if norm(c["title"]) == t]
    if not iguales:
        return None
    if album.get("year"):
        mismo = [c for c in iguales if c.get("year") == album["year"]]
        if mismo:
            return mismo[0]
    return iguales[0]


# ------------------------------------------------------------------------- spotify

class Spotify:
    def __init__(self):
        self.creds = [(env("SPOTIFY_CLIENT_ID" + s), env("SPOTIFY_CLIENT_SECRET" + s)) for s in ("", "_FALLBACK")]
        self.creds = [c for c in self.creds if c[0] and c[1]]
        self.token, self.vence = None, 0

    def get(self, path):
        if not self.token or time.time() > self.vence:
            cid, sec = self.creds[0]
            d = http("https://accounts.spotify.com/api/token", data={"grant_type": "client_credentials"},
                     headers={"Authorization": "Basic " + base64.b64encode(f"{cid}:{sec}".encode()).decode()})
            self.token, self.vence = d["access_token"], time.time() + d.get("expires_in", 3600) - 120
        # Pausa entre llamadas: 0,5 s castigó las dos credenciales ~24 h (2026-10-13) tras ~1.500
        # búsquedas; la reanudación va a 3 s (CRV_SPOTIFY_PAUSA).
        time.sleep(float(os.environ.get("CRV_SPOTIFY_PAUSA", "3")))
        return http("https://api.spotify.com/v1" + path, headers={"Authorization": "Bearer " + self.token})

    def artistas(self, name):
        d = self.get("/search?" + urllib.parse.urlencode({"q": name, "type": "artist", "limit": 10}))
        return [{"id": a["id"], "name": a["name"]} for a in (d.get("artists") or {}).get("items") or []]

    def discos(self, artist_id):
        out, offset = [], 0
        while offset < 300:
            d = self.get(f"/artists/{artist_id}/albums?" + urllib.parse.urlencode(
                {"include_groups": "album,single,compilation", "limit": 10, "offset": offset}))
            items = d.get("items") or []
            out += [{"id": a["id"], "title": a["name"], "year": year_of(a.get("release_date")),
                     "url": f"https://open.spotify.com/album/{a['id']}"} for a in items]
            if not d.get("next") or not items:
                break
            offset += len(items)
        return out


def spotify_id(url):
    m = re.search(r"open\.spotify\.com/(?:intl-\w+/)?artist/([A-Za-z0-9]{22})", url or "")
    return m.group(1) if m else None


def cosechar_spotify(sp, artista, discos):
    """Una búsqueda por disco (el listado por artista quedó castigado: 429 de ~24 h).

    Vale el resultado con título idéntico Y un artista de nombre idéntico (o alias); el perfil
    del artista sale de esos discos casados (el más repetido).
    """
    nombres = {norm(artista["name"])} | {norm(a) for a in artista.get("aliases") or []}
    previo = spotify_id((artista["links"].get("spotify") or {}).get("url")) \
        if (artista["links"].get("spotify") or {}).get("verified") else None
    casados, perfiles = [], {}
    for d in discos:
        if (d["links"].get("spotify") or {}).get("verified"):
            continue
        q = f'album:"{d["title"]}" artist:"{artista["name"]}"'
        res = sp.get("/search?" + urllib.parse.urlencode({"q": q, "type": "album", "limit": 10}))
        plat = []
        for a in (res.get("albums") or {}).get("items") or []:
            if not a:
                continue
            ids = [x["id"] for x in a.get("artists") or [] if norm(x.get("name")) in nombres]
            if previo and previo not in [x["id"] for x in a.get("artists") or []] and not ids:
                continue
            if ids:
                plat.append({"id": a["id"], "title": a["name"], "year": year_of(a.get("release_date")),
                             "url": f"https://open.spotify.com/album/{a['id']}", "artist": ids[0],
                             "artist_name": next(x["name"] for x in a["artists"] if x["id"] == ids[0])})
        p = pick(d, plat)
        if p:
            casados.append({"albumId": d["id"], "url": p["url"], "id": p["id"], "title_plat": p["title"], "year_plat": p["year"]})
            perfiles.setdefault(p["artist"], [p["artist_name"], 0])[1] += 1
    artist_link = None
    if perfiles:
        aid, (nombre, comunes) = max(perfiles.items(), key=lambda kv: kv[1][1])
        artist_link = {"url": f"https://open.spotify.com/artist/{aid}", "id": aid, "name_plat": nombre, "comunes": comunes,
                       "ya_verificado": aid == previo, "otros_perfiles": len(perfiles) - 1}
    return {"artist_link": artist_link, "album_links": casados}


# ------------------------------------------------------------------------- ytmusic

class YTM:
    def __init__(self):
        from ytmusicapi import YTMusic
        self.yt = YTMusic()

    def call(self, fn, *args, **kw):
        for intento in range(4):
            time.sleep(0.8)
            try:
                return getattr(self.yt, fn)(*args, **kw)
            except Exception as e:  # la API interna devuelve errores genéricos ante límites
                if intento == 3:
                    raise
                time.sleep(15 * (intento + 1))
                last = e
        return None


def cosechar_ytmusic(ytm, artista, discos):
    nombres = {norm(artista["name"])} | {norm(a) for a in artista.get("aliases") or []}
    pendientes = [d for d in discos if not (d["links"].get("youtube_music") or {}).get("verified")]
    canal, casados, encontrados = None, {}, {}
    busquedas = 0
    for d in pendientes:
        if canal or busquedas >= 8:
            break
        busquedas += 1
        for r in ytm.call("search", f"{artista['name']} {d['title']}", filter="albums", limit=10) or []:
            artistas = [a for a in r.get("artists") or [] if a.get("name")]
            if norm(r.get("title")) != norm(d["title"]) or not any(norm(a["name"]) in nombres for a in artistas):
                continue
            ids = [a.get("id") for a in artistas if norm(a["name"]) in nombres and a.get("id")]
            canal = canal or (ids[0] if ids else None)
            encontrados.setdefault(d["id"], {"browseId": r["browseId"], "title": r["title"], "year": year_of(r.get("year"))})
            break
    songs = None
    if canal:
        try:
            ar = ytm.call("get_artist", canal)
        except Exception:
            ar = None
        if ar:
            songs = ((ar.get("songs") or {}).get("browseId") or "").removeprefix("VL") or None
            plat = []
            for k in ("albums", "singles"):
                b = ar.get(k) or {}
                res = b.get("results") or []
                if b.get("browseId") and b.get("params"):
                    try:
                        res = ytm.call("get_artist_albums", b["browseId"], b["params"], limit=None) or res
                    except Exception:
                        pass
                plat += [{"browseId": x.get("browseId"), "title": x.get("title"), "year": year_of(x.get("year"))} for x in res if x.get("browseId")]
            for d in pendientes:
                if d["id"] not in encontrados:
                    p = pick(d, plat)
                    if p:
                        encontrados[d["id"]] = p
    for album_id, p in encontrados.items():
        try:
            al = ytm.call("get_album", p["browseId"])
        except Exception:
            continue
        lista = (al or {}).get("audioPlaylistId")
        if lista:
            casados[album_id] = {"albumId": album_id, "url": f"https://music.youtube.com/playlist?list={lista}", "id": lista,
                                 "title_plat": p["title"], "year_plat": p.get("year") or year_of(al.get("year")), "browseId": p["browseId"]}
    comunes = len(casados)
    artist_link = None
    if canal and comunes:
        artist_link = {"url": f"https://music.youtube.com/channel/{canal}", "id": songs, "comunes": comunes}
    return {"artist_link": artist_link, "album_links": list(casados.values()), "busquedas": busquedas}


# ------------------------------------------------------------------------ bandcamp

ITEM_RE = re.compile(r'<li[^>]*data-item-id="(album|track)-(\d+)"[^>]*>\s*<a href="([^"]+)">.*?<p class="title">\s*(.*?)\s*(?:<br>|</p>)', re.S)


def cosechar_bandcamp(artista, discos):
    previo = artista["links"].get("bandcamp") or {}
    if not previo.get("verified"):
        return {"artist_link": None, "album_links": []}
    base = re.match(r"https?://[^/]+", previo["url"]).group(0)
    time.sleep(1.5)
    # urllib recibe el «Client Challenge» de Bandcamp (huella TLS); curl no.
    pagina = subprocess.run(["curl", "-sL", "--max-time", "40", "-A", "Mozilla/5.0 (X11; Linux x86_64)", base + "/music"],
                            capture_output=True, text=True, check=True).stdout
    if "<title>Client Challenge</title>" in pagina:
        raise RuntimeError("Bandcamp pidió desafío")
    plat = []
    for tipo, item_id, href, titulo in ITEM_RE.findall(pagina):
        titulo = html.unescape(re.sub(r"<[^>]+>", "", titulo)).strip()
        plat.append({"tipo": tipo, "id": item_id, "title": titulo, "year": None, "url": urllib.parse.urljoin(base, href)})
    m = re.search(r'data-client-items="([^"]+)"', pagina)
    if m:
        for x in json.loads(html.unescape(m.group(1))):
            plat.append({"tipo": x.get("type"), "id": str(x.get("id")), "title": x.get("title"), "year": None,
                         "url": urllib.parse.urljoin(base, x.get("page_url") or "")})
    if not plat:  # perfil de un solo disco: /music lleva a la página del disco
        props = re.search(r'<meta name="bc-page-properties" content="([^"]+)"', pagina)
        titulo = re.search(r'<meta name="title" content="([^"]+)"', pagina)
        if props and titulo:
            p = json.loads(html.unescape(props.group(1)))
            plat.append({"tipo": "album" if p.get("item_type") == "a" else "track", "id": str(p.get("item_id")),
                         "title": html.unescape(titulo.group(1)).split(", by ")[0], "year": None, "url": base + "/music"})
    casados = []
    for d in discos:
        if (d["links"].get("bandcamp") or {}).get("verified"):
            continue
        p = pick(d, plat)
        if p:
            casados.append({"albumId": d["id"], "url": p["url"], "id": f"{p['tipo']}={p['id']}", "title_plat": p["title"], "year_plat": None})
    return {"artist_link": None, "album_links": casados, "items": len(plat)}


# --------------------------------------------------------------------------- tidal

class Tidal:
    """API oficial (openapi.tidal.com/v2, credencial de developer.tidal.com en .env)."""

    def __init__(self):
        self.cid, self.sec = env("TIDAL_CLIENT_ID"), env("TIDAL_CLIENT_SECRET")
        if not (self.cid and self.sec):
            raise SystemExit("faltan TIDAL_CLIENT_ID/TIDAL_CLIENT_SECRET")
        self.token, self.vence = None, 0

    def get(self, path, params):
        if not self.token or time.time() > self.vence:
            d = http("https://auth.tidal.com/v1/oauth2/token", data={"grant_type": "client_credentials"},
                     headers={"Authorization": "Basic " + base64.b64encode(f"{self.cid}:{self.sec}".encode()).decode()})
            self.token, self.vence = d["access_token"], time.time() + d.get("expires_in", 3600) - 120
        time.sleep(float(os.environ.get("CRV_TIDAL_PAUSA", "1")))
        return http("https://openapi.tidal.com/v2" + path + "?" + urllib.parse.urlencode(params),
                    headers={"Authorization": "Bearer " + self.token, "accept": "application/vnd.api+json"})


def cosechar_tidal(td, artista, discos):
    """Una búsqueda por disco («artista título»); vale título idéntico con un artista de nombre exacto."""
    nombres = {norm(artista["name"])} | {norm(a) for a in artista.get("aliases") or []}
    casados, perfiles = [], {}
    for d in discos:
        if (d["links"].get("tidal") or {}).get("verified"):
            continue
        res = td.get("/searchResults", {"filter[query]": f"{artista['name']} {d['title']}"[:200], "countryCode": "US",
                                        "include": "albums,albums.artists"})
        inc = {(x["type"], x["id"]): x for x in res.get("included") or []}
        plat = []
        for x in res.get("included") or []:
            if x["type"] != "albums":
                continue
            artistas = [inc.get(("artists", r["id"])) for r in ((x.get("relationships") or {}).get("artists") or {}).get("data") or []]
            ids = [a["id"] for a in artistas if a and norm(a["attributes"].get("name")) in nombres]
            if ids:
                at = x["attributes"]
                plat.append({"id": x["id"], "title": at.get("title"), "year": year_of(at.get("releaseDate")),
                             "url": f"https://tidal.com/browse/album/{x['id']}", "artist": ids[0],
                             "artist_name": inc[("artists", ids[0])]["attributes"].get("name")})
        p = pick(d, plat)
        if p:
            casados.append({"albumId": d["id"], "url": p["url"], "id": p["id"], "title_plat": p["title"], "year_plat": p["year"]})
            perfiles.setdefault(p["artist"], [p["artist_name"], 0])[1] += 1
    artist_link = None
    if perfiles:
        aid, (nombre, comunes) = max(perfiles.items(), key=lambda kv: kv[1][1])
        artist_link = {"url": f"https://tidal.com/browse/artist/{aid}", "id": aid, "name_plat": nombre, "comunes": comunes}
    return {"artist_link": artist_link, "album_links": casados}


# ---------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plataforma", choices=["spotify", "ytmusic", "bandcamp", "tidal"])
    ap.add_argument("--dir", default="reports/streaming-embeds-2026-10-13")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    base = Path(args.dir)
    out = base / args.plataforma
    out.mkdir(parents=True, exist_ok=True)
    artistas = [json.loads(l) for l in (base / "entrada" / "artistas.jsonl").read_text().splitlines() if l.strip()]
    discos = {}
    for l in (base / "entrada" / "discos.jsonl").read_text().splitlines():
        if l.strip():
            d = json.loads(l)
            discos.setdefault(d["artistId"], []).append(d)
    if args.plataforma == "bandcamp":
        artistas = [a for a in artistas if (a["links"].get("bandcamp") or {}).get("verified")]
    motor = {"spotify": Spotify, "ytmusic": YTM, "tidal": Tidal}.get(args.plataforma, lambda: None)()
    hechos = errores = 0
    for i, a in enumerate(artistas):
        dest = out / f"a-{a['id']}.json"
        if dest.exists():
            continue
        if args.limit and hechos >= args.limit:
            break
        try:
            if args.plataforma == "spotify":
                r = cosechar_spotify(motor, a, discos.get(a["id"], []))
            elif args.plataforma == "ytmusic":
                r = cosechar_ytmusic(motor, a, discos.get(a["id"], []))
            elif args.plataforma == "tidal":
                r = cosechar_tidal(motor, a, discos.get(a["id"], []))
            else:
                r = cosechar_bandcamp(a, discos.get(a["id"], []))
        except Exception as e:  # noqa: BLE001 — se anota y se sigue; el archivo no se escribe y se reintenta
            errores += 1
            print(f"[{i + 1}/{len(artistas)}] {a['name']}: ERROR {str(e)[:120]}", flush=True)
            if "rate-limit largo" in str(e):
                sys.exit(3)
            time.sleep(5)
            continue
        r.update({"artistId": a["id"], "name": a["name"]})
        dest.write_text(json.dumps(r, ensure_ascii=False))
        hechos += 1
        print(f"[{i + 1}/{len(artistas)}] {a['name']}: perfil {'sí' if r['artist_link'] else 'no'} · discos {len(r['album_links'])}", flush=True)
    print(f"fin: {hechos} artistas nuevos, {errores} errores", flush=True)


if __name__ == "__main__":
    main()
