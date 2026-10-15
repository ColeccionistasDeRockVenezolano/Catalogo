#!/usr/bin/env python3
"""CRV · Volcado del catálogo + lotes para la investigación de SoundCloud (2026-10-15).

Encargo de Brian: un JSON con TODOS los artistas y su discografía entera, y el mismo
material partido en lotes para que ChatGPT (investigación profunda) busque, por artista,
su perfil principal de SoundCloud y, por disco, el set/lista correspondiente.

Salidas (dentro del directorio de trabajo, por defecto reports/soundcloud-2026-10-15):
  catalogo-artistas.json     — todos los artistas con su discografía (JSON completo)
  lotes/lote-NNN.json        — el mismo material en lotes pegables en ChatGPT
  lotes/INDICE.md            — qué artistas van en cada lote (para no repetir trabajo)

Orden de los artistas (el que más rinde primero):
  1) con discografía y SIN perfil de SoundCloud en el catálogo
  2) con discografía y con perfil (solo faltan los discos)
  3) sin discografía y sin perfil
  4) sin discografía y con perfil
Dentro de cada grupo: más discos primero, luego nombre.

Uso:
  python3 scripts/soundcloud-lotes.py [--out DIR] [--size 20] [--limit 0]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SQL = """
SELECT json_build_object(
  'artistId', a.id,
  'nombre', a.name,
  'alias', (SELECT coalesce(json_agg(x.alias ORDER BY x.alias), '[]'::json)
              FROM ingest.artist_aliases x WHERE x.artist_id = a.id AND x.is_primary IS NOT TRUE),
  'tipo', a.artist_type::text,
  'anioFormacion', a.formed_year,
  'pais', a.origin_country,
  'soundcloudEnCatalogo', (SELECT l.url FROM public.streaming_links l
                             WHERE l.artist_id = a.id AND l.platform = 'soundcloud'
                             ORDER BY l.verified DESC, l.id LIMIT 1),
  'enlacesExistentes', (SELECT count(*) FROM public.streaming_links l WHERE l.artist_id = a.id),
  'discos', (SELECT coalesce(json_agg(json_build_object(
                 'albumId', al.id, 'titulo', al.title, 'anio', al.release_year,
                 'tipo', al.album_type::text) ORDER BY al.release_year NULLS LAST, al.id), '[]'::json)
               FROM public.albums al WHERE al.artist_id = a.id)
)::text
FROM public.artists a
ORDER BY (SELECT count(*) FROM public.albums al WHERE al.artist_id = a.id) DESC, a.name;
"""


def volcado(pg: str) -> list[dict]:
    out = subprocess.run(["docker", "exec", pg, "psql", "-U", "crv", "-d", "crv", "-tAc", SQL],
                         capture_output=True, text=True, check=True).stdout
    artistas = []
    for linea in out.splitlines():
        linea = linea.strip()
        if not linea:
            continue
        d = json.loads(linea)
        d["artistId"] = int(d["artistId"])
        for disco in d["discos"]:
            disco["albumId"] = int(disco["albumId"])
        artistas.append(d)
    return artistas


def prioridad(a: dict) -> tuple:
    tiene_discos = len(a["discos"]) > 0
    tiene_sc = bool(a.get("soundcloudEnCatalogo"))
    grupo = 0 if (tiene_discos and not tiene_sc) else 1 if tiene_discos else 2 if not tiene_sc else 3
    return (grupo, a.get("enlacesExistentes", 0), -len(a["discos"]), a["nombre"])


# El propio SoundCloud no tiene perfil para el cajón de compilaciones: fuera de los lotes.
EXCLUIDOS = {"various artists"}
# Discos por bloque: una discografía de 257 discos se reparte en varios lotes (nadie investiga 257 discos en una corrida).
MAX_DISCOS_BLOQUE = 12


def bloques(a: dict) -> list[dict]:
    """Parte los discos de un artista en bloques; el primero lleva los datos de identidad."""
    if len(a["discos"]) <= MAX_DISCOS_BLOQUE:
        return [a]
    partes: list[dict] = []
    for i in range(0, len(a["discos"]), MAX_DISCOS_BLOQUE):
        trozo = a["discos"][i:i + MAX_DISCOS_BLOQUE]
        partes.append({**a, "discos": trozo,
                       "discosDe": f"{i + 1}-{i + len(trozo)} de {len(a['discos'])}"})
    return partes


def empaquetar(artistas: list[dict], unidades: int, max_artistas: int) -> list[list[dict]]:
    """Lotes equilibrados por CARGA (1 por artista + 1 por disco), no por número de artistas:
    el catálogo tiene medianas de 1 disco, pero orquestas con 257. Los bloques siguientes del mismo
    artista cuentan solo sus discos (la identidad ya va en el primer bloque)."""
    piezas: list[dict] = []
    for a in artistas:
        piezas.extend(bloques(a))
    lotes: list[list[dict]] = []
    actual: list[dict] = []
    carga = 0
    for p in piezas:
        peso = (0 if "discosDe" in p else 1) + len(p["discos"])
        if actual and (carga + peso > unidades or len(actual) >= max_artistas):
            lotes.append(actual)
            actual, carga = [], 0
        actual.append(p)
        carga += peso
    if actual:
        lotes.append(actual)
    return lotes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="reports/soundcloud-2026-10-15")
    ap.add_argument("--pg", default="crv-postgres")
    ap.add_argument("--unidades", type=int, default=70, help="carga por lote: 1 por artista + 1 por disco")
    ap.add_argument("--max-artistas", type=int, default=20, help="tope de artistas por lote")
    ap.add_argument("--partes", type=int, default=5, help="partes del archivo único (por si el adjunto no traga)")
    ap.add_argument("--limit", type=int, default=0, help="genera solo los N primeros artistas (pruebas)")
    args = ap.parse_args()

    dest = ROOT / args.out
    (dest / "lotes").mkdir(parents=True, exist_ok=True)

    artistas = volcado(args.pg)
    if args.limit:
        artistas = artistas[: args.limit]
    artistas.sort(key=prioridad)

    discos = sum(len(a["discos"]) for a in artistas)
    con_sc = sum(1 for a in artistas if a.get("soundcloudEnCatalogo"))
    con_discos = sum(1 for a in artistas if a["discos"])

    completo = {
        "generado": "2026-10-15",
        "fuente": "catálogo vivo CRV (public.artists + public.albums + ingest.artist_aliases)",
        "totales": {"artistas": len(artistas), "discos": discos,
                    "artistasConDiscografia": con_discos, "artistasConSoundcloudEnCatalogo": con_sc},
        "artistas": artistas,
    }
    ruta = dest / "catalogo-artistas.json"
    ruta.write_text(json.dumps(completo, ensure_ascii=False, indent=1), encoding="utf8")

    # ── archivo ÚNICO para ChatGPT: JSONL compacto (una línea por artista, en el orden de trabajo).
    # La clave para que quepa: se omite todo lo que el prompt ya sabe (todos son Venezuela) y se
    # usan claves de una letra. ~1 MB para los 4.785 artistas.
    def linea(a: dict) -> str:
        d = {"i": a["artistId"], "n": a["nombre"]}
        alias = [x for x in (a.get("alias") or []) if x and x.strip() and len(x) <= 40 and x != a["nombre"]]
        if alias:
            d["al"] = alias[:4]
        if a.get("anioFormacion"):
            d["f"] = a["anioFormacion"]
        if a.get("pais") and a["pais"].strip().lower() not in ("venezuela", "venezuela "):
            d["p"] = a["pais"]
        if a.get("soundcloudEnCatalogo"):
            d["sc"] = a["soundcloudEnCatalogo"]
        if a["discos"]:
            d["d"] = [[x["albumId"], x["titulo"], x["anio"]] if x["anio"] else [x["albumId"], x["titulo"]]
                      for x in a["discos"]]
        return json.dumps(d, ensure_ascii=False, separators=(",", ":"))

    compacto = dest / "catalogo-soundcloud-completo.jsonl"
    encabezado = (
        "# CRV · catálogo para la investigación de SoundCloud · 2026-10-15\n"
        f"# {len(artistas)} artistas · {discos} discos · una línea JSON por artista, en orden de trabajo\n"
        "# claves: i=artistId · n=nombre · al=alias · f=año de formación · p=país (si no es Venezuela)\n"
        "#         sc=perfil de SoundCloud que YA tiene el catálogo · d=discos [albumId, título, año]\n"
    )
    with compacto.open("w", encoding="utf8") as fh:
        fh.write(encabezado)
        for a in artistas:
            fh.write(linea(a) + "\n")

    # Partes del mismo archivo (por si un adjunto de 0,7 MB se atraganta): catalogo-soundcloud-0K-de-NN.jsonl
    if args.partes > 1:
        partes_dir = dest / "partes"
        partes_dir.mkdir(exist_ok=True)
        tam = -(-len(artistas) // args.partes)
        for k in range(args.partes):
            trozo = artistas[k * tam:(k + 1) * tam]
            if not trozo:
                continue
            nombre_parte = partes_dir / f"catalogo-soundcloud-{k + 1:02d}-de-{args.partes:02d}.jsonl"
            with nombre_parte.open("w", encoding="utf8") as fh:
                fh.write(encabezado.replace("una línea JSON por artista, en orden de trabajo",
                                            f"PARTE {k + 1} de {args.partes} · una línea JSON por artista, en orden de trabajo"))
                for a in trozo:
                    fh.write(linea(a) + "\n")
            print(f"parte {k + 1}/{args.partes}: {len(trozo)} artistas · {nombre_parte.stat().st_size / 1024:.0f} KB")

    para_lotes = [a for a in artistas if a["nombre"].strip().lower() not in EXCLUIDOS]
    lotes = empaquetar(para_lotes, args.unidades, args.max_artistas)
    for i, bloque in enumerate(lotes, start=1):
        (dest / "lotes" / f"lote-{i:03d}.json").write_text(json.dumps({
            "lote": i, "de": len(lotes), "generado": "2026-10-15", "artistas": bloque,
        }, ensure_ascii=False, indent=1), encoding="utf8")

    indice = ["# Índice de lotes — investigación SoundCloud", "",
              f"{len(para_lotes)} artistas · {sum(len(a['discos']) for a in para_lotes)} discos · "
              f"{len(lotes)} lotes (carga ~{args.unidades} por lote, tope {args.max_artistas} artistas)", ""]
    for i, bloque in enumerate(lotes, start=1):
        nombres = ", ".join(f"{a['nombre']} ({len(a['discos'])})" for a in bloque)
        indice.append(f"- lote-{i:03d}.json — {nombres}")
    (dest / "lotes" / "INDICE.md").write_text("\n".join(indice) + "\n", encoding="utf8")

    def rel(p: Path) -> str:
        try:
            return str(p.relative_to(ROOT))
        except ValueError:
            return str(p)

    print(f"artistas {len(artistas)} · discos {discos} · con discografía {con_discos} · con SC en catálogo {con_sc}")
    print(f"{rel(ruta)} — {ruta.stat().st_size / 1048576:.2f} MB")
    print(f"lotes: {len(lotes)} en {rel(dest / 'lotes')}/ "
          f"(lote medio {(sum((dest / 'lotes' / f'lote-{i:03d}.json').stat().st_size for i in range(1, len(lotes) + 1)) / len(lotes)) / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
