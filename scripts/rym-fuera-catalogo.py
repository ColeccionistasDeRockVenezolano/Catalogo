#!/usr/bin/env python3
"""RYM → escritorio: TODOS los artistas de las páginas de ciudad que NO están en el catálogo.

Entrada: reports/rym-ciudades-2026-10-01/artistas.jsonl (2.472 fichas del re-parseo de
data/raw/rateyourmusic/*.html, cosecha manual 2026-10-01) + el catálogo vivo (psql).

Salidas en el escritorio (para que una IA las analice):
  · «RYM fuera del catalogo 2026-10-16.jsonl»  — 1 objeto JSON por artista, todos los campos
  · «RYM fuera del catalogo 2026-10-16.md»     — índice legible + glosario + consigna de análisis
  · «RYM fuera del catalogo 2026-10-16.csv»    — tabla plana para hojas de cálculo

Clasificación por nombre con los mismos niveles que el aplicador (clave exacta → sin artículo →
sin tildes → compacta). «fuera» = sin ninguna ficha candidata. «ambiguo» = hay candidatas pero no
una sola (esos van en su propio archivo del reporte, no aquí). Un artista puede estar en el
catálogo con OTRO nombre: eso lo decide quien analice, con la evidencia de esta lista.

Uso: python3 scripts/rym-fuera-catalogo.py [--out DIR]
"""
import argparse
import csv
import json
import subprocess
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

REPO = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
ENTRADA = REPO / "reports/rym-ciudades-2026-10-01/artistas.jsonl"
DEF_OUT = Path("/home/brian/Desktop")
ARTICULOS = {"el", "la", "los", "las", "un", "una", "unos", "unas", "the", "a", "an"}
NIVELES = ("clave", "articulo", "sin_tilde", "sin_tilde_art", "compacta", "compacta_sin_tilde")


def clave_nombre(valor):
    t = unicodedata.normalize("NFKC", valor or "")
    for feo, lindo in (("\u201c", '"'), ("\u201d", '"'), ("\u2018", "'"), ("\u2019", "'")):
        t = t.replace(feo, lindo)
    t = t.replace("&", " y ").lower().replace("'", "")
    t = unicodedata.normalize("NFKC", t)
    t = "".join(c for c in t if c.isalnum() or c.isspace() or c == "-")
    t = " ".join(t.split())
    sin_art = " ".join(t.split()[1:]) if len(t.split()) > 1 and t.split()[0] in ARTICULOS else t
    sin_tilde = "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn")
    sin_tilde_art = "".join(c for c in unicodedata.normalize("NFD", sin_art) if unicodedata.category(c) != "Mn")
    return {"clave": t, "articulo": sin_art, "sin_tilde": sin_tilde, "sin_tilde_art": sin_tilde_art,
            "compacta": t.replace(" ", ""), "compacta_sin_tilde": sin_tilde.replace(" ", "")}


def psql(consulta, timeout=90):
    r = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAF", "\t", "-c", consulta],
                       capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise SystemExit(f"psql falló: {r.stderr[:300]}")
    return [linea.split("\t") for linea in r.stdout.strip().splitlines() if linea.strip()]


def indices():
    art, per = defaultdict(list), defaultdict(list)
    # Los vacíos van como «·» para que ninguna línea pierda columnas al recortar el salto final.
    for aid, nombre, ciudad, tipo, anio in psql(
            "SELECT id, name, coalesce(nullif(origin_city,''),'·'), coalesce(artist_type::text,'·'), "
            "coalesce(formed_year::text,'·') FROM public.artists"):
        for clave in set(clave_nombre(nombre).values()):
            art[clave].append((int(aid), nombre, "" if ciudad == "·" else ciudad,
                               "" if tipo == "·" else tipo, "" if anio == "·" else anio))
    for pid, nombre, ciudad, nac in psql(
            "SELECT id, name, coalesce(nullif(birth_city,''),'·'), coalesce(nullif(birth_date_value,''),'·') FROM public.persons"):
        for clave in set(clave_nombre(nombre).values()):
            per[clave].append((int(pid), nombre, "" if ciudad == "·" else ciudad, "" if nac == "·" else nac))
    return art, per


def clasificar(reg, art, per):
    claves = clave_nombre(reg["nombre"])
    for nivel in NIVELES:
        valor = claves.get(nivel) or ""
        if not valor:
            continue
        hallazgos = {}
        for fila in art.get(valor, []):
            hallazgos[("artists", fila[0])] = fila
        for fila in per.get(valor, []):
            hallazgos[("persons", fila[0])] = fila
        if not hallazgos:
            continue
        if len(hallazgos) > 1:
            return "ambiguo", nivel, [f"{t}:{f[0]}·{f[1]}" for (t, _), f in hallazgos.items()]
        (tabla, fid), fila = next(iter(hallazgos.items()))
        return "en_catalogo", nivel, [f"{tabla}:{fid}·{fila[1]}"]
    return "fuera", "", []


def ficha(reg, estado, nivel, candidatas):
    ubic = reg.get("ubicacion") or {}
    actual = reg.get("actual") or {}
    return {
        "nombre": reg["nombre"],
        "tipo_rym": reg["tipo"] or "sin_decidir",
        "estado_catalogo": estado,
        "nivel_cruce": nivel or None,
        "candidatas_catalogo": candidatas,
        "ciudad": ubic.get("ciudad"),
        "estado_provincia": ubic.get("estado"),
        "pais": ubic.get("pais"),
        "ubicacion_rym": ubic.get("texto"),
        "anio_referencia": reg.get("anio"),
        "referencia_rym": reg.get("referencia") or "",
        "ciudad_actual": actual.get("texto"),
        "miembros_de": [m["nombre"] for m in (reg.get("miembros_de") or [])],
        "alineacion": reg.get("miembros_texto") or "",
        "paginas_ciudad": reg.get("paginas") or [],
        "rym_url": f"https://rateyourmusic.com/artist/{reg['slug']}",
        "slug_rym": reg["slug"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DEF_OUT))
    args = ap.parse_args()
    out = Path(args.out)
    registros = [json.loads(l) for l in ENTRADA.open(encoding="utf-8") if l.strip()]
    art, per = indices()
    fuera, ambiguos, dentro = [], [], 0
    for reg in registros:
        estado, nivel, candidatas = clasificar(reg, art, per)
        if estado == "fuera":
            fuera.append(ficha(reg, estado, nivel, candidatas))
        elif estado == "ambiguo":
            ambiguos.append(ficha(reg, estado, nivel, candidatas))
        else:
            dentro += 1
    fuera.sort(key=lambda f: ((f["pais"] or "zz"), (f["ciudad"] or "zz"), f["nombre"].lower()))
    ambiguos.sort(key=lambda f: f["nombre"].lower())

    hoy = date.today().isoformat()
    nombres = {
        "jsonl": out / f"RYM fuera del catalogo {hoy}.jsonl",
        "md": out / f"RYM fuera del catalogo {hoy}.md",
        "csv": out / f"RYM fuera del catalogo {hoy}.csv",
        "amb": out / f"RYM ambiguos {hoy}.jsonl",
    }
    with nombres["jsonl"].open("w", encoding="utf-8") as fh:
        for f in fuera:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    with nombres["amb"].open("w", encoding="utf-8") as fh:
        for f in ambiguos:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    with nombres["csv"].open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["nombre", "tipo_rym", "pais", "estado_provincia", "ciudad",
                                           "anio_referencia", "referencia_rym", "ciudad_actual",
                                           "miembros_de", "alineacion", "paginas_ciudad", "rym_url"])
        w.writeheader()
        for f in fuera:
            fila = {k: f[k] for k in w.fieldnames}
            fila["miembros_de"] = " | ".join(f["miembros_de"])
            fila["paginas_ciudad"] = " | ".join(f["paginas_ciudad"])
            w.writerow(fila)

    por_pais = Counter(f["pais"] or "sin ubicación" for f in fuera)
    lineas = [
        f"# RYM · artistas que NO están en el catálogo ({hoy})",
        "",
        "**Qué es esto.** De las 571 páginas de ciudad de RYM capturadas a mano el 2026-10-01",
        f"(`data/raw/rateyourmusic/*.html`) salieron **{len(registros)} fichas distintas**. Cruzadas contra el catálogo",
        f"vivo (artistas y personas, por nombre normalizado en niveles): **{dentro} ya están**, **{len(ambiguos)} son ambiguas**",
        f"(varias fichas candidatas) y **{len(fuera)} no aparecen**. Esto último es lo que hay en este archivo:",
        f"**{len(fuera)} artistas** con todos los datos que la página de RYM daba de cada uno.",
        "",
        "**Archivos.**",
        f"- `{nombres['jsonl'].name}` — 1 objeto JSON por artista (todos los campos). Es el archivo canónico.",
        f"- `{nombres['csv'].name}` — la misma lista en tabla plana (Excel / pandas).",
        f"- `{nombres['amb'].name}` — los {len(ambiguos)} ambiguos, con sus candidatas del catálogo (no son altas: hay que decidir identidad).",
        "",
        "**Campos (JSON/CSV).**",
        "- `nombre`, `tipo_rym` (grupo / persona / sin_decidir; RYM usa «Born» también para grupos, el grupo se reconoce por la alineación).",
        "- `pais`, `estado_provincia`, `ciudad`, `ubicacion_rym` — tal cual la ficha de RYM («Born/Formed <año>, <ciudad>»).",
        "- `anio_referencia` — año de formación (grupos) o de nacimiento (personas), si la ficha lo traía.",
        "- `alineacion` — texto literal de la fila «Members» de RYM (nombre y rol entre paréntesis).",
        "- `miembros_de` — bandas en las que RYM lo lista como miembro (para personas).",
        "- `ciudad_actual` — fila «Currently» de RYM, si existe.",
        "- `paginas_ciudad` — en qué páginas de ciudad apareció (una ficha puede repetirse).",
        "- `rym_url`, `slug_rym` — enlace y slug para verificar en RYM.",
        "",
        "**Ojo con la nacionalidad.** Que esté en una página de ciudad venezolana significa que RYM lo ubica",
        "en la escena de esa ciudad, **no** que sea venezolano: hay fichas con nacimiento/ formación en el extranjero.",
        "El campo `pais` es el de la ficha, no una inferencia.",
        "",
        f"## Reparto por país ({len(por_pais)} distintos)",
        "",
    ]
    for pais, n in por_pais.most_common():
        lineas.append(f"- {pais}: {n}")
    lineas += ["", "## Índice por ciudad", ""]
    actual_pais = None
    for f in fuera:
        pais = f["pais"] or "sin ubicación capturada"
        if pais != actual_pais:
            lineas += ["", f"### {pais}", "", "| artista | tipo | año | ciudad | alineación / miembros de | páginas | RYM |",
                       "|---|---|---|---|---|---|---|"]
            actual_pais = pais
        detalle = f["alineacion"] or ", ".join(f["miembros_de"])
        detalle = (detalle[:110] + "…") if len(detalle) > 110 else detalle
        detalle = detalle.replace("|", "/")
        lineas.append(
            f"| {f['nombre']} | {f['tipo_rym']} | {f['anio_referencia'] or ''} | {f['ciudad'] or ''} | "
            f"{detalle} | {len(f['paginas_ciudad'])} | [RYM]({f['rym_url']}) |")
    lineas += [
        "",
        "## Consigna sugerida para quien analice",
        "",
        "1. Decidir, por artista, si es **alta nueva** en el catálogo, **duplicado con otro nombre** (indicar cuál)",
        "   o **descartar** (no es de rock/pop venezolano, ficha basura, homónimo extranjero).",
        "2. Para las altas: proponer `artist_type` (banda / solista / dúo / proyecto), `origin_city` (la del campo `ciudad`),",
        "   `formed_year` (`anio_referencia`), y los integrantes que se puedan extraer de `alineacion` con su rol.",
        "3. Para las personas con `miembros_de`: proponer la membresía (banda, rol si se conoce, período si aparece).",
        "4. Marcar la evidencia usada (la `rym_url` es la fuente primaria de esta lista).",
        "",
        f"Nota: la lista NO incluye los {len(ambiguos)} ambiguos (ver archivo aparte) ni los artistas de RYM que sí están en el catálogo.",
    ]
    nombres["md"].write_text("\n".join(lineas) + "\n", encoding="utf-8")

    print(f"fichas RYM: {len(registros)} · en catálogo: {dentro} · ambiguos: {len(ambiguos)} · FUERA: {len(fuera)}")
    for clave, ruta in nombres.items():
        print(f"  {clave}: {ruta} ({ruta.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
