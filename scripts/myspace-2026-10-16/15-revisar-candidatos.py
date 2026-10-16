#!/usr/bin/env python3
"""Enriquece la lista de altas «en revisión» (needs_review del ER) con el candidato probable.

El ER del sistema rechazó las altas porque «ve parecidos», pero no devuelve cuáles. Aquí se
busca para cada nombre el más cercano en `persons` + `person_aliases` (tokens primero/último
≥0.75 y global ≥0.75) y se emite un ledger accionable para el cotejo humano / un pase dirigido.

Entrada:  reports/myspace-2026-10-16/altas-miembros.json (corridas previas, lista «revisar»)
Salida:   reports/myspace-2026-10-16/er/miembros-revisar-con-candidato.jsonl + resumen
Uso: python3 scripts/myspace-2026-10-16/15-revisar-candidatos.py
"""
import collections
import difflib
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("p01", "scripts/myspace-2026-10-16/01-plan.py")
p01 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p01)

PREVIO = Path("reports/myspace-2026-10-16/altas-miembros.json")
SALIDA = Path("reports/myspace-2026-10-16/er/miembros-revisar-con-candidato.jsonl")


def ratio(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def main() -> None:
    previo = json.loads(PREVIO.read_text(encoding="utf-8"))
    # el reporte de altas no trae artistId/rol/url: se cruzan del ledger original
    originales: dict[str, dict] = {}
    for l in Path("reports/myspace-2026-10-16/er/miembros-sin-resolver.jsonl").read_text(encoding="utf-8").splitlines():
        if l.strip():
            o = json.loads(l)
            originales[f"{o.get('banda','')}|{o.get('person','')}"] = o
    revisar = {f"{r['banda']}|{r['person']}": {**originales.get(f"{r['banda']}|{r['person']}", {}), **r}
               for r in previo.get("revisar", [])}
    print(f"en revisión: {len(revisar)}")

    nombres: dict[str, int] = {}
    for p in p01.psql("SELECT id, name FROM persons"):
        if len(p) >= 2:
            nombres[p01.norm(p[1])] = int(p[0])
    alias: dict[str, int] = {}
    for a in p01.psql("SELECT person_id, coalesce(normalized_alias,''), alias FROM ingest.person_aliases"):
        if len(a) >= 3 and a[0].strip().isdigit() and int(a[0]) > 0:
            for clave in (p01.norm(a[1]), p01.norm(a[2])):
                if clave:
                    alias.setdefault(clave, int(a[0]))

    indice: dict[str, set[int]] = collections.defaultdict(set)
    etiqueta: dict[int, str] = {}
    for clave, pid in list(nombres.items()) + list(alias.items()):
        for tok in clave.split():
            if len(tok) >= 3:
                indice[tok].add(pid)
        if len(clave) >= len(etiqueta.get(pid, "")):
            etiqueta[pid] = clave

    filas, sin_candidato = [], 0
    for r in revisar.values():
        n = p01.norm(r["person"])
        palabras = n.split()
        vistos: set[int] = set()
        for tok in palabras:
            if len(tok) >= 3:
                vistos |= indice.get(tok, set())
        mejor, mejor_ratio = None, 0.0
        for pid in vistos:
            m = etiqueta.get(pid)
            if not m:
                continue
            mp = m.split()
            r_global = ratio(n, m)
            if r_global < 0.75:
                continue
            par = max(ratio(palabras[0], mp[0]) if mp else 0, ratio(palabras[0], mp[-1])) if len(palabras) > 1 and len(mp) > 1 else 0
            if par >= 0.75 or r_global >= 0.90:
                if r_global > mejor_ratio:
                    mejor, mejor_ratio = (pid, m), r_global
        if mejor:
            filas.append({"banda": r["banda"], "artistId": r.get("artistId"), "person": r["person"], "role": r.get("role", ""),
                          "candidatoPersonId": mejor[0], "candidato": mejor[1], "ratio": round(mejor_ratio, 3),
                          "candidatoFuente": "nombre" if mejor[1] in nombres else "alias"})
        else:
            sin_candidato += 1
            filas.append({"banda": r["banda"], "artistId": r.get("artistId"), "person": r["person"], "role": r.get("role", ""),
                          "candidatoPersonId": None, "candidato": "", "ratio": 0, "candidatoFuente": "ninguno"})

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    with open(SALIDA, "w", encoding="utf-8") as fh:
        for f in filas:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    con = [f for f in filas if f["candidatoPersonId"]]
    print(f"con candidato probable: {len(con)} · sin candidato: {sin_candidato} → {SALIDA}")
    for f in con[:18]:
        print(f"   {f['person'][:24]:24} ≈ {f['candidato'][:26]:26} ({f['ratio']}, {f['candidatoFuente']}) [{f['banda'][:18]}]")


if __name__ == "__main__":
    main()
