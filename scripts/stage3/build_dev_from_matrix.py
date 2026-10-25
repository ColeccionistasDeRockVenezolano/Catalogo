#!/usr/bin/env python3
"""Conjunto de desarrollo: matriz de 133 consultas (Intenciones 0.1.0) en la forma canónica de la etapa 3.

Es especificación de desarrollo (no prueba final). Las adaptaciones a intention-v1 se anotan en
`adaptation` y no cambian la matriz original.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "reports/intenciones-humanas/v0.1.0/matriz-consultas.json"
OUT = ROOT / "docs/unified-search/stage3/datasets/query-dev-matrix.json"


def gold(status, req=(), exc=(), any_=(), pref=(), ctx=0, ent=(), pending=0, alts=(), facet=None):
    return {"status": status, "req": sorted(req), "exc": sorted(exc), "any": sorted(sorted(g) for g in any_), "pref": sorted(pref),
            "ctx": ctx, "ent": [dict(zip(("role", "kind", "literal"), e)) for e in ent], "pending": pending, "alts": sorted(alts), "facet": facet}


def expr(e, req, exc, any_):
    if isinstance(e, str): req.append(e); return
    if "allOf" in e:
        for x in e["allOf"]: expr(x, req, exc, any_)
    elif "anyOf" in e:
        if all(isinstance(x, str) for x in e["anyOf"]): any_.append(list(e["anyOf"]))
        else: raise ValueError("DNF")
    elif "not" in e: exc.append(e["not"])


ADAPT = {
    "Q086": (gold("clarify"), "DNF no representable en intention-v1: se pide aclarar"),
    "Q091": (gold("query_valid", ["genre:rock", "emotion:melancholic", "decade:1990s"]), "década como faceta decade:1990s"),
    "Q092": (gold("contradiction"), None), "Q093": (gold("contradiction"), None),
    "Q100": (gold("clarify", alts=["activity:travel", "activity:intimacy"]), "«coger» es ambiguo entre variantes del español"),
    "Q101": (gold("clarify"), None),
    "Q105": (gold("query_valid", ["genre:instrumental", "activity:concentration"]), "la taxonomía CRV tiene el género Instrumental"),
    "Q106": (gold("partial", ["activity:sleep"], pending=1), "«sin voces» se conserva pendiente"),
    "Q107": (gold("partial", ["genre:rock"], pending=2), "en vivo y acústico pendientes"),
    "Q108": (gold("unsupported", pending=1), None),
    "Q109": (gold("partial", ["activity:running"], pending=1), None),
    "Q110": (gold("partial", ["activity:travel"], pending=1), None),
    "Q111": (gold("clarify", alts=["activity:intimacy", "theme:sexuality"], ent=[("target", None, "sexo")]), None),
    "Q112": (gold("unsupported", pending=1), None),
    "Q113": (gold("query_valid", ["emotion:serene", "activity:concentration"]), "la cobertura es asunto de recuperación (etapa 4)"),
    "Q126": (gold("query_valid", ["emotion:joyful"], ctx=1), None),
    "Q127": (gold("query_valid", ["emotion:sad"], ctx=1), None),
    "Q128": (gold("query_valid", ["activity:concentration"], ctx=1), None),
    "Q129": (gold("clarify", ctx=1, alts=["emotion:joyful", "emotion:euphoric", "emotion:confident"]), None),
    "Q130": (gold("partial", ["emotion:joyful"], pending=1), None),
    "Q133": (gold("unsupported", pending=1), None),
}

cases = []
for c in json.loads(SRC.read_text())["cases"]:
    if c["inputKind"] != "query": continue
    e, note = c["expected"], None
    if c["id"] in ADAPT:
        g, note = ADAPT[c["id"]]
    elif e["status"] == "query_valid":
        req, exc, any_ = [], [], []
        expr(e["expression"], req, exc, any_)
        g = gold("query_valid", req, exc, any_, e.get("prefer", []))
    elif e["status"] == "entity_lookup":
        kind = e["entityKind"]; lit = e["literal"].lower()
        g = gold("entity_lookup", ent=[("target", kind, lit)])
    elif e["status"] == "clarify":
        g = gold("clarify", alts=[a for a in e.get("alternatives", []) if ":" in a and " " not in a])
    else:
        g = gold(e["status"], pending=1)
    cases.append({"id": c["id"], "category": c["group"], "text": c["input"], "gold": g, "split": "dev_matrix", **({"adaptation": note} if note else {})})
OUT.write_text(json.dumps({"version": "crv-query-dev-matrix-1.0.0", "source": "reports/intenciones-humanas/v0.1.0/matriz-consultas.json",
                           "policy": "Desarrollo y regresión; no es prueba final.", "cases": cases}, ensure_ascii=False, indent=1) + "\n")
print(len(cases))
