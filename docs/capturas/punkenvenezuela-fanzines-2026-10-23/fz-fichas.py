import json, os, collections

OUT = "/home/brian/crv-staging/data/research/punkenvenezuela-fanzines-2026-10-23"
lex = {}
for line in open(os.path.join(OUT, "lexicon.jsonl"), encoding="utf-8"):
    r = json.loads(line)
    if r["kind"] == "artist":
        lex[int(r["id"])] = r

res = [l.rstrip("\n").split("\t") for l in open(os.path.join(OUT, "resumen-artistas.tsv"), encoding="utf-8")][1:]
rows = []
for tipo, oid, nombre, menc, docs in res:
    if tipo == "person":
        continue
    a = lex.get(int(oid))
    if not a:
        continue
    faltan = [c for c in ("origin_city", "formed_year") if not a.get(c)]
    if not faltan:
        continue
    rows.append((len(faltan), int(docs), int(menc), nombre, a["id"], a.get("origin_city") or "",
                 a.get("formed_year") or "", ",".join(faltan)))

rows.sort(key=lambda r: (r[0], -r[1], -r[2]))
with open(os.path.join(OUT, "fichas-a-completar.tsv"), "w", encoding="utf-8") as f:
    f.write("artista\tid\tdocumentos\tmenciones\tciudad_origen\tformado_en\tfaltan\n")
    for faltan, docs, menc, nombre, aid, city, fy, cols in rows:
        f.write(f"{nombre}\t{aid}\t{docs}\t{menc}\t{city}\t{fy}\t{cols}\n")

n_art = sum(1 for r in res if r[0] != "person")
print("artistas citados:", n_art, "con ficha incompleta:", len(rows),
      "sin ciudad:", sum(1 for r in rows if "origin_city" in r[7]),
      "sin año:", sum(1 for r in rows if "formed_year" in r[7]))

inf = os.path.join(OUT, "informe.md")
t = open(inf, encoding="utf-8").read()
if "Fichas a completar" not in t:
    t += ("\n## Fichas a completar con los fanzines\n\n"
          f"De los **{n_art} artistas** del catálogo citados en el corpus, "
          f"**{len(rows)}** tienen la ficha incompleta (sin ciudad de origen y/o año "
          f"de formación). `fichas-a-completar.tsv` los ordena por prioridad: primero "
          f"los que están peor y más se citan en los fanzines. Los 25 primeros:\n\n"
          "| Artista | Docs | Menciones | Falta |\n|---|---|---|---|\n")
    for faltan, docs, menc, nombre, aid, city, fy, cols in rows[:25]:
        t += f"| {nombre} | {docs} | {menc} | {cols} |\n"
    open(inf, "w", encoding="utf-8").write(t)
print("informe extendido")
