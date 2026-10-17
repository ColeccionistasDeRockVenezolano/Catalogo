#!/usr/bin/env python3
"""RYM · qué se puede aprovechar de los descartados por duplicado (medición + plan).

Los 449 descartados son la MISMA entidad que una ficha del catálogo. Sus datos no se tiraron:
están en el export. Este script mide, contra el catálogo vivo, cuánto de eso rellena huecos:

  · ciudad vacía en el catálogo y ciudad en RYM,
  · año vacío y año en RYM,
  · discos de RYM que el catálogo NO tiene (solo releases del propio artista: /release/…/<slug>/…),
  · integrantes de RYM que el catálogo no registra como miembros,
  · géneros de RYM.

Salida: reports/…/enriquecimiento-desde-duplicados-<fecha>.jsonl + resumen en consola.
No escribe en el catálogo: es el plan para el aplicador.
"""
import json
import re
import subprocess
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from bs4 import BeautifulSoup

REPO = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
DESKTOP = Path("/home/brian/Desktop")
PAGINAS = [REPO / "data/raw/fuentes-web-2026-10-16/rym-resto/pages",
           REPO / "data/raw/fuentes-web-2026-10-01/rym-nuevos/pages"]
RE_ANIO = re.compile(r"\b(1[89]\d{2}|20\d{2})\b")


def norm(t):
    t = unicodedata.normalize("NFKC", t or "").lower().replace("&", " y ").replace("'", "").replace("-", " ")
    t = "".join(c for c in t if c.isalnum() or c.isspace())
    return " ".join(t.split())


def psql(q, timeout=120):
    r = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAF", "\t", "-c", q],
                       capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise SystemExit(r.stderr[:300])
    return [l.split("\t") for l in r.stdout.strip().splitlines() if l.strip()]


def catalogo():
    art, per = {}, {}
    for aid, nombre, ciudad, anio in psql("SELECT id, name, coalesce(nullif(origin_city,''),'·'), "
                                          "coalesce(formed_year::text,'·') FROM public.artists"):
        art[int(aid)] = {"nombre": nombre, "ciudad": "" if ciudad == "·" else ciudad,
                         "anio": None if anio == "·" else int(anio)}
    for pid, nombre, ciudad, nac in psql("SELECT id, name, coalesce(nullif(birth_city,''),'·'), "
                                         "coalesce(nullif(birth_date_value,''),'·') FROM public.persons"):
        m = RE_ANIO.search(nac or "")
        per[int(pid)] = {"nombre": nombre, "ciudad": "" if ciudad == "·" else ciudad,
                         "anio": int(m.group(0)) if m else None}
    albumes = defaultdict(set)
    for aid, titulo in psql("SELECT artist_id, title FROM public.albums"):
        albumes[int(aid)].add(norm(titulo))
    miembros = defaultdict(set)
    for aid, persona in psql("SELECT m.artist_id, p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id"):
        miembros[int(aid)].add(norm(persona))
    return art, per, albumes, miembros


def fichas():
    indice = {}
    for d in PAGINAS:
        if d.exists():
            for f in d.glob("*.html"):
                indice.setdefault(f.stem, f)
    return indice


def discos_propios(ruta, slug):
    """Releases de la ficha cuyo path incluye el slug del artista (descarta apariciones y créditos)."""
    soup: object = BeautifulSoup(ruta.read_text(encoding="utf-8", errors="replace"), "lxml")
    salida, vistos = [], set()
    for a in soup.select('a[href*="/release/"]'):
        href = str(a.get("href") or "")
        partes = href.split("/release/")[-1].split("/")
        if len(partes) < 3 or partes[1] != slug:
            continue
        titulo = re.sub(r"\s+", " ", a.get_text(" ", strip=True)).strip()
        if not titulo or href in vistos:
            continue
        vistos.add(href)
        fila = a.find_parent("tr")
        anio = None
        if fila:
            m = RE_ANIO.findall(re.sub(r"\s+", " ", fila.get_text(" ", strip=True)))
            anio = int(m[-1]) if m else None
        salida.append({"titulo": titulo, "tipo": partes[0], "anio": anio, "url": href})
    return salida


def nombres_miembros(texto):
    salida = set()
    for trozo in re.split(r",(?![^()]*\))", texto or ""):
        nombre = re.sub(r"\([^)]*\)", "", trozo).strip(" .;")
        if 2 < len(nombre) < 60:
            salida.add(norm(nombre))
    return salida


def main():
    dup = [json.loads(l) for l in (DESKTOP / "RYM duplicados descartados 2026-10-17.jsonl").open(encoding="utf-8") if l.strip()]
    art, per, albumes, miembros = catalogo()
    fichas_idx = fichas()
    plan = []
    resumen = Counter()
    for f in dup:
        cand = f.get("candidata") or {}
        tabla, ident = cand.get("tabla"), cand.get("id")
        if not tabla or not ident:
            resumen["sin candidata (no aprovechable)"] += 1
            continue
        ident = int(ident)
        registro = {"rym": f["nombre"], "rym_url": f.get("rym_url"), "slug": (f.get("rym_url") or "").rstrip("/").split("/artist/")[-1],
                    "catalogo": cand.get("nombre"), "tabla": tabla, "id": ident, "puntos_er": cand.get("puntos"),
                    "estado_er": f["estado_identidad"], "tipo_rym": f.get("tipo_rym")}
        huecos = {}
        if tabla == "artists":
            base = art.get(ident, {})
            if base and not base["ciudad"] and f.get("ciudad"):
                huecos["origin_city"] = f["ciudad"]
            if base and not base["anio"] and f.get("anio"):
                huecos["formed_year"] = f["anio"]
        else:
            base = per.get(ident, {})
            if base and not base["ciudad"] and f.get("ciudad"):
                huecos["birth_city"] = f["ciudad"]
            if base and not base["anio"] and f.get("anio"):
                huecos["birth_year"] = f["anio"]
        if huecos:
            registro["huecos_simples"] = huecos
            resumen["con ciudad/año rellenables"] += 1
        ruta = fichas_idx.get(registro["slug"])
        if ruta:
            propios = discos_propios(ruta, registro["slug"])
            conocidos = albumes.get(ident, set()) if tabla == "artists" else set()
            faltantes = [d for d in propios if norm(d["titulo"]) not in conocidos]
            if faltantes:
                registro["discos_no_catalogados"] = faltantes[:30]
                resumen["con discos no catalogados"] += 1
            nombres = nombres_miembros(f.get("alineacion_rym") or "")
            if nombres and tabla == "artists":
                nuevos = sorted(nombres - miembros.get(ident, set()))
                if nuevos:
                    registro["integrantes_no_registrados"] = nuevos[:20]
                    resumen["con integrantes sin membresía"] += 1
        if f.get("generos_rym"):
            registro["generos_rym"] = f["generos_rym"]
        if len(registro) > 7:
            plan.append(registro)
    plan.sort(key=lambda r: -(len(r.get("discos_no_catalogados") or []) + len(r.get("integrantes_no_registrados") or [])))
    salida = REPO / "reports/rym-venezolanos-2026-10-17" / f"enriquecimiento-desde-duplicados-{date.today().isoformat()}.jsonl"
    with salida.open("w", encoding="utf-8") as fh:
        for r in plan:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print("duplicados leídos:", len(dup))
    for k, v in resumen.most_common():
        print(f"  {k}: {v}")
    print("fichas con algo aprovechable:", len(plan), "→", salida)
    print("discos no catalogados (total):", sum(len(r.get("discos_no_catalogados") or []) for r in plan))
    print("integrantes sin membresía (total):", sum(len(r.get("integrantes_no_registrados") or []) for r in plan))


if __name__ == "__main__":
    main()
