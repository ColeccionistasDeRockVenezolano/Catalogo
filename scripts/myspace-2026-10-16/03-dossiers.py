#!/usr/bin/env python3
"""Dossiers de biografía para la fusión MySpace→catálogo (formato de scripts/apply-biographies.ts).

Cada dossier lleva la bio ACTUAL de la ficha y una fuente: el perfil MySpace capturado
(About + campos estructurados), con la URL del snapshot como evidencia. La síntesis
(04-sintesis.py) fusiona con la bio actual; la aplicación la hace apply-biographies.ts
(claim `crv-sintesis`, undo por run, no pisa si el texto cambió).

Salida: reports/myspace-2026-10-16/bio-dossiers/myspace.jsonl
Uso: python3 scripts/myspace-2026-10-16/03-dossiers.py
"""
import json
import re
import subprocess
from pathlib import Path

JSONL = Path("reports/ma-links-2026-10-15/myspace-piloto.jsonl")
SALIDA = Path("reports/myspace-2026-10-16/bio-dossiers/myspace.jsonl")
CAMPOS_FUENTE = ("Band Members", "Influences", "Sounds Like", "Record Label", "Type of Label",
                 "Member Since", "Location", "Genres", "Band Website")


def tildes_rotas(t: str) -> bool:
    return bool(re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]\.[A-Za-zÁÉÍÓÚÑáéíóúñ]", t or ""))


def util(t: str, minimo: int = 25) -> str:
    if not t:
        return ""
    t = re.sub(r"[|]+", " ", t)
    t = re.sub(r"[.\s]{4,}", " ", t)
    t = re.sub(r"\s+", " ", t).strip(" .|-")
    limpio = re.sub(r"[\s.\-|]", "", t)
    return t if len(limpio) >= minimo else ""


def psql(sql: str) -> list[list[str]]:
    """Filas separadas por \\x1e (record separator) para no romper textos multilínea (bios)."""
    r = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAF", "\x1f", "-R", "\x1e", "-c", sql],
                       capture_output=True, text=True, timeout=120)
    return [fila.split("\x1f") for fila in r.stdout.split("\x1e") if fila.strip()]


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo-ids", default="", help="lista de artistId separados por coma (re-proceso dirigido)")
    args = ap.parse_args()
    solo = {int(x) for x in args.solo_ids.split(",") if x.strip()} if args.solo_ids else set()

    regs: dict[str, dict] = {}
    for l in JSONL.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(l)
        except Exception:
            continue
        regs[str(r.get("slug") or r.get("ma_id"))] = r
    con_ficha = [r for r in regs.values() if r.get("campos") and r.get("crv_artist_id")]
    ids = sorted({int(r["crv_artist_id"]) for r in con_ficha})
    bios = {}
    for c in psql(f"SELECT id, coalesce(biography,'') FROM artists WHERE id IN ({','.join(map(str, ids))})"):
        if len(c) >= 2:
            bios[int(c[0])] = c[1]

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    con_about = 0
    with open(SALIDA, "w", encoding="utf-8") as fh:
        for r in sorted(con_ficha, key=lambda x: int(x["crv_artist_id"])):
            aid = int(r["crv_artist_id"])
            if solo and aid not in solo:
                continue
            campos = r["campos"] or {}
            about = util(campos.get("About") or "", minimo=60)
            # fuente: About (si sirve) + campos estructurados útiles
            partes = []
            if about:
                partes.append(about)
                con_about += 1
            for campo in CAMPOS_FUENTE:
                v = util(campos.get(campo) or "", minimo=4)
                if v and campo != "About":
                    etiqueta = "Miembros de la banda" if campo == "Band Members" else campo
                    partes.append(f"{etiqueta}: {v}")
            if not partes:
                continue
            texto_fuente = "\n\n".join(partes)
            dossier = {
                "caseId": f"artist-{aid}",
                "kind": "artist",
                "entityId": aid,
                "name": r["banda"],
                "currentText": bios.get(aid) or None,
                "sources": [{
                    "ref": "myspace",
                    "source": "MySpace (Wayback Machine)",
                    "url": r.get("url_snapshot") or r.get("url") or "",
                    "text": texto_fuente,
                }],
            }
            fh.write(json.dumps(dossier, ensure_ascii=False) + "\n")
            n += 1
    print(f"dossiers: {n} (con About: {con_about}) → {SALIDA}")


if __name__ == "__main__":
    main()
