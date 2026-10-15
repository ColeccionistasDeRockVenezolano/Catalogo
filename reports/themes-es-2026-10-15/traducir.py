import csv, json, re, sys, collections

BASE = "/tmp/crv-themes-2026-10-15/"
glos = json.load(open(BASE + "glosario.json", encoding="utf-8"))
rows = json.load(open(BASE + "artistas.json", encoding="utf-8"))

faltan = collections.Counter()


def traducir_atomo(texto):
    t = texto.strip()
    if not t:
        return t
    m = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", t)
    if m:
        b, p = m.group(1).strip(), m.group(2).strip()
        tb = traducir_atomo(b) if b else ""
        tp = glos.get(p)
        if tp is None:
            faltan[p] += 1
            tp = p
        return (tb + " (" + tp + ")").strip()
    tr = glos.get(t)
    if tr is None:
        faltan[t] += 1
        return t
    return tr


def traducir_valor(valor):
    partes = re.split(r"([;,])", valor)
    out = []
    for p in partes:
        if p in (";", ","):
            out.append(p)
        else:
            m = re.match(r"^(\s*)(.*?)(\s*)$", p, re.S)
            assert m is not None
            out.append(m.group(1) + traducir_atomo(m.group(2)) + m.group(3))
    return "".join(out)


propuesta = []
for r in rows:
    nueva = traducir_valor(r["themes"])
    propuesta.append({"id": r["id"], "name": r["name"], "antes": r["themes"], "despues": nueva})

with open(BASE + "propuesta.jsonl", "w", encoding="utf-8") as fh:
    for p in propuesta:
        fh.write(json.dumps(p, ensure_ascii=False) + "\n")

if faltan:
    print("FALTAN EN EL GLOSARIO:")
    for k, n in faltan.most_common():
        print(f"  {n}x {k!r}")
    sys.exit(1)

iguales = [p for p in propuesta if p["antes"] == p["despues"] and re.search(r"[A-Za-z]{3}", p["antes"])]
print(f"ok: {len(propuesta)} valores traducidos, 0 atomos sin glosario")
print(f"sin cambios (solo nombres propios): {len(iguales)} -> " + ", ".join(p["name"] for p in iguales[:12]))
