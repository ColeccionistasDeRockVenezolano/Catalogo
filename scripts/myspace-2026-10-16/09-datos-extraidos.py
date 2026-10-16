#!/usr/bin/env python3
"""Minería de los datos que la síntesis extrajo de las bios/perfiles (datos-extraidos.jsonl).

El modelo devolvió por ficha: formacion (año), ciudad, miembros[], discos[], sellos[], otros[].
Aquí se cotejan contra el catálogo y se emiten los ledgers aplicables:
  - mineria/miembros-extra.jsonl      miembros citados que el catálogo no tenía (persona ya existente)
  - mineria/miembros-candidatos.jsonl  sin persona clara (revisión/ER)
  - mineria/formacion.jsonl           año de formación para fichas sin formed_year
  - mineria/ciudad.jsonl              contraste de ciudad
  - mineria/otros.jsonl               discos/sellos/anécdotas (informativo)
Uso: python3 scripts/myspace-2026-10-16/09-datos-extraidos.py
"""
import collections
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("p01", "scripts/myspace-2026-10-16/01-plan.py")
p01 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p01)

DATOS = Path("reports/myspace-2026-10-16/datos-extraidos.jsonl")
SALIDA = Path("reports/myspace-2026-10-16/mineria")


def main() -> None:
    SALIDA.mkdir(parents=True, exist_ok=True)
    crudas = [json.loads(l) for l in DATOS.read_text(encoding="utf-8").splitlines() if l.strip()]
    # el archivo es append (reanudable): una re-síntesis duplica los caseId → el último gana
    dedup: dict[str, dict] = {}
    for f in crudas:
        dedup[f["caseId"]] = f
    filas = list(dedup.values())
    print(f"fichas con datos minados: {len(filas)} (de {len(crudas)} líneas)")

    # urls de snapshot por artista (para la evidencia del ledger de formación)
    urls: dict[int, str] = {}
    for r in (json.loads(l) for l in Path("reports/ma-links-2026-10-15/myspace-piloto.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()):
        if r.get("crv_artist_id"):
            urls[int(r["crv_artist_id"])] = r.get("url_snapshot") or r.get("url") or ""

    personas = {}
    for p in p01.psql("SELECT id, name FROM persons"):
        if len(p) >= 2:
            personas[p01.norm(p[1])] = int(p[0])
    alias: dict[str, int] = {}
    for a in p01.psql("SELECT person_id, alias, normalized_alias FROM ingest.person_aliases"):
        if len(a) >= 3 and a[0].strip().isdigit() and int(a[0]) > 0:
            for clave in (p01.norm(a[1]), p01.norm(a[2])):
                if clave:
                    alias.setdefault(clave, int(a[0]))

    ids = [int(f["caseId"].split("-")[1]) for f in filas]
    lista = ",".join(map(str, ids))
    miembros_bd: dict[int, set[str]] = collections.defaultdict(set)
    for m in p01.psql(f"SELECT m.artist_id, p.name FROM artist_members m JOIN persons p ON p.id=m.person_id WHERE m.artist_id IN ({lista})"):
        if len(m) >= 2:
            miembros_bd[int(m[0])].add(p01.norm(m[1]))
    core = {}
    for c in p01.psql(f"SELECT id, coalesce(origin_city,''), coalesce(formed_year::text,'') FROM artists WHERE id IN ({lista})"):
        if len(c) >= 3:
            core[int(c[0])] = {"ciudad": c[1], "anio": c[2]}

    miembros, candidatos, formacion, ciudad, otros = [], [], [], [], []
    stats = collections.Counter()
    for f in filas:
        aid = int(f["caseId"].split("-")[1])
        d = f.get("datos") or {}
        if d.get("formacion"):
            try:
                anio = int(str(d["formacion"])[:4])
            except ValueError:
                anio = 0
            if 1960 <= anio <= 2026:
                stats["formacion"] += 1
                if not (core.get(aid, {}).get("anio") or "").strip():
                    formacion.append({"artistId": aid, "artist": f.get("banda", ""), "field": "formed_year",
                                      "value": anio, "url": urls.get(aid, ""),
                                      "evidence": f"año de formación citado en el perfil MySpace: {anio}"})
        if d.get("ciudad"):
            c = str(d["ciudad"]).strip()
            if 3 < len(c) < 60 and p01.norm(c) and p01.norm(c) not in p01.norm(core.get(aid, {}).get("ciudad") or ""):
                ciudad.append({"artistId": aid, "ciudad": c, "ciudadActual": core.get(aid, {}).get("ciudad", "")})
        for m in d.get("miembros") or []:
            nombre = str(m.get("nombre") or "").strip()
            rol = str(m.get("rol") or "").strip()[:60]
            n = p01.norm(nombre)
            if not nombre or len(n) < 4 or p01.NOMBRE_MALO.match(nombre):
                continue
            if n in miembros_bd.get(aid, set()):
                continue
            stats["miembros_citados"] += 1
            pid = None
            if len(n.split()) >= 2:
                pid = personas.get(n) or alias.get(n)
                partes = n.split()
                if not pid and len(partes) == 2:
                    inv = f"{partes[1]} {partes[0]}"
                    pid = personas.get(inv) or alias.get(inv)
            fila = {"artistId": aid, "banda": f.get("banda", ""), "person": nombre, "role": rol,
                    "personId": pid, "url": "", "evidencia": f"miembro citado en el perfil MySpace: {nombre}" + (f" — {rol}" if rol else "")}
            (miembros if pid else candidatos).append(fila)
        for campo in ("discos", "sellos", "otros"):
            for v in d.get(campo) or []:
                if str(v).strip():
                    otros.append({"artistId": aid, "campo": campo, "valor": str(v)[:200]})
                    stats[campo] += 1

    for nombre, filas_out in (("miembros-extra.jsonl", miembros), ("miembros-candidatos.jsonl", candidatos),
                              ("formacion.jsonl", formacion), ("ciudad.jsonl", ciudad), ("otros.jsonl", otros)):
        with open(SALIDA / nombre, "w", encoding="utf-8") as fh:
            for x in filas_out:
                fh.write(json.dumps(x, ensure_ascii=False) + "\n")
    resumen = {"fichas": len(filas), "miembros_extra_con_persona": len(miembros), "miembros_candidatos": len(candidatos),
               "formacion_aplicable": len(formacion), "ciudad_contraste": len(ciudad), "otros": len(otros), **stats}
    (SALIDA / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(resumen, ensure_ascii=False, indent=1))
    print("\nmuestra miembros con persona:", [f"{m['person']} → {m['personId']}" for m in miembros[:8]])
    print("muestra formacion:", formacion[:4])
    print("muestra ciudad:", [(c["ciudad"], "≠", c["ciudadActual"]) for c in ciudad[:6]])


if __name__ == "__main__":
    main()
