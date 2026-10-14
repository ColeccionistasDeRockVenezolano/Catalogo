#!/usr/bin/env python3
"""CRV · Spotify diario: un solo dueño de la cuota (2026-10-14).

Brian: «hay un cron … que ya hace algo de spotify, como se pueden unificar y aprovechar mejor».
Antes había dos consumidores de las mismas dos credenciales: el lote de artistas sin foto
(Hermes `spotify-lote-reanudar`, cada 4 h) y la cosecha de reproductores. Cada credencial
aguanta unas 700 llamadas al día antes de un castigo de ~24 h (2026-10-13), así que ahora una
sola corrida diaria reparte un tope por credencial:

  1. fotos     — termina la captura del lote sin foto (tmp-analysis/spotify-lote-2026-10-03:
                 exact1 sin discos), con los mismos archivos que fetch_artist.py; al terminar,
                 dry-run + informe y aviso (la aplicación sigue siendo revisada a mano).
  2. reproductores — discos de Spotify para el selector de plataformas
                 (reports/streaming-embeds-2026-10-13/spotify), con la estrategia barata:
                   · perfil verificado o exact1 del barrido → lista de discos del artista;
                   · barrido sin_match → nada (la regla exige nombre idéntico);
                   · sin barrer → una búsqueda del artista; con un homónimo exacto, su lista;
                   · varios homónimos (exacto_n) → búsqueda disco por disco, como antes.
  3. aplicación — los discos nuevos van a public.streaming_links en un run reversible.

Uso: ~/.venvs/crv-embeds/bin/python -I ops/spotify-diario/diario.py [--tope N] [--solo fotos|reproductores]
Estado y diario: data/raw/spotify-diario/ (cuota.json, diario.log).
"""
import argparse
import base64
import importlib.util
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ESTADO = ROOT / "data/raw/spotify-diario"
LOTE = ROOT / "tmp-analysis/spotify-lote-2026-10-03"
CAPTURAS = ROOT / "data/raw/spotify-lote-2026-10-03"
EMBEDS = ROOT / "reports/streaming-embeds-2026-10-13"
IMAGENES = Path.home() / ".hermes/skills/media/spotify-artist-extract/scripts/download_images.py"


def cargar(nombre, ruta):
    spec = importlib.util.spec_from_file_location(nombre, ruta)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cosecha = cargar("cosecha", ROOT / "scripts/streaming-embeds-cosecha.py")
norm, pick, year_of, env = cosecha.norm, cosecha.pick, cosecha.year_of, cosecha.env


def log(msg):
    print(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}", flush=True)


class Agotada(Exception):
    """Sin cuota hoy para ese tipo de consulta en ninguna credencial."""


def tipo(path):
    """La cuota del modo desarrollo va por grupos de endpoints (Spotify no publica cuáles) y por
    cuenta de desarrollador: dos apps de la misma cuenta comparten cuota (blog del 2026-07-23).
    Medido el 2026-10-14: con la búsqueda sin cuota, la ficha del artista y la del disco seguían
    respondiendo; la principal y la de respaldo se agotan por separado (cuentas distintas)."""
    p = path.split("?")[0]
    if p.startswith("/search"):
        return "busqueda"
    if p.startswith("/artists/") and p.endswith("/albums"):
        return "discos-del-artista"
    if p.startswith("/albums/") and p.endswith("/tracks"):
        return "pistas"
    return "ficha-disco" if p.startswith("/albums/") else "ficha-artista"


class Cuota:
    """Tope diario por credencial y tipo de consulta, con el castigo (Retry-After largo)
    recordado entre corridas."""

    def __init__(self, tope, pausa):
        self.tope, self.pausa = tope, pausa
        self.ruta = ESTADO / "cuota.json"
        self.creds = [(n, c, s) for n, c, s in (
            ("principal", env("SPOTIFY_CLIENT_ID"), env("SPOTIFY_CLIENT_SECRET")),
            ("respaldo", env("SPOTIFY_FALLBACK_CLIENT_ID"), env("SPOTIFY_FALLBACK_CLIENT_SECRET"))) if c and s]
        self.e = json.loads(self.ruta.read_text()) if self.ruta.exists() else {}
        hoy = date.today().isoformat()
        if self.e.get("fecha") != hoy:
            self.e.update({"fecha": hoy, "usadas": {}})
        self.e.setdefault("castigo_hasta", {})
        self.tokens = {}

    def guardar(self):
        ESTADO.mkdir(parents=True, exist_ok=True)
        self.ruta.write_text(json.dumps(self.e, indent=1, ensure_ascii=False))

    def usadas(self, nombre, t=None):
        u = self.e["usadas"].get(nombre) or {}
        return u.get(t, 0) if t else sum(u.values())

    def libre(self, t):
        for nombre, cid, sec in self.creds:
            if self.usadas(nombre, t) < self.tope and (self.e["castigo_hasta"].get(nombre) or {}).get(t, 0) < time.time():
                return nombre, cid, sec
        raise Agotada(f"sin cuota hoy para «{t}»")

    def disponible(self, t):
        try:
            self.libre(t)
            return True
        except Agotada:
            return False

    def token(self, nombre, cid, sec):
        tok, vence = self.tokens.get(nombre, (None, 0))
        if not tok or time.time() > vence:
            req = urllib.request.Request("https://accounts.spotify.com/api/token",
                                         data=urllib.parse.urlencode({"grant_type": "client_credentials"}).encode(),
                                         headers={"Authorization": "Basic " + base64.b64encode(f"{cid}:{sec}".encode()).decode()})
            d = json.load(urllib.request.urlopen(req, timeout=30))
            tok, vence = d["access_token"], time.time() + d.get("expires_in", 3600) - 120
            self.tokens[nombre] = (tok, vence)
        return tok

    def get(self, path):
        t = tipo(path)
        for intento in range(4):
            nombre, cid, sec = self.libre(t)
            time.sleep(self.pausa)
            self.e["usadas"].setdefault(nombre, {})[t] = self.usadas(nombre, t) + 1
            self.guardar()
            req = urllib.request.Request("https://api.spotify.com/v1" + path, headers={
                **cosecha.UA, "Authorization": "Bearer " + self.token(nombre, cid, sec)})
            try:
                return json.load(urllib.request.urlopen(req, timeout=30))
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    # Dos 429 distintos (developer.spotify.com, rate-limits y quota-modes): el límite de
                    # ritmo (ventana móvil de 30 s; se espera Retry-After) y la cuota diaria del modo
                    # desarrollo, por cuenta de desarrollador y por grupo de endpoints, con
                    # «reason»: «QUOTA_EXCEEDED» (ese grupo queda cerrado hasta Retry-After).
                    espera = int(e.headers.get("Retry-After") or 0) or 30
                    try:
                        razon = json.loads(e.read().decode(errors="replace"))["error"].get("reason")
                    except Exception:  # noqa: BLE001
                        razon = None
                    if razon == "QUOTA_EXCEEDED" or espera > 600:
                        self.e["castigo_hasta"].setdefault(nombre, {})[t] = time.time() + max(espera, 3600)
                        self.guardar()
                        log(f"spotify: {nombre} sin cuota en «{t}» ({razon or '429'}, {espera} s); paso a la siguiente")
                    else:
                        time.sleep(espera + 1)
                    continue
                if e.code == 401:
                    self.tokens.pop(nombre, None)
                    continue
                if e.code in (500, 502, 503) and intento < 3:
                    time.sleep(5 * (intento + 1))
                    continue
                raise RuntimeError(f"HTTP {e.code} {path}: {e.read().decode(errors='replace')[:160]}") from e
        raise RuntimeError(f"agotados los reintentos en {path}")

    def paginar(self, path, params, limite=10, maximo=200):
        items, offset = [], 0
        while offset < maximo:
            page = self.get(f"{path}?" + urllib.parse.urlencode({**params, "limit": limite, "offset": offset}))
            items += page.get("items") or []
            if not page.get("next"):
                break
            offset += limite
        return items

    def resumen(self):
        return " · ".join(f"{n} {self.usadas(n)}" for n, _, _ in self.creds)


# ------------------------------------------------------------------------------ 1. fotos

def fotos(sp):
    """Termina la captura del lote sin foto con los archivos de fetch_artist.py."""
    capturar = cargar("capturar", LOTE / "capturar.py")
    sel = [r for r in map(json.loads, (LOTE / "matches.jsonl").read_text().splitlines())
           if r["status"] == "exact1" and r.get("spotify_id") and r["discos"] == 0]
    faltan = [r for r in sel if not capturar.captura_completa(str(CAPTURAS / f"{r['artist_id']}-{capturar.slugify(r['artist_name'])}"))]
    log(f"fotos: faltan {len(faltan)} de {len(sel)}")
    hechos = 0
    with open(LOTE / "capturar.jsonl", "a") as estado:
        for r in faltan:
            slug = f"{r['artist_id']}-{capturar.slugify(r['artist_name'])}"
            dest = CAPTURAS / slug
            dest.mkdir(parents=True, exist_ok=True)
            try:
                capturar_artista(sp, r["spotify_id"], dest)
                img = subprocess.run([sys.executable, "-I", str(IMAGENES), str(dest)], capture_output=True, text=True, timeout=600)
                if img.returncode != 0:
                    raise RuntimeError(img.stderr.strip()[-300:] or f"imágenes: exit {img.returncode}")
                rec = {"estado": "ok", "detalle": "spotify-diario"}
                hechos += 1
            except Agotada:
                raise
            except Exception as e:  # noqa: BLE001 — se anota y se sigue
                rec = {"estado": "error", "detalle": str(e)[-300:]}
            estado.write(json.dumps({"artist_id": r["artist_id"], "name": r["artist_name"], "spotify_id": r["spotify_id"],
                                     "dir": slug, **rec}, ensure_ascii=False) + "\n")
            estado.flush()
            log(f"fotos: {r['artist_id']} {r['artist_name']} → {rec['estado']} ({sp.resumen()})")
    return hechos, len(faltan) - hechos


def capturar_artista(sp, artist_id, dest):
    """artist.json, albums.json, albums-appears.json, album-<id>.json y tracks-<id>.json; las pistas
    salen de la ficha del disco cuando caben (una llamada menos por disco)."""
    def escribir(nombre, datos):
        (dest / nombre).write_text(json.dumps(datos, ensure_ascii=False, indent=1))
    escribir("artist.json", sp.get(f"/artists/{artist_id}"))
    albums = sp.paginar(f"/artists/{artist_id}/albums", {"include_groups": "album,single,compilation"})
    escribir("albums.json", albums)
    appears = sp.paginar(f"/artists/{artist_id}/albums", {"include_groups": "appears_on"}, maximo=100)
    if appears:
        escribir("albums-appears.json", appears)
    for a in albums:
        if (dest / f"tracks-{a['id']}.json").exists():
            continue
        full = sp.get(f"/albums/{a['id']}")
        escribir(f"album-{a['id']}.json", full)
        tracks = full.get("tracks") or {}
        items = tracks.get("items") or []
        if tracks.get("next"):
            items = sp.paginar(f"/albums/{a['id']}/tracks", {}, limite=50, maximo=1000)
        escribir(f"tracks-{a['id']}.json", items)


def cerrar_fotos():
    """Primera vez que no falta ninguna: dry-run + informe y aviso, como el orquestador de Hermes."""
    sello = LOTE / "REANUDADO.txt"
    if sello.exists():
        return
    for script in ("aplicar.py", "informe.py"):
        subprocess.run([sys.executable, str(LOTE / script)], cwd=ROOT, timeout=14400)
    ok = sum(1 for l in (LOTE / "capturar.jsonl").read_text().splitlines() if '"estado": "ok"' in l)
    sello.write_text(f"fase 1 ejecutada (spotify-diario {date.today()}): {ok} capturas ok\n")
    avisar("Spotify (lote sin foto): fase 1 lista — capturas completas y dry-runs hechos. "
           "Informe: reports/spotify-lote-2026-10-03/INFORME.md; falta revisar y confirmar.")


# ------------------------------------------------------------------------ 2. reproductores

def barrido():
    return {r["artist_id"]: r for r in map(json.loads, (LOTE / "matches.jsonl").read_text().splitlines())}


def captura_previa(artist_id, spotify_id):
    """La lista de discos que el lote sin foto ya guardó (cero llamadas)."""
    for d in CAPTURAS.glob(f"{artist_id}-*"):
        try:
            if json.loads((d / "artist.json").read_text())["id"] == spotify_id:
                return json.loads((d / "albums.json").read_text())
        except Exception:  # noqa: BLE001
            continue
    return None


def reproductores(sp, artista, discos, lote):
    nombres = {norm(artista["name"])} | {norm(a) for a in artista.get("aliases") or []}
    link = artista["links"].get("spotify") or {}
    previo = cosecha.spotify_id(link.get("url")) if link.get("verified") else None
    pend = [d for d in discos if not (d["links"].get("spotify") or {}).get("verified")]
    if not pend:
        return {"artist_link": None, "album_links": [], "via": "sin discos pendientes"}
    m = lote.get(artista["id"]) or {}
    if previo:
        sid, via = previo, "perfil verificado"
    elif m.get("status") == "exact1" and m.get("spotify_id"):
        sid, via = m["spotify_id"], "barrido exact1"
    elif m.get("status") == "sin_match":
        return {"artist_link": None, "album_links": [], "via": "barrido sin_match"}
    elif m.get("status") == "exacto_n":
        return {**cosecha.cosechar_spotify(sp, artista, discos), "via": "barrido exacto_n: disco por disco"}
    else:
        res = sp.get("/search?" + urllib.parse.urlencode({"q": artista["name"], "type": "artist", "limit": 10}))
        exactos = {a["id"]: a["name"] for a in (res.get("artists") or {}).get("items") or [] if a and norm(a.get("name")) in nombres}
        if not exactos:
            return {"artist_link": None, "album_links": [], "via": "búsqueda: sin homónimo"}
        if len(exactos) > 1:
            return {**cosecha.cosechar_spotify(sp, artista, discos), "via": "búsqueda: varios homónimos, disco por disco"}
        sid, via = next(iter(exactos)), "búsqueda: homónimo único"
    items = captura_previa(artista["id"], sid)
    if items is None:
        items = sp.paginar(f"/artists/{sid}/albums", {"include_groups": "album,single,compilation"})
    else:
        via += " (lista del lote sin foto)"
    cands = [{"id": a["id"], "title": a["name"], "year": year_of(a.get("release_date")),
              "url": f"https://open.spotify.com/album/{a['id']}"} for a in items if a]
    casados = []
    for d in pend:
        p = pick(d, cands)
        if p:
            casados.append({"albumId": d["id"], "url": p["url"], "id": p["id"], "title_plat": p["title"], "year_plat": p["year"]})
    artist_link = None
    if casados:
        nombre = next((x["name"] for a in items for x in a.get("artists") or [] if x.get("id") == sid), artista["name"])
        artist_link = {"url": f"https://open.spotify.com/artist/{sid}", "id": sid, "name_plat": nombre,
                       "comunes": len(casados), "ya_verificado": sid == previo, "otros_perfiles": 0}
    return {"artist_link": artist_link, "album_links": casados, "via": via}


def cosechar_reproductores(sp):
    entrada = EMBEDS / "entrada"
    out = EMBEDS / "spotify"
    artistas = [json.loads(l) for l in (entrada / "artistas.jsonl").read_text().splitlines() if l.strip()]
    discos = {}
    for l in (entrada / "discos.jsonl").read_text().splitlines():
        if l.strip():
            d = json.loads(l)
            discos.setdefault(d["artistId"], []).append(d)
    lote = barrido()
    faltan = [a for a in artistas if not (out / f"a-{a['id']}.json").exists()]
    log(f"reproductores: faltan {len(faltan)} de {len(artistas)} artistas")
    hechos = 0
    for a in faltan:
        if not (sp.disponible("busqueda") or sp.disponible("discos-del-artista")):
            log("reproductores: parada, sin cuota hoy para búsquedas ni listas de discos")
            break
        try:
            r = reproductores(sp, a, discos.get(a["id"], []), lote)
        except Agotada:
            continue  # su camino no tiene cuota hoy; otro artista quizá sí (se reintenta mañana)
        except Exception as e:  # noqa: BLE001 — se anota y se reintenta mañana (el archivo no se escribe)
            log(f"reproductores: {a['name']}: ERROR {str(e)[:160]}")
            continue
        r.update({"artistId": a["id"], "name": a["name"]})
        (out / f"a-{a['id']}.json").write_text(json.dumps(r, ensure_ascii=False))
        hechos += 1
        log(f"reproductores: {a['name']}: {r['via']} · perfil {'sí' if r['artist_link'] else 'no'} · discos {len(r['album_links'])} ({sp.resumen()})")
    return hechos, len(faltan) - hechos


# ------------------------------------------------------------------------------- avisos

def avisar(msg):
    hermes = Path.home() / ".local/bin/hermes"
    try:
        subprocess.run([str(hermes), "send", "--to", "telegram", msg], timeout=90, capture_output=True)
    except Exception as e:  # noqa: BLE001
        log(f"aviso Telegram falló: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tope", type=int, default=int(os.environ.get("CRV_SPOTIFY_TOPE", "500")),
                    help="llamadas por credencial y día (castigo observado: ~690 a 3 s y ~1.500 a 0,5 s)")
    ap.add_argument("--pausa", type=float, default=float(os.environ.get("CRV_SPOTIFY_PAUSA", "3")))
    # Las fotos quedan fuera por defecto (2026-10-14): el lote casó solo por nombre a artistas sin
    # discos, y muchas capturas son homónimos (Aurora de Ojeda → AURORA noruega, MEDUZA de Trujillo
    # → el trío italiano) o extranjeros cuya discografía no es pertinente. Solo con --con-fotos.
    ap.add_argument("--con-fotos", action="store_true")
    ap.add_argument("--solo", choices=["fotos", "reproductores"])
    args = ap.parse_args()
    sp = Cuota(args.tope, args.pausa)
    log(f"inicio · {sp.resumen()}")
    fotos_faltan = rep_faltan = None
    nuevos = 0
    if args.solo == "fotos" or (args.solo is None and args.con_fotos):
        try:
            _, fotos_faltan = fotos(sp)
            if fotos_faltan == 0:
                cerrar_fotos()
        except Agotada as e:
            log(f"fotos: parada, {e}")
    if args.solo in (None, "reproductores"):
        nuevos, rep_faltan = cosechar_reproductores(sp)
    if nuevos:
        r = subprocess.run(["bash", "scripts/with-node22.sh", "npx", "tsx", "scripts/apply-streaming-embeds.ts",
                            str(EMBEDS.relative_to(ROOT)), "--confirm"], cwd=ROOT, capture_output=True, text=True, timeout=1800)
        log("aplicación: " + (r.stdout.strip().splitlines() or ["(sin salida)"])[-1])
        if r.returncode != 0:
            log("aplicación falló: " + r.stderr.strip()[-400:])
            avisar("Spotify diario: falló la aplicación de reproductores (ver data/raw/spotify-diario/diario.log).")
    if rep_faltan == 0:
        avisar("Spotify diario: cosecha de reproductores terminada; ya se puede retirar el timer crv-spotify-diario.")
    log(f"fin · {nuevos} artistas nuevos · {sp.resumen()}")


if __name__ == "__main__":
    main()
