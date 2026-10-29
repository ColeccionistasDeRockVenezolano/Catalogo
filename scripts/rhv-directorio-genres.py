#!/usr/bin/env python3
"""Libro de géneros del directorio Rock Hecho en Venezuela (captura 2026-10-25).

Lee las 511 biografías de fichas.jsonl (scripts/rhv-directorio-parse.py), toma
la frase de género con phrase_genres de scripts/harvest-rhv-directory.py y la
liga al artista que resolvió scripts/rhv-directorio-absorb.mts (aplicacion.json).
Una fuente basta: el libro se aplica con
  ./scripts/with-node22.sh npx tsx scripts/apply-source-genres.ts --ledger=<salida> [--confirm]
que nunca toca una ficha con principal confirmado.

Uso: rhv-directorio-genres.py <fichas.jsonl> <aplicacion.json> <salida.jsonl>
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("harvest", Path(__file__).with_name("harvest-rhv-directory.py"))
harvest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harvest)


# Frases que el directorio usa más adelante en la biografía: «Su estilo musical bascula entre influencias de
# thrash y heavy metal», «con un estilo que bascula por los terrenos del rock con tendencias progresivas».
LATER = re.compile(
    r"(?:estilo|sonido|propuesta|m[uú]sica)(?: musical)?(?: que)?\s+(?:bascula|oscila|se mueve|transita|navega|se ubica|se enmarca|se centra|se inscribe|se orienta|gira|se desenvuelve)"
    r"\s+(?:entre|por|en|dentro de|hacia|alrededor de)\s+(?:(?:los|el|las|la)\s+)?(?:terrenos?|influencias|corrientes|l[ií]neas?|tendencias|vertientes|g[eé]neros?|ritmos)?\s*(?:del?\s+|de los\s+|de las\s+)?((?:[^.;:(]|,)+?)"
    + harvest.STOP.replace("[,.;:(]", "[.;:(]"), re.I)


# Envolturas del directorio alrededor del género: «sonidos del pop rock», «ritmos de rock»,
# «tendencias pop», «lo electrónico», «fusión del jazz», «rock tradicional».
WRAPPERS = re.compile(r"^(?:(?:diferentes |los |las )?(?:sonidos?|sonoridades|ritmos|conceptos|tendencias|corrientes|elementos)\s+(?:del?\s+|de los\s+|de las\s+)?|de\s+|lo\s+)", re.I)


def tidy(raw: str) -> str:
    value = WRAPPERS.sub("", raw.strip())
    value = re.sub(r"^fusi[oó]n del?\s+(.+)$", r"\1 fusión", value, flags=re.I)
    value = re.sub(r"\s+(?:tradicional|cl[aá]sico)$", "", value, flags=re.I)
    return {"electrónico": "electrónica", "electronico": "electrónica", "gótico": "rock gótico", "beat": "beat"}.get(value.lower(), value)


def genres_of(text: str) -> list[str]:
    found = [tidy(g) for g in harvest.phrase_genres(text)]
    if found:
        return found
    match = LATER.search(" ".join(text.split("\n")))
    # Se reutiliza la limpieza de phrase_genres sobre la frase hallada.
    return [tidy(g) for g in harvest.phrase_genres(f"Es una banda de {match.group(1)}.")] if match else []


def main() -> None:
    fichas_path, applied_path, out_path = sys.argv[1:4]
    artist_ids = json.loads(Path(applied_path).read_text(encoding="utf-8"))["artistIds"]
    rows, without = [], 0
    for line in Path(fichas_path).read_text(encoding="utf-8").splitlines():
        ficha = json.loads(line)
        artist_id = artist_ids.get(ficha["url"])
        if not artist_id:
            continue
        text = "\n".join(p for p in ficha["bio"] if not p.startswith("## "))
        genres = genres_of(text)
        if not genres:
            without += 1
            continue
        rows.append({"caseId": f"artist:{artist_id}", "kind": "artist", "entityId": int(artist_id), "source": "rhv-directorio",
                     "url": ficha["url"], "title": ficha["name"], "rawGenres": genres,
                     "identity": "ficha del directorio RHV ligada por rhv-directorio-absorb (2026-10-25)"})
    Path(out_path).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    print(json.dumps({"conGenero": len(rows), "sinFrase": without}))


if __name__ == "__main__":
    main()
