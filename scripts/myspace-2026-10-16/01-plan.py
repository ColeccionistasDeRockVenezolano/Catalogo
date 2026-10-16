#!/usr/bin/env python3
"""Plan de aplicación al catálogo de la cosecha MySpace/Wayback (paso previo a los appliers).

Medido 2026-10-16: bio/foto/ciudad/año/membresías del catálogo están SIN hueco entre estos
artistas, así que la aplicación NO rellena campos: aporta (a) miembros que el catálogo no
tiene, (b) géneros de época 2007-2010 como claims de evidencia, (c) bio/ciudad de época como
claims de contraste. Filtros de calidad: tildes perdidas del snapshot 2010 («Represi..n»),
rellenos de separadores («| |»), segmentos basura.

Emite en reports/myspace-2026-10-16/plan/:
  miembros-extra.jsonl · genero-epoca.jsonl · ciudad-epoca.jsonl · biografia-epoca.jsonl
  informe-plan.md      · resumen.json
Uso: python3 scripts/myspace-2026-10-16/01-plan.py [--muestra N] [--salida DIR]
"""
import argparse
import collections
import json
import re
import subprocess
import unicodedata
from pathlib import Path

JSONL = Path("reports/ma-links-2026-10-15/myspace-piloto.jsonl")
TITULO = re.compile(r"^\s*MySpace\.com\s*-\s*(?P<banda>[^-]+?)\s*-\s*(?P<ciudad>[^-]+?)\s*-\s*(?P<generos>[^-]+?)\s*-\s*(?P<url>\S+)", re.I)
NOMBRE_MALO = re.compile(r"^(manager|management|contacto?|booking|prensa|tel|cel|celular|telf|correo|email|myspace)\b", re.I)
# campos canónicos que sí tienen destino en los specs del core
CANON = {"About": "biography", "Genres": "genre", "Location": "origin_city", "Genres_t": "genre"}
# etiquetas en otros idiomas (perfiles FR/ES) normalizadas a la etiqueta canónica
EQUIV = {"membre depuis": "Member Since", "membres du groupe": "Band Members", "site web du groupe": "Band Website",
         "similaire à": "Sounds Like", "similaire a": "Sounds Like", "type de label": "Type of Label",
         "miembro desde": "Member Since", "miembros de la banda": "Band Members", "influencias": "Influences",
         "sello discográfico": "Record Label", "sitio web de la banda": "Band Website", "suena como": "Sounds Like",
         "acerca de": "About"}
# campos de perfil PERSONAL (no de banda) o sin destino: no entran al plan
BASURA = {"general", "music", "television", "books", "heroes", "status:", "here for:", "orientation:",
          "body type:", "zodiac sign:", "children:", "occupation:", "profile views", "last login",
          "member since", "type of label", "record label", "band website", "influences", "sounds like",
          "band members"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def tildes_rotas(t: str) -> bool:
    return bool(re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]\.[A-Za-zÁÉÍÓÚÑáéíóúñ]", t or ""))


def texto_util(t: str, minimo: int = 40) -> str:
    """Devuelve el texto limpio si sirve como dato, o ''."""
    if not t:
        return ""
    t = re.sub(r"[|]+", " ", t)
    t = re.sub(r"[.\s]{4,}", " ", t)
    t = re.sub(r"\s+", " ", t).strip(" .|-")
    if len(t) < minimo or tildes_rotas(t):
        return ""
    if re.fullmatch(r"[\s.\-|]*", t):
        return ""
    return t


def parsear_miembros(t: str, roto: bool) -> list[tuple[str, str]]:
    """(nombre, rol) de un campo Band Members de cualquier plantilla."""
    if not t:
        return []
    t = re.sub(r"[|]+", "\n", t)
    partes = re.split(r"[;\n]+", t)
    fuera = []
    for p in partes:
        p = re.sub(r"</?[A-Za-z][^>]*>?", " ", p)
        p = re.sub(r"\s+", " ", p).strip(" .-,")
        if len(p) < 4 or len(p) > 90:
            continue
        if re.search(r"http|@|\d{4}\s*-\s*\d{4}|\baka\b", p, re.I):
            continue
        m = re.match(r"^(?P<nombre>[^:]{3,60}?)\s*[:\-]\s*(?P<rol>.{2,70})$", p)
        if not m:
            continue
        nombre, rol = m.group("nombre").strip(" .-"), m.group("rol").strip(" .-")
        if not nombre or not rol:
            continue
        if roto and tildes_rotas(nombre + " " + rol):
            continue
        # el nombre debe parecer nombre de persona (letras, 1-4 palabras)
        if not re.fullmatch(r"[A-Za-zÁÉÍÓÚÑáéíóúñ'’\- ]{3,50}", nombre):
            continue
        fuera.append((nombre, rol))
    return fuera


def psql(sql: str) -> list[list[str]]:
    r = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAF", "|", "-c", sql],
                       capture_output=True, text=True, timeout=120)
    return [l.split("|") for l in r.stdout.strip().splitlines() if l.strip()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--muestra", type=int, default=10)
    ap.add_argument("--salida", default="reports/myspace-2026-10-16/plan")
    args = ap.parse_args()
    out = Path(args.salida)
    out.mkdir(parents=True, exist_ok=True)

    regs: dict[str, dict] = {}
    for l in JSONL.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(l)
        except Exception:
            continue
        regs[str(r.get("slug") or r.get("ma_id"))] = r
    con_ficha = [r for r in regs.values()
                 if r.get("campos") and r.get("crv_artist_id") and not r.get("reabierto_tardia")]
    print(f"con ficha y datos: {len(con_ficha)}")

    ids = sorted({int(r["crv_artist_id"]) for r in con_ficha})
    lista = ",".join(map(str, ids))

    # personas del catálogo (cotejo global) y membresías actuales por banda
    personas = {}
    for p in psql("SELECT id, name FROM persons"):
        if len(p) >= 2:
            personas[norm(p[1])] = int(p[0])
    alias_persona: dict[str, int] = {}
    for a in psql("SELECT person_id, alias, normalized_alias FROM ingest.person_aliases"):
        if len(a) >= 3 and a[0].strip().isdigit() and int(a[0]) > 0:
            for clave in (norm(a[1]), norm(a[2])):
                if clave:
                    alias_persona.setdefault(clave, int(a[0]))
    miembros_bd: dict[int, set[str]] = collections.defaultdict(set)
    for m in psql(f"SELECT m.artist_id, p.name, coalesce(m.role,'') FROM artist_members m JOIN persons p ON p.id=m.person_id WHERE m.artist_id IN ({lista})"):
        if len(m) >= 3:
            miembros_bd[int(m[0])].add(norm(m[1]))
    print(f"personas en el catálogo: {len(personas)} · bandas con membresías: {len(miembros_bd)}")

    # estado del core para contraste
    core = {}
    for c in psql(f"SELECT id, coalesce(origin_city,''), coalesce(origin_country,''), coalesce(formed_year::text,''), coalesce(biography,'') FROM artists WHERE id IN ({lista})"):
        if len(c) >= 5:
            core[int(c[0])] = {"ciudad": c[1], "pais": c[2], "anio": c[3], "bio_len": len(c[4])}

    miembros, candidatos, generos, ciudades, bios = [], [], [], [], []
    sin_destino = collections.Counter()
    for r in con_ficha:
        aid = int(r["crv_artist_id"])
        url = r.get("url_snapshot") or r.get("url") or ""
        campos = {EQUIV.get(k.lower().strip(), k): v for k, v in (r["campos"] or {}).items()}

        # 1) miembros extra
        bm = campos.get("Band Members") or ""
        roto = tildes_rotas(bm)
        for nombre, rol in parsear_miembros(bm, roto):
            n = norm(nombre)
            if not n or len(n.split()) < 2 and len(n) < 5:
                continue
            if NOMBRE_MALO.match(nombre):
                continue
            rol = re.sub(r"[\d+][\d\s.\-/()+]{5,}", "", rol).strip(" .,-")  # teléfonos fuera del rol
            if len(rol) < 2 or n in miembros_bd.get(aid, set()):
                continue
            # personId: si el nombre (o un alias) ya está en el catálogo, solo falta la relación;
            # los nombres de UNA palabra son ambiguos (homónimos) → van a candidatos, no se aplican.
            pid = None
            if len(n.split()) >= 2:
                pid = personas.get(n) or alias_persona.get(n)
                partes = n.split()
                if not pid and len(partes) == 2:
                    inv = f"{partes[1]} {partes[0]}"
                    pid = personas.get(inv) or alias_persona.get(inv)
            fila = {"artistId": aid, "banda": r["banda"], "person": nombre, "role": rol[:60],
                    "personId": pid, "url": url, "evidencia": f"Band Members del perfil MySpace: {nombre} — {rol}"[:400]}
            (miembros if pid else candidatos).append(fila)

        # 2) géneros de época: campo Genres + título clásico
        gens = set()
        if campos.get("Genres"):
            gens.update(g.strip() for g in re.split(r"[/,]", campos["Genres"]) if g.strip())
        m = TITULO.match(r.get("titulo") or "")
        if m:
            for g in re.split(r"[/,]", m.group("generos")):
                if g.strip():
                    gens.add(g.strip())
        for g in sorted(gens):
            if 2 < len(g) < 40 and not tildes_rotas(g):
                generos.append({"artistId": aid, "banda": r["banda"], "genre": g, "url": url,
                                "evidencia": f"Género declarado en el perfil MySpace ({(r.get('snapshot_ts') or '')[:4]}): {g}"})

        # 3) ciudad de época (contraste)
        if m:
            ciudad_t = m.group("ciudad").strip()
            # «Mariara, VE» / «caracas, VE» → ciudad sin país
            ciudad_t = re.sub(r",\s*(VE|Venezuela)\s*$", "", ciudad_t, flags=re.I).strip()
            if 3 < len(ciudad_t) < 40 and not tildes_rotas(ciudad_t) and ciudad_t.upper() != "VE" \
                    and not re.search(r"\b(metal|rock|punk|death|black|thrash|grind|pionero|banda|core)\b", ciudad_t, re.I) \
                    and not re.search(r"\b(nuevas|canciones|musica|música|download|free|mp3|listen|songs)\b", ciudad_t, re.I):
                actual = (core.get(aid, {}).get("ciudad") or "").strip()
                if norm(ciudad_t) and norm(ciudad_t) not in norm(actual):
                    ciudades.append({"artistId": aid, "banda": r["banda"], "ciudad": ciudad_t, "ciudadActual": actual,
                                     "url": url, "evidencia": f"Ubicación del perfil MySpace: {ciudad_t}"})

        # 4) bio de época (solo si el texto sirve)
        about = texto_util(campos.get("About") or "", minimo=60)
        if about:
            bios.append({"artistId": aid, "banda": r["banda"], "bio": about[:3000], "url": url,
                         "bioActualLen": core.get(aid, {}).get("bio_len", 0)})

        for k, v in campos.items():
            if v and k not in ("About", "Genres", "Location", "Band Members") and k.lower() not in BASURA:
                sin_destino[k] += 1

    for nombre_arch, filas in (("miembros-extra.jsonl", miembros), ("miembros-candidatos.jsonl", candidatos),
                               ("genero-epoca.jsonl", generos), ("ciudad-epoca.jsonl", ciudades),
                               ("biografia-epoca.jsonl", bios)):
        with open(out / nombre_arch, "w", encoding="utf-8") as fh:
            for f in filas:
                fh.write(json.dumps(f, ensure_ascii=False) + "\n")

    resumen = {"con_ficha": len(con_ficha), "miembros_con_persona": len(miembros),
               "miembros_candidatos": len(candidatos),
               "genero_claims": len(generos), "ciudad_contraste": len(ciudades), "bio_claims": len(bios),
               "sin_destino": dict(sin_destino.most_common())}
    (out / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1), encoding="utf-8")

    print(json.dumps(resumen, ensure_ascii=False, indent=1))
    print("\nmuestra miembros:", [f"{m['person']} ({m['role'][:18]}){'*' if m['personId'] else ''}" for m in miembros[: args.muestra]])
    print("muestra géneros:", [f"{g['banda'][:18]}:{g['genre']}" for g in generos[: args.muestra]])
    print("muestra ciudad:", [(c["banda"][:16], c["ciudad"], "≠", c["ciudadActual"]) for c in ciudades[: args.muestra]])


if __name__ == "__main__":
    main()
