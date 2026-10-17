#!/usr/bin/env python3
"""Plan de relleno (solo campos VACÍOS) desde los duplicados RYM confirmados.

Reglas:
  · Solo duplicados con ER fuerte («duplicado», puntaje ≥6); los «probable» quedan fuera.
  · Solo ciudad y año de formación de artistas; en personas, solo ciudad de nacimiento
    (el año de nacimiento exige decidir formato de fecha: no se toca aquí).
  · Escribe reports/rym-venezolanos-2026-10-17/plan-relleno.jsonl para el aplicador.
"""
import json
import subprocess
from collections import Counter
from datetime import date
from pathlib import Path

REPO = Path("/home/brian/apps/Coleccionistas De Rock Venezolano")
ENTRADA = REPO / "reports/rym-venezolanos-2026-10-17" / f"enriquecimiento-desde-duplicados-{date.today().isoformat()}.jsonl"


def psql(q):
    r = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tAF", "\t", "-c", q],
                       capture_output=True, text=True)
    return [l.split("\t") for l in r.stdout.strip().splitlines() if l.strip()]


def main():
    filas = [json.loads(l) for l in ENTRADA.open(encoding="utf-8") if l.strip()]
    estado = {}
    # «·» para los vacíos: un último campo vacío se pierde al recortar el salto de línea de psql.
    for tabla, ident, ciudad, anio in psql(
            "SELECT 'artists', id, coalesce(nullif(origin_city,''),'·'), coalesce(formed_year::text,'·') FROM public.artists"):
        estado[("artists", int(ident))] = {"ciudad": "" if ciudad == "·" else ciudad,
                                           "anio": "" if anio == "·" else anio}
    for tabla, ident, ciudad in psql("SELECT 'persons', id, coalesce(nullif(birth_city,''),'·') FROM public.persons"):
        estado[("persons", int(ident))] = {"ciudad": "" if ciudad == "·" else ciudad, "anio": ""}

    plan, motivos = [], Counter()
    for f in filas:
        if f.get("estado_er") != "duplicado":
            continue
        clave = (f["tabla"], int(f["id"]))
        actual = estado.get(clave)
        if not actual:
            motivos["ficha desaparecida"] += 1
            continue
        huecos = f.get("huecos_simples") or {}
        for campo, valor in huecos.items():
            if campo in ("origin_city", "birth_city"):
                if actual["ciudad"].strip():
                    motivos["ciudad ya escrita"] += 1
                    continue
                plan.append({"tabla": f["tabla"], "id": int(f["id"]), "campo": campo, "valor": valor,
                             "catalogo": f["catalogo"], "rym": f["rym"], "slug": f["slug"],
                             "rym_url": f["rym_url"], "referencia": f"{f['rym']} — {valor} (RYM)",
                             "pagina": "", "puntos_er": f["puntos_er"]})
            elif campo == "formed_year":
                if actual["anio"].strip():
                    motivos["año ya escrito"] += 1
                    continue
                if f.get("tipo_rym") != "grupo":
                    # En solistas el año de RYM es el de NACIMIENTO, no el de formación:
                    # escribirlo en formed_year sería un dato falso (medido: Franco De Vita 1954).
                    motivos["año de persona (no se aplica como formación)"] += 1
                    continue
                plan.append({"tabla": f["tabla"], "id": int(f["id"]), "campo": "formed_year", "valor": valor,
                             "catalogo": f["catalogo"], "rym": f["rym"], "slug": f["slug"],
                             "rym_url": f["rym_url"], "referencia": f"{f['rym']} — formado en {valor} (RYM)",
                             "pagina": "", "puntos_er": f["puntos_er"]})
            else:
                motivos[f"campo no aplicado ({campo})"] += 1
    salida = ENTRADA.with_name("plan-relleno.jsonl")
    with salida.open("w", encoding="utf-8") as fh:
        for p in plan:
            fh.write(json.dumps(p, ensure_ascii=False) + "\n")
    print("filas del plan:", len(plan), dict(Counter((p["campo"]) for p in plan)))
    for k, v in motivos.most_common():
        print("  descartado:", k, v)
    print("→", salida)


if __name__ == "__main__":
    main()
