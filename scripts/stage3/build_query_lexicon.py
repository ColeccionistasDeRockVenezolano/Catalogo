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
    "activity:concentration": ["concentrarse", "concentrar", "estudiando", "estudio", "trabajando", "leyendo", "programando", "study", "studying", "focus", "to study", "work", "working"],
    "activity:relaxation": ["relajante", "relajantes", "relajarse", "relajar", "relax", "descanso", "relaxing", "to relax", "unwind"],
    "activity:celebration": ["fiestas", "rumbear", "rumbeo", "celebrar", "party", "a party", "cumpleanos"],
    "activity:sleep": ["quedarme dormido", "quedarse dormido", "dormirme", "siesta", "echarme una siesta", "sleep", "sleeping", "to sleep"],
    "activity:meditation": ["meditando", "meditation", "to meditate"],
    "activity:dancing": ["bailable", "bailables", "echar pie", "bailar", "bailando", "to dance", "dancing", "dance"],
    "activity:exercise": ["pesas", "rutina de pesas", "precalentar", "gym", "ejercicio", "ejercitarse", "entrenando", "workout", "to work out",
                         "spinning", "clase de spinning", "zumba", "crossfit", "pilates", "aerobicos", "cardio"],
    "activity:running": ["trotando", "corriendo", "running", "to run", "run", "jogging", "morning run"],
    "activity:walking": ["paseo", "caminando", "paseando", "walking", "pasear al perro", "sacar al perro", "pasear el perro"],
    "activity:travel": ["manejar", "manejo", "manejando", "conducir", "conduciendo", "carretera", "viaje", "driving", "travel", "traveling", "drive", "long drive", "the drive", "commute",
                        # 1.5.0 (desarrollo: F034, F099, F141 de 5.0.0)
                        "carro", "el carro", "en el carro", "paseo en carro"],
    "activity:intimacy": ["tener sex", "sex", "making love"],
    "activity:socializing": ["una cena", "cena", "cenar", "cenando", "reunion", "reunion con amigos", "panas", "con panas", "con amigos", "charlar", "conversar", "dinner", "barbecue", "bbq", "hanging out", "hangout"],
    "activity:catharsis": ["desahogarse", "desahogo", "llorar", "gritar"],
    "emotion:joyful": ["alegres", "felices", "contentas", "contentos", "happy", "joyful"],
    "emotion:melancholic": ["melancolicos", "melancolicas", "melancholic"],
    "emotion:tense": ["tensos", "tensas", "angustiantes", "tense"],
    "emotion:serene": ["serenos", "serenas", "tranquilos", "tranquilas", "calmado", "calmada", "calm", "serene"],
    "emotion:sad": ["sad", "tristona"],
    "emotion:nostalgic": ["nostalgicos", "nostalgicas", "nostalgic"],
    "emotion:romantic": ["romanticos", "romanticas", "romantic"],
    "emotion:sensual": ["sensuales", "eroticos", "eroticas", "sexy", "sensual"],
    "emotion:angry": ["odio", "rabiosos", "rabiosas", "furiosos", "furiosas", "angry", "con rabia", "de caracter furioso"],
    "emotion:hopeful": ["esperanzadores", "esperanzadoras", "optimistas", "hopeful"],
    "emotion:euphoric": ["euforicos", "euforicas", "euphoric"],
    "emotion:confident": ["confianza", "poderoso", "poderosa", "empoderado", "empoderada"],
    "emotion:lonely": ["solitarios", "solitarias", "lonely"],
    "emotion:rebellious": ["rebeldes", "rebellious"],
    "emotion:bittersweet": ["agridulces", "bittersweet"],
    "energy:energy-low": ["poca energia", "baja energia", "de energia baja", "low energy", "con energia baja", "con poca energia"],
    "energy:energy-medium": ["energia moderada", "intensidad moderada", "medium energy", "con energia media"],
    "energy:energy-high": ["movido", "movida", "movidos", "movidas", "movidito", "movidita", "energeticos", "energeticas", "energicos", "energicas", "alta energia", "high energy", "energetic",
                           # 1.4.0 (desarrollo: S016, S072 de 4.0.0): «con energía» sin nivel es energía alta; el nivel explícito gana por longitud.
                           "con energia", "con mucha energia", "con energia alta",
                           # 1.5.0 (desarrollo: F033, F065, F073 de 5.0.0): intensificadores coloquiales.
                           "mucha potencia", "con mucha potencia", "mucho ritmo", "con mucho ritmo", "rapido y fuerte", "rapidos y fuertes", "rapida y fuerte", "rapidas y fuertes", "a todo dar"],
    "atmosphere:atmospheric": ["envolventes", "atmosfericos", "atmosfericas", "atmospheric"],
    "atmosphere:dark": ["oscuros", "oscuras", "sombrios", "sombrias", "dark", "oscuridad"],
    "atmosphere:nocturnal": ["madrugada", "de madrugada", "nocturnos", "nocturnas", "nocturnal"],
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
    "theme:breakup": ["ruptura amorosa", "ruptura", "una ruptura", "desamor", "despecho", "breakup", "heartbreak"],
    "theme:sexuality": ["sexo", "sexualidad", "sex", "erotico", "erotica", "eroticos", "eroticas", "erotismo", "sexual", "sexuales"],
    "theme:death": ["muerte", "la muerte", "duelo", "luto", "death"],
    "theme:society": ["sociedad", "la sociedad", "critica social", "la vida cotidiana"],
    "theme:politics": ["politica", "la politica", "protesta", "protesta social", "politics"],
    "theme:war": ["guerra", "la guerra", "lo belico", "belica", "belico", "war"],
    "theme:spirituality": ["religion", "la religion", "espiritualidad", "dios", "fe", "religiosa", "religion and faith"],
    "theme:nature": ["naturaleza", "la naturaleza", "nature"],
    "theme:identity": ["identidad", "raices", "raices culturales", "pertenencia"],
    "theme:migration": ["migracion", "la migracion", "exilio", "el exilio", "diaspora", "emigrar", "la diaspora", "migration", "emigracion", "la emigracion", "emigrantes", "migrantes"],
    "theme:loneliness": ["soledad", "la soledad", "aislamiento", "loneliness"],
    "theme:mental-health": ["salud mental", "depresion", "ansiedad", "mental health"],
    "theme:fantasy": ["fantasia", "mitologia", "seres mitologicos", "fantasy"],
    "theme:science-fiction": ["ciencia ficcion", "el futuro", "science fiction", "futuro", "tecnologia", "la tecnologia", "robots"],
    "theme:violence": ["violencia", "crimen", "crimen y violencia", "violence", "crime"],
    "theme:substances": ["drogas", "alcohol", "sustancias", "drugs"],
    "theme:history": ["historia", "la historia", "memoria historica", "history"],
    "theme:humor": ["humor", "satira", "humoristicas", "humoristicos", "humor"],
}
# Alias adjetivales de temas: no exigen señal temática («canciones satíricas»).
THEME_ALIASES: dict[str, list[str]] = {
    "theme:humor": ["satirico", "satirica", "satiricos", "satiricas", "humoristico", "humoristica", "humoristicos", "humoristicas", "jocoso", "jocosas", "jocosos", "comico", "comica", "comicos", "comicas"],
    "theme:spirituality": ["religioso", "religiosa", "religiosos", "religiosas", "espiritual", "espirituales"],
    "theme:politics": ["politica", "politico", "politicas", "politicos", "de protesta", "protesta", "protesta social", "contestataria", "contestatarias", "contestatario", "contestatarios"],
}

# Paráfrasis frecuentes de las familias de rasgos técnicos (no amplían el vocabulario de facetas).
FACET_ADDITIONS: dict[str, list[str]] = {
    "candidate:production.sources": ["samples", "sampleos", "sampleado", "sampleados", "grabaciones de campo", "field recordings", "sonidos encontrados", "collage", "collages"],
    "candidate:vocals.mode": ["rapeadas", "rapee", "rapeen", "rapear", "rapeada", "rapeados", "voz recitada", "recitado", "voces habladas"],
    "candidate:vocals.prominence": ["voz al fondo", "voz muy al fondo", "voz al fondo de la mezcla", "voz muy al fondo de la mezcla", "voz enterrada en la mezcla", "voz baja en la mezcla"],
    "candidate:structure.continuity": ["sin pausas", "sin pausas entre los temas", "sin pausas entre temas", "sin silencios entre los temas", "temas enlazados", "enlazados", "sin interrupciones", "de un tiron",
                                       # 1.4.0: flexiones (desarrollo: S169 de 3.0.0, S164 de 4.0.0)
                                       "enlazadas", "canciones enlazadas", "van enlazadas", "un solo viaje", "como un solo viaje", "de corrido"],
    "candidate:reception.acclimatization": ["mejore con cada escucha", "mejora con cada escucha", "mejoran con cada escucha", "gana con cada escucha", "crece con cada escucha", "crece con las escuchas", "gane con escuchas", "gane con las escuchas",
                                           "ganan con cada escucha", "ganan con las escuchas", "crecen con cada escucha"],
    "candidate:structure.narrative": ["album conceptual", "cuenta una historia", "cuente una historia", "cuenten una historia", "cuentan una historia",
                                     "que cuente una historia", "que cuenten una historia", "una historia completa", "albumes conceptuales", "disco conceptual", "discos conceptuales", "conceptual", "conceptuales"],
}

# Variantes de género y número (y aumentativo/diminutivo afectivo) de los alias de una palabra
# de emoción, ambiente y energía: «enigmática» ← «enigmaticos», «alegrón» ← «alegre».
def inflections(word: str, dimension: str) -> set[str]:
    if " " in word or len(word) < 5 or not word.isalpha():
        return set()
    out: set[str] = set()
    for suf, stem_len in (("os", 2), ("as", 2), ("o", 1), ("a", 1)):
        if word.endswith(suf):
            stem = word[:-stem_len]
            out |= {stem + "o", stem + "a", stem + "os", stem + "as"}
            break
    else:
        if word.endswith("es") and not word.endswith("ses"):
            out |= {word[:-1]}
        elif word.endswith("e"):
            out |= {word + "s"}
    if dimension == "emotion" and word.endswith(("e", "o", "a")):
        stem = word[:-1]
        out |= {stem + "on", stem + "ona", stem + "ones", stem + "onas", stem + "ito", stem + "ita", stem + "itos", stem + "itas"}
    return out - {word}

SOUND_WORDS = """guitarra guitarras piano pianos saxofon saxofones saxo bateria baterias cuerdas violin violines flauta flautas arpa arpas
trompeta trompetas acordeon acordeones sintetizador sintetizadores teclado teclados tambor tambores percusion contrabajo cello chelo clarinete
voz voces""".split()
ATTRIBUTE_WORDS = """guitarra guitarras piano pianos saxofon saxofones saxo bateria baterias cuerdas violin violines flauta flautas arpa arpas
trompeta trompetas acordeon acordeones sintetizador sintetizadores teclado teclados tambor tambores percusion contrabajo cello chelo clarinete
voz voces cantante cantantes vocalista acapela bpm minuto minutos segundos duren dure duracion compas idioma espanol ingles portugues frances italiano aleman japones
english vieja viejas viejo viejos viejita viejitas viejito viejitos antigua antiguas antiguo antiguos epoca conocida conocidas conocido conocidos
famosa famosas famoso famosos popular populares desconocida desconocidas desconocido desconocidos""".split()

# Alias de género demasiado genéricos o rotos en el registro para proponer un fragmento.
GENRE_ALIAS_DENY = {"wave", "tracker", "sequencer", "jerk", "tread", "vapor", "mashup", "big music", "no melody",
                    "batida", "weightless", "drumless", "musica venezolana", "venezolana",
                    "musica", "latin", "pop rap", "rumba"}

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
    "anime": ["emotion:joyful", "emotion:euphoric", "emotion:confident"],
    "intenso": ["emotion:tense", "energy:energy-high"],
    "intensa": ["emotion:tense", "energy:energy-high"],
    "intensos": ["emotion:tense", "energy:energy-high"],
    "intensas": ["emotion:tense", "energy:energy-high"],
    "para animarme": ["emotion:joyful", "emotion:euphoric", "emotion:confident"],
    # 1.4.0 (desarrollo: S185, S186 de 4.0.0): «suave» y «pesado» sin otro pedido se aclaran.
    "suave": ["emotion:serene", "energy:energy-low"],
    "suaves": ["emotion:serene", "energy:energy-low"],
    "pesado": ["genre:metal", "energy:energy-high"],
    "pesada": ["genre:metal", "energy:energy-high"],
    "pesados": ["genre:metal", "energy:energy-high"],
    "pesadas": ["genre:metal", "energy:energy-high"],
}

MARKERS = {
    "negation": ["sin", "ni", "no quiero", "nada de", "que no sea", "que no sean", "excepto", "menos", "sin ser", "pero no", "no", "without", "no quiero nada", "nada"],
    "or": ["o", "u", "or"],
    "and": ["y", "e", "and", "con"],
    "preference": ["preferiblemente", "de preferencia", "mejor si es", "mejor si son", "mejor si", "ojala", "si es posible", "idealmente", "preferably", "ideally"],
    "boundary": ["pero", "aunque", "but"],
    "listener": ["estoy", "ando", "me siento", "me encuentro", "i am", "im", "i feel"],
    "listenerEnd": ["quiero", "pon", "ponme", "necesito", "dame", "busco", "y quiero", "pero quiero", "recomiendame"],
    "themeCues": ["sobre", "acerca de", "que hablen de", "que hable de", "que traten de", "que trate de", "letras sobre", "letras de", "letra sobre", "tematica", "de tematica", "temas sobre", "canciones sobre", "about", "songs about", "cuya letra trate de", "cuya letra trata de", "cuya letra trata sobre", "que trata de", "que trata sobre", "que traten sobre", "que hablen sobre", "traten de", "trata de", "trata sobre", "con letras sobre", "con letras de", "de tematica", "lyrics about", "que hablan de", "que habla de", "que hablan sobre", "que habla sobre", "hablen de", "hablan de", "que cuente", "que cuenten", "que narre", "que narren", "con historias de", "historias de", "letras de contenido", "contenido", "que trate", "que traten"],
    "entityCues": {"track": ["la cancion", "el tema", "la pista", "cancion", "el track", "the song", "song"],
                   "album": ["el disco", "el album", "el lp", "el ep", "disco", "album", "the album"],
                   "artist": ["la banda", "el grupo", "el artista", "la artista", "el cantante", "la cantante", "banda", "grupo", "artista", "the band"]},
    "ownerCues": ["temas de", "canciones de", "discos de", "albumes de", "musica de", "songs by", "lo nuevo de"],
    "similarityCues": ["parecido a", "parecida a", "parecidos a", "parecidas a", "similar a", "similares a", "al estilo de", "estilo de", "que suene como", "que suene a", "similar to", "like"],
    "similarityWeakCues": ["como", "tipo"],
    "aspects": {"guitars": ["las guitarras", "la guitarra", "guitarras", "guitarra"], "voice": ["la voz", "las voces", "voz", "voces", "el canto"],
                "production": ["la produccion", "produccion", "el sonido"], "composition": ["la composicion", "composicion", "las letras", "letras"],
                "atmosphere": ["el ambiente", "ambiente", "la atmosfera"]},
    "origins": sorted(set("""latinoamericano latinoamericana latinoamericanos latinoamericanas aca aqui venezuela venezolano venezolana venezolanos venezolanas criollo criolla criollos criollas colombia colombiano colombiana colombianos colombianas
ecuador ecuatoriano ecuatoriana ecuatorianos ecuatorianas peru peruano peruana peruanos peruanas chile chileno chilena chilenos chilenas argentina argentino argentinos argentinas
uruguay uruguayo uruguaya uruguayos uruguayas paraguay paraguayo paraguaya bolivia boliviano boliviana bolivianos bolivianas brasil brasileno brasilena brasilenos brasilenas
mexico mexicano mexicana mexicanos mexicanas cuba cubano cubana cubanos cubanas puerto rico puertorriqueno puertorriquena boricua boricuas dominicana dominicano dominicanos dominicanas
panama panameno panamena costa rica costarricense guatemala guatemalteco honduras hondureno nicaragua nicaraguense salvador salvadoreno
espana espanol espanola espanoles espanolas gringo gringa gringos gringas estadounidense estadounidenses usa eeuu estados unidos inglaterra ingles inglesa ingleses britanico britanica britanicos
francia frances francesa franceses alemania aleman alemana alemanes italia italiano italiana italianos japon japones japonesa japoneses noruega noruego noruega noruegos suecia sueco sueca suecos finlandia finlandes
caracas caraqueno caraquena caraquenos maracaibo maracucho maracucha maracuchos zulia zuliano zuliana valencia carabobeno barquisimeto larense larenses guaro guara guaros merida merideno merida andino andina andinos
oriente oriental orientales llanero llanera llaneros llanos margarita margariteno margaritena barlovento falcon coro tachira tachirense maracay aragueno lecheria puerto la cruz ciudad bolivar
bogota medellin lima montevideo quito guayaquil habana madrid barcelona londres""".split()) - {"la", "puerto", "rico", "cruz", "ciudad", "costa", "rica", "estados", "unidos", "salvador", "margarita"}),
    # Versión o grabación: no representable en intention-v1; se conserva pendiente.
    "versionMarkers": ["en vivo", "grabado en vivo", "grabada en vivo", "grabados en vivo", "grabadas en vivo", "en directo", "version en vivo", "versiones en vivo",
                       "remix", "remixes", "remezcla", "remezclas", "remasterizado", "remasterizada", "remasterizados", "remasterizadas", "versiones remasterizadas", "version remasterizada", "version extendida", "live"],
    # Atributos que intention-v1 no representa y que Laya tiende a tomar por relleno (desarrollo: T189, R189).
    "unrepresentable": ["rojo", "roja", "rojos", "rojas", "verde", "verdes", "azul", "azules", "amarillo", "amarilla", "amarillos", "amarillas",
                        "morado", "morada", "morados", "moradas", "naranja", "naranjas", "rosado", "rosada", "rosados", "rosadas", "blanco", "blanca",
                        "blancos", "blancas", "negro", "negra", "negros", "negras", "gris", "grises", "violeta", "violetas",
                        # 1.5.0 (desarrollo: F076 de 5.0.0; convención desde 3.0.0): ocasiones fuera del vocabulario de actividades.
                        "dedicar", "dedicarle", "dedicarles", "dedicarsela", "dedicarselas", "dedicarte", "dedicarla", "limpiar", "limpiando", "limpieza",
                        "cocinar", "cocinando", "orar", "orando", "rezar", "rezando"],
    # 1.3.0 (desarrollo: prueba 3.0.0, S138, S141, S148, S160–S163, S174): instrumentación, voz, idioma,
    # época y popularidad tampoco tienen eje en intention-v1. En una descripción de sonido sin pedido
    # («acordeón, caja y guacharaca») describen un género y no se marcan.
    "attributes": ATTRIBUTE_WORDS,
    # Subconjunto que delata una descripción de sonido (instrumentos y voz; no idioma, época ni popularidad).
    "soundAttributes": SOUND_WORDS,
    # Circunstancia temporal («después del trabajo», «antes de dormir»): no es un pedido a la música.
    "circumstances": ["antes de", "antes del", "despues de", "despues del", "luego de", "luego del", "al salir de", "al salir del", "al volver de", "al volver del"],
    "fillerIdioms": ["que suene a", "que suenen a", "suene a", "suenen a", "sin parar", "sin cesar", "sin descanso", "no recuerdo", "no me acuerdo", "no se", "no importa", "casi no importa", "no se como se llama"],
    "comparatives": ["mas", "menos", "more", "less"],
    # «un disco», «discos»: el formato, no el género disco (desarrollo: R203, T203, S170).
    "formatNouns": ["disco", "discos"],
    "attenuators": ["ni tan", "no tan", "no muy", "medio", "un poco", "not too"],
    "clauseStarts": ["para", "pa", "pal", "for"],
    "decades": {"1950s": ["cincuenta", "50", "50s"], "1960s": ["sesenta", "60", "60s"], "1970s": ["setenta", "70", "70s"],
                "1980s": ["ochenta", "80", "80s"], "1990s": ["noventa", "90", "90s"], "2000s": ["2000", "dos mil", "2000s"], "2010s": ["2010", "2010s"]},
    "fillers": "bandas grupos artistas playlist playlists lista mix sonidos discos disco albumes album grabaciones musica musicas musical cancion canciones tema temas rola rolas pieza piezas algo cosas cosa song songs music tracks quiero quisiera necesito busco buscar busca dame ponme pon recomiendame recomienda recomiendan escuchar oir para pa por de del la el las los lo un una unos unas al a en que sea sean bien full bastante muy mi me ahora favor porfa rato un rato mientras alguna algun buena buenas bueno buenos tipo for the to of some please i want with mas caracter de caracter ambiente atmosfera estilo onda vibra vibras musiquita musiquitas cancioncita cancioncitas temita temitas fino fina finos finas".split(),
}


EXPANSIONS = [ROOT / "docs/unified-search/stage3/inputs/concept-expansion-2026-10-25.json",
              ROOT / "docs/unified-search/stage3/inputs/concept-expansion-2-2026-10-25.json"]
# Rasgos de sonido genéricos: en una expresión ampliada harían de concepto un rasgo de una descripción.
SOUND_GENERIC = {"grave", "graves", "agudo", "aguda", "lento", "lenta", "rapido", "rapida", "suave", "suaves", "pesado", "pesada", "fuerte", "fuertes", "bajo", "bajos", "solemne"}


EXPANDED: set[str] = set()
FACET_ALIAS_DENY = {"rap"}
# «solo» es casi siempre adverbio («que solo tengan piano»), no soledad (desarrollo: S162).
CONCEPT_ALIAS_DENY = {"solo"}


def merge_expansion(concepts: list[dict], taken: set[str]) -> None:
    """Ampliación sistemática (DeepSeek flash, solo etiqueta y definición) con filtros fijos:
    se descarta lo que ya está en el léxico, lo propuesto para dos conceptos, lo que contiene una
    palabra que ya es alias de otro concepto, lo que solo alarga un alias del mismo concepto (el resto
    lo absorbe el segmentador) y las frases de más de tres palabras o con palabras genéricas."""
    exp: dict[str, list[str]] = {}
    for path in EXPANSIONS:
        for cid, items in json.loads(path.read_text())["concepts"].items():
            exp.setdefault(cid, []).extend(items)
    single = {}
    for c in concepts:
        for a in c["aliases"] + c["themeNouns"]:
            if " " not in a:
                single.setdefault(a, set()).add(c["id"])
    proposed: dict[str, set[str]] = {}
    # Inglés de la segunda ronda: solo para actividades («for a long drive» → «long drive»); en las demás
    # dimensiones DeepSeek mezcló situaciones con cualidades («for a dinner» como ambiente cálido).
    dims = {c["id"]: c["dimension"] for c in concepts}
    for cid in list(exp):
        out = []
        for e in map(norm, exp[cid]):
            if re.match(r"^(for|to|on|at|in) ", e):
                if dims.get(cid) != "activity":
                    continue
                e = re.sub(r"^for (a |an |the )?", "", e)
            out.append(e)
        exp[cid] = out
    for cid, items in exp.items():
        for e in items:
            proposed.setdefault(norm(e), set()).add(cid)
    generic = {"musica", "musical", "canciones", "cancion", "sonido", "sonidos", "sonora", "sonoro", "ambiente", "atmosfera", "algo"}
    by_id = {c["id"]: c for c in concepts}
    for cid, items in exp.items():
        c = by_id.get(cid)
        if not c:
            continue
        own = set(c["aliases"] + c["themeNouns"])
        keep = set()
        for e in {norm(x) for x in items}:
            words = e.split()
            if not e or e in taken or e in CONCEPT_ALIAS_DENY or len(proposed[e]) > 1 or len(words) > 3 or generic & set(words):
                continue
            # 0.5.0: ni instrumentos, voz, idioma o época ni rasgos genéricos de sonido («voz susurrada», «grave»).
            if set(words) & (set(ATTRIBUTE_WORDS) | SOUND_GENERIC):
                continue
            if c["dimension"] != "theme" and any(single.get(w, set()) - {cid} for w in words):
                continue
            if len(words) > 1 and c["dimension"] != "theme" and any(w in own for w in words):
                continue
            keep.add(e)
        EXPANDED.update(keep)
        if c["dimension"] == "theme":
            c["themeNouns"] = sorted(set(c["themeNouns"]) | keep)
        else:
            c["aliases"] = sorted(set(c["aliases"]) | keep)


def genre_variants(aliases: set[str]) -> set[str]:
    """Plural de los nombres de una palabra y femenino del adjetivo final («rock psicodelica»)."""
    out = set()
    for a in aliases:
        w = a.split()
        if len(w) == 1 and a.isalpha() and len(a) >= 4 and not a.endswith("s"):
            out.add(a + ("es" if a[-1] not in "aeiou" else "s"))
        if len(w) >= 2 and w[-1].endswith("o") and len(w[-1]) >= 5:
            out.add(" ".join(w[:-1] + [w[-1][:-1] + "a"]))
        if len(w) >= 2 and w[-1] in ("latino", "latina"):
            out.add(" ".join(w[:-1] + [w[-1].replace("latin", "latinoamerican")]))
    return out


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
    for c in concepts:
        c["aliases"] = [a for a in c["aliases"] if a not in CONCEPT_ALIAS_DENY]
        # Plural de los sustantivos temáticos de una palabra («guerras», «hadas»).
        c["themeNouns"] = sorted(set(c["themeNouns"]) | {n + ("es" if n[-1] not in "aeiou" else "s") for n in c["themeNouns"] if " " not in n and n.isalpha() and len(n) >= 4 and not n.endswith("s")})
    taken = {a for c in concepts for a in c["aliases"] + c["themeNouns"]} | set(AMBIGUOUS)
    merge_expansion(concepts, taken)
    taken = {a for c in concepts for a in c["aliases"] + c["themeNouns"]} | set(AMBIGUOUS)
    for c in concepts:
        if c["dimension"] in ("emotion", "atmosphere", "energy"):
            extra = {v for a in c["aliases"] for v in inflections(a, c["dimension"])} - taken
            c["aliases"] = sorted(set(c["aliases"]) | extra)
        if c["id"] in THEME_ALIASES:
            c["aliases"] = sorted(set(c["aliases"]) | {norm(a) for a in THEME_ALIASES[c["id"]]})
    # «rap» nombra el género (hip-hop); la faceta de voz conserva «rapeado», «rapear» (1.4.0; desarrollo: S093, S132 de 4.0.0).
    facets = [{"id": f["id"], "aliases": sorted({norm(a) for a in f["aliasesEs"] + FACET_ADDITIONS.get(f["id"], [])} - FACET_ALIAS_DENY), "definition": f["definition"]} for f in vocab["facets"]]
    genres = []
    for g in genres_db:
        m = gmap.get(g["slug"], {})
        aliases = {norm(g["name"]), norm(g["slug"])}
        aliases |= {norm(a) for a in g["aliases"] if not re.search(r"[\[\]()/]", a)}
        aliases = {a for a in aliases if a and a not in GENRE_ALIAS_DENY and len(a) >= 3}
        aliases = sorted(aliases | genre_variants(aliases))
        traits = [{"aspect": ch["aspect"], "description": ch["description"]} for ch in m.get("characteristics", [])]
        genres.append({"slug": g["slug"], "name": g["name"], "level": g["level"], "parentId": g["parent_genre_id"],
                       "definition": m.get("description") or m.get("proposedDefinition"), "traits": traits,
                       "mapStatus": m.get("descriptionStatus"), "aliases": aliases})
    for c in concepts:
        c["aliases"] = [a for a in c["aliases"] if a not in CONCEPT_ALIAS_DENY]
    # Una expresión de la ampliación que también nombra un género se descarta («parranda»).
    genre_names = {a for g in genres for a in g["aliases"]}
    for c in concepts:
        for k in ("aliases", "themeNouns"):
            c[k] = [a for a in c[k] if not (a in EXPANDED and a in genre_names)]
    sources = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (VOCAB, GENRE_MAP)}
    sources["genres-db-export"] = hashlib.sha256(Path(genres_path).read_bytes()).hexdigest()
    body = {"version": "crv-query-lexicon-0.6.0", "builtBy": "scripts/stage3/build_query_lexicon.py", "vocabularyVersion": vocab["version"],
            "genreMapVersion": json.loads(GENRE_MAP.read_text())["version"], "sources": sources,
            "policy": "Candidatos léxicos para proponer fragmentos; no deciden, no asignan atributos ni crean géneros o conceptos.",
            "concepts": concepts, "facets": facets, "genres": genres,
            "ambiguous": [{"phrase": k, "candidates": v} for k, v in AMBIGUOUS.items()], "markers": MARKERS}
    OUT.write_text(json.dumps(body, ensure_ascii=False, indent=1) + "\n")
    print(len(concepts), len(facets), len(genres), sum(len(g["aliases"]) for g in genres))


if __name__ == "__main__":
    main(sys.argv[1])
