import csv, json, re, sys

BASE = "/tmp/crv-themes-2026-10-15/"
BASE_REPO = "/home/brian/apps/Coleccionistas De Rock Venezolano/reports/themes-es-2026-10-15/"

prop = [json.loads(l) for l in open(BASE_REPO + "propuesta.jsonl", encoding="utf-8")]
esperado = {p["id"]: p["despues"] for p in prop}
antes = {p["id"]: p["antes"] for p in prop}

despues = {}
with open(BASE + "despues.csv", newline="", encoding="utf-8") as fh:
    for rec in csv.reader(fh):
        if len(rec) >= 3:
            despues[int(rec[0])] = rec[2]

problemas = []
# 1) mismo conjunto de artistas con themes
if set(despues) != set(esperado):
    problemas.append(f"conjunto distinto: faltan {sorted(set(esperado)-set(despues))} sobran {sorted(set(despues)-set(esperado))}")
# 2) valor exacto esperado
for i, v in esperado.items():
    if despues.get(i) != v:
        problemas.append(f"id {i}: «{despues.get(i)}» != «{v}»")

# 3) restos en inglés: cualquier átomo del glosario original que siga apareciendo como palabra
glos = json.load(open(BASE_REPO + "glosario-en-es.json", encoding="utf-8"))
restos = []
for i, v in despues.items():
    for k in glos:
        if glos[k] == k:  # término idéntico en español (Gore, Horror, Instrumental…)
            continue
        if re.search(r"(?<![A-Za-z])" + re.escape(k) + r"(?![A-Za-z])", v):
            restos.append((i, k, v))
if restos:
    for i, k, v in restos[:20]:
        problemas.append(f"resto EN id {i}: «{k}» en «{v}»")

# 4) recuento de idioma: fichas con algún término traducido
traducidas = sum(1 for i, v in despues.items() if antes.get(i) != v)
print(f"fichas con themes: {len(despues)} · traducidas: {traducidas} · sin cambio (ya en es): {len(despues)-traducidas}")
if problemas:
    print("PROBLEMAS:")
    for p in problemas:
        print("  " + p)
    sys.exit(1)
print("VERIFICADO: los 352 valores coinciden con la propuesta y no queda ningún término inglés")
