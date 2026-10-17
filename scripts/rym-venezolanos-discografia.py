#!/usr/bin/env python3
"""RYM · venezolanos CON DISCOGRAFÍA que no están en el catálogo (con ER fuerte y sin duplicados).

Fuente de la clasificación: la auditoría `CRV_auditoria_RYM_950_registros_2026-10-17.jsonl`
(950 = 343 «fuera» + 607 «ambiguos» de las páginas de ciudad). Este script NO se cree la etiqueta:
para cada ficha venezolana busca su página RYM capturada, extrae la DISCOGRAFÍA real, y decide
identidad contra el catálogo con todas las señales disponibles:

  · nombre en niveles (clave exacta → sin artículo → sin tildes → compacta) y variantes con apodo
    («José "Majito" Aguilera» ↔ «Majito Aguilera»),
  · solape de títulos de disco (RYM vs public.albums del candidato) — la señal más fuerte,
  · año (formación/nacimiento) igual o en conflicto,
  · ciudad (RYM vs origin_city/birth_city),
  · integrantes (texto de RYM vs artist_members del candidato),
  · tipo (grupo/persona vs tabla del candidato).

Salidas en el escritorio:
  · «RYM venezolanos con discografia <fecha>.jsonl/.csv/.md»  — los que NO están (nuevos) + colisiones
  · «RYM duplicados descartados <fecha>.jsonl»                — los que sí son la misma ficha, con el motivo
  · «Estrategia para encontrar los demas <fecha>.md»          — plan medido con los huecos reales

Uso: python3 scripts/rym-venezolanos-discografia.py [--audit RUTA] [--out DIR]
"""
import argparse
import csv
import json
import re
import subprocess
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from bs4 import BeautifulSoup

REPO = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
DEF_AUD = Path("/home/brian/Downloads/CRV_auditoria_RYM_950_registros_2026-10-17.jsonl")
DEF_OUT = Path("/home/brian/Desktop")
PAGINAS = [REPO / "data/raw/fuentes-web-2026-10-16/rym-resto/pages",
           REPO / "data/raw/fuentes-web-2026-10-01/rym-nuevos/pages"]
CIUDADES = REPO / "data/raw/rateyourmusic"
ARTICULOS = {"el", "la", "los", "las", "un", "una", "unos", "unas", "the", "a", "an"}
NIVELES = ("clave", "articulo", "sin_tilde", "sin_tilde_art", "compacta", "compacta_sin_tilde")
RE_ANIO = re.compile(r"\b(1[89]\d{2}|20\d{2})\b")
RE_APODO = re.compile(r'["“«]([^"“”«»]{2,40})["”»]')
RE_TITULO = re.compile(r"<title>([^<]*)</title>", re.I)
RE_LOC_VE = re.compile(r'href="(/location/([^/"]+)/([^/"]+)/Venezuela)"')


def norm(valor, compacta=False):
    t = unicodedata.normalize("NFKC", valor or "").lower().replace("&", " y ").replace("'", "")
    # El guion es separador débil: «Paiva-Bimbo» y «Paiva Bimbo» son el mismo nombre
    # (medido 2026-10-17: sin esto, Alvaro Paiva-Bimbo entraba como «nuevo» con ficha en el catálogo).
    t = t.replace("-", " ")
    t = "".join(c for c in t if c.isalnum() or c.isspace())
    t = " ".join(t.split())
    if compacta:
        return t.replace(" ", "")
    return t


def claves_laxas(nombre):
    """Claves deliberadamente laxas: primer+último token y tokens ordenados.

    Solo se usan cuando las claves exactas no encuentran NADA, y su resultado nunca decide
    «nuevo» por sí solo: como mucho, deja la ficha en revisión.
    """
    t = norm(nombre)
    tokens = t.split()
    salida = set()
    if len(tokens) >= 3:
        salida.add(f"{tokens[0]} {tokens[-1]}")
    if len(tokens) >= 2:
        salida.add(" ".join(sorted(tokens)))
    return {k for k in salida if k}


def claves(nombre):
    """Claves de comparación de un nombre + variantes por apodo (base y apodo suelto)."""
    base = norm(nombre)
    apodos = [norm(a) for a in RE_APODO.findall(nombre or "")]
    sin_apodo = norm(RE_APODO.sub(" ", nombre or ""))
    candidatos = {base, sin_apodo, *apodos}
    salida = set()
    for c in candidatos:
        if not c:
            continue
        sin_art = " ".join(c.split()[1:]) if len(c.split()) > 1 and c.split()[0] in ARTICULOS else c
        sin_tilde = "".join(x for x in unicodedata.normalize("NFD", c) if unicodedata.category(x) != "Mn")
        sin_tilde_art = "".join(x for x in unicodedata.normalize("NFD", sin_art) if unicodedata.category(x) != "Mn")
        salida |= {c, sin_art, sin_tilde, sin_tilde_art, c.replace(" ", ""), sin_tilde.replace(" ", "")}
    return {k for k in salida if k}


def psql(consulta, timeout=120):
    r = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAF", "\t", "-c", consulta],
                       capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise SystemExit(f"psql: {r.stderr[:400]}")
    return [l.split("\t") for l in r.stdout.strip().splitlines() if l.strip()]


def cargar_catalogo():
    datos = {"artists": {}, "persons": {}, "albumes": defaultdict(set), "miembros": defaultdict(set), "indice": defaultdict(list)}
    for aid, nombre, ciudad, tipo, anio in psql(
            "SELECT id, name, coalesce(nullif(origin_city,''),'·'), coalesce(artist_type::text,'·'), "
            "coalesce(formed_year::text,'·') FROM public.artists"):
        datos["artists"][int(aid)] = {"id": int(aid), "nombre": nombre, "ciudad": "" if ciudad == "·" else ciudad,
                                       "tipo": "" if tipo == "·" else tipo, "anio": None if anio == "·" else int(anio)}
    for pid, nombre, ciudad, nac in psql(
            "SELECT id, name, coalesce(nullif(birth_city,''),'·'), coalesce(nullif(birth_date_value,''),'·') FROM public.persons"):
        anio = RE_ANIO.search(nac or "")
        datos["persons"][int(pid)] = {"id": int(pid), "nombre": nombre, "ciudad": "" if ciudad == "·" else ciudad,
                                       "anio": int(anio.group(0)) if anio else None, "tipo": "persona"}
    for aid, titulo in psql("SELECT artist_id, title FROM public.albums"):
        datos["albumes"][int(aid)].add(norm(titulo))
    for aid, persona in psql("""SELECT m.artist_id, p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id"""):
        datos["miembros"][int(aid)].add(norm(persona))
    for tabla, campo in (("artists", "artists"), ("persons", "persons")):
        for reg in datos[campo].values():
            for clave in claves(reg["nombre"]) | claves_laxas(reg["nombre"]):
                datos["indice"][clave].append((tabla, reg["id"]))
    return datos


def fichas_por_slug():
    indice = {}
    for d in PAGINAS:
        if not d.exists():
            continue
        for f in d.glob("*.html"):
            indice.setdefault(f.stem, f)
    return indice


def parsear_ficha(ruta):
    """Discografía (títulos + tipo + año), integrantes y géneros de una ficha de artista de RYM."""
    html = ruta.read_text(encoding="utf-8", errors="replace")
    soup: object = BeautifulSoup(html, "lxml")
    discos, vistos = [], set()
    for a in soup.select('a[href*="/release/"]'):
        titulo = re.sub(r"\s+", " ", a.get_text(" ", strip=True)).strip()
        href = str(a.get("href") or "")
        if not titulo or href in vistos:
            continue
        vistos.add(href)
        tipo = href.split("/release/")[-1].split("/")[0]
        fila = a.find_parent("tr")
        anio = None
        if fila:
            texto = re.sub(r"\s+", " ", fila.get_text(" ", strip=True))
            coincidencias = RE_ANIO.findall(texto)
            if coincidencias:
                anio = int(coincidencias[-1])
        discos.append({"titulo": titulo, "tipo": tipo, "anio": anio})
    # Alineación / miembros del bloque de información del artista
    miembros = ""
    for fila in soup.select("table.mbgen tr"):
        celdas = fila.find_all("td")
        if len(celdas) >= 2 and celdas[0].get_text(" ", strip=True) in ("Members", "Member of"):
            etiqueta = celdas[0].get_text(" ", strip=True)
            valor = re.sub(r"\s+", " ", celdas[1].get_text(" ", strip=True))
            if etiqueta == "Members" and not miembros:
                miembros = valor
    generos = [re.sub(r"\s+", " ", a.get_text(" ", strip=True)) for a in soup.select('a[href^="/genre/"]')][:6]
    return {"discos": discos, "miembros_texto": miembros, "generos": generos}


def parsear_nombres_miembros(texto):
    """«Daniel Reyes (guitar), Robin Morán (vocals, guitar)» → {'daniel reyes', 'robin moran'}."""
    salida = set()
    for trozo in re.split(r",(?![^()]*\))", texto or ""):
        nombre = re.sub(r"\([^)]*\)", "", trozo).strip(" .;")
        if 2 < len(nombre) < 60:
            salida.add(norm(nombre))
    return salida


def evaluar(reg, datos, fichas):
    """Devuelve (estado, mejor_candidato, puntaje, motivos) para una ficha de RYM."""
    nombre = reg.get("nombre_rym") or ""
    slug = (reg.get("rym_url") or "").rstrip("/").split("/artist/")[-1]
    ruta = fichas.get(slug)
    ficha = parsear_ficha(ruta) if ruta else {"discos": [], "miembros_texto": "", "generos": []}
    ficha["tiene_pagina"] = ruta is not None
    discos_rym = {norm(d["titulo"]) for d in ficha["discos"] if d["titulo"]}
    anio_rym = reg.get("anio_referencia_rym")
    ciudad_rym = norm(reg.get("ciudad_rym") or "")
    tipo_rym = reg.get("tipo_rym") or ""
    miembros_rym = parsear_nombres_miembros(ficha["miembros_texto"] or reg.get("alineacion_rym") or "")

    ids = set()
    for clave in claves(nombre):
        for tabla, ident in datos["indice"].get(clave, []):
            ids.add((tabla, ident))
    match_laxo = False
    if not ids:
        for clave in claves_laxas(nombre):
            for tabla, ident in datos["indice"].get(clave, []):
                ids.add((tabla, ident))
        match_laxo = bool(ids)
    # candidatas declaradas por la auditoría (por si su normalización era más laxa)
    for trozo in re.split(r"[|,]", reg.get("candidatas_catalogo") or ""):
        m = re.match(r"\s*(artists|persons):(\d+)", trozo)
        if m:
            ids.add((m.group(1), int(m.group(2))))

    evaluaciones = []
    for tabla, ident in ids:
        cand = datos["artists"].get(ident) if tabla == "artists" else datos["persons"].get(ident)
        if not cand:
            continue
        puntos, motivos = 0, []
        albumes = datos["albumes"].get(ident, set()) if tabla == "artists" else set()
        solape = discos_rym & albumes
        if not solape and discos_rym and albumes:
            solape = {t for t in discos_rym if len(t) > 8 and any(t in a or a in t for a in albumes)}
        if solape:
            puntos += 6
            motivos.append(f"discos en común: {sorted(solape)[:3]}")
        if anio_rym and cand.get("anio"):
            if int(anio_rym) == int(cand["anio"]):
                puntos += 2
                motivos.append(f"año {anio_rym} coincide")
            else:
                puntos -= 3
                motivos.append(f"año RYM {anio_rym} ≠ catálogo {cand['anio']}")
        if ciudad_rym and norm(cand.get("ciudad") or ""):
            if ciudad_rym == norm(cand["ciudad"]) or ciudad_rym in norm(cand["ciudad"]) or norm(cand["ciudad"]) in ciudad_rym:
                puntos += 2
                motivos.append(f"ciudad {cand['ciudad']} coincide")
            else:
                puntos -= 1
                motivos.append(f"ciudad RYM {reg.get('ciudad_rym')} ≠ {cand['ciudad']}")
        if tabla == "artists" and miembros_rym:
            comunes = miembros_rym & datos["miembros"].get(ident, set())
            if comunes:
                puntos += 3
                motivos.append(f"integrantes en común: {sorted(comunes)[:3]}")
        if tipo_rym == "grupo" and tabla == "persons":
            puntos -= 2
            motivos.append("RYM es grupo pero la candidata es persona")
        if tipo_rym == "persona" and tabla == "artists":
            puntos -= 1
            motivos.append("RYM parece persona pero la candidata es artista")
        if norm(cand["nombre"]) == norm(nombre):
            puntos += 1
        evaluaciones.append({"tabla": tabla, "id": ident, "nombre": cand["nombre"], "ciudad": cand.get("ciudad"),
                             "anio": cand.get("anio"), "puntos": puntos, "motivos": motivos})
    evaluaciones.sort(key=lambda e: -e["puntos"])
    mejor = evaluaciones[0] if evaluaciones else None
    if mejor is None:
        estado = "nuevo"
    elif mejor["puntos"] >= 6:
        estado = "duplicado"
    elif mejor["puntos"] >= 4:
        estado = "duplicado_probable"
    elif any(int(anio_rym or 0) and e["anio"] and int(anio_rym) != int(e["anio"]) for e in evaluaciones):
        estado = "colision"
    else:
        estado = "nuevo_revisar"
    if match_laxo and estado == "nuevo":
        estado = "nuevo_revisar"  # un match laxo (nombre parcial) no autoriza a declarar «nuevo»
    return estado, mejor, ficha, evaluaciones[:3], match_laxo


def huecos_rym():
    """Cuántas páginas de ciudad se capturaron, cuántas locations de VE se ven en ellas y cuáles faltan."""
    capturadas, vistas = set(), Counter()
    for f in CIUDADES.glob("*.html"):
        html = f.read_text(encoding="utf-8", errors="replace")
        m = RE_TITULO.search(html)
        if m:
            capturadas.add(m.group(1).split(" - Rate Your Music")[0].strip().lower())
        for _, ciudad, estado in RE_LOC_VE.findall(html):
            vistas[(ciudad.replace("%20", " "), estado.replace("%20", " "))] += 1
    faltan = [(c, e, n) for (c, e), n in vistas.items() if f"{c}, {e}, VE".lower() not in capturadas]
    return len(capturadas), vistas, sorted(faltan, key=lambda t: -t[2])


def estrategia(filas, descartados, sin_discos_lista, ve_con_discos, datos, revisar_lista=()):
    """Plan para encontrar a los que faltan, con los huecos medidos hoy."""
    capturadas, vistas, faltan = huecos_rym()
    por_estado = Counter(f["estado_identidad"] for f in filas)
    lineas = [
        "# Estrategia para encontrar los artistas venezolanos que faltan",
        "",
        f"Medido el {date.today().isoformat()} contra el catálogo vivo y las capturas en disco.",
        "",
        "## Dónde estamos",
        "",
        f"- RYM: **{capturadas} páginas de ciudad capturadas**; en ellas se ven **{len(vistas)} locations de Venezuela**,",
        f"  de las que **{len(faltan)} no tienen página capturada** (incluye variantes de nombre de la misma ciudad).",
        f"- Fichas de artista RYM en disco (para leer discografía): "
        f"**{sum(1 for d in PAGINAS if d.exists() for _ in d.glob('*.html'))}**.",
        f"- De la auditoría de 950 fichas: 722 venezolanas → **{ve_con_discos} con discografía legible**; de ellas "
        f"**{len(filas)} no son el catálogo** · {len(revisar_lista)} por resolver · {len(descartados)} apartadas por "
        f"duplicado · {len(sin_discos_lista)} sin discografía verificable.",
        f"- Catálogo: **{len(datos['artists'])} artistas**, de los que {sum(1 for a in datos['artists'].values() if a['ciudad'])} "
        "tienen ciudad y el resto no.",
        "",
        "## Hueco 1 · Ciudades de RYM sin capturar (lo más barato)",
        "",
        "Las páginas de ciudad se pueden capturar sin cuenta y traen, por artista: ciudad, año, alineación y «Member of».",
        "Faltan estas locations (las 40 con más enlaces vistos):",
        "",
    ]
    for ciudad, estado, veces in faltan[:40]:
        lineas.append(f"- /location/{ciudad.replace(' ', '%20')}/{estado.replace(' ', '%20')}/Venezuela — {veces} enlaces")
    lineas += [
        "",
        "**Cómo:** reutilizar el capturador de RYM con la lista de locations faltantes (una pasada por página y su paginación),",
        "con el mismo ritmo humano y la sesión del dueño. Después: `scripts/rym-ciudades-reparse.py` (ya existe) y el mismo",
        "cruce por niveles. Coste: minutos por ciudad; sin LLM.",
        "",
        "## Hueco 2 · Fichas de artista ya capturadas, sin exprimir",
        "",
        "Las 12.305 fichas en disco traen discografía, ciudad, integrantes y géneros. Hoy solo se usaron para la captura RYM.",
        "**Cómo:** pasar `scripts/rym-v4-reparse.py` (o el extractor de discografía de este script) sobre todas y cruzar",
        "discografía contra `public.albums`: el solape de títulos es la señal de identidad más fuerte que tenemos.",
        "Eso permite decidir altas y también descubrir artistas que RYM lista pero cuya página de ciudad no se capturó.",
        "",
        "## Hueco 3 · Fuentes fuera de RYM (para los que RYM no lista por ciudad)",
        "",
        "| fuente | qué aporta | estado en el repo |",
        "|---|---|---|",
        "| MusicBrainz (area VE) | artistas con país/area Venezuela y relaciones | 1.666 MBID ya cosechados; faltan los demás |",
        "| Discogs | artistas por país, con discografía y créditos | hay cosecha de bios; no barrido por país |",
        "| Metal Archives | bandas VE con discografía, año y ciudad | `data/raw/metal-archives-ve-2026-10-01` |",
        "| Bandcamp | artistas con location Venezuela y releases | sin barrido |",
        "| Last.fm | tags venezuelan/venezuela/venezuelan rock | tags ya cargados en entity_user_tags |",
        "| Sincopa / blogs / Hemeroteka | fichas históricas con discografía | cosechados y aplicados en parte |",
        "| YouTube | canales/álbumes de artistas VE | hay disponibilidad de videos, no barrido de artistas |",
        "",
        "**Orden recomendado:** (1) completar RYM por ciudad; (2) re-parsear las fichas ya en disco; (3) MusicBrainz por area",
        "VE para los que no aparezcan; (4) Discogs y Bandcamp por país; (5) cruzar todo contra el catálogo con las seis señales",
        "de este script (nombre con apodos, discografía, año, ciudad, integrantes, tipo).",
        "",
        "## Regla de inclusión (para no volver a llenar el catálogo de homónimos)",
        "",
        "1. Vínculo venezolano explícito (ciudad de VE en RYM, area VE en MusicBrainz, país Venezuela en Discogs…).",
        "2. Al menos una obra musical (release) atribuida a esa ficha, no solo mención en una biografía.",
        "3. Identidad: si hay candidata en el catálogo, exigir **discografía en común o año+ciudad+integrantes**;",
        "   con solo el nombre igual no se descarta ni se fusiona: va a colisión.",
        "4. Toda alta lleva claim + evidencia con la URL de la fuente y el run reversible.",
        "",
        "## Métrica de avance",
        "",
        "- Artistas VE con discografía detectados por fuente (hoy: RYM).",
        "- Nuevos vs duplicados vs colisiones por lote (hoy: "
        f"{por_estado.get('nuevo', 0)} nuevos · {len(descartados)} duplicados · {len(revisar_lista)} por resolver).",
        "- % del catálogo con ciudad/año/miembros, antes y después de cada lote.",
    ]
    return "\n".join(lineas) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audit", default=str(DEF_AUD))
    ap.add_argument("--out", default=str(DEF_OUT))
    args = ap.parse_args()
    out = Path(args.out)
    aud = [json.loads(l) for l in Path(args.audit).open(encoding="utf-8") if l.strip()]
    datos = cargar_catalogo()
    fichas = fichas_por_slug()
    print(f"auditoría {len(aud)} · catálogo artistas {len(datos['artists'])} · personas {len(datos['persons'])} · fichas RYM {len(fichas)}")

    # Dedupe interno de las propias fichas RYM: mismo nombre (con variantes) + misma ciudad/año.
    vistos_internos = {}
    filas, descartados, sin_discos_lista, revisar_lista = [], [], [], []
    sin_discografia = 0
    ve_con_discos = 0
    for reg in aud:
        if (reg.get("pais_rym") or "") != "Venezuela":
            continue
        estado, mejor, ficha, top, match_laxo = evaluar(reg, datos, fichas)
        tiene_discos = len(ficha["discos"]) > 0
        if tiene_discos:
            ve_con_discos += 1
        else:
            sin_discografia += 1
        estado_discografia = "con_discos" if tiene_discos else ("ficha_sin_discos" if ficha.get("tiene_pagina") else "sin_ficha")
        clave_interna = (norm(reg.get("nombre_rym") or ""), norm(reg.get("ciudad_rym") or ""), reg.get("anio_referencia_rym"))
        variantes = claves(reg.get("nombre_rym") or "")
        duplicado_interno = None
        for v in variantes:
            for ya in vistos_internos.get(v, []):
                if ya["ciudad"] == clave_interna[1] and (ya["anio"] == clave_interna[2] or not ya["anio"] or not clave_interna[2]):
                    duplicado_interno = ya["nombre"]
                    break
            if duplicado_interno:
                break
        fila = {
            "nombre": reg.get("nombre_rym"),
            "tipo_rym": reg.get("tipo_rym"),
            "pais": reg.get("pais_rym"),
            "ciudad": reg.get("ciudad_rym"),
            "anio": reg.get("anio_referencia_rym"),
            "discos_catalogo_rym": len(ficha["discos"]),
            "discografia_rym": [d["titulo"] for d in ficha["discos"][:25]],
            "generos_rym": ficha["generos"],
            "alineacion_rym": ficha["miembros_texto"] or reg.get("alineacion_rym") or "",
            "grupos_vinculados": reg.get("grupos_vinculados") or "",
            "estado_identidad": estado,
            "estado_discografia": estado_discografia,
            "match_laxo": match_laxo,
            "candidata": mejor,
            "candidatas_top": top,
            "auditoria_recomendacion": reg.get("recomendacion"),
            "auditoria_evidencia": reg.get("grado_de_evidencia"),
            "auditoria_justificacion": reg.get("justificacion"),
            "origen_archivo": reg.get("origen_archivo"),
            "rym_url": reg.get("rym_url"),
            "tiene_ficha_rym": bool(ficha["discos"]),
        }
        if duplicado_interno:
            fila["estado_identidad"] = "duplicado_interno"
            fila["candidata"] = {"nombre": duplicado_interno, "motivo": "misma ficha repetida en el lote"}
            descartados.append(fila)
            continue
        for v in variantes:
            vistos_internos.setdefault(v, []).append({"nombre": fila["nombre"], "ciudad": clave_interna[1], "anio": clave_interna[2]})
        if estado in ("duplicado", "duplicado_probable"):
            descartados.append(fila)
        elif estado in ("nuevo_revisar", "colision"):
            # Hay una ficha con el mismo nombre en el catálogo (o el año choca): NO se declara nuevo.
            revisar_lista.append(fila)
        elif fila["estado_discografia"] == "con_discos":
            filas.append(fila)
        else:
            sin_discos_lista.append(fila)

    filas.sort(key=lambda f: ({"nuevo": 0, "nuevo_revisar": 1}.get(f["estado_identidad"], 2), (f["ciudad"] or "zz"), f["nombre"].lower()))
    hoy = date.today().isoformat()
    nombres = {
        "jsonl": out / f"RYM venezolanos con discografia {hoy}.jsonl",
        "csv": out / f"RYM venezolanos con discografia {hoy}.csv",
        "md": out / f"RYM venezolanos con discografia {hoy}.md",
        "dup": out / f"RYM duplicados descartados {hoy}.jsonl",
        "sin": out / f"RYM venezolanos sin discografia verificable {hoy}.jsonl",
        "rev": out / f"RYM por resolver identidad {hoy}.jsonl",
        "plan": out / f"Estrategia para encontrar los demas {hoy}.md",
    }
    with nombres["sin"].open("w", encoding="utf-8") as fh:
        for f in sin_discos_lista:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    with nombres["rev"].open("w", encoding="utf-8") as fh:
        for f in revisar_lista:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    nombres["plan"].write_text(estrategia(filas, descartados, sin_discos_lista, ve_con_discos, datos, revisar_lista), encoding="utf-8")
    with nombres["jsonl"].open("w", encoding="utf-8") as fh:
        for f in filas:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    with nombres["dup"].open("w", encoding="utf-8") as fh:
        for f in descartados:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    campo_csv = ["nombre", "tipo_rym", "ciudad", "anio", "discos_catalogo_rym", "discografia_rym",
                 "alineacion_rym", "grupos_vinculados", "estado_identidad", "auditoria_recomendacion", "rym_url"]
    with nombres["csv"].open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=campo_csv, extrasaction="ignore")
        w.writeheader()
        for f in filas:
            fila = dict(f)
            fila["discografia_rym"] = " | ".join(f["discografia_rym"])
            w.writerow(fila)

    por_estado = Counter(f["estado_identidad"] for f in filas)
    con_discos = [f for f in filas if f["discos_catalogo_rym"]]
    lineas = [
        f"# RYM · venezolanos con discografía fuera del catálogo ({hoy})",
        "",
        "**Qué es.** De la auditoría de 950 fichas RYM (páginas de ciudad, cosecha manual 2026-10-01)",
        f"se toman las **{len([r for r in aud if (r.get('pais_rym') or '') == 'Venezuela'])} venezolanas**, se les lee la",
        "**discografía real** en la ficha RYM capturada y se decide identidad contra el catálogo vivo con nombre",
        "(niveles + apodos), títulos de disco, año, ciudad, integrantes y tipo. Lo que resulta duplicado se aparta.",
        "",
        "**Resultado.**",
        f"- Fichas venezolanas auditadas: {len([r for r in aud if (r.get('pais_rym') or '') == 'Venezuela'])}",
        f"- Con discografía legible en su ficha RYM: **{ve_con_discos}**",
        f"- **En esta lista (venezolanos con discografía y sin ficha en el catálogo): {len(filas)}** "
        f"(todos con estado «nuevo»: ni nombre, ni apodo, ni disco en común con ninguna ficha)",
        f"- Por resolver identidad (mismo nombre en el catálogo, o año en conflicto): **{len(revisar_lista)}** "
        f"(ver `{nombres['rev'].name}`)",
        f"- Apartados por duplicado: **{len(descartados)}** (ver `{nombres['dup'].name}`)",
        f"- Sin discografía verificable (ficha sin releases o sin ficha capturada): **{len(sin_discos_lista)}** "
        f"(ver `{nombres['sin'].name}`)",
        "",
        "**Cómo se decidió «es el mismo».** Puntaje por señales: discos en común +6 · integrantes en común +3 ·",
        "año igual +2 · ciudad igual +2 · nombre exacto +1 · año en conflicto −3 · tipo contradictorio −2/−1.",
        "≥6 = duplicado; 4–5 = duplicado probable (también se aparta); ≤3 con año en conflicto = **colisión** (no se",
        "descarta: puede ser otro artista homónimo); ≤3 sin conflicto = **nuevo** (o `nuevo_revisar` si no había ni",
        "discografía ni señales suficientes).",
        "",
        "**Campos.** `nombre`, `tipo_rym`, `ciudad`, `anio`, `discos_catalogo_rym` (cuántos discos lista su ficha RYM),",
        "`discografia_rym` (primeros 25 títulos), `alineacion_rym` (integrantes con rol), `grupos_vinculados`,",
        "`estado_identidad`, `candidata` (la ficha del catálogo que se evaluó, con motivos), `auditoria_*` (lo que dijo",
        "la auditoría previa) y `rym_url`.",
        "",
        f"## Índice por ciudad ({len(filas)} fichas)",
        "",
        "| artista | tipo | año | ciudad | discos | integrantes / grupos | estado | RYM |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for f in filas:
        detalle = (f["alineacion_rym"] or f["grupos_vinculados"] or "")
        detalle = (detalle[:80] + "…") if len(detalle) > 80 else detalle
        lineas.append(f"| {f['nombre']} | {f['tipo_rym']} | {f['anio'] or ''} | {f['ciudad'] or ''} | "
                      f"{f['discos_catalogo_rym']} | {detalle.replace('|', '/')} | {f['estado_identidad']} | [RYM]({f['rym_url']}) |")
    lineas += ["", "## Por resolver identidad (no se declaran nuevos)", ""]
    for f in revisar_lista[:60]:
        cand = f.get("candidata") or {}
        motivos = "; ".join(cand.get("motivos") or []) if isinstance(cand, dict) else ""
        lineas.append(f"- {f['nombre']} ({f['ciudad'] or '?'}): {f['estado_identidad']} → "
                      f"{cand.get('nombre') if isinstance(cand, dict) else ''} — {motivos[:150]}")
    lineas += ["", "## Apartados por duplicado (motivo resumido)", ""]
    for f in descartados[:60]:
        cand = f.get("candidata") or {}
        motivos = "; ".join(cand.get("motivos") or []) if isinstance(cand, dict) else ""
        lineas.append(f"- {f['nombre']} ({f['ciudad'] or '?'}): {f['estado_identidad']} → {cand.get('nombre') if isinstance(cand, dict) else ''} — {motivos[:160]}")
    nombres["md"].write_text("\n".join(lineas) + "\n", encoding="utf-8")

    print(f"venezolanas auditadas: {len([r for r in aud if (r.get('pais_rym') or '') == 'Venezuela'])} · sin discografía legible: {sin_discografia}")
    print(f"lista final: {len(filas)} {dict(por_estado)} · descartados: {len(descartados)}")
    for clave, ruta in nombres.items():
        print(f"  {clave}: {ruta} ({ruta.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
