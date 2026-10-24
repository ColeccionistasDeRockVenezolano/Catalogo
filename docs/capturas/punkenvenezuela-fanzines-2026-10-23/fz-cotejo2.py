#!/usr/bin/env python3
"""Cotejo v2: alta precisión. Corpus de fanzines vs catálogo CRV.

Reglas (tras medir que los nombres de una sola palabra común —«La Calle»,
«Cárcel», «Represión»— generaban miles de falsos positivos):
  * se calcula en cuántas PÁGINAS aparece cada clave (df);
  * clave genérica (df > 3% de las páginas) => se descarta;
  * clave de una sola palabra: exige contexto de banda (±120 car.) y >=5 letras;
  * clave de varias palabras: fuerte si df <= 3% (con contexto) o df <= 1% (sin él);
  * el resto va a matches-debiles.jsonl, fuera del informe.
"""
import os, re, json, unicodedata, collections, sys

OUT = "/home/brian/crv-staging/data/research/punkenvenezuela-fanzines-2026-10-23"
CORPUS = os.path.join(OUT, "corpus.jsonl")
LEX = os.path.join(OUT, "lexicon.jsonl")

STOP = set("""punk punkrock rock metal demo maqueta banda bandas grupo grupos
varios recopilatorio recopilacion concierto conciertos vivo split single
sencillo album ep lp cd casete tape vinilo disco discos editorial numero anos
caracas venezuela barquisimeto maracaibo valencia merida maracay los las del
por con para una uno unos unas que como mas sin sobre entre desde hasta
cuando donde este esta estos estas otro otra otros otras nuevo nueva primeros
primeras historia anarquia anarquista libertad libre resistencia contra todo
todos todas nada siempre nunca aqui alli ellos nosotros ustedes gente mundo
vida muerte sangre guerra paz calle calles sistema estado gobierno pueblo
barrio ciudad pais america latina sur norte centro este oeste actitud peligro
ruido sonido musica musical cancion canciones temas directo gira toque toques
festival muestra presentacion edicion especial parte volumen ano años""".split())

BAND_CTX = re.compile(
    r"\b(bandas?|grupos?|agrupacion(es)?|tocaron|tocaba|tocaban|toca|toque(s)?|"
    r"concierto(s)?|presentacion(es)?|recital(es)?|festival(es)?|"
    r"discos?|maqueta(s)?|demo(s)?|grabaron|grabacion(es)?|integrantes?|"
    r"formacion|voz|voces|guitarra(s)?|guitarrista(s)?|bajista(s)?|bajo|"
    r"bateria|baterista(s)?|cantante(s)?|punk|punketo(s)?|hardcore|anarcopunk|"
    r"punkrock|bandcamp|disquera|sello)\b")
GENERIC_TOKENS = set("""la el los las un una unos unas de del al en con por para sin
sobre contra entre y o que como mas muy todo toda todos todas este esta esto
estos estas ese esa eso aquellos aquellas otro otra otros otras nuevo nueva
gran grandes primer primera segundos bajo alta alto libre libres negro negra
blanco roja rojo muerte vida gente calle calles ciudad mundo pueblo pais sangre
guerra paz cielo infierno fuego agua tierra aire alma cuerpo mente corazon
amor odio rabia miedo dolor sueno sueños noche dia dias tiempo años anos ano
historia memoria ruido sonido musica futuro pasado presente sistema estado
poder lucha revuelta revuelta caos orden desorden guerra hepatitis sida
carcel carceles presos preso tortura torturas represion rebelion revolucion
insurreccion resistencia accion movida escena generacion juventud""".split())

CITY_RE = re.compile(
    r"\b(Caracas|Barquisimeto|Maracaibo|Valencia|Maracay|M[ée]rida|San Crist[óo]bal|"
    r"Cuman[áa]|Barinas|Matur[íi]n|Puerto La Cruz|Ciudad Guayana|Guarenas|Guatire|"
    r"Petare|Catia|Sabana Grande|Los Teques|Coro|Punto Fijo|Acarigua|Araure|Cabimas|"
    r"El Tigre|Car[úu]pano|Porlamar|La Guaira)\b")
YEAR_RE = re.compile(r"\b(19[5-9]\d|200\d|201\d)\b")

def norm(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s)).strip()

# ---------- lexicón ----------
artists, aliases_of, persons = {}, collections.defaultdict(list), {}
for line in open(LEX, encoding="utf-8"):
    r = json.loads(line)
    if r["kind"] == "artist":
        artists[r["id"]] = r
    elif r["kind"] == "alias":
        aliases_of[r["artist_id"]].append(r["alias"])
    else:
        persons[r["id"]] = r

keymap, meta = {}, {}
for aid, a in artists.items():
    for etiqueta, texto in [("artist", a["name"])] + [("alias", x) for x in aliases_of.get(aid, [])]:
        k = norm(texto)
        if len(k) < 5 or k in STOP:
            continue
        toks = k.split()
        if len(toks) == 1 and (len(k) < 5 or k in GENERIC_TOKENS):
            continue
        if k not in keymap:
            keymap[k] = (etiqueta, aid, a["name"])
            meta[k] = len(toks)
for pid, p in persons.items():
    k = norm(p["name"])
    toks = k.split()
    if len(toks) < 2 or len(k) < 7:
        continue
    if any(t in GENERIC_TOKENS for t in toks[:1]):
        continue
    if k not in keymap:
        keymap[k] = ("person", pid, p["name"])
        meta[k] = len(toks)

maxlen = max(meta.values())
print("claves:", len(keymap), flush=True)

# ---------- pasada única ----------
pages = []
df = collections.Counter()          # clave -> nº de páginas
raw_hits = []                        # (clave, idx_pagina, contexto, toks)
for idx, line in enumerate(open(CORPUS, encoding="utf-8")):
    r = json.loads(line)
    t = r.get("texto") or ""
    n = norm(t)
    pages.append(r)
    if len(n) < 40:
        continue
    toks = [(m.group(0), m.start()) for m in re.finditer(r"[a-z0-9]+", n)]
    vistos = set()
    for i in range(len(toks)):
        for size in range(1, min(maxlen, len(toks) - i) + 1):
            frase = " ".join(toks[i + j][0] for j in range(size))
            if frase not in keymap:
                continue
            if frase in vistos:
                continue
            vistos.add(frase)
            pos = toks[i][1]
            ctx = n[max(0, pos - 120): pos + len(frase) + 120]
            raw_hits.append((frase, idx, ctx))
    for f in vistos:
        df[f] += 1

total_pages = len(pages)
print("hits brutos:", len(raw_hits), flush=True)

def original_case(doc, tokens):
    """Frase tal como aparece en el texto original (para la evidencia)."""
    txt = pages[doc].get("texto") or ""
    pat = r"(?i)\b" + r"\W+".join(re.escape(t) for t in tokens) + r"\b"
    m = re.search(pat, txt)
    return m.group(0) if m else " ".join(tokens)

fuertes, debiles = [], []
for frase, idx, ctx in raw_hits:
    kind, oid, label = keymap[frase]
    P = pages[idx]
    ratio = df[frase] / total_pages
    if ratio > 0.15:
        continue
    toks = frase.split()
    tiene_ctx = bool(BAND_CTX.search(ctx))
    if len(toks) == 1:
        fuerte = tiene_ctx and ratio <= 0.03
    else:
        fuerte = (ratio <= 0.03 and tiene_ctx) or ratio <= 0.01
    rec = {
        "fuerza": "fuerte" if fuerte else "debil",
        "tipo": kind, "id": oid, "nombre": label,
        "como_aparece": original_case(idx, toks),
        "df_paginas": df[frase], "df_ratio": round(ratio, 4),
        "contexto_banda": tiene_ctx,
        "doc": P["doc"], "pagina": P["pagina"], "metodo": P.get("metodo"),
        "calidad": P.get("calidad"), "contexto": ctx.strip(),
    }
    (fuertes if fuerte else debiles).append(rec)

with open(os.path.join(OUT, "matches.jsonl"), "w", encoding="utf-8") as f:
    for m in fuertes:
        f.write(json.dumps(m, ensure_ascii=False) + "\n")
with open(os.path.join(OUT, "matches-debiles.jsonl"), "w", encoding="utf-8") as f:
    for m in debiles:
        f.write(json.dumps(m, ensure_ascii=False) + "\n")

# ---------- resumen ----------
by_entity = collections.defaultdict(lambda: {"menciones": 0, "docs": set(), "evid": []})
for m in fuertes:
    e = by_entity[(m["tipo"], m["id"], m["nombre"])]
    e["menciones"] += 1
    e["docs"].add(m["doc"])
    if len(e["evid"]) < 3:
        e["evid"].append(m)

with open(os.path.join(OUT, "resumen-artistas.tsv"), "w", encoding="utf-8") as f:
    f.write("tipo\tid\tnombre\tmenciones\tdocumentos\n")
    for (k, oid, nm), e in sorted(by_entity.items(), key=lambda x: (-len(x[1]["docs"]), -x[1]["menciones"])):
        f.write(f"{k}\t{oid}\t{nm}\t{e['menciones']}\t{len(e['docs'])}\n")

# ---------- candidatos (nombres no catalogados) ----------
cand = collections.Counter()
cand_docs = collections.defaultdict(set)
for p in pages:
    t = p.get("texto") or ""
    if (p.get("calidad") or 0) < 0.55:
        continue
    for m in re.finditer(r"\b([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9]{2,}(?:\s+[A-ZÁÉÍÓÚÑ0-9]{2,}){0,3})\b", t):
        g = m.group(1).strip()
        ng = norm(g)
        if len(ng) < 5 or ng in keymap or ng in STOP or len(g) > 60:
            continue
        if any(tok in GENERIC_TOKENS for tok in ng.split()):
            continue
        cand[g] += 1
        cand_docs[g].add(p["doc"])
with open(os.path.join(OUT, "candidatos.tsv"), "w", encoding="utf-8") as f:
    f.write("candidato\tmenciones\tdocumentos\n")
    for g, c in cand.most_common(500):
        if c >= 2 and len(cand_docs[g]) >= 2:
            f.write(f"{g}\t{c}\t{len(cand_docs[g])}\n")

# ---------- informe ----------
n_art = sum(1 for k in by_entity if k[0] == "artist")
n_per = sum(1 for k in by_entity if k[0] == "person")
n_ali = sum(1 for k in by_entity if k[0] == "alias")
lowq = sum(1 for p in pages if (p.get("calidad") or 0) < 0.55 and (p.get("chars") or 0) > 40)
top_art = [(k, e) for k, e in sorted(by_entity.items(), key=lambda x: (-len(x[1]["docs"]), -x[1]["menciones"])) if k[0] != "person"]
top_per = [(k, e) for k, e in sorted(by_entity.items(), key=lambda x: (-len(x[1]["docs"]), -x[1]["menciones"])) if k[0] == "person"]

with open(os.path.join(OUT, "informe.md"), "w", encoding="utf-8") as f:
    f.write("# Cotejo de los fanzines de punkenvenezuela contra el catálogo CRV\n\n")
    f.write(f"- Páginas con texto: **{total_pages}** ({lowq} con OCR de calidad baja)\n")
    f.write(f"- Menciones **fuertes** (con evidencia): **{len(fuertes)}** en "
            f"**{len(by_entity)}** entidades — {n_art} artistas, {n_ali} por alias, {n_per} personas\n")
    f.write(f"- Menciones débiles descartadas del informe: {len(debiles)} "
            f"(`matches-debiles.jsonl`)\n")
    f.write(f"- Candidatos no catalogados: ver `candidatos.tsv`\n\n")
    f.write("## Artistas citados con más documentos\n\n")
    f.write("| Artista | Documentos | Menciones | Evidencia |\n|---|---|---|---|\n")
    for (k, oid, nm), e in top_art[:45]:
        ev = e["evid"][0]
        f.write(f"| {nm} | {len(e['docs'])} | {e['menciones']} | "
                f"{ev['doc'][:38]} p.{ev['pagina']} |\n")
    f.write("\n## Personas citadas\n\n| Persona | Documentos | Menciones |\n|---|---|---|\n")
    for (k, oid, nm), e in top_per[:25]:
        f.write(f"| {nm} | {len(e['docs'])} | {e['menciones']} |\n")
    f.write("\n## Cómo leer la evidencia\n\n")
    f.write("Cada fila de `matches.jsonl` trae `como_aparece` (grafía del fanzine), "
            "`doc`, `pagina`, `contexto` y la calidad OCR de esa página. Una mención "
            "«fuerte» significa: nombre poco frecuente en el corpus y, si es de una "
            "palabra, rodeado de vocabulario de banda (banda, grupo, tocan, concierto, "
            "maqueta, integrantes…). No implica que la ficha del catálogo esté bien: "
            "es una pista para verificar.\n")
    f.write("\n## Límites\n\n"
            "- El OCR confunde grafías (`PUIvKiS`): esos nombres no cruzan.\n"
            "- Los fanzines hablan de política además de música; se descartó lo genérico "
            "midiendo en cuántas páginas aparece cada nombre, pero queda ruido.\n"
            "- 27 páginas con calidad < 0,55: sirven para buscar, no para citar.\n")

print(json.dumps({"fuertes": len(fuertes), "debiles": len(debiles), "entidades": len(by_entity),
                  "artistas": n_art, "personas": n_per, "alias": n_ali,
                  "candidatos": sum(1 for g, c in cand.items() if c >= 2)}))
