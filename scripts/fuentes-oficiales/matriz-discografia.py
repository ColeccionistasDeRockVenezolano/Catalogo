#!/usr/bin/env python3
"""CRV · Matriz de decisión de la discografía (Brian, 2026-10-14). Solo lectura.

Cruza el cotejo de Bandcamp (discografia.jsonl) con el catálogo EN VIVO: para cada disco «faltante» busca un
parecido en la ficha (prefijos de catálogo, «ft.», sufijos de sesión) y para cada lista de pistas calcula la
diferencia en los dos sentidos con títulos normalizados. Propone una decisión por caso; no escribe nada.
Uso: python3 -I scripts/fuentes-oficiales/matriz-discografia.py
Salida: reports/fuentes-oficiales-2026-10-13/matriz-discografia-2026-10-14.{json,md}
"""
import json, re, subprocess, unicodedata
from difflib import SequenceMatcher
from pathlib import Path

DIR = Path("reports/fuentes-oficiales-2026-10-13")
USABLE = {"trayectoria", "disco-en-comun"}
# Revisión a mano de Claude (2026-10-14) sobre la propuesta automática; la clave es (artistId, título de la fuente).
REVIEWED = {
    (139, "La Vida Boheme ft. Christian Coleman, Chris Cuzme & Joey Johnson: Tiempo Comparti2"): "Ya existe (id 5549, mismas 5 pistas): no crear; enlazar la fuente",
    (459, "Live In Boston: 10 Years Of Resilliance In The US"): "Ya existe (id 15650) SIN pistas: cargar las 11 pistas; conservar la grafía «Resilliance» como alias",
    (459, "Zeta in Austin, TX July 26 (Live At Parish 2023)"): "Ya existe (id 15649, «Austin TX 7.26.23: Live at Parish») SIN pistas: cargar las 8; publicado en 2024, grabado el 26-07-2023 (nota)",
    (10, "Creation (instrumental)"): "Versión instrumental del EP «Creation» (id 35): como disco 2 de esa página (regla de discos múltiples) o ficha aparte; decide Brian",
    (101, "Children / Parents"): "Alta como sencillo doble (2 pistas); el parecido con «Hielo sobre arena» es falso",
    (112, "Desde Cero: 1998/2008"): "Subida parcial (2 de las 21 pistas) de «Desde Cero» (id 2017): no crear; enlazar la fuente",
    (112, "Horacero (Des)enchufado"): "Ya existe (id 530, «Desenchufado», 12 pistas): no crear; enlazar la fuente",
    (138, "V E N E N O"): "Ya existe (id 15514, «Veneno») SIN pistas: cargar la pista; tipo sencillo; «V E N E N O» como alias",
    (140, "DEMO casero 2013"): "Ya existe (id 743, «Demo», 7 pistas: la fuente trae 6, falta «Al Margen de la Ley»): no crear; enlazar",
}
REVIEWED_TRACKS = {
    5549: "Emparejamiento erróneo del cotejo: la fuente es «Tiempo Compartido», que YA está como id 14033 (las 7 pistas). 5549 está bien. Solo queda el año de 14033: catálogo 2021, Bandcamp 2020-11-06",
    595: "«Intro», «Outro» y «Narration» parecen las mismas posiciones con nombre genérico: comparar duraciones y renombrar con los títulos de la fuente",
    504: "El catálogo separa en dos pistas lo que Bandcamp junta y suma demos y ensayos de la reedición: conservar",
    195: "«Daisy» = «Daicy» (grafía). «Caliente» y «Comunícate» son de la reedición de Vampisoul (2023): no añadirlas a la edición de 1970; el año 1970 se queda",
    1985: "Son las mismas 6 pistas con otro nombre (año y versión en el título): no tocar; opcional, títulos de la fuente como alias",
    198: "Bandcamp no existía en 2003, así que la fecha la puso la banda: publicar en 2003 y anotar «grabado en 2002». Decide Brian",
    203: "2016 es la subida a Bandcamp; la biografía dice noviembre de 2009: no tocar",
    553: "2016 es la subida; el catálogo trae «Speedboy 2.0» de más: conservar",
    2715: "2023 es la subida a Bandcamp: no tocar",
    459: "«Jump into da van» = «Jump Into The Van (Intro)» (grafía): no tocar",
    1221: "«Daisy» = «Daicy» (grafía); «Por estas Calles» de más en el catálogo: conservar",
}


def sql(query: str):
    out = subprocess.run(["docker", "exec", "-i", "crv-postgres", "psql", "-U", "crv", "crv", "-At", "-c", query],
                         capture_output=True, text=True, check=True).stdout.strip()
    return json.loads(out) if out else None


def fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^\w ]+", " ", text)).strip()


def bare_track(title: str) -> str:
    title = re.sub(r"\((?:feat|ft|con|with)\.?[^)]*\)", "", title, flags=re.I)
    title = re.sub(r"\s[-–]\s.*(live session|en vivo|live|remaster|version|versión|demo|inedita|inédita).*$", "", title, flags=re.I)
    title = re.sub(r"\((?:instrumental|inedita|inédita|demo|live|en vivo|remaster[^)]*|bonus[^)]*|\d{4})\)", "", title, flags=re.I)
    return fold(title)


def bare_album(title: str, artist: str) -> str:
    title = re.sub(r"^[A-Z]{2,5}[: ]?\d{2,4}[: ]\s*", "", title)  # «DTT:003 …», «SAT129: …»
    folded = fold(title)
    for name in {fold(artist)}:
        folded = re.sub(rf"^{re.escape(name)}\b( ft .*?)?", "", folded).strip()
    return re.sub(r"\b(ep|lp|single|demo|ext|extended version|version)\b", "", folded).strip()


def catalog(artist_id: int):
    return sql(f"""SELECT coalesce(json_agg(x ORDER BY x.year NULLS LAST), '[]') FROM (
      SELECT al.id, al.title, al.release_year AS year, al.album_type::text AS type,
        coalesce((SELECT array_agg(alias) FROM ingest.album_aliases a WHERE a.album_id=al.id), '{{}}') AS aliases,
        coalesce((SELECT json_agg(t.title ORDER BY t.disc_number, t.track_number) FROM public.tracks t WHERE t.album_id=al.id), '[]') AS tracks
      FROM public.albums al WHERE al.artist_id={artist_id}) x""")


def similar(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b or (len(min(a, b, key=len)) >= 5 and (a in b or b in a)):
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def track_diff(source: list[str], catalog_tracks: list[str]):
    src = {bare_track(t): t for t in source}
    cat = {bare_track(t): t for t in catalog_tracks}
    only_src = [src[k] for k in src if k not in cat and not any(similar(k, c) >= 0.85 for c in cat)]
    only_cat = [cat[k] for k in cat if k not in src and not any(similar(k, s) >= 0.85 for s in src)]
    return only_src, only_cat


def track_decision(n_src: int, n_cat: int, only_src: list, only_cat: list) -> str:
    common = n_src - len(only_src)
    if not only_src and not only_cat:
        return "Solo cambia la grafía (feat., sufijos): no tocar"
    if common == 0:
        return "Ninguna pista coincide: emparejamiento o lista de otro disco; revisar a mano"
    if only_src and not only_cat:
        return f"Añadir {len(only_src)} pista(s) de la fuente a esta edición"
    if only_cat and not only_src:
        return f"El catálogo tiene {len(only_cat)} pista(s) de más (edición ampliada o reedición): conservar"
    return "Diferencias en los dos sentidos: revisar a mano (posibles ediciones distintas)"


def album_decision(album: dict, best) -> str:
    title = album["title"]
    n = len(album.get("tracks") or [])
    published = album.get("datePublished") or ""
    years_in_title = [int(y) for y in re.findall(r"\b(19[5-9]\d|20[0-2]\d)\b", title)]
    notes = []
    if best and best["score"] >= 0.8:
        return f"Ya existe como «{best['title']}» ({best['year']}, id {best['id']}): no crear; enlazar la fuente"
    if years_in_title and published and min(years_in_title) < int(published[:4]):
        notes.append(f"año del título {min(years_in_title)} ≠ publicación {published[:4]}: guardar la publicación y anotar la grabación")
    if re.search(r"\blive\b|en vivo|session", title, re.I):
        kind = "en vivo"
    elif n == 1:
        kind = "sencillo"
    elif n and n <= 4:
        kind = "EP o sencillo (confirmar tipo)"
    else:
        kind = "álbum (confirmar tipo)"
    base = f"Alta como {kind}"
    if best and best["score"] >= 0.6:
        notes.append(f"parecido a «{best['title']}» (id {best['id']}): confirmar que es otra edición")
    return base + ("; " + "; ".join(notes) if notes else "")


def main() -> None:
    rows = [json.loads(line) for line in (DIR / "discografia.jsonl").read_text().splitlines() if line.strip()]
    missing, tracklists, skipped = [], [], []
    for row in rows:
        if row["identity"] not in USABLE:
            skipped += [{"artistId": row["artistId"], "artist": row["name"], "identity": row["identity"], "title": m["title"], "url": m["url"]} for m in row["missing"]]
            continue
        cat = catalog(row["artistId"]) or []
        by_id = {a["id"]: a for a in cat}
        for album in row["missing"]:
            key = bare_album(album["title"], row["name"])
            scored = [{"id": a["id"], "title": a["title"], "year": a["year"], "tracks": len(a["tracks"]),
                       "score": max(similar(key, bare_album(t, row["name"])) for t in [a["title"], *a["aliases"]])} for a in cat]
            best = max(scored, key=lambda s: s["score"], default=None)
            src_tracks = [t["title"] for t in album.get("tracks") or []]
            entry = {"artistId": row["artistId"], "artist": row["name"], "title": album["title"], "url": album["url"],
                     "datePublished": album.get("datePublished"), "sourceTracks": len(src_tracks), "tracks": src_tracks,
                     "closest": best if best and best["score"] >= 0.6 else None}
            if best and best["score"] >= 0.6:
                only_src, only_cat = track_diff(src_tracks, by_id[best["id"]]["tracks"])
                entry["closestDiff"] = {"onlySource": only_src, "onlyCatalog": only_cat}
            entry["decision"] = REVIEWED.get((row["artistId"], album["title"])) or album_decision(album, best)
            missing.append(entry)
        for match in row["matched"]:
            if match["action"] != "con-pistas":
                continue
            live = by_id.get(match["albumId"])
            if not live:
                continue
            src_tracks = [t["title"] for t in match["tracks"]]
            only_src, only_cat = track_diff(src_tracks, live["tracks"])
            year_note = None
            if match.get("sourceYear") and live["year"] and match["sourceYear"] != live["year"]:
                year_note = f"catálogo {live['year']} · fuente {match['sourceYear']} (publicado {match.get('datePublished')})"
            if not only_src and not only_cat and not year_note:
                continue
            tracklists.append({"artistId": row["artistId"], "artist": row["name"], "albumId": live["id"], "album": live["title"],
                               "sourceTitle": match["title"], "url": match["url"], "catalogYear": live["year"], "sourceYear": match.get("sourceYear"),
                               "datePublished": match.get("datePublished"), "catalogTracks": len(live["tracks"]), "sourceTracks": len(src_tracks),
                               "onlySource": only_src, "onlyCatalog": only_cat, "year": year_note,
                               "decision": REVIEWED_TRACKS.get(live["id"]) or (track_decision(len(src_tracks), len(live["tracks"]), only_src, only_cat) if (only_src or only_cat) else "Solo el año difiere")})
    out = {"generated": "2026-10-14", "missing": missing, "tracklists": tracklists, "skippedUnconfirmed": skipped}
    (DIR / "matriz-discografia-2026-10-14.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")

    md = ["# Matriz de decisión · discografía (2026-10-14)", "",
          "Solo lectura: nada de esto se ha aplicado. Cada fila necesita el visto bueno de Brian.", "",
          f"## A. Discos de la fuente que no casan con el catálogo ({len(missing)})", "",
          "| # | Artista | Lanzamiento (fuente) | Publicado | Pistas | Más parecido en el catálogo | Decisión recomendada |", "|---|---|---|---|---|---|---|"]
    for i, m in enumerate(missing, 1):
        close = f"{m['closest']['title']} ({m['closest']['year']}, id {m['closest']['id']}, {m['closest']['tracks']} p.)" if m["closest"] else "—"
        md.append(f"| D{i:02d} | {m['artist']} | [{m['title']}]({m['url']}) | {m['datePublished'] or '—'} | {m['sourceTracks']} | {close} | {m['decision']} |")
    md += ["", f"## B. Listas de pistas y años que no cuadran ({len(tracklists)})", "",
           "| # | Artista | Disco (id) | Año cat./fuente | Pistas cat./fuente | Solo en la fuente | Solo en el catálogo | Decisión recomendada |", "|---|---|---|---|---|---|---|---|"]
    for i, t in enumerate(tracklists, 1):
        years = f"{t['catalogYear']} / {t['sourceYear']}" + (" ⚠" if t["year"] else "")
        md.append(f"| T{i:02d} | {t['artist']} | [{t['album']}]({t['url']}) ({t['albumId']}) | {years} | {t['catalogTracks']} / {t['sourceTracks']} | "
                  f"{'; '.join(t['onlySource']) or '—'} | {'; '.join(t['onlyCatalog']) or '—'} | {t['decision']} |")
    md += ["", f"## C. Fuera de la matriz: identidad sin confirmar ({len(skipped)})", ""]
    md += [f"- {s['artist']} ({s['identity']}): [{s['title']}]({s['url']})" for s in skipped]
    (DIR / "matriz-discografia-2026-10-14.md").write_text("\n".join(md) + "\n")
    print(json.dumps({"faltantes": len(missing), "conParecido": sum(1 for m in missing if m["closest"]), "listas": len(tracklists), "sinConfirmar": len(skipped)}))


if __name__ == "__main__":
    main()
