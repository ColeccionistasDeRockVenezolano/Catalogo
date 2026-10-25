#!/usr/bin/env python3
"""Prueba final reservada de interpretación de consultas (etapa 3).

Redactada por Claude el 2026-10-25, ANTES de construir el léxico, el segmentador
o cualquier modelo de la etapa 3. No se usa para desarrollo, ajuste de reglas,
selección de umbrales ni entrenamiento: solo se evalúa una vez por versión.
La salida se congela con SHA-256 en docs/unified-search/stage3/criteria.json.

Formato de la etiqueta (gold):
  status   query_valid | partial | entity_lookup | clarify | unsupported | contradiction | unrecognized
  req/exc/pref  conceptos exigidos, excluidos y preferidos (ids del vocabulario 0.3.0,
                genre:<slug>, similarity:<aspecto>, decade:<década>)
  any      grupos OR (lista de listas)
  ctx      número de estados del oyente que solo son contexto
  ent      entidades [{role, kind|None, literal normalizado}]
  pending  restricciones que deben conservarse sin ejecutar (mínimo)
  alts     para clarify: alternativas aceptables (al menos una debe proponerse)
  facet    familia de faceta candidata que debe registrarse (si aplica)
"""
from __future__ import annotations
import hashlib, json, sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "docs/unified-search/stage3/datasets/query-test-reserved.json"
cases: list[dict] = []


def c(cat, text, status, req=(), exc=(), any_=(), pref=(), ctx=0, ent=(), pending=0, alts=(), facet=None, note=None):
    cases.append({"id": f"T{len(cases)+1:03d}", "category": cat, "text": text, "gold": {
        "status": status, "req": sorted(req), "exc": sorted(exc), "any": sorted(sorted(g) for g in any_),
        "pref": sorted(pref), "ctx": ctx, "ent": [dict(zip(("role", "kind", "literal"), e)) for e in ent],
        "pending": pending, "alts": sorted(alts), "facet": facet}, **({"note": note} if note else {})})


V = "query_valid"
# --- Actividad (un concepto) ---
c("activity", "algo pa' dormir", V, ["activity:sleep"])
c("activity", "música para echarme una siesta", V, ["activity:sleep"])
c("activity", "rolas para meditar en la mañana", V, ["activity:meditation"])
c("activity", "música pa echar un pie el sábado", V, ["activity:dancing"])
c("activity", "quiero algo para bailar", V, ["activity:dancing"])
c("activity", "música para ir al gimnasio", V, ["activity:exercise"])
c("activity", "canciones para salir a trotar", V, ["activity:running"])
c("activity", "algo para escuchar mientras manejo a Valencia", V, ["activity:travel"])
c("activity", "música para un road trip por los llanos", V, ["activity:travel"])
c("activity", "temas para una cena con panas", V, ["activity:socializing"])
c("activity", "música para desahogarme después de un día horrible", V, ["activity:catharsis"])
c("activity", "música para estudiar para el parcial", V, ["activity:concentration"])
c("activity", "algo para concentrarme programando", V, ["activity:concentration"])
c("activity", "música para relajarme un rato", V, ["activity:relaxation"])
c("activity", "música para hacer el amor", V, ["activity:intimacy"])
c("activity", "algo para dar un paseo por el Ávila", V, ["activity:walking"])
c("activity", "música para celebrar mi cumpleaños", V, ["activity:celebration"])
# --- Emoción (carácter pedido) ---
c("emotion", "música alegre", V, ["emotion:joyful"])
c("emotion", "canciones felices", V, ["emotion:joyful"])
c("emotion", "rock melancólico", V, ["genre:rock", "emotion:melancholic"])
c("emotion", "algo bien triste", V, ["emotion:sad"])
c("emotion", "música nostálgica de despecho", V, ["emotion:nostalgic"], pending=1, note="despecho no es concepto del vocabulario")
c("emotion", "canciones románticas", V, ["emotion:romantic"])
c("emotion", "música sensual", V, ["emotion:sensual"])
c("emotion", "algo rabioso, con rabia", V, ["emotion:angry"])
c("emotion", "música esperanzadora", V, ["emotion:hopeful"])
c("emotion", "temas eufóricos", V, ["emotion:euphoric"])
c("emotion", "música serena", V, ["emotion:serene"])
c("emotion", "algo tranquilo", V, ["emotion:serene"])
c("emotion", "música tensa, angustiante", V, ["emotion:tense"])
c("emotion", "canciones rebeldes", V, ["emotion:rebellious"])
c("emotion", "algo agridulce", V, ["emotion:bittersweet"])
c("emotion", "música solitaria", V, ["emotion:lonely"])
# --- Energía ---
c("energy", "música de energía alta", V, ["energy:energy-high"])
c("energy", "algo con mucha energía", V, ["energy:energy-high"])
c("energy", "música de intensidad baja", V, ["energy:energy-low"])
c("energy", "algo de intensidad moderada", V, ["energy:energy-medium"])
c("energy", "temas enérgicos", V, ["energy:energy-high"])
# --- Ambiente ---
c("atmosphere", "música oscura", V, ["atmosphere:dark"])
c("atmosphere", "algo sombrío", V, ["atmosphere:dark"])
c("atmosphere", "música nocturna", V, ["atmosphere:nocturnal"])
c("atmosphere", "algo etéreo", V, ["atmosphere:ethereal"])
c("atmosphere", "música onírica", V, ["atmosphere:dreamy"])
c("atmosphere", "metal épico", V, ["genre:metal", "atmosphere:epic"])
c("atmosphere", "música íntima", V, ["atmosphere:intimate"])
c("atmosphere", "algo cálido y acogedor", V, ["atmosphere:warm"])
c("atmosphere", "música fría, glacial", V, ["atmosphere:cold"])
c("atmosphere", "algo siniestro", V, ["atmosphere:ominous"])
c("atmosphere", "música misteriosa", V, ["atmosphere:mysterious"])
c("atmosphere", "música con ambiente de fiesta", V, ["atmosphere:festive"])
c("atmosphere", "música envolvente", V, ["atmosphere:atmospheric"])
c("atmosphere", "algo espacioso", V, ["atmosphere:spacious"])
# --- Temática ---
c("theme", "canciones sobre el amor", V, ["theme:love"])
c("theme", "canciones sobre una ruptura", V, ["theme:breakup"])
c("theme", "letras sobre la muerte", V, ["theme:death"])
c("theme", "canciones de protesta social", V, ["theme:politics"])
c("theme", "canciones sobre política venezolana", V, ["theme:politics"], pending=1, note="venezolana como origen queda pendiente")
c("theme", "temas sobre la guerra", V, ["theme:war"])
c("theme", "canciones sobre la naturaleza", V, ["theme:nature"])
c("theme", "canciones sobre la migración", V, ["theme:migration"])
c("theme", "letras sobre drogas", V, ["theme:substances"])
c("theme", "canciones sobre salud mental", V, ["theme:mental-health"])
c("theme", "canciones de ciencia ficción", V, ["theme:science-fiction"])
c("theme", "letras humorísticas", V, ["theme:humor"])
c("theme", "canciones sobre religión", V, ["theme:spirituality"])
c("theme", "canciones sobre la soledad", V, ["theme:loneliness"])
c("theme", "temas sobre crimen y violencia", V, ["theme:violence"])
# --- Género ---
c("genre", "black metal", V, ["genre:black-metal"])
c("genre", "rock progresivo", V, ["genre:rock-progresivo"])
c("genre", "salsa", V, ["genre:salsa"])
c("genre", "gaita", V, ["genre:gaita"])
c("genre", "joropo", V, ["genre:joropo"])
c("genre", "thrash metal", V, ["genre:thrash-metal"])
c("genre", "ska", V, ["genre:ska"])
c("genre", "música electrónica", V, ["genre:electronica"])
c("genre", "punk rock", V, ["genre:punk-rock"])
c("genre", "reggae", V, ["genre:reggae"])
c("genre", "post-rock", V, ["genre:post-rock"])
c("genre", "trip hop", V, ["genre:trip-hop"])
c("genre", "shoegaze", V, ["genre:shoegaze"])
c("genre", "hip hop", V, ["genre:hip-hop"])
c("genre", "merengue", V, ["genre:merengue"])
# --- Combinaciones Y ---
c("and", "rock para estudiar", V, ["genre:rock", "activity:concentration"])
c("and", "metal para entrenar", V, ["genre:metal", "activity:exercise"])
c("and", "salsa para bailar", V, ["genre:salsa", "activity:dancing"])
c("and", "música triste de energía baja", V, ["emotion:sad", "energy:energy-low"])
c("and", "ambient para dormir", V, ["genre:ambient", "activity:sleep"])
c("and", "jazz nocturno y melancólico", V, ["genre:jazz", "atmosphere:nocturnal", "emotion:melancholic"])
c("and", "punk rabioso sobre política", V, ["genre:punk", "emotion:angry", "theme:politics"])
c("and", "música alegre para una fiesta", V, ["emotion:joyful", "activity:celebration"])
c("and", "rock alternativo oscuro", V, ["genre:rock-alternativo", "atmosphere:dark"])
c("and", "música serena para meditar", V, ["emotion:serene", "activity:meditation"])
c("and", "canciones románticas sobre una ruptura", V, ["emotion:romantic", "theme:breakup"])
c("and", "reggae para la playa, alegre", V, ["genre:reggae", "emotion:joyful"], pending=1, note="la playa no es actividad del vocabulario")
c("and", "electrónica de energía alta para correr", V, ["genre:electronica", "energy:energy-high", "activity:running"])
c("and", "música épica y oscura", V, ["atmosphere:epic", "atmosphere:dark"])
c("and", "algo nostálgico y cálido", V, ["emotion:nostalgic", "atmosphere:warm"])
c("and", "heavy metal sobre la guerra", V, ["genre:heavy-metal", "theme:war"])
c("and", "música tranquila para leer", V, ["emotion:serene", "activity:concentration"])
c("and", "rock psicodélico para viajar", V, ["genre:rock-psicodelico", "activity:travel"])
c("and", "canciones tristes sobre la muerte", V, ["emotion:sad", "theme:death"])
c("and", "funk para bailar con energía alta", V, ["genre:funk", "activity:dancing", "energy:energy-high"])
c("and", "música misteriosa y nocturna para manejar", V, ["atmosphere:mysterious", "atmosphere:nocturnal", "activity:travel"])
c("and", "hardcore punk rabioso", V, ["genre:hardcore-punk", "emotion:angry"])
c("and", "bolero romántico", V, ["genre:bolero", "emotion:romantic"])
c("and", "trance eufórico", V, ["genre:trance", "emotion:euphoric"])
# --- Alternativas O ---
c("or", "rock o metal para entrenar", V, ["activity:exercise"], any_=[["genre:rock", "genre:metal"]])
c("or", "música alegre o eufórica", V, any_=[["emotion:joyful", "emotion:euphoric"]])
c("or", "salsa o merengue para bailar", V, ["activity:dancing"], any_=[["genre:salsa", "genre:merengue"]])
c("or", "algo para dormir o meditar", V, any_=[["activity:sleep", "activity:meditation"]])
c("or", "música melancólica o nostálgica", V, any_=[["emotion:melancholic", "emotion:nostalgic"]])
c("or", "canciones sobre política o sobre la guerra", V, any_=[["theme:politics", "theme:war"]])
c("or", "jazz o blues nocturno", V, ["atmosphere:nocturnal"], any_=[["genre:jazz", "genre:blues"]])
c("or", "ska o reggae", V, any_=[["genre:ska", "genre:reggae"]])
c("or", "música oscura o siniestra", V, any_=[["atmosphere:dark", "atmosphere:ominous"]])
c("or", "música de energía baja o media", V, any_=[["energy:energy-low", "energy:energy-medium"]])
c("or", "punk o hardcore punk sobre la sociedad", V, ["theme:society"], any_=[["genre:punk", "genre:hardcore-punk"]])
# --- Negación ---
c("negation", "música sin tristeza", V, exc=["emotion:sad"])
c("negation", "no quiero nada triste", V, exc=["emotion:sad"])
c("negation", "rock pero que no sea oscuro", V, ["genre:rock"], exc=["atmosphere:dark"])
c("negation", "música para estudiar sin rock ni metal", V, ["activity:concentration"], exc=["genre:rock", "genre:metal"])
c("negation", "canciones de amor sin carácter romántico", V, ["theme:love"], exc=["emotion:romantic"])
c("negation", "música para bailar, nada de reggaetón", V, ["activity:dancing"], exc=["genre:reggaeton"])
c("negation", "metal sin temática religiosa", V, ["genre:metal"], exc=["theme:spirituality"])
c("negation", "algo alegre pero sin energía alta", V, ["emotion:joyful"], exc=["energy:energy-high"])
c("negation", "música para dormir que no sea melancólica", V, ["activity:sleep"], exc=["emotion:melancholic"])
c("negation", "jazz excepto jazz fusión", V, ["genre:jazz"], exc=["genre:jazz-fusion"])
c("negation", "música sin letras sobre drogas", V, exc=["theme:substances"])
c("negation", "punk sin política", V, ["genre:punk"], exc=["theme:politics"])
c("negation", "música íntima para la cama, sin letras sobre sexo", V, ["atmosphere:intimate", "activity:intimacy"], exc=["theme:sexuality"])
c("negation", "nada de salsa ni merengue", V, exc=["genre:salsa", "genre:merengue"])
c("negation", "música oscura sin ser triste", V, ["atmosphere:dark"], exc=["emotion:sad"])
c("negation", "algo para correr, menos electrónica", V, ["activity:running"], exc=["genre:electronica"])
c("negation", "rock sin carácter melancólico", V, ["genre:rock"], exc=["emotion:melancholic"])
c("negation", "canciones sobre la muerte pero no tristes", V, ["theme:death"], exc=["emotion:sad"])
c("negation", "música ni tan triste", "unsupported", pending=1, note="negación atenuada")
# --- Preferencia ---
c("preference", "rock para estudiar, preferiblemente nocturno", V, ["genre:rock", "activity:concentration"], pref=["atmosphere:nocturnal"])
c("preference", "música para bailar, de preferencia salsa", V, ["activity:dancing"], pref=["genre:salsa"])
c("preference", "algo para dormir, mejor si es etéreo", V, ["activity:sleep"], pref=["atmosphere:ethereal"])
c("preference", "metal épico, ojalá sobre la guerra", V, ["genre:metal", "atmosphere:epic"], pref=["theme:war"])
c("preference", "música alegre, si es posible de energía media", V, ["emotion:joyful"], pref=["energy:energy-medium"])
c("preference", "jazz para una cena con amigos, preferiblemente cálido", V, ["genre:jazz", "activity:socializing"], pref=["atmosphere:warm"])
c("preference", "canciones de protesta, de preferencia punk", V, ["theme:politics"], pref=["genre:punk"])
# --- Estado del oyente (solo contexto) ---
c("listener", "estoy triste, ponme algo alegre", V, ["emotion:joyful"], ctx=1)
c("listener", "ando triste y quiero música que acompañe esa tristeza", V, ["emotion:sad"], ctx=1)
c("listener", "estoy cansado, necesito música para estudiar", V, ["activity:concentration"], ctx=1)
c("listener", "me siento solo, quiero algo esperanzador", V, ["emotion:hopeful"], ctx=1)
c("listener", "estoy ansioso, quiero música serena", V, ["emotion:serene"], ctx=1)
c("listener", "ando de mal humor, pon algo para bailar", V, ["activity:dancing"], ctx=1)
c("listener", "estoy feliz, quiero rock con mucha energía", V, ["genre:rock", "energy:energy-high"], ctx=1)
c("listener", "estoy triste, quiero algo para animarme", "clarify", ctx=1, alts=["emotion:joyful", "emotion:euphoric", "emotion:confident"])
c("listener", "me siento nostálgico, ponme salsa", V, ["genre:salsa"], ctx=1)
c("listener", "estoy estresado, música para relajarme", V, ["activity:relaxation"], ctx=1)
c("listener", "estoy enamorado y quiero canciones románticas", V, ["emotion:romantic"], ctx=1)
c("listener", "ando con rabia, quiero música para desahogarme", V, ["activity:catharsis"], ctx=1)
# --- Búsqueda de entidad con títulos que parecen conceptos ---
E = "entity_lookup"
c("entity", "busca la canción Soledad", E, ent=[("target", "track", "soledad")])
c("entity", "quiero la canción «Amor»", E, ent=[("target", "track", "amor")])
c("entity", "la canción Libertad", E, ent=[("target", "track", "libertad")])
c("entity", "el tema Miedo", E, ent=[("target", "track", "miedo")])
c("entity", "busca el disco Esperanza", E, ent=[("target", "album", "esperanza")])
c("entity", "canción \"Tristeza\"", E, ent=[("target", "track", "tristeza")])
c("entity", "el tema La Fiesta", E, ent=[("target", "track", "la fiesta")])
c("entity", "busca la banda Nostalgia", E, ent=[("target", "artist", "nostalgia")])
c("entity", "Exilio", E, ent=[("target", "artist", "exilio")])
c("entity", "temas de Los Amigos Invisibles", E, ent=[("target", "artist", "los amigos invisibles")])
c("entity", "Seguridad Nacional", E, ent=[("target", "artist", "seguridad nacional")])
c("entity", "discos de Desorden Público", E, ent=[("target", "artist", "desorden publico")])
c("entity", "canciones de Sentimiento Muerto", E, ent=[("target", "artist", "sentimiento muerto")])
c("entity", "La Vida Bohème", E, ent=[("target", "artist", "la vida boheme")])
c("entity", "Caramelos de Cianuro", E, ent=[("target", "artist", "caramelos de cianuro")])
c("entity", "la canción Caliente", E, ent=[("target", "track", "caliente")])
c("entity", "el disco Rabia", E, ent=[("target", "album", "rabia")])
c("entity", "Los Paranoias", E, ent=[("target", "artist", "los paranoias")])
c("entity", "busca la canción Sexo", E, ent=[("target", "track", "sexo")])
c("entity", "Témpano", E, ent=[("target", "artist", "tempano")])
c("entity", "Rawayana", E, ent=[("target", "artist", "rawayana")])
c("entity", "el tema Fuego", E, ent=[("target", "track", "fuego")])
c("entity", "la canción La Noche", E, ent=[("target", "track", "la noche")])
# --- Parecido ---
c("similarity", "algo parecido a Desorden Público", V, ["similarity:overall"], ent=[("reference", "artist", "desorden publico")])
c("similarity", "bandas como Los Paranoias", V, ["similarity:overall"], ent=[("reference", "artist", "los paranoias")])
c("similarity", "música similar a Arca", V, ["similarity:overall"], ent=[("reference", "artist", "arca")])
c("similarity", "parecido a Témpano en las guitarras", V, ["similarity:guitars"], ent=[("reference", "artist", "tempano")])
c("similarity", "algo parecido a Arca en la voz", V, ["similarity:voice"], ent=[("reference", "artist", "arca")])
c("similarity", "parecido a Viniloversus en la producción", V, ["similarity:production"], ent=[("reference", "artist", "viniloversus")])
c("similarity", "como Rawayana pero más triste", "partial", ["similarity:overall"], ent=[("reference", "artist", "rawayana")], pending=1, note="comparativo «más triste» no representable")
c("similarity", "al estilo de Los Mesoneros", V, ["similarity:overall"], ent=[("reference", "artist", "los mesoneros")])
c("similarity", "algo parecido a Aditus para bailar", V, ["similarity:overall", "activity:dancing"], ent=[("reference", "artist", "aditus")])
# --- Restricciones no representables ---
P, U = "partial", "unsupported"
c("unsupported", "música a 120 BPM para correr", P, ["activity:running"], pending=1)
c("unsupported", "canciones rojas para viajar", P, ["activity:travel"], pending=1)
c("unsupported", "música sin voces para dormir", P, ["activity:sleep"], pending=1)
c("unsupported", "rock grabado en vivo", P, ["genre:rock"], pending=1)
c("unsupported", "canciones acústicas", U, pending=1)
c("unsupported", "música con voz femenina", U, pending=1)
c("unsupported", "canciones de menos de tres minutos", U, pending=1)
c("unsupported", "música en 7/8", U, pending=1)
c("unsupported", "canciones que suenen a domingo en la tarde", U, pending=1)
c("unsupported", "rock con guitarra fuzz", P, ["genre:rock"], pending=1, facet="candidate:timbre.fuzz")
c("unsupported", "algo lo-fi para estudiar", P, ["activity:concentration"], pending=1, facet="candidate:production.fidelity-aesthetic")
c("unsupported", "un disco conceptual que cuente una historia", U, pending=1, facet="candidate:structure.narrative")
c("unsupported", "temas con samples y collage de sonidos", U, pending=1, facet="candidate:production.sources")
c("unsupported", "música con la voz enterrada en la mezcla", U, pending=1, facet="candidate:vocals.prominence")
c("unsupported", "canciones rapeadas", U, pending=1, facet="candidate:vocals.mode")
c("unsupported", "un disco que gane con escuchas", U, pending=1, facet="candidate:reception.acclimatization")
c("unsupported", "temas de corrido, sin cortes entre canciones", U, pending=1, facet="candidate:structure.continuity")
c("unsupported", "música alegre con letras sobre nostalgia", P, ["emotion:joyful"], pending=1)
c("unsupported", "canciones cuya letra trate de fiestas", U, pending=1)
# --- Década (filtro de publicación del disco) ---
c("decade", "rock melancólico de los noventa", V, ["genre:rock", "emotion:melancholic", "decade:1990s"])
c("decade", "salsa de los setenta", V, ["genre:salsa", "decade:1970s"])
c("decade", "metal de los 80", V, ["genre:metal", "decade:1980s"])
c("decade", "música para bailar de los 2000", V, ["activity:dancing", "decade:2000s"])
# --- Aclarar ---
C = "clarify"
c("clarify", "música caliente", C, alts=["emotion:sensual", "atmosphere:warm", "energy:energy-high"])
c("clarify", "algo para aumentar mi aura", C, alts=["emotion:confident", "atmosphere:epic", "energy:energy-high"])
c("clarify", "sexo", C, alts=["activity:intimacy", "theme:sexuality"])
c("clarify", "música para recordar", C, alts=["emotion:nostalgic", "theme:history"])
c("clarify", "rock y triste o alegre", C)
c("clarify", "psicodélico", C, alts=["genre:rock-psicodelico", "atmosphere:psychedelic"])
c("clarify", "nostalgia", C, alts=["emotion:nostalgic"], ent=[("target", None, "nostalgia")], note="también es banda y título")
c("clarify", "música sobre amor o para amar", C, alts=["theme:love", "emotion:romantic", "activity:intimacy"])
c("clarify", "algo para animarme", C, alts=["emotion:joyful", "emotion:euphoric", "emotion:confident"])
c("clarify", "música intensa", C, alts=["energy:energy-high", "emotion:tense"])
c("clarify", "(rock para estudiar) o (ska para bailar)", C, note="DNF no representable en intention-v1")
# --- Contradicciones ---
K = "contradiction"
c("contradiction", "música triste y sin tristeza", K)
c("contradiction", "música de energía alta y energía baja", K)
c("contradiction", "rock pero sin rock", K)
c("contradiction", "algo alegre que no sea alegre", K)
c("contradiction", "música para dormir, de intensidad alta y de intensidad baja", K)
# --- Género por descripción (propuestas del mapa, nunca filtro) ---
D = "clarify"
c("described", "guitarras con trémolo, voces rasgadas y gritadas, sonido crudo", D, alts=["genre:black-metal", "genre:raw-black-metal", "genre:black-metal-atmosferico", "genre:black-metal-depresivo"], note="descripción de rasgos")
c("described", "arpa, cuatro y maracas llaneras", D, alts=["genre:joropo", "genre:golpe-llanero", "genre:pasaje", "genre:musica-tradicional"])
c("described", "furro, charrasca y tambora en diciembre", D, alts=["genre:gaita", "genre:gaita-de-furro"])
c("described", "canciones cortas, rápidas y crudas con tres acordes", D, alts=["genre:punk", "genre:punk-rock", "genre:hardcore-punk", "genre:street-punk", "genre:raw-punk"])
c("described", "piano, congas, timbales y metales con montuno", D, alts=["genre:salsa", "genre:timba", "genre:son", "genre:mambo", "genre:guaguanco"])
c("described", "bajo pesado, ritmos quebrados a mucha velocidad y breaks", D, alts=["genre:drum-and-bass"])
c("described", "capas de guitarras con mucha distorsión y voces sumergidas", D, alts=["genre:shoegaze", "genre:dream-pop"])
c("described", "riffs lentos y muy pesados, afinación baja", D, alts=["genre:doom-metal", "genre:sludge-metal", "genre:stoner-metal", "genre:drone-metal"])
c("described", "guitarra rasgueada y voz que cuenta historias", D, alts=["genre:cantautor", "genre:folk", "genre:nueva-cancion", "genre:nueva-trova"])
c("described", "beats lentos, scratches y samples de jazz", D, alts=["genre:trip-hop", "genre:boom-bap", "genre:jazz-rap", "genre:downtempo"])
c("described", "sintetizadores fríos y caja de ritmos de los ochenta", D, alts=["genre:synth-pop", "genre:coldwave", "genre:darkwave", "genre:new-wave"])
c("described", "tambores afrovenezolanos de San Juan", D, alts=["genre:tambor-afrovenezolano"])
c("described", "riffs rápidos y palm mute, voces agresivas, velocidad", D, alts=["genre:thrash-metal", "genre:speed-metal", "genre:crossover-thrash"])
# --- Otros idiomas ---
c("multilingual", "music to study", V, ["activity:concentration"])
c("multilingual", "sad songs", V, ["emotion:sad"])
c("multilingual", "dark ambient for sleeping", V, ["genre:dark-ambient", "activity:sleep"])
c("multilingual", "happy music for a party", V, ["emotion:joyful", "activity:celebration"])
c("multilingual", "songs about war", V, ["theme:war"])
# --- Ruido y vacío ---
c("noise", "asdkjh qwe", "unrecognized")
c("noise", "música", "unrecognized")
c("noise", "algo bueno", "unrecognized", pending=1, note="valoración sin criterio representable")

for case in cases:
    case["split"] = "test_reserved"
    case["author"] = "Claude (encargo de Brian, 2026-10-25)"
body = {"version": "crv-query-test-reserved-1.0.0", "authoredAt": "2026-10-25",
        "authoredBefore": "léxico, segmentador, preguntas y modelos de la etapa 3",
        "policy": "Prueba final reservada: no se usa para desarrollo, reglas, umbrales ni entrenamiento.",
        "cases": cases}
text = json.dumps(body, ensure_ascii=False, indent=1) + "\n"
OUT.write_text(text)
print(len(cases), hashlib.sha256(text.encode()).hexdigest())
