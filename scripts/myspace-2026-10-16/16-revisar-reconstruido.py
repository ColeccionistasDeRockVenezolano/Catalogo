#!/usr/bin/env python3
"""Reconstruye los «revisar» del lote de altas (el reporte se sobrescribió), les busca
candidato probable y separa los aplicables: los de nombre EXACTO ya existen en `persons`
→ solo falta la relación (formato del applier 02).

Los 150 candidatos originales = ledger `er/miembros-sin-resolver.jsonl` (motivo 'sin candidato')
con los filtros del applier 12. De ellos se restan los 12 creados (lote 1) y los 4 errores.

Salida:
  er/miembros-revisar-134.jsonl    (los en revisión, con candidato probable)
  er/miembros-aplicar-exactos.jsonl (formato {artistId, personId, person, role, banda, url, evidencia})
Uso: python3 scripts/myspace-2026-10-16/16-revisar-reconstruido.py
"""
import collections
import difflib
import importlib.util
import json
import re
from pathlib import Path

spec = importlib.util.spec_from_file_location("p01", "scripts/myspace-2026-10-16/01-plan.py")
p01 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p01)

SIN_RESOLVER = Path("reports/myspace-2026-10-16/er/miembros-sin-resolver.jsonl")
SALIDA = Path("reports/myspace-2026-10-16/er")
NOMBRE = re.compile(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’.\- ]{6,60}$")
MALAS = re.compile(r"\b(video|vídeo|photos?|fotos?|editor|imagen|google|search|by|realizado|editado|myspace|demo|disc|album|álbum|contacto|manager|booking|promo|intro|outro|live|official)\b", re.I)
CREADAS = {"ESCLAVO DE LA ETERNIDAD", "REGRESO DEL ABISMO", "Editor de Imagenes", "Yazmal Destructor", "Google search",
           "Agony Tul", "PHOTOS BY", "Dionardo Aparicio", "Aeneas Inferno", "Tormentum Ov War", "Hell Torment", "Mors Desolatvm"}
ERRORES = {"Romel Salcedo", "Giampietro Taza", "B. Vrolok", "Jovino Becerra"}


def ratio(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def main() -> None:
    filas = [json.loads(l) for l in SIN_RESOLVER.read_text(encoding="utf-8").splitlines() if l.strip()]
    cands = [f for f in filas if f.get("person") not in CREADAS and f.get("person") not in ERRORES
             and NOMBRE.match(f.get("person") or "") and not re.search(r"\d", f["person"])
             and not MALAS.search(f["person"]) and re.search(r"[a-záéíóúñ]", f["person"])
             and 2 <= len(f["person"].split()) <= 4]
    print(f"candidatos reconstruidos (sin creadas ni errores): {len(cands)}")

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

    revisar, aplicar = [], []
    exactos = difusos = sin_cand = 0
    for c in cands:
        n = p01.norm(c["person"])
        palabras = n.split()
        pid, cand_txt, r_mejor, fuente = None, "", 0.0, ""
        for clave in (n, " ".join(reversed(palabras))):
            if nombres.get(clave):
                pid, fuente, r_mejor, cand_txt = nombres[clave], "nombre", 1.0, clave
                break
            if alias.get(clave):
                pid, fuente, r_mejor, cand_txt = alias[clave], "alias", 1.0, clave
                break
        if not pid:
            vistos: set[int] = set()
            for tok in palabras:
                if len(tok) >= 3:
                    vistos |= indice.get(tok, set())
            for pid2 in vistos:
                m = etiqueta.get(pid2)
                if not m:
                    continue
                rg = ratio(n, m)
                mp = m.split()
                par = max(ratio(palabras[0], mp[0]), ratio(palabras[0], mp[-1])) if len(mp) > 1 else 0
                if rg >= 0.75 and (par >= 0.75 or rg >= 0.90) and rg > r_mejor:
                    pid, cand_txt, r_mejor, fuente = pid2, m, rg, "difflib"
        fila = {"banda": c.get("banda", ""), "artistId": c.get("artistId"), "person": c["person"], "role": c.get("role", ""),
                "candidatoPersonId": pid, "candidato": cand_txt, "ratio": round(r_mejor, 3), "candidatoFuente": fuente or "ninguno",
                "url": c.get("url", ""), "evidencia": c.get("evidencia", "")}
        revisar.append(fila)
        if pid and r_mejor >= 0.999:
            exactos += 1
            aplicar.append({"artistId": c["artistId"], "banda": c.get("banda", ""), "person": c["person"],
                            "role": c.get("role", ""), "personId": pid, "url": c.get("url", ""), "evidencia": c.get("evidencia", "")})
        elif pid:
            difusos += 1
        else:
            sin_cand += 1

    with open(SALIDA / "miembros-revisar-134.jsonl", "w", encoding="utf-8") as fh:
        for f in revisar:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    with open(SALIDA / "miembros-aplicar-exactos.jsonl", "w", encoding="utf-8") as fh:
        for f in aplicar:
            fh.write(json.dumps(f, ensure_ascii=False) + "\n")
    print(f"exactos (aplicables ya): {exactos} · difusos (revisión): {difusos} · sin candidato: {sin_cand}")
    print("\nmuestra exactos:")
    for f in aplicar[:12]:
        print(f"   {f['banda'][:20]:20} {f['person'][:24]:24} → person {f['personId']} · {f['role'][:20]}")
    print("muestra difusos:")
    for f in [x for x in revisar if x["candidatoFuente"] == "difflib"][:10]:
        print(f"   {f['person'][:24]:24} ≈ {f['candidato'][:26]:26} ({f['ratio']})")


if __name__ == "__main__":
    main()
