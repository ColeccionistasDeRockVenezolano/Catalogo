#!/usr/bin/env python3
"""Léxico de consultas de la etapa 3 (crv-query-lexicon).

Fuentes, sin alterarlas:
  - reports/unified-search-stage2/vocabulary.json (64 conceptos y 22 facetas, alias revisados)
  - reports/unified-search-stage2/genre-map.json (definiciones y rasgos del mapa 0.17.0)
  - ingest.genres + ingest.genre_aliases exportados (argumento 1, JSON)
Añadidos propios (ADDITIONS): flexiones, verbos, formas venezolanas e inglés. Son
candidatos léxicos para proponer fragmentos; nunca deciden por sí solos: Laya
elige entre candidatos y el compilador valida. No crean conceptos ni géneros.
"""
from __future__ import annotations
import hashlib, json, re, sys, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/unified-search/stage3/query-lexicon.json"
VOCAB = ROOT / "reports/unified-search-stage2/vocabulary.json"
GENRE_MAP = ROOT / "reports/unified-search-stage2/genre-map.json"


def norm(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[^a-z0-9ñ'\s-]", " ", text.replace("ñ", "ñ"))
    text = text.replace("-", " ").replace("'", " ")
    return re.sub(r"\s+", " ", text).strip()


# Concepto -> alias añadidos. Los temas se marcan aparte (requieren señal temática).
ADDITIONS: dict[str, list[str]] = {
    "activity:concentration": ["concentrarse", "concentrar", "estudiando", "estudio", "trabajando", "leyendo", "programando", "study", "studying", "focus", "to study"],
    "activity:relaxation": ["relajarse", "relajar", "relax", "descanso", "relaxing", "to relax"],
    "activity:celebration": ["fiestas", "rumbear", "rumbeo", "celebrar", "party", "a party", "cumpleanos"],
    "activity:sleep": ["siesta", "echarme una siesta", "sleep", "sleeping", "to sleep"],
    "activity:meditation": ["meditando", "meditation", "to meditate"],
    "activity:dancing": ["echar pie", "bailar", "bailando", "to dance", "dancing"],
    "activity:exercise": ["gym", "ejercicio", "ejercitarse", "entrenando", "workout", "to work out"],
    "activity:running": ["trotando", "corriendo", "running", "to run"],
    "activity:walking": ["paseo", "caminando", "paseando", "walking"],
    "activity:travel": ["manejar", "manejo", "manejando", "conducir", "conduciendo", "carretera", "viaje", "driving", "travel", "traveling"],
    "activity:intimacy": ["tener sex", "sex", "making love"],
    "activity:socializing": ["una cena", "cena", "reunion", "reunion con amigos", "panas", "con panas", "con amigos", "charlar", "conversar"],
    "activity:catharsis": ["desahogarse", "desahogo", "llorar", "gritar"],
    "emotion:joyful": ["alegres", "felices", "contentas", "contentos", "happy", "joyful"],
    "emotion:melancholic": ["melancolicos", "melancolicas", "melancholic"],
    "emotion:tense": ["tensos", "tensas", "angustiantes", "tense"],
    "emotion:serene": ["serenos", "serenas", "tranquilos", "tranquilas", "calmado", "calmada", "calm", "serene"],
    "emotion:sad": ["sad", "tristona"],
    "emotion:nostalgic": ["nostalgicos", "nostalgicas", "nostalgic"],
    "emotion:romantic": ["romanticos", "romanticas", "romantic"],
    "emotion:sensual": ["sensuales", "eroticos", "eroticas", "sexy", "sensual"],
    "emotion:angry": ["rabiosos", "rabiosas", "furiosos", "furiosas", "angry", "con rabia", "de caracter furioso"],
    "emotion:hopeful": ["esperanzadores", "esperanzadoras", "optimistas", "hopeful"],
    "emotion:euphoric": ["euforicos", "euforicas", "euphoric"],
    "emotion:confident": ["poderoso", "poderosa", "empoderado", "empoderada"],
    "emotion:lonely": ["solitarios", "solitarias", "lonely"],
    "emotion:rebellious": ["rebeldes", "rebellious"],
    "emotion:bittersweet": ["agridulces", "bittersweet"],
    "energy:energy-low": ["poca energia", "baja energia", "de energia baja", "low energy"],
    "energy:energy-medium": ["energia moderada", "intensidad moderada", "medium energy"],
    "energy:energy-high": ["energeticos", "energeticas", "energicos", "energicas", "alta energia", "high energy", "energetic"],
    "atmosphere:atmospheric": ["envolventes", "atmosfericos", "atmosfericas", "atmospheric"],
    "atmosphere:dark": ["oscuros", "oscuras", "sombrios", "sombrias", "dark"],
    "atmosphere:nocturnal": ["nocturnos", "nocturnas", "nocturnal"],
    "atmosphere:ethereal": ["etereos", "etereas", "ethereal"],
    "atmosphere:dreamy": ["oniricos", "oniricas", "dreamy"],
    "atmosphere:epic": ["epicos", "epicas", "epic"],
    "atmosphere:intimate": ["intimos", "intimas", "intimate"],
    "atmosphere:warm": ["calidos", "calidas", "acogedores", "acogedoras", "warm"],
    "atmosphere:cold": ["frios", "frias", "glaciales", "cold"],
    "atmosphere:ominous": ["amenazantes", "siniestros", "siniestras", "inquietantes", "ominous"],
    "atmosphere:mysterious": ["misteriosos", "misteriosas", "enigmaticos", "enigmaticas", "mysterious"],
    "atmosphere:psychedelic": ["psicodelico", "psicodelica", "psicodelicos", "psicodelicas", "psychedelic"],
    "atmosphere:festive": ["festivos", "festivas", "festive"],
    "atmosphere:spacious": ["espaciosos", "espaciosas", "spacious"],
}
# Sustantivos temáticos: solo son candidatos tras una señal temática (THEME_CUES).
THEME_NOUNS: dict[str, list[str]] = {
    "theme:love": ["amor", "el amor", "love"],
    "theme:breakup": ["ruptura", "una ruptura", "desamor", "despecho", "breakup", "heartbreak"],
    "theme:sexuality": ["sexo", "sexualidad", "sex"],
    "theme:death": ["muerte", "la muerte", "duelo", "luto", "death"],
    "theme:society": ["sociedad", "la sociedad", "critica social", "la vida cotidiana"],
    "theme:politics": ["politica", "la politica", "protesta", "protesta social", "politics"],
    "theme:war": ["guerra", "la guerra", "lo belico", "belica", "belico", "war"],
    "theme:spirituality": ["religion", "la religion", "espiritualidad", "dios", "fe", "religiosa", "religion and faith"],
    "theme:nature": ["naturaleza", "la naturaleza", "nature"],
    "theme:identity": ["identidad", "raices", "raices culturales", "pertenencia"],
    "theme:migration": ["migracion", "la migracion", "exilio", "el exilio", "diaspora", "emigrar", "la diaspora", "migration"],
    "theme:loneliness": ["soledad", "la soledad", "aislamiento", "loneliness"],
    "theme:mental-health": ["salud mental", "depresion", "ansiedad", "mental health"],
    "theme:fantasy": ["fantasia", "mitologia", "seres mitologicos", "fantasy"],
    "theme:science-fiction": ["ciencia ficcion", "el futuro", "science fiction"],
    "theme:violence": ["violencia", "crimen", "crimen y violencia", "violence", "crime"],
    "theme:substances": ["drogas", "alcohol", "sustancias", "drugs"],
    "theme:history": ["historia", "la historia", "memoria historica", "history"],
    "theme:humor": ["humor", "satira", "humoristicas", "humoristicos", "humor"],
}
# Alias de género demasiado genéricos o rotos en el registro para proponer un fragmento.
GENRE_ALIAS_DENY = {"wave", "tracker", "sequencer", "jerk", "tread", "vapor", "mashup", "big music", "no melody",
                    "batida", "weightless", "drumless", "instrumental", "musica venezolana", "venezolana",
                    "musica", "latin", "pop rap"}

# Expresiones ambiguas del diccionario 0.1.0 (ambiguousExpressions) y de la matriz
# de desarrollo (Q129). Sin señal sintáctica son candidatas múltiples: Laya decide
# o el compilador pide aclarar.
AMBIGUOUS: dict[str, list[str]] = {
    "aumentar mi aura": ["emotion:confident", "atmosphere:epic", "energy:energy-high"],
    "aura": ["emotion:confident", "atmosphere:epic", "energy:energy-high"],
    "caliente": ["emotion:sensual", "atmosphere:warm", "energy:energy-high"],
    "calientes": ["emotion:sensual", "atmosphere:warm", "energy:energy-high"],
    "hot": ["emotion:sensual", "atmosphere:warm", "energy:energy-high"],
    "para recordar": ["emotion:nostalgic", "theme:history"],
    "recordar": ["emotion:nostalgic", "theme:history"],
    "sexo": ["activity:intimacy", "theme:sexuality"],
    "amor": ["theme:love", "emotion:romantic", "activity:intimacy"],
    "para amar": ["emotion:romantic", "activity:intimacy"],
    "soledad": ["theme:loneliness", "emotion:lonely"],
    "psicodelico": ["atmosphere:psychedelic", "genre:rock-psicodelico"],
    "psicodelica": ["atmosphere:psychedelic", "genre:rock-psicodelico"],
    "animarme": ["emotion:joyful", "emotion:euphoric", "emotion:confident"],
    "para animarme": ["emotion:joyful", "emotion:euphoric", "emotion:confident"],
}

MARKERS = {
    "negation": ["sin", "ni", "no quiero", "nada de", "que no sea", "que no sean", "excepto", "menos", "sin ser", "pero no", "no", "without", "no quiero nada", "nada"],
    "or": ["o", "u", "or"],
    "and": ["y", "e", "and", "con"],
    "preference": ["preferiblemente", "de preferencia", "mejor si es", "mejor si son", "mejor si", "ojala", "si es posible", "idealmente", "preferably", "ideally"],
    "boundary": ["pero", "aunque", "but"],
    "listener": ["estoy", "ando", "me siento", "me encuentro", "i am", "im", "i feel"],
    "listenerEnd": ["quiero", "pon", "ponme", "necesito", "dame", "busco", "y quiero", "pero quiero", "recomiendame"],
    "themeCues": ["sobre", "acerca de", "que hablen de", "que hable de", "que traten de", "que trate de", "letras sobre", "letras de", "letra sobre", "tematica", "de tematica", "temas sobre", "canciones sobre", "about", "songs about", "cuya letra trate de", "cuya letra trata de", "cuya letra trata sobre", "que trata de", "que trata sobre", "que traten sobre", "que hablen sobre", "traten de", "trata de", "trata sobre", "con letras sobre", "con letras de", "de protesta", "de tematica", "lyrics about"],
    "entityCues": {"track": ["la cancion", "el tema", "la pista", "cancion", "el track", "the song", "song"],
                   "album": ["el disco", "el album", "el lp", "el ep", "disco", "album", "the album"],
                   "artist": ["la banda", "el grupo", "el artista", "la artista", "el cantante", "la cantante", "banda", "grupo", "artista", "the band"]},
    "ownerCues": ["temas de", "canciones de", "discos de", "albumes de", "musica de", "songs by", "lo nuevo de"],
    "similarityCues": ["parecido a", "parecida a", "parecidos a", "parecidas a", "similar a", "similares a", "al estilo de", "estilo de", "que suene como", "que suene a", "similar to", "like"],
    "similarityWeakCues": ["como", "tipo"],
    "aspects": {"guitars": ["las guitarras", "la guitarra", "guitarras", "guitarra"], "voice": ["la voz", "las voces", "voz", "voces", "el canto"],
                "production": ["la produccion", "produccion", "el sonido"], "composition": ["la composicion", "composicion", "las letras", "letras"],
                "atmosphere": ["el ambiente", "ambiente", "la atmosfera"]},
    "origins": sorted(set("""venezuela venezolano venezolana venezolanos venezolanas criollo criolla criollos criollas colombia colombiano colombiana colombianos colombianas
ecuador ecuatoriano ecuatoriana ecuatorianos ecuatorianas peru peruano peruana peruanos peruanas chile chileno chilena chilenos chilenas argentina argentino argentinos argentinas
uruguay uruguayo uruguaya uruguayos uruguayas paraguay paraguayo paraguaya bolivia boliviano boliviana bolivianos bolivianas brasil brasileno brasilena brasilenos brasilenas
mexico mexicano mexicana mexicanos mexicanas cuba cubano cubana cubanos cubanas puerto rico puertorriqueno puertorriquena boricua boricuas dominicana dominicano dominicanos dominicanas
panama panameno panamena costa rica costarricense guatemala guatemalteco honduras hondureno nicaragua nicaraguense salvador salvadoreno
espana espanol espanola espanoles espanolas gringo gringa gringos gringas estadounidense estadounidenses usa eeuu estados unidos inglaterra ingles inglesa ingleses britanico britanica britanicos
francia frances francesa franceses alemania aleman alemana alemanes italia italiano italiana italianos japon japones japonesa japoneses noruega noruego noruega noruegos suecia sueco sueca suecos finlandia finlandes
caracas caraqueno caraquena caraquenos maracaibo maracucho maracucha maracuchos zulia zuliano zuliana valencia carabobeno barquisimeto larense larenses guaro guara guaros merida merideno merida andino andina andinos
oriente oriental orientales llanero llanera llaneros llanos margarita margariteno margaritena barlovento falcon coro tachira tachirense maracay aragueno lecheria puerto la cruz ciudad bolivar
bogota medellin lima montevideo quito guayaquil habana madrid barcelona londres""".split()) - {"la", "puerto", "rico", "cruz", "ciudad", "costa", "rica", "estados", "unidos", "salvador", "margarita"}),
    "fillerIdioms": ["sin parar", "sin cesar", "sin descanso", "no recuerdo", "no me acuerdo", "no se", "no importa", "casi no importa", "no se como se llama"],
    "comparatives": ["mas", "menos", "more", "less"],
    "attenuators": ["ni tan", "no tan", "no muy", "medio", "un poco", "not too"],
    "clauseStarts": ["para", "pa", "pal", "for"],
    "decades": {"1950s": ["cincuenta", "50", "50s"], "1960s": ["sesenta", "60", "60s"], "1970s": ["setenta", "70", "70s"],
                "1980s": ["ochenta", "80", "80s"], "1990s": ["noventa", "90", "90s"], "2000s": ["2000", "dos mil", "2000s"], "2010s": ["2010", "2010s"]},
    "fillers": "musica musicas musical cancion canciones tema temas rola rolas pieza piezas algo cosas cosa song songs music tracks quiero quisiera necesito busco buscar busca dame ponme pon recomiendame recomienda recomiendan escuchar oir para pa por de del la el las los lo un una unos unas al a en que sea sean bien full bastante muy mi me ahora favor porfa rato un rato mientras alguna algun buena buenas bueno buenos tipo for the to of some please i want with mas caracter de caracter ambiente atmosfera estilo onda vibra vibras".split(),
}


def main(genres_path: str) -> None:
    vocab = json.loads(VOCAB.read_text())
    gmap = {g["slug"]: g for g in json.loads(GENRE_MAP.read_text())["genres"]}
    genres_db = json.loads(Path(genres_path).read_text())
    concepts = []
    for c in vocab["concepts"]:
        if c["dimension"] == "theme":
            aliases = sorted({norm(a) for a in c["aliasesEs"]})
            nouns = sorted({norm(a) for a in THEME_NOUNS.get(c["id"], [])})
        else:
            aliases = sorted({norm(a) for a in c["aliasesEs"] + ADDITIONS.get(c["id"], [])})
            nouns = []
        concepts.append({"id": c["id"], "dimension": c["dimension"], "labelEs": c["labelEs"], "definitionEs": c["definitionEs"],
                         "aliases": aliases, "themeNouns": nouns})
    facets = [{"id": f["id"], "aliases": sorted({norm(a) for a in f["aliasesEs"]}), "definition": f["definition"]} for f in vocab["facets"]]
    genres = []
    for g in genres_db:
        m = gmap.get(g["slug"], {})
        aliases = {norm(g["name"]), norm(g["slug"])}
        aliases |= {norm(a) for a in g["aliases"] if not re.search(r"[\[\]()/]", a)}
        aliases = sorted(a for a in aliases if a and a not in GENRE_ALIAS_DENY and len(a) >= 3)
        traits = [{"aspect": ch["aspect"], "description": ch["description"]} for ch in m.get("characteristics", [])]
        genres.append({"slug": g["slug"], "name": g["name"], "level": g["level"], "parentId": g["parent_genre_id"],
                       "definition": m.get("description") or m.get("proposedDefinition"), "traits": traits,
                       "mapStatus": m.get("descriptionStatus"), "aliases": aliases})
    sources = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (VOCAB, GENRE_MAP)}
    sources["genres-db-export"] = hashlib.sha256(Path(genres_path).read_bytes()).hexdigest()
    body = {"version": "crv-query-lexicon-0.2.0", "builtBy": "scripts/stage3/build_query_lexicon.py", "vocabularyVersion": vocab["version"],
            "genreMapVersion": json.loads(GENRE_MAP.read_text())["version"], "sources": sources,
            "policy": "Candidatos léxicos para proponer fragmentos; no deciden, no asignan atributos ni crean géneros o conceptos.",
            "concepts": concepts, "facets": facets, "genres": genres,
            "ambiguous": [{"phrase": k, "candidates": v} for k, v in AMBIGUOUS.items()], "markers": MARKERS}
    OUT.write_text(json.dumps(body, ensure_ascii=False, indent=1) + "\n")
    print(len(concepts), len(facets), len(genres), sum(len(g["aliases"]) for g in genres))


if __name__ == "__main__":
    main(sys.argv[1])
