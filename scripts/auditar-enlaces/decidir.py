#!/usr/bin/env python3
"""Decisión humana de la auditoría de enlaces: lista explícita revisada a ojo.
La IA solo aporta el motivo cuando coincide; nada se oculta por umbral automático.
Escribe decisiones.jsonl (a ocultar) y revision.jsonl (dudas, visibles). Uso: decidir.py DIR"""
import json, os, sys

d = sys.argv[1]
STREAM = {
    # Perfiles homónimos: Apple
    1225, 48630, 48699, 48702, 48723, 48753, 48768, 48800, 48813, 48857, 48891, 48904, 48920, 48943, 48980, 48977, 49005,
    3286, 49266, 49373, 49407, 49429, 49458, 49842, 49939, 49961, 50056, 50202, 50399, 2488, 2561, 2006, 50516, 2872,
    50580, 50586, 12406, 51195,
    # Deezer, Spotify, YouTube Music
    1223, 50260, 48629, 48754, 48769, 48947, 49362, 49408, 49704, 49808, 49841, 50196, 1456, 50332, 1952, 2005, 10388,
    2870, 10693, 50552, 11720, 50656, 12405, 2414, 10711, 48538, 48642, 48911, 48966, 49374, 49889, 49938,
    # Solo coincidía un disco que se llama como la banda
    607, 2456, 2486, 2838, 6098, 10903, 12007, 13444, 14301, 15154, 16431, 17433, 21276, 1176, 3644, 22822, 24314,
    8702, 8703, 8704, 8705,
    # Enlace de disco homónimo sacado de esos mismos perfiles ajenos
    608, 2461, 2491, 2853, 3645, 6100, 8706, 8707, 10904, 12008, 12904, 13443, 14300, 14672, 15153, 16430, 17432, 21275,
    22821, 24313, 24944,
    # Otro nombre o entidad identificada
    14673, 50890, 51187, 48453, 50928, 3583, 5008, 50676, 48419, 48433, 11996, 48411, 2416,
    # Disco equivocado
    5608, 7561, 20524, 52519,
}
SOCIAL = {
    2659, 2660, 2641, 2642, 2643, 2721, 2722, 5435, 5450, 5463, 5464, 5466, 5470, 5497, 5498, 5499, 5399, 2631, 2632, 2633,
    747, 5270, 5514, 3811, 3862, 3655, 4032, 4115, 5166, 3469, 4554, 3404, 3638, 5098, 5377, 5387, 5445, 5446, 3540, 5191,
    5473, 5474, 5475, 5478, 5479, 1416, 5011,
}
filas = {(f["k"], f["id"]): f for f in map(json.loads, open(os.path.join(d, "veredictos.jsonl")))}
ia = {}
for l in open(os.path.join(d, "opinion-ia.jsonl")):
    o = json.loads(l)
    ia[(o["k"], o["id"])] = o
oc = {}
for k, ids in (("stream", STREAM), ("social", SOCIAL)):
    for i in ids:
        f = filas[(k, i)]
        assert f["verified"], (k, i)
        o = ia.get((k, i))
        oc[(k, i)] = "no es de la ficha: " + (o["motivo"] if o and o.get("veredicto") == "ajeno" else f["por"])
# Muertos con respuesta firme de la plataforma
for l in open(os.path.join(d, "muertos-recheck.jsonl")):
    m = json.loads(l)
    if m["estado"] == "muerto":
        oc[(m["k"], m["id"])] = f"enlace muerto: {m['platform']} responde que no existe (comprobado dos veces)"
for f in filas.values():
    if f["verified"] and f["v"] == "muerto" and f["platform"] == "youtube":
        oc[(f["k"], f["id"])] = "enlace muerto: la API de YouTube no lo encuentra"
with open(os.path.join(d, "decisiones.jsonl"), "w") as s:
    for (k, i), m in sorted(oc.items()):
        s.write(json.dumps({"k": k, "id": i, "motivo": m[:300]}, ensure_ascii=False) + "\n")
n = 0
with open(os.path.join(d, "revision.jsonl"), "w") as s:
    for key, f in filas.items():
        o = ia.get(key)
        marcado = f["v"] in ("homonimo", "canal_distinto", "otro_lugar", "dudoso", "ajeno", "disco_ajeno", "disco_distinto", "muerto")
        if f["verified"] and key not in oc and (marcado or (o and o.get("veredicto") == "ajeno")):
            s.write(json.dumps({**{x: f[x] for x in ("k", "id", "artist_id", "album_id", "artista", "platform", "url", "source", "v", "por")},
                                "ia": o and o.get("veredicto"), "ia_motivo": o and o.get("motivo")}, ensure_ascii=False) + "\n")
            n += 1
print("a ocultar", len(oc), "a revisión", n)
