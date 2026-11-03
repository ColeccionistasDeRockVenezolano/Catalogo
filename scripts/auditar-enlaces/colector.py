#!/usr/bin/env python3
"""Auditoría de enlaces del catálogo: quién hay detrás de cada URL.

Pregunta a cada plataforma por sus vías públicas u oficiales (APIs, oEmbed,
incrustados) y guarda lo que dice de sí misma: nombre, discos y pistas.
No escribe en la base; el juicio lo hace analizar.py. Reanudable: salta las URL
ya guardadas. Facebook, Instagram, Threads, Amazon y Bandcamp no se consultan: no ofrecen vía
pública o responden con un control antibots, que no se intenta saltar.

  python3 scripts/auditar-enlaces/colector.py --out DIR --plat deezer
  (ytmusic necesita ~/.venvs/crv-embeds/bin/python)
"""
import argparse, base64, html, json, os, re, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

UA = {"User-Agent": "CRV-auditoria-enlaces/1.0 (+coleccionistasderockvenezolano.com)", "Accept-Language": "es,en"}


def env(name):
    for line in Path(".env").read_text().splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip('"')
    return os.environ.get(name, "")


def http(url, data=None, headers=None, timeout=30):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    for intento in range(5):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf8", "ignore")
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and intento < 4:
                time.sleep(float(e.headers.get("Retry-After") or 0) or 20 * (intento + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if intento == 4:
                raise
            time.sleep(5 * (intento + 1))


def js(url, **k):
    return json.loads(http(url, **k))


def urls_of(out, plats):
    vistos = {}
    for line in open(out / "enlaces.jsonl", encoding="utf8"):
        d = json.loads(line)
        if d["platform"] in plats:
            vistos.setdefault(d["url"], d)
    return vistos


class Salida:
    def __init__(self, out, plat):
        self.path = out / f"evidencia-{plat}.jsonl"
        self.hechas = set()
        if self.path.exists():
            for line in open(self.path, encoding="utf8"):
                self.hechas.add(json.loads(line)["url"])
        self.f = open(self.path, "a", encoding="utf8")

    def __call__(self, url, **datos):
        self.f.write(json.dumps({"url": url, **datos}, ensure_ascii=False) + "\n")
        self.f.flush()
        self.hechas.add(url)


def uno_a_uno(out, plats, nombre, fn, pausa):
    urls = urls_of(out, plats)
    salida = Salida(out, nombre)
    pendientes = [u for u in urls if u not in salida.hechas]
    print(nombre, "pendientes", len(pendientes), flush=True)
    for n, url in enumerate(pendientes):
        try:
            salida(url, **fn(url, urls[url]))
        except urllib.error.HTTPError as e:
            salida(url, err=f"HTTP {e.code}")
        except Exception as e:  # una URL rara no para la campaña
            salida(url, err=str(e)[:120])
        if n % 200 == 0:
            print(nombre, n, flush=True)
        time.sleep(pausa)
    print(nombre, "FIN", flush=True)


def deezer(url, _):
    m = re.search(r"/(artist|album|track)/(\d+)", url)
    if not m:
        return {"err": "url sin id"}
    tipo, i = m.groups()
    d = js(f"https://api.deezer.com/{tipo}/{i}")
    if d.get("error"):
        return {"err": "no existe", "tipo": tipo}
    if tipo == "artist":
        al = js(f"https://api.deezer.com/artist/{i}/albums?limit=200").get("data", [])
        top = js(f"https://api.deezer.com/artist/{i}/top?limit=50").get("data", [])
        return {"tipo": tipo, "name": d.get("name"), "albums": [a.get("title") for a in al], "tracks": [t.get("title") for t in top], "nalb": d.get("nb_album")}
    return {"tipo": tipo, "name": d.get("title"), "artists": [a.get("name") for a in d.get("contributors", [])] or [d.get("artist", {}).get("name")]}


def embed_spotify(url, _):
    m = re.search(r"open\.spotify\.com/(?:[a-z-]+/)?(artist|album|track|playlist)/([A-Za-z0-9]+)", url)
    if not m:
        return {"err": "url sin id"}
    tipo, i = m.groups()
    b = http(f"https://open.spotify.com/embed/{tipo}/{i}")
    n = re.search(r'__NEXT_DATA__"[^>]*>(.*?)</script>', b, re.S)
    if not n:
        return {"err": "sin datos", "tipo": tipo}
    e = json.loads(n.group(1))["props"]["pageProps"].get("state", {}).get("data", {}).get("entity") or {}
    if not e:
        return {"err": "no existe", "tipo": tipo}
    pistas = e.get("trackList") or []
    if tipo == "artist":
        return {"tipo": tipo, "name": e.get("name") or e.get("title"), "tracks": [t.get("title") for t in pistas]}
    return {"tipo": tipo, "name": e.get("name") or e.get("title"), "artists": [e.get("subtitle")], "tracks": [t.get("title") for t in pistas], "creditos_pista": sorted({c.strip() for t in pistas for c in (t.get("subtitle") or "").replace("\xa0", " ").split(",") if c.strip()})}


def apple(out):
    urls = urls_of(out, {"apple_music"})
    salida = Salida(out, "apple")
    ids = {}
    for u in urls:
        if u in salida.hechas:
            continue
        m = re.search(r"/(?:album|artist)/(?:[^/?]*/)?(?:id)?(\d+)", u)
        if m:
            ids[u] = (m.group(1), "artist" if "/artist/" in u else "album")
        else:
            salida(u, err="url sin id")
    for tipo, tam in (("artist", 15), ("album", 150)):
        lista = [(u, i) for u, (i, t) in ids.items() if t == tipo]
        print("apple", tipo, len(lista), flush=True)
        for s in range(0, len(lista), tam):
            parte = lista[s:s + tam]
            q = ",".join(i for _, i in parte)
            extra = "&entity=album&limit=60" if tipo == "artist" else ""
            try:
                res = js(f"https://itunes.apple.com/lookup?id={q}{extra}").get("results", [])
            except Exception as e:
                print("apple err", e, flush=True)
                time.sleep(60)
                continue
            for u, i in parte:
                if tipo == "artist":
                    fila = [r for r in res if str(r.get("artistId")) == i]
                    a = next((r for r in fila if r.get("wrapperType") == "artist"), None)
                    if a:
                        salida(u, tipo=tipo, name=a.get("artistName"), albums=[r.get("collectionName") for r in fila if r.get("wrapperType") == "collection"])
                    else:
                        salida(u, tipo=tipo, err="no existe")
                else:
                    a = next((r for r in res if str(r.get("collectionId")) == i), None)
                    if a:
                        salida(u, tipo=tipo, name=a.get("collectionName"), artists=[a.get("artistName")], pais=a.get("country"))
                    else:
                        salida(u, tipo=tipo, err="no existe")
            time.sleep(3.3)  # iTunes: unas 20 consultas por minuto
    print("apple FIN", flush=True)


def tidal(out):
    urls = urls_of(out, {"tidal"})
    salida = Salida(out, "tidal")
    cid, sec = env("TIDAL_CLIENT_ID"), env("TIDAL_CLIENT_SECRET")
    tok = {"t": "", "exp": 0}

    def token():
        if time.time() > tok["exp"]:
            d = json.loads(http("https://auth.tidal.com/v1/oauth2/token", data=b"grant_type=client_credentials",
                                headers={"Authorization": "Basic " + base64.b64encode(f"{cid}:{sec}".encode()).decode(), "Content-Type": "application/x-www-form-urlencoded"}))
            tok.update(t=d["access_token"], exp=time.time() + d.get("expires_in", 3600) - 60)
        return {"Authorization": "Bearer " + tok["t"], "Accept": "application/vnd.api+json"}

    tareas = {"artists": [], "albums": []}
    for u in urls:
        if u in salida.hechas:
            continue
        m = re.search(r"/(artist|album)/(\d+)", u)
        if m:
            tareas[m.group(1) + "s"].append((u, m.group(2)))
        else:
            salida(u, err="url sin id")
    for tipo, lista in tareas.items():
        print("tidal", tipo, len(lista), flush=True)
        for s in range(0, len(lista), 20):
            parte = lista[s:s + 20]
            q = urllib.parse.urlencode({"filter[id]": ",".join(i for _, i in parte), "countryCode": "US", "include": "albums" if tipo == "artists" else "artists"})
            try:
                d = js(f"https://openapi.tidal.com/v2/{tipo}?{q}", headers=token())
            except urllib.error.HTTPError as e:
                print("tidal err", e.code, flush=True)
                time.sleep(30)
                continue
            inc = {(x["type"], x["id"]): x for x in d.get("included") or []}
            filas = {x["id"]: x for x in d.get("data") or []}
            for u, i in parte:
                x = filas.get(i)
                if not x:
                    salida(u, tipo=tipo[:-1], err="no existe")
                    continue
                rel = x.get("relationships") or {}
                if tipo == "artists":
                    al = [inc.get(("albums", r["id"])) for r in (rel.get("albums") or {}).get("data") or []]
                    salida(u, tipo="artist", name=x["attributes"].get("name"), albums=[a["attributes"].get("title") for a in al if a])
                else:
                    ar = [inc.get(("artists", r["id"])) for r in (rel.get("artists") or {}).get("data") or []]
                    salida(u, tipo="album", name=x["attributes"].get("title"), artists=[a["attributes"].get("name") for a in ar if a])
            time.sleep(1.2)
    print("tidal FIN", flush=True)


def ytmusic(out):
    from ytmusicapi import YTMusic
    yt = YTMusic()

    def fn(url, _):
        c = re.search(r"/channel/([\w-]+)", url)
        if c:
            a = yt.get_artist(c.group(1))
            al = ((a.get("albums") or {}).get("results") or []) + ((a.get("singles") or {}).get("results") or [])
            return {"tipo": "artist", "name": a.get("name"), "albums": [x.get("title") for x in al], "tracks": [x.get("title") for x in (a.get("songs") or {}).get("results") or []]}
        p = re.search(r"[?&]list=([\w-]+)", url)
        if p:
            b = yt.get_album_browse_id(p.group(1))
            if not b:
                return {"err": "no existe"}
            d = yt.get_album(b)
            return {"tipo": "album", "name": d.get("title"), "artists": [a.get("name") for a in d.get("artists") or []]}
        return {"err": "url sin id"}

    uno_a_uno(out, {"youtube_music"}, "ytmusic", fn, 0.25)


def youtube(out):
    urls = urls_of(out, {"youtube"})
    salida = Salida(out, "youtube")
    key = env("YOUTUBE_API_KEY")
    canales, videos = [], []
    for u in urls:
        if u in salida.hechas:
            continue
        c = re.search(r"/channel/(UC[\w-]+)", u)
        v = re.search(r"(?:v=|youtu\.be/|/embed/)([\w-]{11})", u)
        h = re.search(r"youtube\.com/(?:@|user/|c/)([^/?]+)", u)
        if c:
            canales.append((u, c.group(1)))
        elif v:
            videos.append((u, v.group(1)))
        elif h:
            try:
                campo = "forUsername" if "/user/" in u else "forHandle"
                d = js(f"https://www.googleapis.com/youtube/v3/channels?part=snippet&{campo}={urllib.parse.quote(h.group(1))}&key={key}")
                it = (d.get("items") or [None])[0]
                salida(u, tipo="channel", name=it["snippet"]["title"], desc=it["snippet"].get("description", "")[:600], pais=it["snippet"].get("country")) if it else salida(u, err="no existe")
            except Exception as e:
                salida(u, err=str(e)[:100])
        else:
            salida(u, err="url sin id")
    for ruta, lista in (("channels", canales), ("videos", videos)):
        print("youtube", ruta, len(lista), flush=True)
        for s in range(0, len(lista), 50):
            parte = lista[s:s + 50]
            d = js(f"https://www.googleapis.com/youtube/v3/{ruta}?part=snippet&maxResults=50&id={','.join(i for _, i in parte)}&key={key}")
            filas = {x["id"]: x["snippet"] for x in d.get("items", [])}
            for u, i in parte:
                sn = filas.get(i)
                if not sn:
                    salida(u, err="no existe")
                elif ruta == "channels":
                    salida(u, tipo="channel", name=sn.get("title"), desc=sn.get("description", "")[:600], pais=sn.get("country"))
                else:
                    salida(u, tipo="video", name=sn.get("title"), artists=[sn.get("channelTitle")], desc=sn.get("description", "")[:300])
            time.sleep(0.2)
    print("youtube FIN", flush=True)


def meta(b, prop):
    m = re.search(rf'<meta[^>]+(?:property|name)=["\']{prop}["\'][^>]+content=["\']([^"\']*)', b) or re.search(rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]+(?:property|name)=["\']{prop}["\']', b)
    return html.unescape(m.group(1)) if m else ""


def titulo(b):
    m = re.search(r"<title[^>]*>(.*?)</title>", b, re.S)
    return re.sub(r"\s+", " ", html.unescape(m.group(1))).strip() if m else ""


def texto(b):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<script.*?</script>|<style.*?</style>|<[^>]+>", " ", b, flags=re.S)))


def qobuz(url, _):
    b = http(url)
    return {"tipo": "album" if "/album/" in url else "artist", "name": titulo(b)[:200], "og": meta(b, "og:title")[:200],
            "albums": re.findall(r'data-gtm-name="([^"]+)"', b)[:80] or [html.unescape(x) for x in re.findall(r'"name":"([^"]{2,120})","@type":"MusicAlbum"', b)][:80]}


def soundcloud(url, _):
    d = js("https://soundcloud.com/oembed?format=json&url=" + urllib.parse.quote(url))
    return {"tipo": "perfil", "name": d.get("author_name") or d.get("title"), "titulo": d.get("title"), "desc": (d.get("description") or "")[:300]}


def web(url, _):
    b = http(url, timeout=20)
    if re.search(r"client challenge|bot verification|verifying you are|just a moment|attention required", titulo(b), re.I):
        return {"err": "control antibots"}
    return {"tipo": "web", "name": titulo(b)[:200], "og": meta(b, "og:site_name")[:120], "desc": (meta(b, "description") or meta(b, "og:description"))[:400], "cuerpo": texto(b)[:6000]}


def x(url, _):
    d = js("https://publish.twitter.com/oembed?url=" + urllib.parse.quote(url))
    return {"tipo": "perfil", "name": d.get("author_name") or d.get("title") or "", "existe": True}


def tiktok(url, _):
    d = js("https://www.tiktok.com/oembed?url=" + urllib.parse.quote(re.sub(r"^https?://(www\.)?", "https://www.", url)))
    return {"tipo": "perfil", "name": d.get("author_name"), "titulo": d.get("title"), "existe": True}


def bluesky(url, _):
    h = re.search(r"/profile/([^/?]+)", url).group(1)
    d = js("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=" + h)
    return {"tipo": "perfil", "name": d.get("displayName"), "desc": (d.get("description") or "")[:300]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--plat", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    p = a.plat
    if p == "deezer":
        uno_a_uno(out, {"deezer"}, p, deezer, 0.12)
    elif p == "spotify":
        uno_a_uno(out, {"spotify"}, p, embed_spotify, 0.4)
    elif p == "apple":
        apple(out)
    elif p == "tidal":
        tidal(out)
    elif p == "ytmusic":
        ytmusic(out)
    elif p == "youtube":
        youtube(out)
    elif p == "qobuz":
        uno_a_uno(out, {"qobuz"}, p, qobuz, 0.6)
    elif p == "soundcloud":
        uno_a_uno(out, {"soundcloud"}, p, soundcloud, 0.5)
    elif p == "web":
        uno_a_uno(out, {"website", "linktree", "store"}, p, web, 0.5)
    elif p == "x":
        uno_a_uno(out, {"x"}, p, x, 1.0)
    elif p == "tiktok":
        uno_a_uno(out, {"tiktok"}, p, tiktok, 1.0)
    elif p == "bluesky":
        uno_a_uno(out, {"bluesky"}, p, bluesky, 0.5)
    else:
        raise SystemExit("plataforma desconocida")


if __name__ == "__main__":
    main()
