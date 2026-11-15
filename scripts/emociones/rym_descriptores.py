"""Diccionario de descriptores comunitarios de RYM (crv-rym-descriptors-0.2.0).

0.2.0 (2026-11-12): cubre los 505 descriptores del glosario oficial. El glosario se corrigió
(el parser asignaba a 10 descriptores sin texto la definición del vecino: kissing→police,
shopping→sleep, Wild West→farming...): 406 con definición oficial y 111 sin ella. El
significado de los que no tienen texto está en rym_significados.py, con su evidencia.

Cada descriptor RYM describe cómo la comunidad percibe un disco. Aquí se fija:
  - eje: emocion | actitud | ambiente | energia (los cuatro cuentan como «cómo se siente»)
         tematica | contexto | voz | sonido | forma (no son sensación)
  - es: equivalente en español
  - valencia (solo emoción/actitud/ambiente): pos | neg | mix | neu
  - nota: matiz de significado o falso amigo

Definiciones: síntesis de Claude (2026-11-12) a partir del uso en RYM. Contrastado el
2026-11-12 con el glosario oficial (data/raw/rym-descriptores-2026-11-12, 517 entradas,
8 categorías; informe en reports/rym-descriptores-glosario-2026-11-12.md): las 400 claves
existen en RYM —ninguna inventada—, 330 tienen definición oficial publicada y 70 son
descriptores que RYM deja sin texto. RYM no define NINGUNA hoja de «mood» (28/28): la
distinción oficial es de categoría (mood = emociones; atmosphere = imágenes), así que el
significado por término de los emocionales es necesariamente interpretación. Decisión de
Brian: los descriptores son evidencia de comunidad del DISCO y mandan sobre el carácter
típico del género.
"""

VERSION = "crv-rym-descriptors-0.3.0"
SENTIR = {"emocion", "actitud", "ambiente", "energia"}

# descriptor: (eje, es, valencia, nota)
D = {}

def add(eje, rows):
    for row in rows:
        k, es, *rest = row
        val = rest[0] if rest else None
        nota = rest[1] if len(rest) > 1 else None
        D[k] = (eje, es, val, nota)

add("emocion", [
    ("passionate", "apasionado", "pos"), ("longing", "anhelante", "mix"),
    ("melancholic", "melancólico", "neg"), ("bittersweet", "agridulce", "mix"),
    ("introspective", "introspectivo", "neu"), ("romantic", "romántico", "pos"),
    ("angry", "rabioso", "neg"), ("uplifting", "edificante", "pos", "levanta el ánimo"),
    ("sentimental", "sentimental", "mix"), ("anxious", "ansioso", "neg"),
    ("sensual", "sensual", "pos", "carácter de la música; no acredita actividad íntima"),
    ("sombre", "sombrío", "neg", "grave y triste"), ("pessimistic", "pesimista", "neg"),
    ("hateful", "lleno de odio", "neg"), ("misanthropic", "misántropo", "neg"),
    ("lonely", "solitario", "neg"), ("happy", "alegre", "pos"),
    ("depressive", "depresivo", "neg"), ("triumphant", "triunfal", "pos"),
    ("soothing", "reconfortante", "pos", "calma y consuela"), ("nihilistic", "nihilista", "neg"),
    ("optimistic", "optimista", "pos"), ("sad", "triste", "neg"),
    ("scary", "aterrador", "neg"), ("spiritual", "espiritual", "pos"),
    ("peaceful", "apacible", "pos"), ("meditative", "meditativo", "neu"),
    ("self-hatred", "autodesprecio", "neg"), ("cynical", "cínico", "neg"),
    ("nostalgia", "nostálgico", "mix"), ("regret", "arrepentimiento", "neg"),
    ("grief", "duelo", "neg"), ("apathetic", "apático", "neg"),
    ("insecure", "inseguro", "neg"), ("obsession", "obsesivo", "neg"),
    ("compassionate", "compasivo", "pos"), ("courage", "valiente", "pos"),
    ("paranoia", "paranoico", "neg"), ("disturbing", "perturbador", "neg"),
    ("calm", "tranquilo", "pos"), ("epic", "épico", "pos", "grandioso"),
    ("suspenseful", "de suspenso", "neg"), ("existential", "existencial", "neu"),
    ("self-love", "amor propio", "pos"), ("homesickness", "añoranza del hogar", "mix"),
    ("unrequited love", "amor no correspondido", "neg"), ("farewell", "despedida", "mix"),
])
add("actitud", [
    ("playful", "juguetón", "pos"), ("boastful", "fanfarrón", "neu"),
    ("anthemic", "himno", "pos", "coreable y exaltado"), ("rebellious", "rebelde", "neu"),
    ("quirky", "excéntrico", "pos"), ("humorous", "humorístico", "pos"),
    ("serious", "serio", "neu"), ("sarcastic", "sarcástico", "neu"),
    ("satirical", "satírico", "neu"), ("provocative", "provocador", "neu"),
    ("menacing", "amenazante", "neg"), ("deadpan", "impasible", "neu", "humor seco"),
    ("sassy", "descarado", "pos"), ("flirting", "coqueto", "pos"),
    ("theatrical", "teatral", "neu"), ("vulgar", "vulgar", "neu"),
    ("dark humor", "humor negro", "neu"), ("parody", "paródico", "pos"),
    ("cautionary", "aleccionador", "neu"), ("diss", "tiradera", "neg", "ataque a otro artista"),
])
add("ambiente", [
    ("dark", "oscuro", "neg"), ("atmospheric", "atmosférico", "neu"),
    ("nocturnal", "nocturno", "neu"), ("warm", "cálido", "pos"),
    ("cold", "frío", "neg"), ("ethereal", "etéreo", "pos"),
    ("ominous", "ominoso", "neg"), ("surreal", "surrealista", "neu"),
    ("mysterious", "misterioso", "neu"), ("lush", "exuberante", "pos", "denso y rico en capas"),
    ("mellow", "suave", "pos", "relajado"), ("apocalyptic", "apocalíptico", "neg"),
    ("cryptic", "críptico", "neu"), ("infernal", "infernal", "neg"),
    ("psychedelic", "psicodélico", "neu"), ("hypnotic", "hipnótico", "neu"),
    ("futuristic", "futurista", "neu"), ("pastoral", "pastoral", "pos"),
    ("hazy", "brumoso", "neu"), ("macabre", "macabro", "neg"),
    ("ritualistic", "ritual", "neu"), ("desolate", "desolado", "neg"),
    ("cozy", "acogedor", "pos"), ("funereal", "fúnebre", "neg"),
    ("bright", "luminoso", "pos"), ("gothic", "gótico", "neg"),
    ("dystopian", "distópico", "neg"), ("cavernous", "cavernoso", "neg"),
    ("aquatic", "acuático", "neu"), ("dreams", "onírico", "neu"),
    ("cosmic horror", "horror cósmico", "neg"), ("paranormal", "paranormal", "neg"),
    ("horror", "terror", "neg"), ("tropical", "tropical", "pos"),
    ("urban", "urbano", "neu"), ("space", "espacial", "neu"),
    ("forest", "boscoso", "neu"), ("nature", "natural", "pos"),
    ("desert", "desértico", "neu"), ("decay", "decadente", "neg"),
])
add("energia", [
    ("energetic", "enérgico", None), ("heavy", "pesado", None),
    ("aggressive", "agresivo", None), ("chaotic", "caótico", None),
    ("manic", "frenético", None), ("party", "fiestero", None),
    ("soft", "suave", None), ("punchy", "contundente", None),
    ("bouncy", "saltarín", None), ("lethargic", "letárgico", None),
    ("dancing", "bailable (según la comunidad)", None, "percepción; no acredita adecuación para bailar"),
    ("rhythmic", "rítmico", None), ("chugging", "machacón", None, "riff entrecortado y pesado"),
    ("plodding", "pesado y lento", None), ("raw", "crudo", None),
    ("noisy", "ruidoso", None), ("dense", "denso", None), ("sparse", "escaso", None),
    ("maximalist", "maximalista", None), ("minimalistic", "minimalista", None),
    ("stomping", "pisoteante", None), ("martial", "marcial", None),
])
add("tematica", [
    ("love", "amor"), ("sexual", "sexual", None, "temática; no acredita sensualidad"), ("death", "muerte"),
    ("violence", "violencia"), ("conscious", "consciente", None, "rap/letra con conciencia social"),
    ("breakup", "ruptura amorosa"), ("poetic", "poético"), ("political", "político"),
    ("hedonism", "hedonismo"), ("drugs", "drogas"), ("concept album", "álbum conceptual"),
    ("folklore", "folclor"), ("antireligious", "antirreligioso"), ("crime", "crimen"),
    ("alienation", "alienación"), ("satanism", "satanismo"), ("occult", "ocultismo"),
    ("war", "guerra"), ("protest", "protesta"), ("LGBTQ", "LGBTQ"), ("philosophical", "filosófico"),
    ("alcohol", "alcohol"), ("fantasy", "fantasía"), ("science fiction", "ciencia ficción"),
    ("Christmas", "Navidad"), ("mythology", "mitología"), ("suicide", "suicidio"),
    ("patriotic", "patriótico"), ("history", "historia"), ("anti-authoritarian", "antiautoritario"),
    ("Christian", "cristiano"), ("pagan", "pagano"), ("gore", "gore"), ("money", "dinero"),
    ("transgender", "transgénero"), ("internet", "internet"), ("mental health", "salud mental"),
    ("anarchism", "anarquismo"), ("about music", "sobre la música"), ("homicide", "homicidio"),
    ("addiction", "adicción"), ("religious", "religioso"), ("anticolonialism", "anticolonialismo"),
    ("community", "comunidad"), ("migration", "migración"), ("nationalism", "nacionalismo"),
    ("cyberpunk", "cyberpunk"), ("failure", "fracaso"), ("gay", "gay"), ("cannabis", "cannabis"),
    ("disease", "enfermedad"), ("kink", "fetichismo"), ("conservatism", "conservadurismo"),
    ("travel", "viajes"), ("trauma", "trauma"), ("escapism", "escapismo"),
    ("individuality", "individualidad"), ("family", "familia"), ("infidelity", "infidelidad"),
    ("fashion", "moda"), ("association football", "fútbol"), ("Vikings", "vikingos"),
    ("food", "comida"), ("fame", "fama"), ("guns", "armas"), ("socialism", "socialismo"),
    ("cars", "carros"), ("animals", "animales"), ("vengeance", "venganza"), ("wrestling", "lucha libre"),
    ("environmentalism", "ecologismo"), ("domestic", "vida doméstica"), ("cocaine", "cocaína"),
    ("everyday life", "vida cotidiana"), ("childhood", "infancia"), ("film", "cine"),
    ("literature", "literatura"), ("indigeneity", "indigenismo"), ("nonbinary", "no binario"),
    ("conspiracy", "conspiración"), ("educational", "educativo"), ("friendship", "amistad"),
    ("radio", "radio"), ("vehicles", "vehículos"), ("video games", "videojuegos"), ("time", "el tiempo"),
    ("afterlife", "más allá"), ("revolution", "revolución"), ("television", "televisión"),
    ("antidrug", "antidrogas"), ("police", "policía"), ("Halloween", "Halloween"),
    ("bisexual", "bisexual"), ("maritime", "marítimo"), ("adolescence", "adolescencia"),
    ("work", "trabajo"), ("health", "salud"), ("opioids", "opioides"), ("aliens", "extraterrestres"),
    ("antiracism", "antirracismo"), ("fairy tale", "cuento de hadas"), ("gender dysphoria", "disforia de género"),
    ("robots", "robots"), ("technology", "tecnología"), ("beauty", "belleza"), ("baseball", "béisbol"),
    ("entertainment industry", "industria del espectáculo"), ("pacifism", "pacifismo"),
    ("anime and manga", "anime y manga"), ("gender", "género (identidad)"), ("visual arts", "artes visuales"),
    ("poverty", "pobreza"), ("womanhood", "ser mujer"), ("feminism", "feminismo"), ("manhood", "ser hombre"),
    ("Islamic", "islámico"), ("disaster", "desastre"), ("ageing", "envejecimiento"),
    ("hallucinogens", "alucinógenos"), ("school", "escuela"), ("prison", "cárcel"),
    ("rejection", "rechazo"), ("memory", "memoria"), ("greed", "codicia"), ("leisure", "ocio"),
    ("birds", "aves"), ("farming", "campo"), ("cosmetics", "cosmética"), ("marriage", "matrimonio"),
    ("propaganda", "propaganda"), ("trains", "trenes"), ("horses", "caballos"), ("freedom", "libertad"),
    ("monsters", "monstruos"), ("vampires", "vampiros"), ("antiquity", "antigüedad"), ("sobriety", "sobriedad"),
    ("betrayal", "traición"), ("lesbian", "lésbico"), ("racing", "carreras"), ("gambling", "apuestas"),
    ("cats", "gatos"), ("pirates", "piratas"), ("older adulthood", "vejez"), ("secrets", "secretos"),
    ("Moon", "la Luna"), ("Biblical", "bíblico"), ("Judaic", "judaico"), ("injury", "lesiones"),
    ("loyalty", "lealtad"), ("anticonsumerism", "anticonsumismo"), ("creative process", "proceso creativo"),
    ("antidiscrimination", "antidiscriminación"), ("narrative", "narrativo"), ("stream of consciousness", "flujo de conciencia"),
    ("sports", "deportes"), ("medieval", "medieval"), ("lyrical dissonance", "disonancia letra-música", None, "letra triste con música alegre o al revés"),
])
add("contexto", [
    ("summer", "verano"), ("winter", "invierno"), ("autumn", "otoño"), ("spring", "primavera"),
    ("rain", "lluvia"), ("nightlife", "vida nocturna"), ("daytime", "diurno"), ("beach", "playa"),
    ("morning", "mañana"), ("evening", "atardecer"), ("seasonal", "de temporada"), ("holiday", "festivo"),
    ("Carnaval", "carnaval"), ("mountains", "montaña"), ("fire", "fuego"), ("suburban", "suburbano"),
    ("storm", "tormenta"), ("wind", "viento"), ("sleep", "sueño", None, "tema o escena; no acredita música para dormir"),
])
add("voz", [
    ("male vocalist", "voz masculina"), ("female vocalist", "voz femenina"), ("harsh vocals", "voces ásperas"),
    ("androgynous vocals", "voz andrógina"), ("nonbinary vocalist", "voz no binaria"), ("growling", "gutural"),
    ("pitched-down vocals", "voz grave procesada"), ("vocal group", "grupo vocal"), ("shrieking", "chillidos"),
    ("duet", "dúo"), ("talk-singing", "canto hablado"), ("vocal chops", "voces recortadas"),
    ("gang vocals", "coros de pandilla"), ("pitched-up vocals", "voz aguda procesada"), ("sing-rapping", "rap cantado"),
    ("whispering", "susurros"), ("choral", "coral"), ("crooning", "crooner"), ("monologue", "monólogo"),
    ("belting", "voz de pecho potente"), ("falsetto", "falsete"), ("nonlexical vocables", "vocalizaciones sin palabras"),
    ("yarling", "yarling"), ("a cappella", "a capela"), ("stuttering vocals", "voz tartamuda"),
    ("toasting", "toasting"), ("murmuring", "murmullos"), ("posse cut", "colaboración de varios raperos"),
    ("call and response", "pregunta y respuesta"), ("unaccompanied solo", "solo sin acompañamiento"),
    ("code-mixing", "mezcla de idiomas"),
])
add("sonido", [
    ("melodic", "melódico"), ("eclectic", "ecléctico"), ("instrumental", "instrumental"),
    ("sampling", "samples"), ("repetitive", "repetitivo"), ("mechanical", "mecánico"),
    ("lo-fi", "lo-fi"), ("progressive", "progresivo"), ("acoustic", "acústico"), ("technical", "técnico"),
    ("dissonant", "disonante"), ("avant-garde", "vanguardista"), ("complex", "complejo"),
    ("abstract", "abstracto"), ("uncommon time signatures", "compases irregulares"), ("bassy", "con mucho bajo"),
    ("improvisation", "improvisación"), ("orchestral", "orquestal"), ("angular", "anguloso"),
    ("tribal", "tribal"), ("blast beats", "blast beats"), ("lobit", "lobit"), ("polyrhythm", "polirritmia"),
    ("fuzzy", "con fuzz"), ("atonal", "atonal"), ("smooth", "pulido"), ("piercing", "penetrante"),
    ("warbly", "ondulante"), ("muffled", "apagado"), ("Wall of Sound", "muro de sonido"), ("twinkling", "centelleante"),
    ("four on the floor", "bombo a negras"), ("polyphonic", "polifónico"), ("crackly", "crepitante"),
    ("squelchy", "chapoteante"), ("buzzy", "zumbante"), ("gallop", "galope"), ("jamming", "zapada"),
    ("aleatory", "aleatorio"), ("generative music", "música generativa"), ("skronky", "estridente (skronk)"),
    ("microtonal", "microtonal"), ("clanging", "metálico"), ("ticking", "tictac"), ("reversing", "sonidos invertidos"),
    ("mixed meter", "métrica mixta"), ("free rhythm", "ritmo libre"), ("triple meter", "compás ternario"),
    ("interpolation", "interpolación"), ("pastiche", "pastiche"), ("natural", "natural", None, "sonido sin artificio ni procesamiento"),
])
add("forma", [
    ("ballad", "balada"), ("suite", "suite"), ("medley", "popurrí"), ("leitmotif", "leitmotiv"),
    ("intro", "intro"), ("reprise", "reprise"), ("callback", "guiño a otra canción"), ("wordplay", "juegos de palabras"),
    ("skit", "skit"), ("interlude", "interludio"), ("through-composed", "composición continua"), ("outro", "outro"),
])

# Añadidos 2026-11-12 tras el glosario oficial (105 descriptores que faltaban).
add("actitud", [("altruistic", "altruista", "pos"), ("utopian", "utópico", "pos")])
add("ambiente", [("grassland", "llanura de pastos", "neu", "paisaje de sabana o pradera"),
                 ("wetland", "humedal", "neu"), ("Southern Gothic", "gótico sureño", "neg")])
add("tematica", [(k, es) for k, es in [
    ("alter ego", "alter ego"), ("amphibians", "anfibios"), ("apology", "disculpa"), ("aviation", "aviación"),
    ("Bahá'í", "bahaísmo"), ("basketball", "baloncesto"), ("birthday", "cumpleaños"), ("boredom", "aburrimiento"),
    ("boxing", "boxeo"), ("Buddhist", "budismo"), ("bugs", "insectos"), ("card games", "juegos de cartas"),
    ("circus", "circo"), ("color", "colores"), ("comics", "cómics"), ("confusion", "confusión"),
    ("dishonesty", "mentira"), ("divorce", "divorcio"), ("dogs", "perros"), ("drought", "sequía"),
    ("envy", "envidia"), ("disappointment", "decepción"), ("exile", "exilio"), ("fans", "fans"), ("fear", "miedo (tema)"), ("fishing", "pesca"),
    ("fitness", "ejercicio físico"), ("flowers", "flores"), ("ghosts", "fantasmas"), ("gratitude", "gratitud"),
    ("healing", "sanación"), ("Hindu", "hinduismo"), ("HIV and AIDS", "VIH y sida"), ("hunting", "caza"),
    ("ideology", "ideología"), ("Jain", "jainismo"), ("jewelry", "joyas"), ("kissing", "besos"), ("law", "ley"),
    ("long-distance relationship", "relación a distancia"), ("mathematics", "matemáticas"), ("mining", "minería"),
    ("monarchy", "monarquía"), ("nicotine", "nicotina"), ("pandemic", "pandemia"), ("parenthood", "crianza"),
    ("pets", "mascotas"), ("phones", "teléfonos"), ("plants", "plantas"), ("prehistory", "prehistoria"),
    ("Rastafari", "rastafarismo"), ("reincarnation", "reencarnación"), ("science", "ciencia"),
    ("shamanism", "chamanismo"), ("shopping", "compras"), ("siblings", "hermanos"), ("Sikh", "sijismo"),
    ("skateboarding", "skate"), ("success", "éxito"), ("Sun", "el Sol"), ("surfing", "surf"), ("theft", "robo"),
    ("trucks", "camiones"), ("vacation", "vacaciones"), ("vegetarianism", "vegetarianismo"), ("Wild West", "Viejo Oeste"),
]])
add("sonido", [("collective improvisation", "improvisación colectiva"), ("downtuning", "afinación baja"),
               ("monophonic", "monofónico"), ("rubato", "rubato"), ("swing rhythm", "ritmo swing"),
               ("tone clusters", "clústeres")])
add("voz", [("gurgling vocals", "voz gorgoteante"), ("humming", "tarareo"), ("pig squealing", "chillido porcino"),
            ("raspy vocals", "voz rasposa"), ("scat singing", "scat"), ("throat singing", "canto de garganta"),
            ("tunnel screaming", "grito de túnel"), ("whistle register", "registro de silbido"), ("whistling", "silbido")])
add("forma", [("dialogue", "diálogo"), ("epistolary", "epistolar"), ("list song", "canción lista"),
              ("freestyle", "freestyle"), ("movement", "movimiento"), ("silence", "silencio")])
# Categorías organizativas del glosario: no se votan como descriptor de un disco.
add("categoria", [(k, es) for k, es in [
    ("atmosphere", "ambiente"), ("mood", "estado de ánimo"), ("form", "forma"), ("lyrics", "letra"),
    ("style", "estilo"), ("tone", "tono de la letra"), ("technique", "técnica"), ("theme", "tema"), ("vocals", "voz"),
    ("composition", "composición"), ("production", "producción"), ("ensemble", "conjunto"), ("section", "sección"),
]])

SENSACION_EN_CONTEXTO = set()  # reservado para descriptores mixtos


def eje(desc):
    return D.get(desc, (None,))[0]
