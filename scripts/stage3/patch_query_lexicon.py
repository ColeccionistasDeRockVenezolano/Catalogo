#!/usr/bin/env python3
"""Parche declarado del léxico de consultas (etapa 3, versión 1.8.0).

El léxico 0.7.0 se construyó con build_query_lexicon.py a partir de un volcado de géneros que ya no
está en el equipo; reconstruirlo cambiaría otras cosas. Este parche parte del léxico vigente y solo
añade los alias de PATCH (sinónimos claros de la convención escrita, elegidos en desarrollo: lotes
reales 1 y 2 y entrenamiento del lote 3). Nunca crea conceptos ni géneros y rechaza un alias que ya
tenga otro dueño. Registra la huella del léxico de partida.

Uso: python3 scripts/stage3/patch_query_lexicon.py
"""
from __future__ import annotations
import hashlib, json, re, sys, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEXICON = ROOT / "docs/unified-search/stage3/query-lexicon.json"
FROM, TO = "crv-query-lexicon-0.7.0", "crv-query-lexicon-0.8.0"

PATCH: dict[str, list[str]] = {
    # Convención §1: «para niños» / «infantil» → música infantil (decisión de Brian, lote 1: bebés → infantil).
    "genre:musica-infantil": ["ninos", "ninas", "bebes", "bebe", "para ninos", "para bebes", "de ninos"],
    "genre:funk": ["funky"],
    "activity:celebration": ["xv anos", "quince anos", "15 anos", "quinceanera", "boda", "bodas", "casarse", "se van a casar",
                             "graduados", "graduado", "graduadas", "cumpleanera", "cumpleanero", "cumple"],
    # Convención §1: «bajar el cortisol» es relajación (ejemplo literal de la convención).
    "activity:relaxation": ["cortisol", "bajar el cortisol"],
    "activity:exercise": ["boxing", "kickboxing", "king boxing", "aerobica", "aerobicas", "aerobics", "aerobico"],
    "emotion:joyful": ["positivas", "positiva", "positivo", "positivos", "alegrar"],
    "emotion:hopeful": ["inspiran", "que inspiran", "inspiradora", "inspiradoras", "inspirador", "inspiradores"],
    "theme:humor": ["graciosa", "gracioso", "graciosas", "graciosos"],
    # Paráfrasis inequívocas (§1): enamorarse y la ruptura dichas con un verbo.
    "theme:love": ["te gusta alguien", "alguien te gusta", "me gusta alguien", "alguien me gusta"],
    "theme:breakup": ["te rompen el corazon", "rompen el corazon", "me rompieron el corazon", "volver con tu ex", "volver con mi ex", "tu ex", "mi ex"],
    "activity:sleep": ["duerman", "se duerman", "duerma", "se duerma", "dormirse"],
    "activity:travel": ["moto", "en moto", "rodar en moto", "carros"],
    "theme:death": ["muere", "murio", "fallecio", "fallecido", "fallecida", "ser querido", "se va al cielo"],
    "theme:spirituality": ["santeria", "santero", "orisha", "orula"],
    "emotion:confident": ["motivadora", "motivadoras", "motivador", "motivadores", "motivacional", "motivacionales", "motivan", "que motivan", "motivar"],
}


# Convención §3 y §2: un lugar, gentilicio o idioma es procedencia pendiente y nunca un nombre.
BASE = ["angola", "angolena", "africa", "africana", "africano", "africanas", "africanos", "arabe", "arabes", "arabia", "argelia", "australia", "australiana",
        "australiano", "austria", "belgica", "canada", "canadiense", "caribe", "caribena", "caribeno", "catalan", "catalana", "catalunya", "china", "chinas",
        "chino", "chinos", "corea", "coreana", "coreanas", "coreano", "coreanos", "dinamarca", "danesa", "danes", "egipto", "egipcia", "escocia", "escoces",
        "escocesa", "europa", "europea", "europeo", "filipinas", "gallega", "gallego", "galicia", "grecia", "griega", "griego", "hindu", "holanda", "holandesa",
        "india", "indonesia", "irlanda", "irlandes", "irlandesa", "islandia", "islandesa", "israel", "jamaica", "jamaiquina", "jamaiquino", "marruecos",
        "nigeria", "oaxaca", "oaxaquena", "oaxaquenas", "oaxaqueno", "polonia", "polaca", "polaco", "portugal", "portugues", "portuguesa", "quechua",
        "rosarina", "rosarino", "rusia", "rusa", "ruso", "rusos", "sevilla", "sevillana", "sudafrica", "suiza", "suizo", "turquia", "turca", "turco",
        "ucrania", "ucraniana", "vasco", "vasca", "zulu", "zulues", "margaritenos", "margaritenas", "andaluz", "andaluza", "canaria", "canario",
        "nordica", "nordico", "escandinava", "escandinavo", "hawaiana", "hawaiano", "hawai", "texas", "tejana", "tejano", "california", "nueva york",
        "miami", "puerto rico", "colombianita", "venezuelan", "mexican", "brazilian", "japanese", "korean", "chinese", "spanish", "english", "french"]
ORIGINS: list[str] = BASE


def norm(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9ñ\s]", " ", text)).strip()


def main() -> None:
    raw = LEXICON.read_bytes()
    lex = json.loads(raw)
    if lex["version"] != FROM:
        sys.exit(f"se esperaba {FROM}, hay {lex['version']}")
    owners: dict[str, str] = {}
    for c in lex["concepts"]:
        for a in c["aliases"] + c.get("themeNouns", []):
            owners[a] = c["id"]
    for g in lex["genres"]:
        for a in g["aliases"]:
            owners[a] = "genre:" + g["slug"]
    for a in lex["ambiguous"]:
        owners[a["phrase"]] = "ambiguous"
    concepts = {c["id"]: c for c in lex["concepts"]}
    genres = {"genre:" + g["slug"]: g for g in lex["genres"]}
    added = 0
    for target, aliases in PATCH.items():
        entry = concepts.get(target) or genres.get(target)
        if entry is None:
            sys.exit(f"{target} no existe en el vocabulario")
        for a in map(norm, aliases):
            if owners.get(a, target) != target:
                sys.exit(f"«{a}» ya pertenece a {owners[a]}")
            if a not in entry["aliases"]:
                entry["aliases"] = sorted(set(entry["aliases"]) | {a})
                owners[a] = target
                added += 1
    owned_phrases = set(owners)
    origins = set(lex["markers"].get("origins", []))
    for o in map(norm, ORIGINS):
        if o in owned_phrases:
            sys.exit(f"procedencia «{o}» ya pertenece a {owners[o]}")
        if o not in origins:
            origins.add(o); added += 1
    lex["markers"]["origins"] = sorted(origins)
    lex["version"] = TO
    lex["derivedFrom"] = {"version": FROM, "sha256": hashlib.sha256(raw).hexdigest(),
                          "change": "1.8.0 (Brian, 2026-11-10: «Convención escrita + reglas»): alias de PATCH en scripts/stage3/patch_query_lexicon.py."}
    LEXICON.write_text(json.dumps(lex, ensure_ascii=False, indent=1) + "\n")
    print(f"{TO}: {added} alias añadidos")


if __name__ == "__main__":
    main()
