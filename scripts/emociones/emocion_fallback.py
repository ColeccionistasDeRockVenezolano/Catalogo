"""Emoción de respaldo por capas (idea de Brian, 2026-11-12): pista → disco → artista → género.

No escribe en la base: lee la instantánea de exportar_catalogo.mjs y produce archivos.

Capas y pesos (lo heredado pesa menos):
  resenas            lo que escribe la gente en sus reseñas (emocion_resenas.py) ..... 1.0
  descriptores_rym   descriptores de comunidad de la ficha RYM del disco ......... 0.9
  artista_discos     (artista) lo que dicen las reseñas y descriptores de sus discos  0.6
  genero             carácter típico de los géneros confirmados del disco ......... 0.4
  genero_artista     el disco no tiene género: usa el PRINCIPAL de su artista ..... 0.3
Carácter de un género (etapa 2), por orden: ficha de carácter 0.2.x (web con citas) + perfil RYM del género;
si no tiene nada y no es una categoría sin carácter, lo hereda del género padre (×0,5 por salto).
Géneros mezclados (etapa 3): principal pesa 1 y secundario 0,5; la puntuación de cada rasgo es la media
ponderada; si un disco tiene a la vez emociones positivas y negativas fuertes se marca «mixto».

Uso:
  python3 -I scripts/emociones/emocion_fallback.py --catalogo <catalogo.json> --fichas <fichas-rym.json> \
      --out <dir> [--resenas <emocion-resenas.jsonl>] [--resumen docs/unified-search/emociones/emocion-fallback-resumen.json]
Escribe también filas-entity-emotions.jsonl: lo que se cargaría en public.entity_emotions (SIMULACIÓN, no se carga aquí).
"""
import argparse, collections, json, re, sys, unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2] / "docs/unified-search/emociones"
VERSION = "crv-emotion-fallback-0.1.0"
PESO_CAPA = {"resenas": 1.0, "descriptores_rym": 0.9, "artista_discos": 0.6, "genero": 0.4, "genero_artista": 0.3}
# basis de entity_emotions (varchar 16): una fila por (entidad, emoción, capa); el buscador usa la capa más alta
BASIS = {"resenas": "resenas", "descriptores_rym": "descriptor_rym", "artista_discos": "artista_discos",
         "genero": "genero", "genero_artista": "genero_artista"}
FUERZA = {"definitorio": 1.0, "frecuente": 0.6, "variable": 0.3, "heredado": 0.3}
# Categorías funcionales o temáticas sin carácter propio (además de las marcadas sin_caracter en la ficha)
FUNCIONALES = {"banda-sonora", "bandas-sonoras", "world-ethnic", "instrumental", "white-metal", "musica-cristiana",
               "musica-cristiana-contemporanea", "musica-infantil"}
# Puente a las 6 emociones del buscador (src/api/repositories/emotions.ts). Por raíz normalizada del rasgo.
SENSACION = [
    ("cachonda", ["sensual", "seduct", "coquet", "erotic", "slow jam"]),
    ("tristeza", ["triste", "melancol", "nostalg", "depresiv", "desola", "solitari", "doliente", "lastimer", "quejumbr",
                  "duelo", "anhel", "agridulce", "sombri", "lugubre", "funebre", "pesimist", "arrepent", "añoranza",
                  "anoranza", "amor no correspondido", "despedida", "desolador"]),
    ("enfocado", ["tranquil", "sereno", "calm", "suave", "relaj", "apacible", "meditativ", "reconfort", "pausad",
                  "intimo", "acogedor", "etereo", "atmosfer", "hipnot", "onirico", "pastoral", "idilic", "minimal",
                  "introspectiv", "reflexiv", "brumoso", "sencillo"]),
    ("libertad", ["rebelde", "irreverente", "desafiante", "hedonista", "combativ", "contestatari", "comprometid",
                  "callejer", "provocador", "crudo"]),
    ("aumenta_mi_aura", ["energ", "festiv", "fiester", "bailable", "epico", "heroic", "triunfal", "himno", "agresiv",
                         "intenso", "vigoros", "frenetic", "potente", "edificante", "optimist", "alegre", "euforic",
                         "contundente", "grandios", "explosiv", "parrander", "animado", "rapido"]),
    ("emocion", ["romantic", "tierno", "afectuos", "carinos", "apasionad", "sentimental", "emotiv", "lirico",
                 "serenater", "devot", "espiritual"]),
]


def norm(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c)).strip()


def clave(es):
    return re.sub(r"\s*\(.*?\)", "", norm(es).split("/")[0]).strip()


def sensacion(es):
    k = clave(es)
    for emo, raices in SENSACION:
        if any(r in k for r in raices):
            return emo
    return None


def rasgo(es, eje, val, peso, origen):
    return {"rasgo": clave(es), "es": es, "eje": eje, "valencia": val, "peso": round(peso, 3),
            "sensacion": sensacion(es), "origen": origen}


def caracter_generos(generos_db):
    ultima = max((p for p in RAIZ.glob("caracter-0.*.json") if not p.name.endswith(".src.json")), key=lambda p: tuple(int(x) for x in re.findall(r"\d+", p.name.split("caracter-")[1])[:3]))
    ficha = {g["slug"]: g for g in json.load(open(ultima))["generos"]}
    perfil = {p["slug"]: p for p in json.load(open(RAIZ / "perfil-generos-rym.json"))["generos"]}
    padre = {g["slug"]: g["parent"] for g in generos_db}
    propio = {}
    for g in generos_db:
        s = g["slug"]; f = ficha.get(s); r = {}
        if s in FUNCIONALES or (f and f["confianza"] == "sin_caracter"):
            propio[s] = {"estado": "sin_caracter", "rasgos": []}
            continue
        if f:
            for c in f["caracter"]:
                w = FUERZA[c["fuerza"]] * (0.6 if f["confianza"] == "baja" else 1.0)
                r.setdefault(clave(c["es"]), rasgo(c["es"], c["eje"], c["valencia"], w,
                                                   "heredado_ficha" if c["fuerza"] == "heredado" else "ficha_web"))
        for t in (perfil.get(s) or {}).get("tipico", []):
            k = clave(t["es"]); w = min(1.0, t["share"] / 0.25) * 0.8
            if k in r:
                r[k]["peso"] = round(min(1.0, r[k]["peso"] + 0.2), 3); r[k]["origen"] += "+perfil_rym"
            else:
                r[k] = rasgo(t["es"], t["eje"], t["valencia"], w, "perfil_rym")
        estado = ("ficha_" + f["confianza"]) if f else ("perfil_rym" if r else "vacio")
        propio[s] = {"estado": estado, "rasgos": sorted(r.values(), key=lambda x: -x["peso"])}
    final = {}
    for s, v in propio.items():
        if v["estado"] != "vacio":
            final[s] = v; continue
        p, f, salto = padre.get(s), 0.5, 1
        while p and propio.get(p, {}).get("estado") == "vacio":
            p, f, salto = padre.get(p), f * 0.5, salto + 1
        if p and propio.get(p, {}).get("rasgos"):
            final[s] = {"estado": f"heredado_de:{p}",
                        "rasgos": [dict(x, peso=round(x["peso"] * f, 3), origen=f"padre:{p}") for x in propio[p]["rasgos"]]}
        else:
            final[s] = {"estado": "sin_datos", "rasgos": []}
    return final


def combinar(partes, top=8, minimo=0.12):
    """partes: [(peso, [rasgos])] → rasgos ponderados (media), con marca de mezcla."""
    tot = sum(w for w, _ in partes if _)
    if not tot:
        return [], False
    acc = {}
    for w, rs in partes:
        for x in rs:
            a = acc.setdefault(x["rasgo"], dict(x, peso=0.0))
            a["peso"] += w * x["peso"] / tot
    out = sorted((dict(a, peso=round(a["peso"], 3)) for a in acc.values() if a["peso"] >= minimo), key=lambda x: -x["peso"])[:top]
    pos = sum(x["peso"] for x in out if x["eje"] == "emocion" and x["valencia"] == "pos")
    neg = sum(x["peso"] for x in out if x["eje"] == "emocion" and x["valencia"] == "neg")
    return out, pos >= 0.35 and neg >= 0.35


def sensaciones(rasgos, capa):
    acc = collections.Counter()
    for x in rasgos:
        if x["sensacion"]:
            acc[x["sensacion"]] += x["peso"]
    return {e: round(min(1.0, v) * PESO_CAPA[capa], 3) for e, v in acc.most_common() if v >= 0.15}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalogo", required=True); ap.add_argument("--fichas", required=True)
    ap.add_argument("--out", required=True); ap.add_argument("--resumen"); ap.add_argument("--resenas")
    a = ap.parse_args()
    cat = json.load(open(a.catalogo))
    gid = {g["id"]: g["slug"] for g in cat["generos"]}
    car = caracter_generos(cat["generos"])
    dic = {f["descriptor"]: f for f in json.load(open(RAIZ / "rym-descriptores.json"))["descriptores"]}
    ku = lambda u: u.lower().rstrip("/").replace("_", "-").replace("http://", "https://")
    fichas = {ku(u): v for u, v in json.load(open(a.fichas)).items()}
    artistas = {int(k): v for k, v in cat["artistas"].items()}
    resenas = {}
    if a.resenas and Path(a.resenas).exists():
        resenas = {x["album_id"]: x for x in map(json.loads, open(a.resenas))}
    discos = []; cuenta = collections.Counter(); sens_cuenta = collections.Counter()
    for d in cat["discos"]:
        capas = []
        rv = resenas.get(d["id"])
        if rv:
            capas.append({"capa": "resenas", "resenas": rv["resenas"], "fuentes": rv["fuentes"],
                          "cruceAprobado": rv["cruceAprobado"], "rasgos": rv["rasgos"],
                          "sensaciones": sensaciones(rv["rasgos"], "resenas")})
        f = fichas.get(ku(d["rym"])) if d["rym"] else None
        if f and f["desc"]:
            rs = []
            for i, t in enumerate(f["desc"]):
                e = dic.get(t)
                if e and e["cuentaComoSensacion"]:
                    rs.append(rasgo(e["es"], e["eje"], e["valencia"], max(0.4, 1 - 0.1 * i), "descriptor_rym:" + t))
            if rs:
                capas.append({"capa": "descriptores_rym", "fuente": d["rym"], "rasgos": rs,
                              "sensaciones": sensaciones(rs, "descriptores_rym")})
        gs = [(gid.get(g), r) for g, r in d["generos"] if gid.get(g)]
        capa = "genero"
        if not gs and d["artist"] in artistas:
            gs = [(gid.get(g), r) for g, r in artistas[d["artist"]] if r == "primary" and gid.get(g)]
            capa = "genero_artista"
        partes = [(1.0 if r == "primary" else 0.5, car.get(s, {}).get("rasgos", [])) for s, r in gs]
        rs, mixto = combinar(partes)
        if rs:
            capas.append({"capa": capa, "generos": [[s, r] for s, r in gs], "rasgos": rs, "mixto": mixto,
                          "sensaciones": sensaciones(rs, capa)})
        if capas:
            discos.append({"album_id": d["id"], "artist_id": d["artist"], "titulo": d["title"], "capas": capas})
            cuenta[capas[0]["capa"]] += 1
            for e in capas[0]["sensaciones"]:
                sens_cuenta[e] += 1
        else:
            cuenta["sin_emocion"] += 1
    # capa del artista: media de la mejor evidencia propia (reseñas/descriptores) de sus discos
    por_art = collections.defaultdict(list)
    for x in discos:
        c = x["capas"][0]
        if c["capa"] in ("resenas", "descriptores_rym"):
            por_art[x["artist_id"]].append((1.0, c["rasgos"]))
    artistas_out = []
    for aid, partes in por_art.items():
        rs, mixto = combinar(partes)
        if rs:
            artistas_out.append({"artist_id": aid, "discos": len(partes), "capa": "artista_discos", "rasgos": rs,
                                 "mixto": mixto, "sensaciones": sensaciones(rs, "artista_discos")})
    filas = []
    for x in discos:
        for c in x["capas"]:
            for emo, sc in c["sensaciones"].items():
                filas.append({"album_id": x["album_id"], "artist_id": None, "emotion": emo, "score": sc,
                              "basis": BASIS[c["capa"]], "evidence": len([r for r in c["rasgos"] if r["sensacion"] == emo]),
                              "detail": {"rasgos": [r["es"] for r in c["rasgos"] if r["sensacion"] == emo],
                                         "generos": c.get("generos"), "tipicoDelGenero": c["capa"].startswith("genero")},
                              "model_version": VERSION})
    for x in artistas_out:
        for emo, sc in x["sensaciones"].items():
            filas.append({"album_id": None, "artist_id": x["artist_id"], "emotion": emo, "score": sc,
                          "basis": "artista_discos", "evidence": x["discos"],
                          "detail": {"rasgos": [r["es"] for r in x["rasgos"] if r["sensacion"] == emo]},
                          "model_version": VERSION})
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    with open(out / "emocion-artistas.jsonl", "w") as fh:
        for x in artistas_out:
            fh.write(json.dumps(x, ensure_ascii=False) + "\n")
    with open(out / "filas-entity-emotions.jsonl", "w") as fh:
        for x in filas:
            fh.write(json.dumps(x, ensure_ascii=False) + "\n")
    json.dump({"version": VERSION, "pesosCapa": PESO_CAPA, "generos": car}, open(out / "caracter-generos-resuelto.json", "w"),
              ensure_ascii=False, indent=1)
    with open(out / "emocion-discos.jsonl", "w") as fh:
        for x in discos:
            fh.write(json.dumps(x, ensure_ascii=False) + "\n")
    est = collections.Counter(v["estado"].split(":")[0] for v in car.values())
    res = {"version": VERSION, "catalogoExportado": cat["exportado"], "generos": {"total": len(car), "porEstado": dict(est)},
           "discos": {"total": len(cat["discos"]), "capaPrincipal": dict(cuenta),
                      "conDescriptoresRym": sum(1 for x in discos if x["capas"][0]["capa"] == "descriptores_rym"),
                      "sensacionPrincipalPorEmocion": dict(sens_cuenta),
                      "mixtos": sum(1 for x in discos for c in x["capas"] if c.get("mixto"))},
           "artistasConEvidenciaDeSusDiscos": len(artistas_out),
           "filasEntityEmotions": dict(collections.Counter(f["basis"] for f in filas))}
    if a.resumen:
        json.dump(res, open(a.resumen, "w"), ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
