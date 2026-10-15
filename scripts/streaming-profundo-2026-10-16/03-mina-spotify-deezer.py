#!/usr/bin/env python3
"""Búsqueda profunda · mina de disco: URLs de Spotify y Deezer vistas en lo capturado (prensa,
blogs, páginas de bandas). Verifica cada una contra su metadato público y casa con el catálogo.

  · Spotify → oEmbed público (sin credenciales): título del álbum/artista.
  · Deezer  → api.deezer.com: título + artista (fiable).

Casado conservador (nada entra sin verificar):
  · álbum  → título exacto normalizado + (si hay) artista exacto; si el título es ambiguo en el
             catálogo, se descarta.
  · artista→ nombre exacto único.
Escribe `enlaces-disco.jsonl` (formato del aplicador) y `descartados.jsonl` con el motivo.
Reanudable: salta las URLs ya presentes en el ledger.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
RAW = ROOT / "data" / "raw"
DEST = ROOT / "reports" / "streaming-profundo-2026-10-16" / "mina-disco"
UA = "CRV-reproductores/1.0 (+coleccionistasderockvenezolano.com)"


def norm(t: str) -> str:
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    t = re.sub(r"\s*\((?:remaster|remastered|deluxe|edici[oó]n[^)]*|special[^)]*|bonus[^)]*)\)", " ", t)
    t = re.sub(r"\b(?:el|la|los|las|the)\b", " ", t)
    return " ".join("".join(c if c.isalnum() else " " for c in t).split())


def q(sql: str) -> list[list[str]]:
    out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAc", sql, "-F", "\t"],
                         capture_output=True, text=True).stdout
    return [l.split("\t") for l in out.splitlines() if l.strip()]


def pide(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    for intento in range(3):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf8", "replace") or "{}")
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                time.sleep(3 * (intento + 1))
                continue
            return None
        except Exception:
            time.sleep(1)
    return None


def urls_en_disco(patron: str) -> list[tuple[str, str]]:
    """(url, archivo donde se vio) únicos, con grep (rápido) sobre todo lo capturado."""
    salida = subprocess.run(["grep", "-rHoE", "--include=*.html", "--include=*.json", "--include=*.md",
                             "--include=*.txt", patron, "."], cwd=RAW, capture_output=True, text=True).stdout
    vistos: dict[str, str] = {}
    for linea in salida.splitlines():
        if ":" not in linea:
            continue
        archivo, url = linea.split(":", 1)
        u = url.strip().rstrip(").,;\"'")
        if not u.startswith("http"):
            u = "https://" + u.lstrip("/")
        vistos.setdefault(u, archivo)
    return list(vistos.items())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--pausa", type=float, default=0.35)
    ap.add_argument("--plataforma", choices=["spotify", "deezer", "ambas"], default="ambas")
    args = ap.parse_args()

    DEST.mkdir(parents=True, exist_ok=True)
    ledger = DEST / "enlaces-disco.jsonl"
    descartes = DEST / "descartados-disco.jsonl"
    hechas = {json.loads(l)["url"] for l in ledger.read_text(encoding="utf8").splitlines()} if ledger.exists() else set()

    # catálogo para casar
    albumes: dict[str, list[tuple[int, int]]] = {}
    titulo_artista = {int(f[0]): f[1] for f in q("SELECT id, name FROM public.artists") if len(f) == 2}
    for f in q("SELECT al.id, al.artist_id, al.title FROM public.albums al"):
        if len(f) == 3 and f[2]:
            albumes.setdefault(norm(f[2]), []).append((int(f[0]), int(f[1])))
    artistas: dict[str, list[int]] = {}
    for f in q("SELECT id, name FROM public.artists"):
        if len(f) == 2:
            artistas.setdefault(norm(f[1]), []).append(int(f[0]))
    print(f"catálogo: {len(albumes)} títulos de disco · {len(artistas)} nombres de artista")

    candidatas: list[tuple[str, str, str]] = []  # (url, plataforma, archivo)
    if args.plataforma in ("spotify", "ambas"):
        for u, a in urls_en_disco(r"open\.spotify\.com/(artist|album|track)/[A-Za-z0-9]+"):
            candidatas.append((u, "spotify", a))
    if args.plataforma in ("deezer", "ambas"):
        for u, a in urls_en_disco(r"deezer\.com/[a-z/]*(album|artist)/[0-9]+"):
            candidatas.append((u, "deezer", a))
    candidatas = [(u, p, a) for u, p, a in candidatas if u not in hechas]
    print(f"candidatas por revisar: {len(candidatas)}")
    if args.limit:
        candidatas = candidatas[: args.limit]

    escritos = descartados = 0
    with ledger.open("a", encoding="utf8") as fl, descartes.open("a", encoding="utf8") as fd:
        for i, (url, plataforma, archivo) in enumerate(candidatas, 1):
            es_album = "/album/" in url
            titulo = artista_nombre = None
            ident = None
            if plataforma == "spotify":
                m = re.search(r"/(artist|album|track)/([A-Za-z0-9]+)", url)
                ident = m.group(2) if m else None
                es_album = bool(m and m.group(1) == "album")
                o = pide("https://open.spotify.com/oembed?url=" + urllib.parse.quote(url, safe=""))
                if o:
                    titulo = re.sub(r"^Spotify Embed:\s*", "", str(o.get("title") or "")).strip()
            else:
                m = re.search(r"/(album|artist)/(\d+)", url)
                ident = m.group(2) if m else None
                es_album = bool(m and m.group(1) == "album")
                d = pide(f"https://api.deezer.com/{'album' if es_album else 'artist'}/{ident}")
                if d and not d.get("error"):
                    titulo = d.get("title") or d.get("name")
                    artista_nombre = (d.get("artist") or {}).get("name") if es_album else None
            time.sleep(args.pausa)

            fila = None
            if titulo:
                if es_album:
                    cands = albumes.get(norm(titulo), [])
                    if artista_nombre:
                        cands = [c for c in cands if norm(titulo_artista.get(c[1], "")) == norm(artista_nombre)]
                    if len(cands) == 1:
                        fila = {"albumId": cands[0][0], "artistId": cands[0][1], "platform": plataforma,
                                "url": url, "id": ident, "evidencia": f"visto en {archivo}",
                                "titulo_plat": titulo, "veredicto": "casado"}
                    elif len(cands) > 1:
                        fd.write(json.dumps({"url": url, "motivo": "título ambiguo", "titulo": titulo}, ensure_ascii=False) + "\n")
                        descartados += 1
                    else:
                        fd.write(json.dumps({"url": url, "motivo": "título sin casar", "titulo": titulo}, ensure_ascii=False) + "\n")
                        descartados += 1
                else:
                    ids = sorted(set(artistas.get(norm(titulo), [])))
                    if len(ids) == 1:
                        fila = {"artistId": ids[0], "platform": plataforma, "url": url, "id": ident,
                                "evidencia": f"visto en {archivo}", "veredicto": "casado"}
                    else:
                        fd.write(json.dumps({"url": url, "motivo": "artista sin casar o ambiguo", "titulo": titulo}, ensure_ascii=False) + "\n")
                        descartados += 1
            else:
                fd.write(json.dumps({"url": url, "motivo": "sin metadato público", "titulo": None}, ensure_ascii=False) + "\n")
                descartados += 1

            if fila:
                fl.write(json.dumps(fila, ensure_ascii=False) + "\n")
                fl.flush()
                escritos += 1
            if i % 100 == 0 or i == len(candidatas):
                print(f"  {i}/{len(candidatas)} · casados: {escritos} · descartados: {descartados}", flush=True)

    print(f"LISTO: {escritos} casados · {descartados} descartados · ledger {ledger}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
