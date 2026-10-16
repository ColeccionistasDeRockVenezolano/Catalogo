#!/usr/bin/env python3
"""Cotejo de los DISCOS citados en los perfiles/bios MySpace contra la discografía del catálogo.

Entrada: mineria/otros.jsonl (campo='discos'). Por cada cita se normaliza el título y se
compara (difflib ≥0.86, patrón de la campaña de enlaces) con los álbumes del propio artista;
también se prueba sin el año entre paréntesis y contra `album_aliases` si existieran títulos
alternativos. Salida: qué citas NO aparecen en la discografía (candidatas a disco faltante).

Salida: reports/myspace-2026-10-16/er/{discos-citados.jsonl,discos-no-en-catalogo.jsonl} + resumen
Uso: python3 scripts/myspace-2026-10-16/13-cotejo-discos.py
"""
import collections
import difflib
import importlib.util
import json
import re
import unicodedata
from pathlib import Path

spec = importlib.util.spec_from_file_location("p01", "scripts/myspace-2026-10-16/01-plan.py")
p01 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p01)

ENTRADA = Path("reports/myspace-2026-10-16/mineria/otros.jsonl")
SALIDA = Path("reports/myspace-2026-10-16/er")


def norm_titulo(t: str) -> str:
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    t = re.sub(r"\((?:\d{4}|[^)]{0,20})\)", " ", t)      # (2006), (demo), (EP)
    t = re.sub(r"\b(demo|ep|lp|album|álbum|sencillo|single|casete|cd)\b", " ", t)
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def main() -> None:
    SALIDA.mkdir(parents=True, exist_ok=True)
    citas = [json.loads(l) for l in ENTRADA.read_text(encoding="utf-8").splitlines() if l.strip()] if ENTRADA.exists() else []
    discos = [c for c in citas if c.get("campo") == "discos" and 3 < len(str(c.get("valor") or "")) < 90]
    print(f"citas de discos: {len(discos)}")

    ids = sorted({int(c["artistId"]) for c in discos})
    albumes: dict[int, list[tuple[int, str, str]]] = collections.defaultdict(list)
    for a in p01.psql(f"SELECT artist_id, id, title, coalesce(year::text,'') FROM albums WHERE artist_id IN ({','.join(map(str, ids))})"):
        if len(a) >= 4:
            albumes[int(a[0])].append((int(a[1]), norm_titulo(a[2]), a[3]))

    # títulos de pistas (a veces la cita es un tema suelto)
    pistas: dict[int, list[str]] = collections.defaultdict(list)
    for p in p01.psql(f"SELECT al.artist_id, t.title FROM tracks t JOIN albums al ON al.id=t.album_id WHERE al.artist_id IN ({','.join(map(str, ids))})"):
        if len(p) >= 2:
            pistas[int(p[0])].append(norm_titulo(p[1]))

    filas, sin_catalogo = [], []
    stats = collections.Counter()
    for c in discos:
        aid = int(c["artistId"])
        titulo = norm_titulo(str(c["valor"]))
        if not titulo:
            continue
        lista = [t for _, t, _ in albumes.get(aid, [])]
        match = difflib.get_close_matches(titulo, lista, n=1, cutoff=0.86)
        estado, match_titulo = "no_en_catalogo", ""
        if match:
            estado, match_titulo = "en_catalogo", match[0]
        else:
            # ¿es un tema suelto del artista?
            m2 = difflib.get_close_matches(titulo, pistas.get(aid, []), n=1, cutoff=0.90)
            if m2:
                estado, match_titulo = "es_pista", m2[0]
        stats[estado] += 1
        fila = {"artistId": aid, "cita": c["valor"], "normalizado": titulo, "estado": estado, "match": match_titulo}
        filas.append(fila)
        if estado == "no_en_catalogo":
            sin_catalogo.append(fila)

    with open(SALIDA / "discos-citados.jsonl", "w", encoding="utf-8") as fh:
        for f in filas:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    with open(SALIDA / "discos-no-en-catalogo.jsonl", "w", encoding="utf-8") as fh:
        for f in sin_catalogo:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    resumen = {"citas": len(discos), **stats}
    (SALIDA / "discos-resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(resumen, ensure_ascii=False, indent=1))
    print("\ncitas NO en el catálogo (muestra):")
    for f in sin_catalogo[:25]:
        print(f"   artist {f['artistId']:5} · {f['cita'][:70]}")


if __name__ == "__main__":
    main()
