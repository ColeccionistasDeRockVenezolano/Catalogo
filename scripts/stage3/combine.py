#!/usr/bin/env python3
"""Modo «solo si coinciden» (1.10.0): el plan se responde solo si la 1.8.0 (Laya por fragmentos) y el
estudiante producen el mismo plan; si no, se abstiene (la búsqueda normal sigue sin interpretar).

  combine.py --student plans-student.jsonl --legacy eval-1.8.0.json --out plans-combined.jsonl
             [--rescue TAU]   además acepta el plan del estudiante si su confianza >= TAU aunque no coincidan
             [--gold dataset.json]  imprime cobertura y exactitud dentro de lo respondido (solo desarrollo)

Comparación de coincidencia = forma canónica sin la clase de entidad (la etiqueta la hace opcional si el oro no la fija):
estado, exigidos, excluidos, preferidos, grupos O, alternativas, literales de entidad con su papel, contextos y pendiente>0.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def key(c: dict) -> tuple:
    f = lambda k: tuple(sorted(c.get(k) or []))
    anyg = tuple(sorted(tuple(sorted(g)) for g in (c.get("any") or []) if isinstance(g, list)))
    ents = tuple(sorted((e["literal"].lower().strip(), e.get("role", "target")) for e in (c.get("ent") or [])))
    return (c["status"], f("req"), f("exc"), f("pref"), anyg, f("alts"), ents, int(c.get("ctx") or 0), int((c.get("pending") or 0) > 0))


def abstain(c: dict, other: dict | None = None) -> dict:
    """Sin acuerdo no se ejecuta nada: el plan queda «unsupported» con al menos un pendiente (el sistema declara que no
    resolvió la consulta entera, en vez de decir que no la reconoce)."""
    c = dict(c)
    c["pending"] = max(1, c.get("pending") or 0, (other or {}).get("pending") or 0)
    c["status"] = "unsupported"
    c["req"], c["exc"], c["pref"], c["any"], c["alts"], c["ent"] = [], [], [], [], [], []
    return c


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--student", required=True)
    ap.add_argument("--legacy", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--rescue", type=float, default=2.0)
    a = ap.parse_args()
    legacy = {d["id"]: d["canonical"] for d in json.loads(Path(a.legacy).read_text())["details"]}
    rows = [json.loads(l) for l in Path(a.student).read_text().splitlines()]
    out, agree, rescued = [], 0, 0
    for r in rows:
        s, l = r["canonical"], legacy.get(r["id"])
        ok = l is not None and key(s) == key(l)
        resc = (not ok) and r.get("confidence", 0) >= a.rescue and s["status"] in ("query_valid", "partial", "entity_lookup")
        agree += ok
        rescued += resc
        out.append({"id": r["id"], "canonical": s if (ok or resc) else abstain(s, l), "ms": r.get("ms", 0), "agree": ok})
    Path(a.out).write_text("".join(json.dumps(o, ensure_ascii=False) + "\n" for o in out))
    print(f"n={len(rows)} coinciden={agree} rescatados={rescued}")


if __name__ == "__main__":
    main()
