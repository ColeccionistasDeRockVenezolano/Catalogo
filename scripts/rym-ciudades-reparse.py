#!/usr/bin/env python3
"""RYM · ciuades: re-parseo OFFLINE de las páginas de ciudad de la primera cosecha RYM.

Fuente: data/raw/rateyourmusic/*.html (571 páginas del 2026-10-01) — eran páginas
/location/<Ciudad>/<Estado>/Venezuela/_/artists/<n> que Brian capturó a mano ciudad por ciudad.
Cada entrada trae la ficha resumida del artista: «Formed <año>, <ciudad>» (grupos) o
«Born <fecha>, <ciudad>» (personas), más «Currently» (ciudad actual) y «Member of» (bandas).

Salidas (reports/rym-ciudades-2026-10-01/):
  · artistas.jsonl  — 1 línea por artista (dedup por slug de RYM) con ciudad, año y miembros_de
  · resumen.md      — conteos: páginas, ciudades, entradas, con ciudad de Venezuela, tipos

Uso:
  python3 scripts/rym-ciudades-reparse.py [--html DIR] [--out DIR] [--cruzar]
Sin red: solo lee HTML en disco. `--cruzar` compara contra el catálogo (psql) e imprime
cuántas fichas sin ciudad podrían rellenarse y cuántas quedan ambiguas.
"""
import argparse
import json
import os
import re
import subprocess
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

REPO = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
DEF_HTML = REPO / "data/raw/rateyourmusic"
DEF_OUT = REPO / "reports/rym-ciudades-2026-10-01"
RE_TITULO = re.compile(r"<title>([^<]*)</title>", re.I)
RE_ANIO = re.compile(r"\b(19|20)\d{2}\b")
RE_LOC = re.compile(r"^/location/(?P<ciudad>[^/]+)/(?P<estado>[^/]+)/(?P<pais>[^/]+)$")

ARTICULOS = {"el", "la", "los", "las", "un", "una", "unos", "unas", "the", "a", "an"}


def clave_nombre(valor):
    """Clave de comparación (espejo de src/normalization/entity-name.ts) + variante sin artículo."""
    t = unicodedata.normalize("NFKC", valor or "")
    for feo, lindo in (("\u201c", '"'), ("\u201d", '"'), ("\u2018", "'"), ("\u2019", "'")):
        t = t.replace(feo, lindo)
    t = re.sub(r"[\u2010-\u2015\u2212]", "-", t)
    t = t.replace("&", " y ")
    t = t.lower()
    t = t.replace("'", "")
    t = re.sub(r"[^\w\s-]", " ", t, flags=re.UNICODE)
    t = re.sub(r"[\s_]+", " ", t).strip()
    sin_articulo = " ".join(t.split()[1:]) if len(t.split()) > 1 and t.split()[0] in ARTICULOS else t
    sin_tilde = "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn")
    sin_tilde_art = "".join(c for c in unicodedata.normalize("NFD", sin_articulo) if unicodedata.category(c) != "Mn")
    return {"clave": t, "articulo": sin_articulo, "sin_tilde": sin_tilde, "sin_tilde_art": sin_tilde_art,
            "compacta": t.replace(" ", ""), "compacta_sin_tilde": sin_tilde.replace(" ", "")}


def parsear_pagina(ruta):
    """(ciudad_de_la_pagina, [entradas]) de un HTML de /location/.../artists/."""
    html = ruta.read_text(encoding="utf-8", errors="replace")
    m = RE_TITULO.search(html)
    titulo = (m.group(1).strip() if m else "")
    ciudad_pagina = titulo.split(" - Rate Your Music")[0].strip()
    soup: Any = BeautifulSoup(html, "lxml")
    entradas = []
    for a in soup.select("h3 a.artist"):
        href = str(a.get("href") or "").strip()
        if not href.startswith("/artist/"):
            continue
        tr: Any = a.find_parent("tr")
        if tr is None:
            continue
        tabla: Any = tr.find("table", class_="mbgen")
        filas = {}
        if tabla:
            for fila in tabla.find_all("tr"):
                celdas = fila.find_all("td")
                if len(celdas) >= 2:
                    etiqueta = celdas[0].get_text(" ", strip=True)
                    filas.setdefault(etiqueta, celdas[1])

        def valor(etiqueta):
            celda = filas.get(etiqueta)
            return re.sub(r"\s+", " ", celda.get_text(" ", strip=True)) if celda else ""

        def loc(etiqueta):
            celda = filas.get(etiqueta)
            if not celda:
                return None
            enlace = celda.find("a", href=RE_LOC)
            if not enlace:
                return None
            partes = RE_LOC.match(str(enlace.get("href") or ""))
            if not partes:
                return None
            return {"texto": re.sub(r"\s+", " ", enlace.get_text(" ", strip=True)),
                    "ciudad": partes.group("ciudad"), "estado": partes.group("estado"),
                    "pais": partes.group("pais")}

        nacido = valor("Born")
        formado = valor("Formed")
        # RYM usa «Born» para personas Y para grupos (medido 2026-10-16: /artist/100_grados tiene
        # Born = ciudad y Members = la alineación). Señales fuertes de identidad:
        #   · «Members»      → grupo
        #   · «Member of» o fecha completa (día mes año) → persona
        # Si no hay ninguna, el tipo queda sin decidir (el cruce decide por la ficha del catálogo).
        miembros_texto = valor("Members")
        referencia = nacido or formado
        anio = None
        if referencia:
            y = RE_ANIO.search(referencia)
            anio = int(y.group(0)) if y else None
        miembros_de = []
        celda_miembros = filas.get("Member of")
        if celda_miembros:
            for enlace in celda_miembros.find_all("a", href=True):
                if enlace["href"].startswith("/artist/"):
                    miembros_de.append({"slug": enlace["href"].split("/artist/")[-1],
                                        "nombre": re.sub(r"\s+", " ", enlace.get_text(" ", strip=True))})
        fecha_completa = bool(re.search(r"\b\d{1,2}\s+(?:de\s+)?[A-Za-zÁÉÍÓÚáéíóúÑñ]+\s+\d{4}\b", referencia or ""))
        if miembros_texto:
            tipo = "grupo"
        elif miembros_de or fecha_completa:
            tipo = "persona"
        else:
            tipo = ""
        entradas.append({
            "slug": href.split("/artist/")[-1],
            "nombre": re.sub(r"\s+", " ", a.get_text(" ", strip=True)),
            "tipo": tipo, "referencia": referencia, "anio": anio,
            "ubicacion": loc("Born") or loc("Formed"),
            "actual": loc("Currently"),
            "miembros_de": miembros_de,
            "miembros_texto": miembros_texto,
            "pagina": ciudad_pagina,
        })
    return ciudad_pagina, entradas


def recolectar(html_dir):
    """{slug: registro} deduplicado, con las páginas de ciudad donde apareció."""
    registros, paginas = {}, {}
    archivos = sorted(html_dir.glob("*.html"))
    for ruta in archivos:
        try:
            ciudad_pagina, entradas = parsear_pagina(ruta)
        except Exception as exc:  # una página rota no tumba el lote
            print(f"  ¡ojo! {ruta.name}: {exc}")
            continue
        paginas[ciudad_pagina] = paginas.get(ciudad_pagina, 0) + 1
        for entrada in entradas:
            reg = registros.get(entrada["slug"])
            if reg is None:
                reg = dict(entrada)
                reg["paginas"] = [ciudad_pagina]
                registros[entrada["slug"]] = reg
            else:
                if ciudad_pagina not in reg["paginas"]:
                    reg["paginas"].append(ciudad_pagina)
                # Una entrada con ubicación manda sobre otra sin ella (la misma ficha se repite en varias ciudades).
                if not reg.get("ubicacion") and entrada.get("ubicacion"):
                    for clave in ("referencia", "anio", "tipo", "ubicacion", "actual"):
                        reg[clave] = entrada[clave]
                if not reg.get("miembros_texto") and entrada.get("miembros_texto"):
                    reg["miembros_texto"] = entrada["miembros_texto"]
                    if reg.get("tipo") != "grupo":
                        reg["tipo"] = "grupo"
    return registros, paginas, len(archivos)


def escribir_salidas(registros, paginas, total_archivos, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    ruta_jsonl = out_dir / "artistas.jsonl"
    with ruta_jsonl.open("w", encoding="utf-8") as fh:
        for reg in sorted(registros.values(), key=lambda r: r["nombre"].lower()):
            fh.write(json.dumps(reg, ensure_ascii=False) + "\n")
    con_ubicacion = [r for r in registros.values() if r.get("ubicacion")]
    ve = [r for r in con_ubicacion if (r["ubicacion"] or {}).get("pais") == "Venezuela"]
    tipos = Counter(r["tipo"] or "sin tipo" for r in registros.values())
    ciudades = Counter((r["ubicacion"] or {}).get("ciudad", "?") for r in con_ubicacion)
    lineas = [
        f"# RYM · ciudades (re-parseo de {date.today().isoformat()})",
        "",
        f"- Páginas HTML leídas: **{total_archivos}** · ciudades distintas en el nombre del archivo: **{len(paginas)}**",
        f"- Artistas distintos (por slug de RYM): **{len(registros)}**",
        f"- Con ubicación propia en su ficha (Formed/Born + ciudad): **{len(con_ubicacion)}** "
        f"({100.0 * len(con_ubicacion) / max(1, len(registros)):.1f} %)",
        f"- Con ubicación en Venezuela: **{len(ve)}** · fuera de Venezuela: **{len(con_ubicacion) - len(ve)}**",
        f"- Tipo: " + " · ".join(f"{k}: {v}" for k, v in tipos.most_common()),
        f"- Con ciudad actual («Currently») distinta: **{sum(1 for r in registros.values() if r.get('actual'))}**",
        f"- Con «Member of»: **{sum(1 for r in registros.values() if r.get('miembros_de'))}** "
        f"(vínculos persona→banda: **{sum(len(r['miembros_de']) for r in registros.values())}**)",
        "",
        "## Ciudades con más artistas (según la ficha, no según la página)",
        "",
    ]
    for ciudad, total in ciudades.most_common(20):
        lineas.append(f"- {ciudad}: {total}")
    lineas += ["", "## Páginas capturadas por ciudad (top 10)", ""]
    for ciudad, total in Counter(paginas).most_common(10):
        lineas.append(f"- {ciudad}: {total}")
    (out_dir / "resumen.md").write_text("\n".join(lineas) + "\n", encoding="utf-8")
    return ruta_jsonl


def psql(consulta, timeout=60):
    r = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAF", "\t", "-c", consulta],
                       capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        print(r.stderr[:400])
        return []
    return [linea.split("\t") for linea in r.stdout.strip().splitlines() if linea.strip()]


def cruzar(registros):
    """Cuántas fichas del catálogo sin ciudad pueden rellenarse con esto (y cuántas quedan ambiguas).

    Se busca el nombre en AMBOS índices (artistas y personas): identidad fuerte = un único hit.
    Dos hits (aunque sean de la misma tabla) o un hit de tipo contrario al detectado → revisión.
    """
    artistas = psql("""SELECT id, name, coalesce(origin_city,''), artist_type::text FROM public.artists""")
    personas = psql("""SELECT id, name, coalesce(birth_city,'') FROM public.persons""")
    indice_art, indice_per = {}, {}
    for aid, nombre, ciudad, tipo in artistas:
        for clave in set(clave_nombre(nombre).values()):
            indice_art.setdefault(clave, []).append((int(aid), nombre, ciudad, tipo))
    for pid, nombre, ciudad in personas:
        for clave in set(clave_nombre(nombre).values()):
            indice_per.setdefault(clave, []).append((int(pid), nombre, ciudad))

    resumen, candidatos, ambiguos = Counter(), [], []
    # Niveles de comparación, de más fuerte a más laxa: se gana el primer nivel que tenga hits
    # (así una clave compacta/sin tildes no ensucia con ambigüedades de nombres distintos).
    niveles = ("clave", "articulo", "sin_tilde", "sin_tilde_art", "compacta", "compacta_sin_tilde")
    for reg in registros.values():
        ubic = reg.get("ubicacion") or {}
        if ubic.get("pais") != "Venezuela" or not ubic.get("ciudad"):
            continue
        claves = clave_nombre(reg["nombre"])
        hallazgos, nivel_usado = {}, ""
        for nivel in niveles:
            valor_clave = claves.get(nivel) or ""
            if not valor_clave:
                continue
            encontrados = {}
            for fila in indice_art.get(valor_clave, []):
                encontrados[("artists", fila[0])] = fila
            for fila in indice_per.get(valor_clave, []):
                encontrados[("persons", fila[0])] = fila
            if encontrados:
                hallazgos, nivel_usado = encontrados, nivel
                break
        if not hallazgos:
            resumen["sin ficha en el catálogo"] += 1
            continue
        if len(hallazgos) > 1:
            resumen["nombre ambiguo (varias fichas)"] += 1
            ambiguos.append({"rym": reg["nombre"], "slug": reg["slug"], "ciudad": ubic["ciudad"],
                             "motivo": f"varias fichas (nivel {nivel_usado})",
                             "candidatas": [f"{tabla}:{fila[0]}·{fila[1]}" for (tabla, _), fila in hallazgos.items()]})
            continue
        (tabla, fid), fila = next(iter(hallazgos.items()))
        detectado = "persons" if reg["tipo"] == "persona" else ("artists" if reg["tipo"] == "grupo" else "")
        if detectado and detectado != tabla:
            resumen[f"tipo contrario ({reg['tipo']} rym → {tabla})"] += 1
            ambiguos.append({"rym": reg["nombre"], "slug": reg["slug"], "ciudad": ubic["ciudad"],
                             "motivo": f"tipo detectado {reg['tipo']}, ficha en {tabla} (nivel {nivel_usado})",
                             "candidatas": [f"{tabla}:{fid}·{fila[1]}"]})
            continue
        ciudad_catalogo = fila[2]
        if ciudad_catalogo:
            resumen[f"{tabla}: ya tiene ciudad"] += 1
        else:
            resumen[f"{tabla}: RELLENABLE"] += 1
            candidatos.append({"tabla": tabla, "id": fid,
                               "campo": "origin_city" if tabla == "artists" else "birth_city",
                               "catalogo": fila[1], "tipo_rym": reg["tipo"], "nivel": nivel_usado,
                               "rym": reg["nombre"], "slug": reg["slug"],
                               "ciudad": ubic["ciudad"], "ubicacion_completa": ubic["texto"],
                               "anio": reg.get("anio"), "referencia": reg.get("referencia"),
                               "pagina": reg["paginas"][0] if reg.get("paginas") else "",
                               "rym_url": f"https://rateyourmusic.com/artist/{reg['slug']}"})
    out = REPO / "reports/rym-ciudades-2026-10-01"
    (out / "candidatos-ciudad.jsonl").write_text(
        "".join(json.dumps(c, ensure_ascii=False) + "\n" for c in candidatos), encoding="utf-8")
    (out / "ambiguos.jsonl").write_text(
        "".join(json.dumps(c, ensure_ascii=False) + "\n" for c in ambiguos), encoding="utf-8")
    return resumen, candidatos, ambiguos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", default=str(DEF_HTML))
    ap.add_argument("--out", default=str(DEF_OUT))
    ap.add_argument("--cruzar", action="store_true")
    args = ap.parse_args()
    registros, paginas, total = recolectar(Path(args.html))
    ruta = escribir_salidas(registros, paginas, total, Path(args.out))
    print(f"artistas: {len(registros)} · páginas: {total} · ciudades: {len(paginas)} → {ruta}")
    if args.cruzar:
        resumen, candidatos, ambiguos = cruzar(registros)
        print("=== cruce con el catálogo ===")
        for clave, valor in resumen.most_common():
            print(f"  {clave}: {valor}")
        print(f"  candidatos a rellenar: {len(candidatos)} · ambiguos: {len(ambiguos)}")


if __name__ == "__main__":
    main()
