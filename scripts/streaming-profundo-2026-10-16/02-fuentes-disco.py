#!/usr/bin/env python3
"""Enlaces de plataformas encontrados en lo capturado (blogs, prensa, páginas de bandas):
casa el USUARIO/subdominio con el nombre del artista del catálogo y escribe lotes/ledger."""
from __future__ import annotations

import json
import re
import subprocess
import unicodedata
from pathlib import Path

ROOT = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
DEST = ROOT / "reports" / "streaming-profundo-2026-10-16" / "fuentes-disco"
DEST.mkdir(parents=True, exist_ok=True)


def norm(t: str) -> str:
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    t = re.sub(r"\b(?:el|la|los|las|the)\b", " ", t)
    return " ".join("".join(c if c.isalnum() else " " for c in t).split())


def q(sql: str) -> str:
    return subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAc", sql],
                          capture_output=True, text=True).stdout


artistas: dict[str, list[int]] = {}
for linea in q("SELECT id, name FROM public.artists").strip().splitlines():
    partes = linea.split("|")
    if len(partes) == 2:
        artistas.setdefault(norm(partes[1]), []).append(int(partes[0]))

# alias de artista (los del catálogo: Billos → Billo's)
for linea in q("SELECT artist_id, alias FROM ingest.artist_aliases WHERE is_primary IS NOT TRUE").strip().splitlines():
    partes = linea.split("|")
    if len(partes) == 2 and partes[0].isdigit():
        artistas.setdefault(norm(partes[1]), []).append(int(partes[0]))


def unico(handle: str) -> int | None:
    ids = artistas.get(norm(handle), [])
    unicos = sorted(set(ids))
    return unicos[0] if len(unicos) == 1 else None


resumen = {}
# ── Bandcamp: subdominio == artista
bc = [l.strip() for l in Path("/tmp/bc-artistas.txt").read_text().splitlines() if l.strip()]
filas_bc = []
for h in bc:
    sub = h.replace(".bandcamp.com", "")
    a = unico(sub)
    if a:
        filas_bc.append({"artistId": a, "platform": "bandcamp", "url": f"https://{h}", "handle": sub,
                         "evidencia": "subdominio de Bandcamp visto en lo capturado", "matchHandle": True})
resumen["bandcamp"] = {"en_disco": len(bc), "casan": len(filas_bc)}

# ── SoundCloud: usuario == artista (lote para el verificador que ya existe)
sc = [l.strip() for l in Path("/tmp/sc-usuarios.txt").read_text().splitlines() if l.strip()]
lote_sc = []
for h in sc:
    a = unico(h)
    if a:
        lote_sc.append({"artistId": a, "nombre": h, "soundcloud": {
            "url": f"https://soundcloud.com/{h}", "confianza": "media",
            "evidencia": "usuario de SoundCloud visto en lo capturado (blogs/prensa/páginas de bandas)",
            "motivo": "El usuario coincide con el nombre del artista en el catálogo."}, "discos": []})
resumen["soundcloud"] = {"en_disco": len(sc), "casan": len(lote_sc)}

# ── YouTube: canal (@usuario, /c/, /user/) == artista; los watch?v= van aparte
yt = [l.strip() for l in Path("/tmp/yt-links.txt").read_text().splitlines() if l.strip()]
filas_yt, videos = [], 0
for u in yt:
    m = re.search(r"youtube\.com/(?:@|c/|user/)([A-Za-z0-9_.-]+)", u)
    if not m:
        videos += 1
        continue
    canal = m.group(1)
    a = unico(canal.lstrip("@"))
    if a:
        filas_yt.append({"artistId": a, "platform": "youtube", "url": f"https://www.youtube.com/@{canal.lstrip('@')}",
                         "handle": canal, "evidencia": "canal de YouTube visto en lo capturado", "matchHandle": True})
resumen["youtube"] = {"en_disco": len(yt), "canales_que_casan": len(filas_yt), "videos_sueltos": videos}

(DEST / "bandcamp-youtube.jsonl").write_text(
    "\n".join(json.dumps(f, ensure_ascii=False) for f in filas_bc + filas_yt) + "\n", encoding="utf8")
if lote_sc:
    (DEST / "lote-soundcloud-disco.json").write_text(
        json.dumps({"tramo": "fuentes-disco", "artistas": lote_sc}, ensure_ascii=False, indent=1), encoding="utf8")

print(json.dumps(resumen, ensure_ascii=False, indent=1))
print("→", DEST)
