#!/usr/bin/env python3
"""ER dirigida de los candidatos de MIEMBROS (MySpace) contra personas del catálogo.

Reglas (conservadoras, calibradas con la muestra de 2026-10-16):
  - nombre de UNA palabra (apodo o nombre suelto): NO resuelve automáticamente → revisión.
  - nombre de 2-4 palabras: 
      * exacto (nombre, alias o invertido) → resuelve;
      * difuso: primer y último token deben casar con ≥0.90 (orden directo o invertido) y el
        ratio global ≥0.88 → resuelve si hay UN único candidato así. (Evita Morillo≈Portillo,
        Franny≈Ronny: el token cambiado hunde el puntaje.)
  - nunca crea personas; si la persona resuelta ya es miembro de esa banda (por id) → se salta.

Salida: reports/myspace-2026-10-16/er/{miembros-resueltos,miembros-sin-resolver}.jsonl + resumen.json
Uso: python3 scripts/myspace-2026-10-16/11-er-miembros.py
"""
import collections
import difflib
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("p01", "scripts/myspace-2026-10-16/01-plan.py")
p01 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p01)

ENTRADAS = [Path("reports/myspace-2026-10-16/plan/miembros-candidatos.jsonl"),
            Path("reports/myspace-2026-10-16/mineria/miembros-candidatos.jsonl")]
SALIDA = Path("reports/myspace-2026-10-16/er")


def ratio(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def casan_tokens(n: str, m: str) -> bool:
    """Primer y último token con ≥0.90 (directo o invertido) y ratio global ≥0.88."""
    a, b = n.split(), m.split()
    if len(a) < 2 or len(b) < 2:
        return False
    if ratio(n, m) < 0.88:
        return False
    pares = ((a, b), (a, list(reversed(b))))
    return any(ratio(x[0], y[0]) >= 0.90 and ratio(x[-1], y[-1]) >= 0.90 for x, y in pares)


def main() -> None:
    SALIDA.mkdir(parents=True, exist_ok=True)
    cands: dict[tuple[int, str], dict] = {}
    for ruta in ENTRADAS:
        if not ruta.exists():
            continue
        for l in ruta.read_text(encoding="utf-8").splitlines():
            if not l.strip():
                continue
            c = json.loads(l)
            if c.get("personId"):
                continue
            cands.setdefault((int(c["artistId"]), p01.norm(c["person"])), c)
    print(f"candidatos (dedupe): {len(cands)}")

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

    ids = sorted({aid for aid, _ in cands})
    miembros_pid: dict[int, set[int]] = collections.defaultdict(set)
    for m in p01.psql(f"SELECT artist_id, person_id FROM artist_members WHERE artist_id IN ({','.join(map(str, ids))})"):
        if len(m) >= 2:
            miembros_pid[int(m[0])].add(int(m[1]))

    resueltos, sin_resolver = [], []
    stats = collections.Counter()
    for (aid, n), c in sorted(cands.items()):
        if not n or len(n) < 4:
            sin_resolver.append({**c, "motivo": "nombre demasiado corto"})
            continue
        palabras = n.split()
        if len(palabras) < 2:
            sin_resolver.append({**c, "motivo": "nombre de una palabra: revisar a mano"})
            stats["una_palabra"] += 1
            continue
        pid, como = None, ""
        for clave in (n, " ".join(reversed(palabras))):
            if nombres.get(clave):
                pid, como = nombres[clave], "exacto"
                break
            if alias.get(clave):
                pid, como = alias[clave], "alias exacto"
                break
        if not pid:
            vistos: set[int] = set()
            for tok in palabras:
                if len(tok) >= 3:
                    vistos |= indice.get(tok, set())
            posibles = [(pid2, etiqueta[pid2]) for pid2 in vistos if pid2 in etiqueta and casan_tokens(n, etiqueta[pid2])]
            if len(posibles) == 1:
                pid, como = posibles[0][0], f"difflib {ratio(n, posibles[0][1]):.2f} ({posibles[0][1]})"
            elif len(posibles) > 1:
                sin_resolver.append({**c, "motivo": f"ambiguo: {[p[1] for p in posibles[:3]]}"})
                stats["ambiguo"] += 1
                continue
        if pid:
            if pid in miembros_pid.get(aid, set()):
                stats["ya_en_banda_por_id"] += 1
                continue
            resueltos.append({"artistId": aid, "banda": c.get("banda", ""), "person": c["person"],
                              "role": (c.get("role") or "")[:60], "personId": pid,
                              "url": c.get("url", ""), "evidencia": c.get("evidencia", ""),
                              "como": como, "personaCatalogo": etiqueta.get(pid, "")})
            stats[como.split()[0]] += 1
        else:
            sin_resolver.append({**c, "motivo": "sin candidato"})
            stats["sin_candidato"] += 1

    for nombre, filas_out in (("miembros-resueltos.jsonl", resueltos), ("miembros-sin-resolver.jsonl", sin_resolver)):
        with open(SALIDA / nombre, "w", encoding="utf-8") as fh:
            for x in filas_out:
                fh.write(json.dumps(x, ensure_ascii=False) + "\n")
    resumen = {"candidatos": len(cands), "resueltos": len(resueltos), "sin_resolver": len(sin_resolver), **stats}
    (SALIDA / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(resumen, ensure_ascii=False, indent=1))
    print("\nresueltos:")
    for r in resueltos[:20]:
        print(f"   {r['banda'][:20]:20} {r['person'][:24]:24} → {r['personaCatalogo'][:24]:24} ({r['como'][:34]})")


if __name__ == "__main__":
    main()
