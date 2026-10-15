#!/usr/bin/env python3
"""Analiza el log estructurado de capturas Wayback (capturas-wayback.jsonl) y saca PATRONES
que sirven para capturar mejor: qué ventanas de año rinden datos, qué formas de URL fallan,
cuándo un «0 snapshots» es saturación y no ausencia, latencias y proyecciones.

Salida: reports/ma-links-2026-10-15/patrones-wayback.md (+ resumen por consola).
Uso: python3 scripts/ma-links-2026-10-16/07-patrones.py
"""
import json
import os
import statistics
from collections import Counter, defaultdict

SALIDA_DIR = "reports/ma-links-2026-10-15"
EVENTOS = f"{SALIDA_DIR}/capturas-wayback.jsonl"
INFORME = f"{SALIDA_DIR}/patrones-wayback.md"


def leer() -> list[dict]:
    if not os.path.exists(EVENTOS):
        return []
    return [json.loads(l) for l in open(EVENTOS, encoding="utf-8") if l.strip()]


def pct(a: int, b: int) -> str:
    return f"{100 * a / b:.0f} %" if b else "—"


def main() -> None:
    ev = leer()
    res = [e for e in ev if e.get("fase") == "resultado"]
    cdx = [e for e in ev if e.get("fase") == "cdx"]
    des = [e for e in ev if e.get("fase") == "descarga"]
    lineas: list[str] = ["# Patrones de las capturas Wayback (MySpace)", ""]
    lineas.append(f"Eventos: {len(ev)} · perfiles intentados: {len(res)} · consultas CDX: {len(cdx)} · descargas: {len(des)}")
    lineas.append("")

    # 1. Resultado global y por fuente
    por_res = Counter(r["resultado"] for r in res)
    lineas.append("## Resultado por fuente")
    for fuente in ("ma", "cdx"):
        grupo = [r for r in res if r.get("fuente") == fuente]
        if not grupo:
            continue
        ok = sum(1 for r in grupo if r["resultado"] == "ok")
        lineas.append(f"- fuente **{fuente}**: {len(grupo)} intentos · {ok} con datos ({pct(ok, len(grupo))}) · "
                      f"{Counter(r['resultado'] for r in grupo).most_common()}")
    lineas.append("")

    # 2. Por año elegido: éxito y campos
    por_anio: dict[int, dict] = defaultdict(lambda: {"n": 0, "ok": 0, "campos": Counter(), "no_ascii": []})
    for r in res:
        anio = r.get("anio")
        if not anio:
            continue
        g = por_anio[anio]
        g["n"] += 1
        if r["resultado"] == "ok":
            g["ok"] += 1
            for c in r.get("campos") or []:
                g["campos"][c] += 1
        if r.get("no_ascii"):
            g["no_ascii"].append(r["no_ascii"])
    lineas.append("## Por año del snapshot (¿qué ventana rinde?)")
    for anio in sorted(por_anio):
        g = por_anio[anio]
        na = f"{statistics.median(g['no_ascii']):.0f}" if g["no_ascii"] else "—"
        lineas.append(f"- {anio}: {g['n']} intentos · {pct(g['ok'], g['n'])} con datos · "
                      f"campos top {g['campos'].most_common(3)} · no-ASCII mediano {na}")
    lineas.append("")

    # 3. Éxito por forma de URL
    por_forma: dict[str, Counter] = defaultdict(Counter)
    for r in res:
        por_forma[r.get("forma") or "?"][r["resultado"]] += 1
    lineas.append("## Por forma de la URL original")
    for forma, c in sorted(por_forma.items(), key=lambda kv: -sum(kv[1].values())):
        lineas.append(f"- {forma}: {sum(c.values())} · {dict(c)}")
    lineas.append("")

    # 4. CDX: latencia, vacíos y ráfagas (¿cuándo es saturación?)
    if cdx:
        ms = [c["ms"] for c in cdx if c.get("ms") is not None]
        vacios = [c for c in cdx if c.get("filas") == 0]
        lineas.append("## CDX: salud y saturación")
        if ms:
            lineas.append(f"- latencia: p50 {statistics.median(ms):.0f} ms · p90 {sorted(ms)[int(len(ms)*0.9)-1]:.0f} ms · máx {max(ms):.0f} ms")
        lineas.append(f"- consultas {len(cdx)} · vacías {len(vacios)} ({pct(len(vacios), len(cdx))}) · sin respuesta {sum(1 for c in cdx if not c.get('respondio'))}")
        rafagas, actual = [], 0
        for c in cdx:
            if c.get("filas") == 0:
                actual += 1
            else:
                if actual:
                    rafagas.append(actual)
                actual = 0
        if actual:
            rafagas.append(actual)
        lineas.append(f"- ráfagas de vacíos: {sorted(rafagas, reverse=True)[:8]} (máx {max(rafagas) if rafagas else 0} seguidos)")
        # latencia antes/después de un vacío (señal temprana)
        antes, despues = [], []
        for i, c in enumerate(cdx):
            if c.get("filas") == 0 and i > 0 and cdx[i-1].get("ms"):
                antes.append(cdx[i-1]["ms"])
            if c.get("filas") == 0 and i + 1 < len(cdx) and cdx[i+1].get("ms"):
                despues.append(cdx[i+1]["ms"])
        if antes and despues:
            lineas.append(f"- latencia media justo ANTES de un vacío: {statistics.mean(antes):.0f} ms · DESPUÉS: {statistics.mean(despues):.0f} ms")
        # Patrón «solo-301»: hay archivo pero sin ningún 200 clásico (no se reintenta).
        stats_glob = Counter()
        con_archivo_sin_200 = 0
        for c in cdx:
            st = c.get("statuses") or {}
            for k, v in st.items():
                stats_glob[k] += v
            if st and not c.get("filas"):
                con_archivo_sin_200 += 1
        lineas.append(f"- statuses vistos: {stats_glob.most_common(6)} · consultas con archivo pero sin 200: {con_archivo_sin_200}")
        formas_ok = Counter(c.get("forma_ok") for c in cdx if c.get("filas"))
        if formas_ok:
            lineas.append(f"- forma de URL que rindió (con 200 clásicos): {formas_ok.most_common()}")
        lineas.append("")

    # 5. Campos que rinden
    campos = Counter()
    for r in res:
        for c in r.get("campos") or []:
            campos[c] += 1
    lineas.append("## Campos que rinden")
    lineas.append(f"- {campos.most_common(12)}")
    lineas.append("")

    # 6. Proyección
    if des:
        lineas.append("## Coste")
        lineas.append(f"- descargas: {len(des)} · mediana {statistics.median([d['ms'] for d in des]):.0f} ms · bytes medianos {statistics.median([d['bytes'] for d in des]):.0f}")
    lineas.append("")

    # 7. Recomendaciones (reglas)
    lineas.append("## Recomendaciones automáticas")
    ok_total = sum(1 for r in res if r["resultado"] == "ok")
    lineas.append(f"- tasa de datos global: {pct(ok_total, len(res))}.")
    mejores = sorted(por_anio.items(), key=lambda kv: -(kv[1]["ok"] / kv[1]["n"] if kv[1]["n"] else 0))
    if mejores:
        lineas.append(f"- mejor ventana medida: {mejores[0][0]} ({pct(mejores[0][1]['ok'], mejores[0][1]['n'])} con datos).")
    sin_snap = [r for r in res if r["resultado"] == "sin_snapshot"]
    if sin_snap:
        lineas.append(f"- {len(sin_snap)} perfiles sin snapshot: reintentar tras respiro del CDX antes de darlos por ausentes "
                      "(el log lo distingue: una ráfaga de vacíos = saturación).")
    lineas.append("- si el CDX encadena 4 vacíos: pausa de 300 s (política ya aplicada en el capturador).")

    texto = "\n".join(lineas) + "\n"
    with open(INFORME, "w", encoding="utf-8") as fh:
        fh.write(texto)
    print(texto)
    print("escrito:", INFORME)


if __name__ == "__main__":
    main()
