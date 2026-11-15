"""Construye caracter-0.2.0.src.json: muestra 0.1.0 revisada + lote 2 (111 géneros de la cola).

Cada entrada lleva carácter típico del género (fallback, no afirmación sobre la obra) con citas literales
de las capturas. Las URL se escriben abreviadas y se resuelven contra las capturas de las dos campañas.
`heredaDe` sin carácter propio copia el de esos géneros (archivo o perfil RYM) con fuerza «heredado».

Uso: python3 -I scripts/emociones/caracter_lote2.py <campaña-muestra> <campaña-lote2> <salida.src.json> [<campaña-ronda2>] [<campaña-ronda3>]
"""
import glob, json, re, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2] / "docs/unified-search/emociones"

# fila: slug, familia, comparadoCon, caracter "es|eje|val|fuerza;...", contraste, fuentes [(url-abreviada, cita)],
#       confianza, extras (nota, heredaDe)
L = []


def G(slug, fam, comp, car, contraste, fuentes, conf, nota=None, hereda=None):
    L.append(dict(slug=slug, familia=fam, comparadoCon=comp, car=car, contraste=contraste, fuentes=fuentes,
                  confianza=conf, nota=nota, heredaDe=hereda))


# ---------- blues, funk/soul, bolero ----------
G("blues", "blues", ["harmonica-blues", "jazz"],
  "melancólico|emocion|neg|definitorio;triste|emocion|neg|definitorio;solitario|emocion|neg|frecuente;"
  "sentido/sincero|emocion|pos|frecuente;alegre|emocion|pos|variable",
  "La tristeza dicha con franqueza es su centro, aunque admite piezas alegres; el jazz es más juguetón y variable.",
  [("tunetempest.co.uk/the-harmonica-in-blues", "melancholic melodies, and heartfelt lyrics to express themes of hardship, love, and resilience"),
   ("en.m.wikipedia.org/wiki/Blues", "originated from \"blue devils\", meaning melancholy and sadness"),
   ("rodrigolalonso.blogspot.com", "reflejan y expresan sentimientos de tristeza, soledad, marginación"),
   ("jazzguitartoday.com", "Blues in jazz can be any tempo or mood from sad to happy")], "alta")
G("harmonica-blues", "blues", ["blues"], "cálido/expresivo|ambiente|pos|frecuente",
  "Variante instrumental del blues: comparte su carácter y añade el timbre cálido de la armónica.",
  [("creativemusicalinstrument.com", "warm, expressive tone ideal for blues music")], "baja", hereda=["blues"])
G("bolero-beat", "bolero", ["bolero", "beat"], "", "Bolero con instrumentación beat de los sesenta.",
  [], "heredado", nota="Sin fuentes con carácter propio; combina bolero y beat (regla de géneros mezclados).",
  hereda=["bolero", "beat"])
G("latin-funk", "funk-y-soul", ["funk-y-soul", "jazz-fusion"],
  "sensual|emocion|pos|definitorio;fiestero/bailable|energia|-|frecuente;juguetón|actitud|pos|frecuente;"
  "cálido|ambiente|pos|frecuente;alegre|emocion|pos|frecuente",
  "Más sensual y caribeño que el funk de origen.",
  [("slowradio.net/slow-latin-funk", "con un ritmo más relajado y sensual"),
   ("melodigging.com/genre/latin-funk", "Latin Funk United States · 1960 s Dancing Happy Chill Sentimental Romantic")], "alta",
  nota="El perfil RYM (54 discos) coincide: sensual, cálido, juguetón, fiestero.")
G("doo-wop", "funk-y-soul", ["funk-y-soul", "rock-and-roll"],
  "romántico|emocion|pos|definitorio;cálido|ambiente|pos|frecuente;nostálgico|emocion|neu|variable",
  "Armonías vocales románticas; la nostalgia viene sobre todo de sus resurgimientos.",
  [("en.wikipedia.org/wiki/Doo-wop", "the romantic style of the doo-wop groups appealed to them"),
   ("es.alegsaonline.com/art/28498", "ya sea con fines nostálgicos o para aportar calidez y claridad melódica")], "media")
G("funk-y-soul", "funk-y-soul", ["latin-funk", "doo-wop"],
  "apasionado|emocion|pos|definitorio;enérgico|energia|-|frecuente;sensual|emocion|pos|variable",
  "Categoría paraguas: el soul aporta la pasión vocal y el funk la energía rítmica.",
  [("flyriver.com/g/characteristics-of-funk-and-soul", "whose passionate vocals and heartfelt lyrics captured the essence of soul's emotional core"),
   ("en.wikipedia.org/wiki/Soul_music", "Southern soul , a driving, energetic variety"),
   ("en.wikipedia.org/wiki/Soul_music", "Memphis soul , a shimmering, sultry style")], "alta")

# ---------- clásica ----------
G("musica-clasica", "musica-clasica", ["opera", "musica-de-camara"], "", "",
  [("psicofronteras.com", "se caracteriza por su capacidad de evocar una amplia gama de emociones, desde la alegría hasta la melancolía")],
  "sin_caracter", nota="Paraguas de cuatro siglos: las fuentes dicen que abarca toda la gama emocional. El carácter depende del período y la obra; no se asigna uno típico.")
G("musica-de-camara", "musica-clasica", ["musica-clasica", "opera"],
  "íntimo|ambiente|pos|definitorio;dialogante|actitud|neu|frecuente",
  "Frente a la ópera y la orquesta: pocos instrumentos que conversan.",
  [("es.alegsaonline.com/art/18410", "Intimidad y diálogo: los instrumentos interactúan como si conversaran")], "baja")
G("opera", "musica-clasica", ["musica-de-camara", "musica-clasica"],
  "dramático|emocion|neu|definitorio;apasionado|emocion|pos|frecuente",
  "El género clásico más teatral.",
  [("onabo.org/armonia-en-la-opera-musical", "en la creación de mundos dramáticos ricos y complejos en la ópera"),
   ("wikiteka.com/apuntes/explorando-musica-clasica-camara-opera", "derivó hacia una ópera lírica con temática de drama o fantasía romántica")], "media")
G("musica-coral", "musica-clasica", ["musica-sacra"], "exuberante|ambiente|pos|frecuente",
  "Solo hay evidencia de comunidad (RYM, 24 discos: «lush»).", [], "baja",
  nota="Sin fuentes web con carácter; el rasgo sale del perfil RYM.")
G("musica-sacra", "musica-clasica", ["musica-coral", "adoracion"],
  "solemne|emocion|neu|definitorio;reverente|actitud|pos|definitorio;trascendente/espiritual|ambiente|pos|definitorio",
  "Frente a la música de adoración actual: más solemne y litúrgica.",
  [("educadua.com/la-musica-sacra", "se caracteriza por su carácter solemne y reverente, utilizando armonías y melodías que evocan la trascendencia y la adoración"),
   ("educadua.com/la-musica-sacra", "para crear un ambiente de solemnidad y trascendencia")], "media",
  nota="Una sola fuente web (dos frases); el perfil RYM añade «lush».")
G("musica-antigua", "musica-clasica", ["musica-clasica"], "", "", [], "sin_caracter",
  nota="Etiqueta de período (Edad Media y Renacimiento), sin carácter emocional común en las fuentes.")
G("nacionalismo-musical", "musica-clasica", ["musica-clasica"], "", "",
  [("wikiteka.com/apuntes/nacionalismo-musical", "movimiento ligado al Romanticismo que se inspira en el folclore y la tradición de cada país")],
  "sin_caracter", nota="Corriente histórica: su carácter es el del folclor que toma en cada país.")
G("neoclasica", "metal", ["power-metal", "technical-metal"], "virtuoso|actitud|neu|definitorio",
  "Acepción de Brian: solo metal neoclásico. Lo distingue el virtuosismo; lo demás lo hereda del power metal.",
  [("lafactoriadelritmo.com/metal-neoclasico", "en su origen fueron un grupo de músicos de inmenso talento y preparación")], "baja",
  hereda=["power-metal"])
G("bandas-sonoras", "bandas-sonoras", [], "", "",
  [("pdfcoffee.com/elementos-que-conforman-una-banda-sonora", "Desde la funcionalidad de la música como portadora de sentimientos y emociones")],
  "sin_caracter", nota="Categoría funcional: acompaña una imagen y su emoción la da la escena.")

# ---------- cristiana ----------
G("musica-cristiana", "musica-cristiana", ["adoracion"], "", "", [], "sin_caracter",
  nota="Categoría temática (letras de fe) con todos los estilos; usar el género musical del disco.")
G("musica-cristiana-contemporanea", "musica-cristiana", ["musica-cristiana"], "", "",
  [("es.wikipedia.org/wiki/M%C3%BAsica_cristiana", "se entiende no propiamente como un estilo musical separado del resto de estilos, sino más bien como una categoría musical cuya lírica representa un contenido de fe cristiana")],
  "sin_caracter", nota="La propia fuente dice que no es un estilo: es temática.")
G("adoracion", "musica-cristiana", ["musica-sacra"],
  "devoto|actitud|pos|definitorio;espiritual/íntimo|ambiente|pos|definitorio;reflexivo|emocion|neu|frecuente",
  "Más íntima y personal que la música sacra litúrgica.",
  [("prezi.com/p/4oyy7vx3h1jg", "facilitando un momento de reflexión y conexión espiritual profunda"),
   ("prezi.com/p/4oyy7vx3h1jg", "reflejando la necesidad de expresar devoción en comunidad")], "baja")
G("white-metal", "metal", ["metal"], "", "", [], "sin_caracter",
  nota="Temático (metal cristiano): suena como cualquier subgénero de metal; usar ese subgénero.")

# ---------- electrónica ----------
G("tech-house", "electronica", ["future-house", "house"],
  "hipnótico|ambiente|neu|definitorio;enérgico/bailable|energia|-|definitorio;nocturno/de club|ambiente|neu|frecuente;"
  "tensión y liberación|emocion|neu|frecuente",
  "Más seco y duro que el deep house, que es cálido y profundo.",
  [("zipdj.com/blog/tech-house", "This rhythmic and hypnotic aesthetic"),
   ("zipdj.com/blog/tech-house", "Designed for underground nightclubs rather than commercial venues, tech house plays with tension and release"),
   ("genre-ai.app/blog/deep-house-vs-tech-house", "tech house is the workhorse that keeps bodies moving"),
   ("genre-ai.app/blog/deep-house-vs-tech-house", "starting deep and warm, then sliding into harder, drier tech house grooves")], "alta")
G("future-house", "electronica", ["tech-house"], "enérgico|energia|-|definitorio;accesible/melódico|actitud|pos|frecuente",
  "Más accesible y melódico que el tech house.",
  [("grokipedia.com/page/Future_house", "with its emphasis on melodic hooks and high-energy drops")], "baja")
G("latin-electronic-fusion", "electronica", ["changa-tuki", "fusion-latina"],
  "fiestero/bailable|energia|-|definitorio;festivo|emocion|pos|frecuente;surrealista|ambiente|neu|frecuente;"
  "nocturno|ambiente|neu|frecuente;futurista|ambiente|neu|frecuente",
  "Ritmos latinos y caribeños sobre electrónica.",
  [("grokipedia.com/page/Latin_Electronic_Music", "its emphasis on festive, body-moving grooves"),
   ("melodigging.com/genre/latin-electronic", "Latin Electronic Argentina · 2000 s Dancing Chill Happy Dreamy Sentimental")], "alta",
  nota="Perfil RYM (192 discos): fiestero, rítmico, surrealista, nocturno, futurista, caótico.")
G("ethereal-wave", "electronica", ["dark-folk", "futurepop"],
  "etéreo/de otro mundo|ambiente|neu|definitorio;gótico/oscuro|ambiente|neg|definitorio;romántico|emocion|pos|definitorio;"
  "introspectivo|emocion|neu|frecuente",
  "La cara etérea y romántica del darkwave.",
  [("academia-lab.com/enciclopedia/onda-eterea", "se describe de diversas formas como \"gótico\", \"romántico\" y \"de otro mundo\""),
   ("pt.wikipedia.org/wiki/Ethereal_wave", "é descrito como \"gótico\", \"romântico\" e \"sobrenatural\""),
   ("radarmusica.com/darkwave", "romanticismo oscuro, ethereal wave y sensibilidad introspectiva")], "alta")
G("futurepop", "electronica", ["ethereal-wave"],
  "optimista|emocion|pos|definitorio;enérgico|energia|-|definitorio;futurista|ambiente|neu|frecuente",
  "Más optimista y bailable que el synthpop, que es melancólico y nostálgico.",
  [("thecontentauthority.com/blog/futurepop-vs-synthpop", "Futurepop tends to be more upbeat and energetic, while synthpop can be more melancholy and introspective"),
   ("thecontentauthority.com/blog/futurepop-vs-synthpop", "characterized by its upbeat and optimistic sound")], "baja",
  nota="Una sola fuente, comparativa.")
G("changa-tuki", "electronica", ["raptor-house", "latin-electronic-fusion"],
  "fiestero/frenético|energia|-|definitorio;crudo|actitud|neu|frecuente;callejero/urbano|ambiente|neu|frecuente;"
  "ingenioso/humorístico|actitud|pos|frecuente;agresivo|actitud|neg|variable",
  "Movimiento caraqueño; el raptor house es su cara más agresiva.",
  [("lyricassistant.com/how-to-write-changa-tuki-songs", "Changa Tuki is raw energy in speaker form"),
   ("crackmagazine.net/article/profiles/history-of-changa-tuki", "is in every way a child of its frenetic mother city: raw, energetic, violent, witty, Caribbean"),
   ("melodigging.com/genre/changa-tuki", "Changa Tuki Venezuela · 1990 s Dancing Intense Happy Dark Sentimental")], "alta",
  nota="Perfil RYM (131 discos): fiestero, rítmico, enérgico, tropical, urbano, nocturno.")
G("raptor-house", "house", ["changa-tuki"],
  "agresivo|actitud|neg|definitorio;enérgico|energia|-|definitorio;humorístico|actitud|pos|frecuente;callejero/urbano|ambiente|neu|frecuente",
  "Dentro de la changa, la variante de sintetizadores y caídas más agresivos.",
  [("grokipedia.com/page/raptor_house", "raptor house emphasizing aggressive synths and drops reflective of Caracas's vibrant yet turbulent urban energy"),
   ("ritmoslatam.distintaslatitudes.net/raptor-house", "los ritmos caribeño y una pizca de humor"),
   ("crackmagazine.net/article/profiles/history-of-changa-tuki", "raw, energetic, violent, witty, Caribbean")], "alta")

# ---------- folk ----------
G("dark-folk", "folk", ["ethereal-wave"], "oscuro|ambiente|neg|definitorio;apocalíptico/ritual|ambiente|neg|frecuente",
  "Nombre alternativo del neofolk.",
  [("es.wikipedia.org/wiki/Neofolk", "Otros términos vagos a veces usados para describir a artistas de este género son «dark folk»"),
   ("es.wikipedia.org/wiki/Neofolk", "imaginería religiosa y apocalíptica")], "baja")
G("nueva-cancion", "folk", ["nueva-trova"],
  "comprometido/combativo|actitud|neu|definitorio;melancólico|emocion|neg|frecuente",
  "Canción política latinoamericana; la nueva trova cubana es más romántica.",
  [("en.wikipedia.org/wiki/Nueva_canci%C3%B3n", "musicians often faced censorship, exile, torture, death, or forceful disappearances"),
   ("en.wikipedia.org/wiki/Nueva_canci%C3%B3n", "a key counterhegemonic institution that broke through the censorship")], "media",
  nota="El perfil RYM (70 discos) solo da «melancholic» (0,08).")
G("nueva-trova", "folk", ["nueva-cancion"],
  "romántico|emocion|pos|frecuente;introspectivo|emocion|neu|frecuente;comprometido|actitud|neu|frecuente",
  "Más romántica e introspectiva que la nueva canción.",
  [("grokipedia.com/page/Nueva_trova", "infused Nueva Trova with romantic introspection"),
   ("havanamusicschool.com/pablo-milanes-el-romantico", "Pablo Milanés – El romántico de la nueva trova")], "media")
G("folk-punk", "punk", ["folk", "street-punk"],
  "crudo/enérgico|energia|-|definitorio;rebelde/político|actitud|neu|frecuente;humorístico|actitud|pos|variable",
  "Energía punk con instrumentos acústicos.",
  [("bayareapunk.com/blog/Folk_Punk", "Raw, energetic, and often acoustic-driven music"),
   ("bayareapunk.com/blog/Folk_Punk", "known for their political lyrics and energetic live performances")], "baja")
G("flamenco", "folk", ["tango"],
  "apasionado|emocion|pos|definitorio;intenso/profundo|emocion|neu|definitorio;festivo|emocion|pos|variable",
  "Lo jondo (profundo) frente a los cantes festivos; el tango es más sensual y nostálgico.",
  [("andalucia.com/flamenco/characteristics", "to see a deep passionate display of flamenco"),
   ("talkpal.ai/culture/what-are-the-linguistic-roots", "A heightened state of emotion, expression, and authenticity in flamenco performance"),
   ("thecontentauthority.com/blog/flamenco-vs-tango", "can create an energetic and festive ambiance")], "alta")
G("tango", "fusion-latina", ["flamenco"],
  "melancólico|emocion|neg|definitorio;nostálgico|emocion|neg|definitorio;sensual|emocion|pos|frecuente;intenso|emocion|neu|frecuente",
  "Más nostálgico que el flamenco, más sensual que el bolero.",
  [("dancefacts.net/tango/tango-music", "nostalgic lyrics, sudden changes in dynamics"),
   ("dancefacts.net/tango/tango-music", "intense but melancholic mood"),
   ("es.wikipedia.org/wiki/Tango", "el ritmo tanguero y su clima nostálgico"),
   ("dancefacts.net/tango/tango-music", "the more “romantic” or “sensual” the tango song is")], "alta")
G("folk-celta", "folk", ["folk"], "noble|actitud|pos|frecuente;reflexivo|emocion|neu|frecuente",
  "", [("musaisong.app/estilo/celtic-folk", "el folk celta requiere perspectiva y nobleza, no fuego rápido")], "baja")
G("musica-navidena", "folk", ["aguinaldo", "gaita-de-furro"],
  "alegre|emocion|pos|definitorio;afectuoso|emocion|pos|frecuente;sereno/en paz|emocion|pos|frecuente",
  "En Venezuela abarca aguinaldos y gaitas, de ahí el «tropical» de RYM.",
  [("elespanol.com/viajes/20231218", "reviven cada año sentimientos de alegría, amor y paz"),
   ("elespanol.com/viajes/20231218", "Villancicos, para unas fechas que predican alegría, buenos sentimientos")], "alta",
  nota="Perfil RYM (65 discos): happy (0,14), tropical (0,11).")
G("musica-infantil", "pop", [], "", "", [], "sin_caracter", nota="Categoría de público, no de estilo.")
G("world-ethnic", "folk", [], "", "", [], "sin_caracter",
  nota="Categoría comercial que reúne folclores de todo el mundo; usar el género concreto.")

# ---------- jazz ----------
G("jazz", "jazz", ["big-band", "smooth-jazz", "blues"],
  "espontáneo/improvisado|actitud|neu|definitorio;juguetón|actitud|pos|frecuente;alegre|emocion|pos|variable;melancólico|emocion|neg|variable",
  "Más variable que el blues: va de la euforia a la melancolía.",
  [("georgecaldwelljazz.com/el-caracter-improvisado", "El carácter improvisado del jazz y su espontaneidad"),
   ("musicway.es/como-expresa-el-jazz", "desde la alegría y la euforia hasta la melancolía y la tristeza")], "media",
  nota="Perfil RYM (148 discos): playful (0,09).")
G("big-band", "jazz", ["jazz", "smooth-jazz"],
  "cálido|ambiente|pos|frecuente;enérgico/bailable|energia|-|frecuente;elegante/sofisticado|actitud|pos|frecuente;nostálgico/vintage|ambiente|neu|variable",
  "Arreglos escritos para baile o concierto, frente al combo pequeño e improvisado.",
  [("radarmusica.com/big-band", "evocar glamour, años 40, crimen, comedia sofisticada, baile, ciudad nocturna, casino, swing o energía vintage"),
   ("radarmusica.com/big-band", "Una Big band puede tocar música muy bailable o música muy sofisticada")], "media",
  nota="Perfil RYM (28 discos): warm (0,20), energetic (0,13).")
G("smooth-jazz", "jazz", ["jazz", "jazz-fusion"],
  "relajante|energia|-|definitorio;romántico|emocion|pos|frecuente;sofisticado|actitud|pos|frecuente",
  "La cara suave y de fondo del jazz.",
  [("audiolover.com/genres/jazz/what-is-smooth-jazz", "can be enjoyed as background music for relaxation"),
   ("audiolover.com/genres/jazz/what-is-smooth-jazz", "This format focused on smooth and romantic R&B and soul music")], "baja")
G("jazz-fusion", "jazz", ["rock-fusion", "smooth-jazz"],
  "enérgico/explosivo|energia|-|frecuente;apasionado|emocion|pos|frecuente;vanguardista|actitud|neu|frecuente",
  "Más enérgico y experimental que el smooth jazz.",
  [("reddigitalcatolica.com/jazz-fusion", "puede pasar de ser suave y melódico a explosivo y enérgico"),
   ("reddigitalcatolica.com/jazz-fusion", "convierten al jazz fusión en un lenguaje expresivo y vanguardista")], "baja",
  nota="Perfil RYM (82 discos): warm, rhythmic (débil).")
G("rock-fusion", "rock", ["jazz-fusion"], "", "", [], "heredado",
  nota="Sin fuentes con carácter propio.", hereda=["jazz-fusion"])
G("instrumental", "instrumental", [], "", "", [], "sin_caracter", nota="Categoría funcional (sin voz).")

# ---------- latina ----------
G("guaracha", "fusion-latina", ["timba", "soca"],
  "picaresco/jocoso|actitud|pos|definitorio;sensual|emocion|pos|frecuente;festivo/exuberante|emocion|pos|frecuente",
  "Canción rápida y burlona; la timba es más agresiva.",
  [("directoriomusicacubana.com/generos/guaracha", "se define por sus temas picarescos y sensuales"),
   ("web.archive.org/web/20100401204320", "de ritmo rpido y texto jocoso"),
   ("thesoundatlas.org/discover/guaracha", "its spirit lives on in the more festive, humorous strands of salsa")], "alta")
G("timba", "fusion-latina", ["guaracha"],
  "agresivo/intenso|actitud|neg|definitorio;bailable|energia|-|frecuente;humor negro/crítico|actitud|neu|variable",
  "La salsa cubana más agresiva y compleja.",
  [("en.wikipedia.org/wiki/Timba", "Because timba is highly aggressive and a challenge to dance to"),
   ("thesoundatlas.org/discover/timba", "addressing the economic desperation of the special period with dark humor")], "alta")
G("samba", "fusion-latina", ["soca"],
  "sensual/corporal|emocion|pos|frecuente;festivo|emocion|pos|frecuente;humorístico|actitud|pos|variable",
  "La samba-canção y la bossa la vuelven más contenida y romántica.",
  [("en.wikipedia.org/wiki/Samba", "the rhythmic-bodily sensuality of traditional samba"),
   ("es.wikipedia.org/wiki/Samba_(m%C3%BAsica)", "habituales reuniones festivas, regadas de música, comida y bebida"),
   ("en.wikipedia.org/wiki/Samba", "generally humorous in character")], "media")
G("vallenato", "fusion-latina", ["cumbia"],
  "romántico|emocion|pos|definitorio;narrativo|actitud|neu|definitorio;festivo|emocion|pos|variable;nostálgico|emocion|neg|variable",
  "Cada aire tiene su carácter: paseo narrativo, merengue festivo, son nostálgico.",
  [("prezi.com/p/fvvztggyud3t", "aborda temáticas románticas y cotidianas, utilizando un lenguaje emotivo y poético"),
   ("vallenatia.org/cultura/aires-del-vallenato", "Narrativo, melódico, pausado Merengue 2/4 Allegro (120-140 BPM) Festivo, rápido, bailable"),
   ("vallenatia.org/cultura/aires-del-vallenato", "Lento, nostálgico, improvisado")], "alta")
G("soca", "fusion-latina", ["samba", "guaracha"],
  "fiestero|energia|-|definitorio;festivo/eufórico|emocion|pos|definitorio;picaresco|actitud|pos|variable",
  "Música de carnaval; más bailable y menos narrativa que el calipso.",
  [("radarmusica.com/soca-que-es", "por qué todo el mundo entra en “modo fiesta” en cuanto suena"),
   ("sfconservatoryofdance.org/dance-music-glossary/soca-music", "its infectious rhythms and vibrant energy"),
   ("es.wikipedia.org/wiki/Soca", "de humor picaresco de subido tono sexual")], "alta")
G("fusion-latina", "fusion-latina", [], "", "", [], "sin_caracter",
  nota="Paraguas de 769 discos sin carácter común; un disco de fusión combina el de sus géneros de base.")
G("folclor-fusion", "fusion-latina", ["joropo-fusion"], "", "", [], "sin_caracter",
  nota="Acepción de Brian: folclore venezolano renovado. Combina el carácter del folclor de base del disco.")
G("joropo-fusion", "fusion-latina", ["folclor-fusion"], "", "", [], "heredado",
  nota="Sin fuentes propias; parte del joropo.", hereda=["joropo"])

# ---------- metal ----------
G("metal", "metal", ["metal-extremo", "heavy-rock"],
  "agresivo|actitud|neg|definitorio;intenso|energia|-|definitorio;oscuro|ambiente|neg|frecuente;rebelde|actitud|neu|frecuente",
  "Más oscuro y agresivo que el hard rock, que es festivo.",
  [("todossomosuno.com.mx/portal/metal-y-psicologia", "con su energía agresiva y ritmos intensos"),
   ("thisvsthat.io/heavy-metal-vs-metal", "Heavy Metal tends to have a darker and more aggressive tone"),
   ("xeriaoficial.com/blog/73-power-metal", "libertad rebeldía historia guerra fantasía")], "alta")
G("metal-extremo", "metal", ["metal"],
  "agresivo|actitud|neg|definitorio;rápido/intenso|energia|-|definitorio;oscuro|ambiente|neg|definitorio",
  "", [("aimusic.so/tag/metal-extremo", "characterized by its aggressive, fast-paced sound, and often dark and complex themes")], "baja")
G("metal-instrumental", "metal", ["metal"], "", "", [], "heredado", nota="Categoría funcional dentro del metal.", hereda=["metal"])
G("death-metal-old-school", "metal", ["death-metal", "death-and-roll"],
  "oscuro|ambiente|neg|definitorio;intenso|energia|-|definitorio;crudo/primitivo|actitud|neu|frecuente;épico|emocion|pos|variable",
  "La forma cruda y fundacional del death metal.",
  [("melodigging.com/genre/old-school-death-metal", "Old School Death Metal United States · 1980 s Intense Dark Epic Sad"),
   ("melodigging.com/genre/old-school-death-metal", "primal atmosphere, and unapologetically heavy sound")], "media")
G("death-and-roll", "metal", ["death-metal-old-school"],
  "hedonista/rebelde|actitud|neu|definitorio;oscuro|ambiente|neg|frecuente;intenso|energia|-|frecuente;bailable|energia|-|variable",
  "Death metal con el balanceo del rock 'n' roll.",
  [("grokipedia.com/page/Death_%27n%27_roll", "frequently explore themes of hedonism , rebellion , and existential despair"),
   ("melodigging.com/genre/death-n-roll", "Death 'n' Roll Sweden · 1990 s Intense Dark Dancing")], "media")
G("death-groove-metal", "metal", ["death-metal"], "", "", [], "heredado", nota="Sin fuentes.", hereda=["death-metal", "groove-metal"])
G("death-metal-progresivo", "metal", ["technical-metal"],
  "agresivo|actitud|neg|definitorio;caótico|ambiente|neg|frecuente",
  "Acepción de Brian: no es death técnico. Le suma ambición compositiva al death metal; el resto lo hereda de él.",
  [("breakpointmetal.com/genero/progressive-death-metal", "fusiona la agresividad vocal y rítmica del death metal con la complejidad estructural"),
   ("deathdoom.com/death-metal/progressive-death-metal", "Chaotic song structures")], "baja", hereda=["death-metal"])
G("technical-metal", "metal", ["death-metal-progresivo"], "", "Rasgo técnico, no emocional.", [], "heredado",
  nota="Las fuentes solo describen técnica; hereda del metal.", hereda=["metal"])
G("melodic-metal", "metal", ["metal"], "épico|emocion|pos|frecuente;agresivo|actitud|neg|variable",
  "Equilibrio entre melodía y potencia.",
  [("decrowned.fi/l/what-is-melodic-metal", "contrast between aggressive and epic moods")], "baja")
G("power-metal-sinfonico", "metal", ["power-metal-progresivo", "power-metal"],
  "épico|emocion|pos|definitorio;grandioso|ambiente|pos|frecuente;contrastado|energia|-|frecuente",
  "Power metal con orquesta y coros.",
  [("xeriaoficial.com/blog/73-power-metal", "coros épicos arreglos inspirados en la música clásica"),
   ("xeriaoficial.com/blog/73-power-metal", "contrastes entre momentos suaves y explosiones de potencia")], "baja", hereda=["power-metal"])
G("power-metal-progresivo", "metal", ["power-metal-sinfonico"],
  "heroico/épico|emocion|pos|definitorio;luminoso|emocion|pos|frecuente;intenso|energia|-|frecuente",
  "", [("melodigging.com/genre/progressive-power-metal", "the speed, bright melodies, and heroic tone of power metal"),
       ("melodigging.com/genre/progressive-power-metal", "Progressive Power Metal Sweden · 1990 s Epic Happy Intense Dark Dreamy")], "media")
G("dark-metal", "metal", ["doom-metal"], "oscuro|ambiente|neg|definitorio;depresivo|emocion|neg|definitorio",
  "Entre doom y black metal.",
  [("metal-addiction.com/2024/06/17", "fusionar elementos de doom y black metal con una temática depresiva y suicida")], "baja")
G("metal-latino", "metal", ["metal"], "", "", [], "heredado", nota="Etiqueta regional.", hereda=["metal"])
G("barquisimetal", "metal", ["metal"], "", "", [], "heredado",
  nota="Escena y sitio de Barquisimeto, no un estilo; hereda del metal.", hereda=["metal"])
G("guarorock", "rock", ["rock"], "", "", [], "heredado", nota="Etiqueta regional (Barquisimeto).", hereda=["rock"])

# ---------- pop ----------
G("balada", "pop", ["bolero"],
  "romántico|emocion|pos|definitorio;pausado|energia|-|definitorio;apasionado|emocion|pos|frecuente",
  "Heredera del bolero: canción de amor lenta.",
  [("es.wikipedia.org/wiki/Balada_rom%C3%A1ntica", "una canción de amor de tiempo lento, interpretada por un cantante solista"),
   ("es.wikipedia.org/wiki/Balada", "cuando deciden llamar \"ballad\" a los temas lentos de temática romántica")], "alta",
  nota="Perfil RYM (177 discos): romantic, passionate.")
G("dance-pop", "pop", ["balada"],
  "bailable/enérgico|energia|-|definitorio;fiestero|energia|-|frecuente;alegre|emocion|pos|frecuente;juguetón|actitud|pos|frecuente",
  "", [("en.wikipedia.org/wiki/Dance-pop", "Up-tempo and upbeat music that dance-oriented or dance-centered")], "alta",
  nota="Perfil RYM (182 discos): rhythmic, energetic, party, playful.")

# ---------- punk ----------
G("hardcore-punk", "punk", ["hardcore-melodico", "raw-punk"],
  "agresivo|actitud|neg|definitorio;crudo|actitud|neu|definitorio;caótico|ambiente|neg|frecuente;intenso|energia|-|definitorio",
  "Más rápido y agresivo que el punk; el melódico añade introspección.",
  [("thisvsthat.io/hardcore-punk-vs-melodic-hardcore", "The atmosphere at a hardcore punk show is often chaotic and aggressive"),
   ("thisvsthat.io/hardcore-punk-vs-melodic-hardcore", "Sound Fast, aggressive, raw")], "alta",
  nota="Perfil RYM (154 discos): raw, aggressive.")
G("hardcore-melodico", "punk", ["hardcore-punk"],
  "emotivo/introspectivo|emocion|neu|definitorio;agresivo|actitud|neg|frecuente;enérgico|energia|-|frecuente",
  "", [("thisvsthat.io/hardcore-punk-vs-melodic-hardcore", "melodic hardcore tends to have a more introspective and emotional lyrical approach"),
       ("thisvsthat.io/hardcore-punk-vs-melodic-hardcore", "blending melody and aggression to create a unique and emotionally charged sound")], "media")
G("raw-punk", "punk", ["hardcore-punk", "crust-punk"], "", "", [], "heredado",
  nota="Las fuentes solo lo usan como adjetivo.", hereda=["hardcore-punk", "crust-punk"])
G("street-punk", "punk", ["oi", "hardcore-punk"],
  "desolador|emocion|neg|frecuente;irreverente|actitud|neu|definitorio;callejero/pendenciero|ambiente|neu|frecuente",
  "", [("es.wikipedia.org/wiki/Street_punk", "su mensaje era más desolador e irreverente"),
       ("es.wikipedia.org/wiki/Street_punk", "se refieren a temas sobre las peleas, beber, hacer fiestas, la violencia")], "media")
G("oi", "punk", ["street-punk"], "", "", [], "heredado", nota="Sin fuentes propias; pariente directo del street punk.", hereda=["street-punk"])
G("emo", "punk", ["hardcore-melodico"],
  "emotivo/apasionado|emocion|pos|definitorio;melancólico|emocion|neg|definitorio;introspectivo/confesional|emocion|neu|frecuente;"
  "ansioso|emocion|neg|frecuente;crudo|actitud|neu|frecuente;depresivo|emocion|neg|variable",
  "", [("scarystudies.com/goth-vs-punk-vs-emo", "confessional expression, introspection, emotionally intense feelings"),
       ("en.wikipedia.org/wiki/Emo", "his cracked, almost distraught, intense vocal style"),
       ("scarystudies.com/goth-vs-punk-vs-emo", "emo encompasses the same interests in darkness and melancholy expression")], "alta",
  nota="Perfil RYM (99 discos): passionate, raw, melancholic, sentimental, anxious, depressive.")
G("psychobilly", "punk", ["horror-punk", "rockabilly"],
  "agresivo|actitud|neg|frecuente;macabro/terror|ambiente|neg|definitorio;juguetón/kitsch|actitud|pos|definitorio;caótico|energia|-|frecuente",
  "Rockabilly juguetón con agresión punk y terror de serie B.",
  [("musicadviser.co.uk/music-genres", "a fusion of rockabilly's twangy, bouncy energy with punk rock's raw aggression and theatrical horror aesthetic"),
   ("en.wikipedia.org/wiki/Psychobilly", "the \"aesthetics of kitsch, camp and cheese\" are openly embraced"),
   ("musicadviser.co.uk/music-genres", "Psychobilly dancing is deliberately chaotic")], "alta")
G("horror-punk", "punk", ["psychobilly", "deathrock"],
  "macabro/terror|ambiente|neg|definitorio;humor negro|actitud|neu|frecuente;crudo/agresivo|energia|-|definitorio",
  "", [("grokipedia.com/page/Horror_punk", "a raw, aggressive energy derived from punk rock foundations"),
       ("grokipedia.com/page/Horror_punk", "often infused with dark humor or satire"),
       ("revistafantastique.com/horror-punk", "con temáticas y estéticas inspirados en el cine de terror de serie B")], "alta")
G("deathrock", "punk", ["horror-punk"],
  "mórbido|ambiente|neg|definitorio;oscuro|ambiente|neg|definitorio;teatral|actitud|neu|frecuente;crudo|actitud|neu|frecuente",
  "Más crudo y punk que el rock gótico.",
  [("easure.net/en/pages/deathrock", "combining raw energy with a morbid, theatrical mood"),
   ("easure.net/en/pages/deathrock", "a mixture of punk and gothic with a dark mood and horror influences"),
   ("es.wikipedia.org/wiki/Deathrock", "evocan directamente a la muerte y no únicamente la visión romántica de ésta")], "alta")
G("punk-metal", "punk", ["hardcore-punk"],
  "agresivo|actitud|neg|definitorio;rápido/directo|energia|-|definitorio",
  "Crossover thrash: hardcore y thrash.",
  [("radarmusica.com/crossover-thrash", "suena rápido, seco, agresivo y directo"),
   ("hermpie.com/crossover-thrash", "Speed and aggression are central to Crossover Thrash")], "alta")
G("blackened-crust", "punk", ["crust-punk"],
  "oscuro/sombrío|ambiente|neg|definitorio;frío|ambiente|neg|frecuente;agresivo|actitud|neg|definitorio;intenso|energia|-|frecuente",
  "", [("radarmusica.com/crust-punk", "riffs más fríos, atmósfera oscura, voces más extremas y una estética más sombría"),
       ("melodigging.com/genre/blackened-crust", "Blackened Crust Canada · 2000 s Intense Dark Sad Epic")], "alta")
G("sludge-metal", "metal", ["doom-metal", "hardcore-punk"],
  "opresivo|emocion|neg|definitorio;denso/sucio|ambiente|neg|definitorio;lento/pesado|energia|-|definitorio;agresivo|actitud|neg|frecuente",
  "Lentitud del doom con agresión del hardcore.",
  [("breakpointmetal.com/genero/sludge-metal", "dando como resultado un sonido denso, sucio y emocionalmente opresivo"),
   ("melodigging.com/genre/blackened-crust", "Sludge metal is a hybrid of doom metal’s slow, downtuned weight and hardcore punk’s raw aggression")], "alta",
  nota="Perfil RYM (67 discos): heavy.")

# ---------- reggae ----------
G("reggae-y-ska", "reggae-y-ska", ["roots-reggae", "rocksteady"],
  "romántico|emocion|pos|frecuente;consciente|actitud|neu|frecuente", "Paraguas; el resto se hereda de reggae y ska.",
  [("en.wikipedia.org/wiki/Roots_reggae", "Although romantic songs continued to predominate"),
   ("en.wikipedia.org/wiki/Reggae", "contribution to international discourse on issues of injustice, resistance, love and humanity")],
  "media", hereda=["reggae", "ska"])
G("roots-reggae", "reggae-y-ska", ["rocksteady", "ragga"],
  "espiritual|ambiente|pos|definitorio;consciente/combativo|actitud|neu|definitorio;nostálgico|emocion|neg|variable",
  "", [("thereggaeinstitute.org/historical-eras", "Rastafari spiritual themes • Liberation, justice, and identity narratives"),
       ("en.wikipedia.org/wiki/Roots_reggae", "is shaped by desire, nostalgia and trauma")], "alta")
G("rocksteady", "reggae-y-ska", ["roots-reggae"],
  "romántico|emocion|pos|definitorio;relajado|energia|-|frecuente",
  "Más lento y romántico que el ska.",
  [("en.wikipedia.org/wiki/Reggae", "a genre slower than ska featuring more romantic lyrics"),
   ("es.wikipedia.org/wiki/Rocksteady", "Las letras del rocksteady van desde temas románticos"),
   ("grokipedia.com/page/Rocksteady", "leveraging rocksteady's laid-back groove for romantic and social themes")], "alta")
G("ragga", "reggae-y-ska", ["roots-reggae"], "enérgico/animado|energia|-|definitorio;optimista|emocion|pos|frecuente",
  "Más enérgico que el reggae.",
  [("thecontentauthority.com/blog/reggae-vs-ragga", "It is a more upbeat and energetic style of music"),
   ("thecontentauthority.com/blog/reggae-vs-ragga", "instantly uplifts my mood")], "baja")

# ---------- rock ----------
G("rock-and-roll", "rock", ["rockabilly", "twist"],
  "enérgico|energia|-|definitorio;alegre/animado|emocion|pos|definitorio;rebelde|actitud|neu|frecuente;juvenil/salvaje|actitud|neu|frecuente",
  "", [("thisvsthat.io/rock-and-roll-vs-rockabilly", "Style Upbeat, energetic Upbeat, twangy"),
       ("thisvsthat.io/rock-and-roll-vs-rockabilly", "characterized by its energetic and rebellious sound"),
       ("es.wikipedia.org/wiki/Rockabilly", "volviéndose más salvaje y juvenil")], "alta", nota="Perfil RYM (18 discos): energetic.")
G("rockabilly", "rock", ["rock-and-roll", "psychobilly"],
  "juguetón|actitud|pos|definitorio;enérgico|energia|-|definitorio;atrevido/sensual|emocion|pos|frecuente;nostálgico|emocion|neu|variable",
  "Más campestre (twangy) que el rock and roll.",
  [("corbetosboots.com/blog/moteros", "Atrevimiento, sensualidad y diversión a partes iguales"),
   ("en.wikipedia.org/wiki/Rockabilly", "creating a subculture rooted in music, dance and nostalgia")], "alta",
  nota="Perfil RYM (19 discos): playful (0,26), energetic (0,26).")
G("twist", "rock", ["rock-and-roll"], "bailable|energia|-|definitorio;alegre|emocion|pos|frecuente",
  "", [("melodigging.com/genre/twist", "Twist United States · 1960 s Dancing Happy Sentimental")], "baja")
G("beat", "rock", ["rock-and-roll"], "melancólico|emocion|neg|variable", "", [], "baja",
  nota="Sin fuentes web con carácter; rasgo débil del perfil RYM (30 discos: melancholic 0,10). Lo demás hereda del rock.",
  hereda=["rock"])
G("glam-rock", "rock", ["heavy-rock"],
  "hedonista/sensual|emocion|pos|definitorio;bailable/pegadizo|energia|-|frecuente;teatral|actitud|neu|frecuente",
  "", [("es.wikipedia.org/wiki/Glam_rock", "letras hedonistas y superficiales que interpretaba de forma deliberadamente sensual"),
       ("es.wikipedia.org/wiki/Glam_rock", "su boogie rock pegadizo, influido por melodías bailables")], "media")
G("heavy-rock", "rock", ["metal", "glam-rock"], "rudo/pesado|actitud|neu|definitorio;festivo|emocion|pos|frecuente",
  "Más festivo y bluesero que el heavy metal.",
  [("es.wikipedia.org/wiki/Hard_rock", "más «pesados» y «rudos» que el tradicional"),
   ("es.wikipedia.org/wiki/Hard_rock", "más festivas en el hard rock (a excepciones)")], "media")
G("rock-progresivo", "rock", ["rock-sinfonico", "space-rock"], "épico|emocion|pos|variable;enérgico|energia|-|variable",
  "", [("resonanciaprogresiva.blogspot.com", "considerada por algunos como el primer álbum de rock progresivo épico")], "baja",
  nota="El perfil RYM (324 discos) solo da energetic (0,15): no hay carácter emocional común fuerte.")
G("rock-sinfonico", "rock", ["rock-progresivo"], "grandioso/exuberante|ambiente|pos|frecuente", "",
  [("dlsi.ua.es/~inesta/Prog", "Caracterizado por el lujo en teclas y sintetizadores y por las voces melódicas")], "baja",
  hereda=["rock-progresivo"])
G("space-rock", "rock", ["neo-psicodelia", "rock-progresivo"],
  "onírico/etéreo|ambiente|neu|definitorio;atmosférico|ambiente|neu|definitorio;psicodélico|ambiente|neu|frecuente",
  "", [("ourmusicworld22.substack.com", "to create a dreamy, ethereal sound"),
       ("bingleymusiclive.com/musical-genres-glossary/space-rock", "the atmospheric textures and ambient soundscapes of space rock")], "alta")
G("rock-melodico", "rock", ["aor"], "nostálgico|emocion|neg|variable", "Se identifica con el AOR (estilo).",
  [("ecured.cu/Rock_mel%C3%B3dico", "O también conocido como melodic rock (AOR)"),
   ("billboard.com/lists/las-50-mejores-bandas", "letras poéticas y nostálgicas")], "baja", hereda=["aor"])
G("rock-instrumental", "rock", ["rock"], "", "", [], "heredado", nota="Categoría funcional dentro del rock.", hereda=["rock"])
G("rock-electronico", "rock", ["rock", "electronica"], "", "", [], "heredado", nota="Sin fuentes con carácter.", hereda=["rock", "electronica"])
G("ethnic-rock", "rock", ["rock"], "", "", [], "heredado",
  nota="Sin fuentes; combinar con el folclor del disco.", hereda=["rock"])
G("neo-psicodelia", "rock-psicodelico", ["space-rock"],
  "psicodélico|ambiente|neu|definitorio;atmosférico|ambiente|neu|definitorio;surrealista|ambiente|neu|frecuente;hipnótico|ambiente|neu|frecuente",
  "", [("grokipedia.com/page/Neo-psychedelia", "trippy soundscapes, experimental production techniques, and evocative atmospheres"),
       ("grokipedia.com/page/Neo-psychedelia", "echoing guitars, modal structures, and hypnotic rhythms")], "alta",
  nota="Perfil RYM (156 discos): psychedelic, atmospheric, surreal, dense, ethereal, mysterious.")

# ---------- venezolana ----------
G("tonada", "musica-venezolana", ["pasaje"], "sencillo|actitud|neu|frecuente;cariñoso|emocion|pos|variable",
  "Canto de trabajo del llano (ordeño, arreo), no de baile.",
  [("es.wikipedia.org/wiki/Llanero", "denominadas propiamente cantos de ordeño y cabresteo"),
   ("cuentaelabuelo.blogspot.com/2010/02/la-tonada", "esta forma de música sencilla, proyectada por el trabajador rural"),
   ("cuentaelabuelo.blogspot.com/2010/02/la-tonada", "las palabras cariñosas a la vaca Canastilla")], "baja")
G("aguinaldo", "musica-venezolana", ["gaita-de-furro", "musica-navidena"],
  "festivo/parrandero|emocion|pos|frecuente;devoto|actitud|pos|variable",
  "Hay aguinaldos de parranda y aguinaldos religiosos.",
  [("es.wikipedia.org/wiki/Aguinaldo_(Venezuela)", "los aguinaldos pueden dividirse en aguinaldos de parranda y aguinaldos religiosos")],
  "baja", hereda=["musica-navidena"])
G("vals-venezolano", "musica-venezolana", ["vals-andino"],
  "elegante|actitud|pos|frecuente;romántico/serenatero|emocion|pos|frecuente",
  "", [("orinocopadrerio.blogspot.com/2014/03/el-vals-venezolano", "abiertas a los serenateros, recorriendo con su elegancia melódica")], "baja")
G("merengue-venezolano", "musica-venezolana", ["vals-venezolano"],
  "alegre/festivo|emocion|pos|definitorio;bailable|energia|-|definitorio",
  "Merengue caraqueño de cinco por ocho.",
  [("prezi.com/p/cdnnp0jcd7sd", "desborda un sin fin de ritmos y alegrías a nivel personal, donde el goce, la efervescencia"),
   ("prezi.com/p/cdnnp0jcd7sd", "detallándolo como género musical bailable")], "baja")
G("golpe-larense", "musica-venezolana", ["tamunangue"], "festivo|emocion|pos|definitorio;bailable|energia|-|frecuente",
  "Se canta y baila en fiestas patronales; el tamunangue es su contraparte ritual.",
  [("eltocuyo.com/en/did-you-know/golperos-del-tocuyo", "Golpe is music to sing and dance to : groups of four to six musicians animate patron saint festivities, parrandas, vigils, weddings")],
  "baja")
G("bambuco", "musica-andina-venezolana", ["vals-andino"],
  "romántico|emocion|pos|definitorio;idílico|ambiente|pos|definitorio;señorial|actitud|pos|frecuente",
  "", [("absolutviajes.com/venezuela/musica-tradicional-venezolana", "se caracteriza por ser melodías románticas, idílicas con ciertos matices señoriales"),
       ("labrujuladelcanto.com/2022/04", "se caracteriza por ofrecer melodías románticas, idílicas y con ciertos matices señoriales"),
       ("es.wikipedia.org/wiki/M%C3%BAsica_de_Venezuela", "encontrándose en estos últimos bajo formas de melodías románticas")], "alta",
  nota="Dos de las fuentes repiten el mismo texto.")
G("vals-andino", "musica-andina-venezolana", ["bambuco", "vals-venezolano"], "", "", [], "heredado",
  nota="Sin fuente propia clara.", hereda=["musica-andina-venezolana", "vals-venezolano"])
G("musica-venezolana", "musica-venezolana", [], "", "", [], "sin_caracter", nota="Paraguas nacional.")
G("musica-oriental", "musica-venezolana", ["polo-oriental", "malaguena", "jota-oriental", "galeron"],
  "melancólico|emocion|neg|heredado;triste|emocion|neg|heredado;festivo|emocion|pos|heredado", "",
  [("musicamargaritayoriental.blogspot.com", "tiene el ritmo y el sentimiento de la música oriental venezolana")], "heredado",
  nota="Familia con dos polos: polo, malagueña y jota son melancólicos; galerón y gaita, festivos. Los dos quedan como heredados (de malagueña, jota, galerón y gaita oriental).")
G("musica-andina-venezolana", "musica-venezolana", ["bambuco"],
  "suave/acompasado|energia|-|definitorio;romántico|emocion|pos|frecuente",
  "", [("hablemosdeculturas.com/musica-andina-venezolana", "ha tomado melodías suaves y acompasadas que pueden llegar a recordar los boleros"),
       ("hablemosdeculturas.com/musica-andina-venezolana", "se le da el nombre de melodías románticas")], "baja")
G("tambor-afrovenezolano", "musica-venezolana", ["fulia", "sangueo"], "", "", [], "heredado",
  nota="Sin fuentes nuevas; hereda de sus géneros de la muestra.", hereda=["sangueo", "fulia"])
G("musica-de-camara-popular", "musica-venezolana", [], "", "", [], "sin_caracter", nota="Formato, no estilo.")
G("ritmo-orquidea", "musica-venezolana", [], "", "", [], "sin_caracter", nota="Sin fuentes en la web.")
G("gaita-de-furro", "gaita", ["aguinaldo"],
  "alegre/festivo|emocion|pos|definitorio;devoto|actitud|pos|variable;contestatario|actitud|neu|variable;romántico|emocion|pos|variable",
  "Gaita zuliana: costumbrista, de protesta, chiquinquireña o romántica según la letra.",
  [("infoguia.com/infotip.asp?t=expresion-del-sentir-venezolano", "es escuchada en cada rincón de Venezuela alegrando el ambiente decembrino"),
   ("infoguia.com/infotip.asp?t=expresion-del-sentir-venezolano", "de protesta, que denuncia situaciones sociales y políticas, la chiquinquireña")], "alta",
  nota="Perfil RYM de «gaita» (79 discos): tropical, rhythmic, uplifting, playful.")

# ---------- revisión de la muestra (decisiones 1–3) ----------
REV = {
    "gaban": dict(confianza="heredado", heredaDe=["golpe-llanero"],
                  fuentes=[("pdfcoffee.com/pdf-trabajo-de-joropo", "presencia de figuras hemiólicas, ya sea por grupos de cuatro corcheas ó de dos corcheas más una negra, así como por figuraciones en blancas, como suele suceder en el Gabán")],
                  nota="Es un golpe (la fuente lo pone como ejemplo de la rítmica de los golpes): hereda del golpe llanero."),
    "golpe-y-estribillo": dict(confianza="heredado", heredaDe=["golpe-llanero"],
                               nota="Forma del joropo oriental y guayanés; sin fuentes con carácter. Hereda del golpe."),
    "puntillanto": dict(familia="musica-oriental", caracter_extra=["rítmico|energia|-|frecuente"],
                        fuentes=[("grokipedia.com/page/francisco_mata", "the plaintive polo margariteño, languid malagueña, rhythmic puntillanto")],
                        nota="Familia cambiada a música oriental: las fuentes lo nombran con el polo y la malagueña de Margarita."),
    "gaita-oriental": dict(confianza="baja", caracter_extra=["festivo/parrandero|emocion|pos|frecuente", "comunitario|ambiente|pos|frecuente"],
                           fuentes=[("radio.otilca.org/por-que-llamamos-gaita", "específicamente al hecho de “parrandear”"),
                                    ("sierraalta.substack.com/p/la-gaita-margaritena", "en la familia, en las fiestas, en los encuentros comunitarios y también en el duelo")],
                           nota="Gaita margariteña: parranda de Pascua; también se canta en el duelo."),
    "merengue-oriental": dict(confianza="heredado", heredaDe=["merengue-venezolano"],
                              nota="Sin fuentes con carácter (solo etiquetas de «diversiones margariteñas»). Hereda del merengue venezolano, no de la familia oriental, que es mayormente melancólica."),
    "motivo-guaiqueri": dict(confianza="heredado", heredaDe=["musica-oriental"],
                             fuentes=[("grokipedia.com/page/francisco_mata", "he innovated the 'Motivo Guaiquerí' rhythm in 1964")],
                             nota="Ritmo creado por Francisco Mata en 1964; sin fuentes con carácter. Hereda de la familia oriental (ambivalente)."),
}

# ---------- ronda 2 (2026-11-12): consultas nuevas + Wikipedia/Melodigging directos ----------
# Melodigging agrega etiquetas de ánimo de varias fuentes (Spotify, RYM, Discogs, usuarios): cuenta como una fuente.
R2 = {
    "guasa": dict(conf="media", car="jocoso/burlesco|actitud|pos|definitorio;festivo/bullicioso|emocion|pos|frecuente",
                  f=[("comoeslacosa.wordpress.com/2008/07/24/joropo", "se referían a los merengues que portaban letras jocosas, burlescas, guasonas"),
                     ("algunasconsideracionessobrelaguasaenv.blogspot.com", "como la guasa es sinónimo de bochinche, de algarabía, de divertimento")]),
    "tonada": dict(conf="media", car="nostálgico|emocion|neg|definitorio",
                   f=[("es.wikipedia.org/wiki/M%C3%BAsica_llanera", "melodías alegres, recias y nostálgicas, como las tonadas")],
                   nota="Wikipedia en inglés describe la tonada chilena como melancólica; no se usa (otro país)."),
    "golpe-y-estribillo": dict(car="festivo|emocion|pos|frecuente",
                               f=[("es.wikipedia.org/wiki/Joropo_oriental", "El joropo oriental es una danza que se realiza tradicionalmente en las fiestas patronales")],
                               nota="Ronda 2: el joropo oriental es de fiesta patronal (rasgo propio débil); el resto sigue heredado del golpe."),
    "puntillanto": dict(conf="media", f=[("es.wikipedia.org/wiki/Francisco_Mata", "el puntillanto o punto marinero cadencioso")],
                        nota="Ronda 2: Wikipedia confirma «cadencioso» y lo nombra entre los cantos margariteños."),
    "merengue-oriental": dict(conf="baja", car="alegre/contagioso|emocion|pos|definitorio;bailable|energia|-|definitorio",
                              f=[("undiaunacancion.es/descubriendo-la-musica-de-la-region-orien", "que cuenta con un ritmo alegre y contagioso que invita a bailar")],
                              nota="Ronda 2: una fuente con carácter propio (alegre, bailable); coincide con lo heredado del merengue venezolano."),
    "musica-oriental": dict(f=[("soloenmargarita.blogspot.com/2014/12/musica-margaritena", "con letras nos llevan de la alegría a la melancolía")],
                            nota="Ronda 2: una fuente confirma los dos polos (de la alegría a la melancolía)."),
    "aguinaldo": dict(conf="media", car="alegre|emocion|pos|definitorio",
                      f=[("danzamundial.net/danzas-tradicionales-por-region/aguinaldo-v", "se caracteriza por su ritmo alegre y pegajoso"),
                         ("danzamundial.net/danzas-tradicionales-por-region/aguinaldo-v", "letras que reflejan la devoción religiosa, la alegría de la Navidad")]),
    "vals-venezolano": dict(conf="alta", car="sentimental|emocion|pos|frecuente;nostálgico|emocion|neg|frecuente;triste|emocion|neg|variable",
                            f=[("melodigging.com/genre/vals-venezolano", "Vals Venezolano Venezuela · 1840 s Romantic Sentimental Chill Dancing Sad"),
                               ("melodigging.com/genre/vals-venezolano", "and sung in nostalgic salon style"),
                               ("pianospuch.com.ar/canciones-venezolanas-en-piano", "conservó la elegancia y el sentimiento del vals original")]),
    "merengue-venezolano": dict(conf="alta", car="picaresco|actitud|pos|definitorio;sensual|emocion|pos|frecuente",
                                f=[("pianospuch.com.ar/canciones-venezolanas-en-piano", "se caracteriza por su ritmo sincopado y su carácter festivo y picaresco"),
                                   ("radio.otilca.org/el-merengue-caraqueno-o-merengue-rucaneao", "hace referencia al baile sensual y erótico que lo caracterizaba"),
                                   ("roomlab.cl/blog/origen-del-merengue-venezolano", "hacía referencia al baile sensual y erótico que lo caracterizaba")]),
    "sangueo": dict(conf="media", car="devoto|actitud|pos|frecuente;festivo|emocion|pos|frecuente",
                    f=[("radio.otilca.org/ritmos-tradicionales-de-venezuela-el-sangue", "deben cantar y bailar al ritmo del SANGUEO")],
                    nota="Ronda 2: canto de promesa y parranda a San Juan."),
    "tambor-afrovenezolano": dict(conf="baja", car="festivo/jubiloso|emocion|pos|definitorio",
                                  f=[("porunavenezuelaposible.com/tambores-venezolanos", "se interpretan en celebraciones llenas de júbilo, cantos y bailes afrovenezolanos")],
                                  nota="Ronda 2: rasgo propio (júbilo); lo demás sigue heredado de sangueo y fulía."),
    "harmonica-blues": dict(conf="media", car="intenso|emocion|neu|frecuente",
                            f=[("melodigging.com/genre/harmonica-blues", "Harmonica Blues United States · 1930 s Dancing Intense Sad Dark Sentimental")]),
    "futurepop": dict(conf="media", reemplazar=True,
                      car="bailable|energia|-|definitorio;melancólico/romántico|emocion|neg|definitorio;épico|emocion|pos|frecuente;"
                          "futurista|ambiente|neu|definitorio;optimista|emocion|pos|variable",
                      f=[("minatrix.fm/es/news/id-263", "Potencia de club melancolía romántica sonido nítido y pulido vibe cyberpunk"),
                         ("melodigging.com/genre/futurepop", "Futurepop Germany · 1990 s Dancing Epic Sentimental Sad Dark")],
                      nota="Ronda 2 CORRIGE la 0.2.0: «optimista» venía de una sola fuente comparativa; dos fuentes lo describen bailable y melancólico."),
    "future-house": dict(conf="media", car="alegre|emocion|pos|frecuente;onírico|ambiente|neu|variable",
                         f=[("melodigging.com/genre/future-house", "Future House Netherlands · 2010 s Dancing Happy Epic Dreamy")]),
    "dark-folk": dict(conf="alta", car="sombrío/triste|emocion|neg|definitorio;solitario|emocion|neg|frecuente;místico|ambiente|neu|frecuente",
                      f=[("melodigging.com/genre/dark-folk", "Dark folk is a somber, acoustic-centered branch of folk"),
                         ("observatoriodosfamosos.com.br/coluna/adames-news/a-arte-tran", "explorando temas de tristeza, solidão, morte, natureza e misticismo")]),
    "folk-punk": dict(conf="media", car="comunitario|ambiente|pos|frecuente;alegre|emocion|pos|variable",
                      f=[("melodigging.com/genre/folk-punk", "Folk Punk United Kingdom · 1980 s Intense Happy Sentimental Sad Dancing"),
                         ("melodigging.com/genre/folk-punk", "making folk punk a vibrant, community‑driven micro‑culture")]),
    "folk-celta": dict(car="romántico|emocion|pos|variable",
                       f=[("es.wikipedia.org/wiki/M%C3%BAsica_celta", "El movimiento musical celta, de carácter romántico")],
                       nota="Ronda 2: solo una mención con «cita requerida»; sigue baja."),
    "smooth-jazz": dict(conf="media", car="onírico|ambiente|neu|variable",
                        f=[("melodigging.com/genre/smooth-jazz", "Smooth Jazz United States · 1970 s Chill Romantic Sentimental Dreamy Happy")]),
    "jazz-fusion": dict(conf="media", car="intenso|emocion|neu|frecuente;épico|emocion|pos|variable",
                        f=[("melodigging.com/genre/jazz-fusion", "Jazz Fusion United States · 1960 s Dancing Chill Intense Epic Dreamy")]),
    "musica-de-camara": dict(conf="media", car="romántico/sentimental|emocion|pos|frecuente;melancólico|emocion|neg|variable",
                             f=[("melodigging.com/genre/chamber-music", "Chamber Music Italy · 1600 s Romantic Chill Sentimental Sad Dreamy")]),
    "neoclasica": dict(conf="media", car="épico|emocion|pos|definitorio;intenso|emocion|neu|frecuente;oscuro|ambiente|neg|variable",
                       f=[("melodigging.com/genre/neoclassical-metal", "Neoclassical Metal Sweden · 1980 s Epic Intense Dark Sad Sentimental"),
                          ("breakpointmetal.com/genero/neoclassical-metal", "pone el énfasis en la destreza instrumental, la precisión técnica y la elaboración melódica")]),
    "death-metal-progresivo": dict(conf="media", car="oscuro|ambiente|neg|definitorio;épico|emocion|pos|frecuente;intenso|emocion|neu|frecuente",
                                   f=[("melodigging.com/genre/progressive-death-metal", "Progressive Death Metal United States · 1980 s Intense Dark Epic Sad Dreamy")]),
    "melodic-metal": dict(conf="media", car="emotivo|emocion|pos|frecuente;intenso|emocion|neu|frecuente",
                          f=[("melodigging.com/genre/melodic-metal", "Melodic Metal Germany · 1980 s Epic Intense Happy Sentimental Sad"),
                             ("decrowned.fi/l/heavy-metal-vs-melodic-metal", "melody-forward writing, harmonized guitars, emotional lift")]),
    "power-metal-sinfonico": dict(conf="media", car="alegre|emocion|pos|frecuente;onírico|ambiente|neu|variable",
                                  f=[("melodigging.com/genre/symphonic-power-metal", "Symphonic Power Metal Italy · 1990 s Epic Happy Dancing Dreamy Sentimental")]),
    "technical-metal": dict(conf="baja", car="intenso|emocion|neu|frecuente;oscuro|ambiente|neg|frecuente",
                            f=[("melodigging.com/genre/technical-death-metal", "Technical Death Metal United States · 1980 s Intense Dark Epic Sad")],
                            nota="Ronda 2: rasgos propios débiles (una fuente agregada); lo demás sigue heredado del metal."),
    "ragga": dict(conf="media", car="romántico|emocion|pos|variable;intenso|emocion|neu|frecuente",
                  f=[("melodigging.com/genre/ragga", "Ragga Jamaica · 1980 s Dancing Intense Happy Dark Sentimental"),
                     ("mundodadanca.com.br/2015/10/ragga-ou-dancehall", "os cantores dirigem-se freqüentemente a interesses românticos e de rastafari")]),
    "twist": dict(conf="media", f=[("es.wikipedia.org/wiki/Twist_(baile)", "El twist es un baile basado en el rock and roll muy popular a comienzos de la década de 1960")]),
    "beat": dict(conf="media", car="alegre|emocion|pos|frecuente;bailable|energia|-|frecuente;romántico|emocion|pos|frecuente",
                 f=[("melodigging.com/genre/merseybeat", "Merseybeat United Kingdom · 1960 s Happy Dancing Romantic Sentimental Chill")],
                 nota="Ronda 2: el merseybeat se describe alegre, bailable y romántico; el «melancólico» de RYM queda como variable."),
    "rock-progresivo": dict(conf="media", car="épico|emocion|pos|definitorio;onírico|ambiente|neu|frecuente;melancólico|emocion|neg|variable",
                            f=[("melodigging.com/genre/progressive-rock", "Progressive Rock United Kingdom · 1960 s Epic Dreamy Sad Sentimental Intense")]),
    "rock-sinfonico": dict(conf="media", car="épico|emocion|pos|definitorio;romántico|emocion|pos|frecuente;onírico|ambiente|neu|frecuente",
                           f=[("melodigging.com/genre/symphonic-prog", "Symphonic Prog United Kingdom · 1970 s Epic Sentimental Dreamy Romantic Sad")]),
    "rock-melodico": dict(conf="media", car="romántico|emocion|pos|frecuente;alegre|emocion|pos|frecuente;épico|emocion|pos|frecuente",
                          f=[("melodigging.com/genre/aor", "Aor United States · 1970 s Happy Romantic Sentimental Epic Sad"),
                             ("qconciertos.es/estilo/genre-melodic-rock", "combinando intros de piano o guitarra acústica con finales épicos y orquestales")]),
    "rock-fusion": dict(conf="baja", car="intenso|emocion|neu|frecuente;alegre|emocion|pos|variable",
                        f=[("melodigging.com/genre/jazz-rock", "Jazz Rock United States · 1960 s Intense Dancing Happy Chill Sentimental")]),
    "raw-punk": dict(conf="media", car="intenso|emocion|neu|definitorio;oscuro|ambiente|neg|frecuente;crudo/primitivo|actitud|neu|definitorio",
                     f=[("melodigging.com/genre/raw-punk", "Raw Punk Sweden · 1980 s Intense Dark Sad Sentimental"),
                        ("melodigging.com/genre/d-beat", "D-beat is a raw, fast, and politically charge")]),
}

# Ronda 3 (2026-11-12, contexto social): para los 13 géneros débiles y los 4 heredados sin justificación se
# investigó qué son, de dónde vienen, dónde y cuándo se tocan, en qué ambiente y quién los escucha.
# ctx = {queEs, origen, dondeYCuando, ambiente, publico} redactado SOLO con lo que dicen las citas de `f`
# (o las ya existentes del género); desc = descripción breve del género. heredaDe=None quita la herencia.
OPP = "orinocopadrerio.blogspot.com/2011/11/llano-adentro"
TOC = "eltocuyo.com/sabias-que/golperos-del-tocuyo-golpe-larense"
R3 = {
    "corrio": dict(
        conf="alta",
        car="recio/turbulento|energia|-|definitorio;narrativo|actitud|neu|definitorio;desafiante/altivo|actitud|pos|frecuente",
        f=[(OPP, "el corrío es turbulento, atravesado"),
           (OPP, "El corrío llanero representa la idiosincrasia del hombre llanero, su temperamento recio"),
           (OPP, "se interpreta en los parrandos llaneros que se celebran en la sabana"),
           (OPP, "El género narrativo del corrío, que refiere sucesos populares, se origina en la romanza española"),
           ("musicallanera.net/resenas/el-pasaje-llanero", "A diferencia del golpe recio o el corrío, el pasaje se distingue por su carácter pausado y melódico"),
           ("es.wikipedia.org/wiki/Joropo_llanero", "se distinguen por su capacidad para evocar el carácter desafiante y guerrero del llanero"),
           ("elrinconcolombiano.com/torneo-internacional-del-corrio-llanero", "es un ritmo recio escrito en versos octosílabos")],
        ctx=dict(queEs="Modalidad del joropo llanero de ritmo rápido («golpe por corrío», en 3/4) en la que el cantador narra una historia: sucesos de la vida o del trabajo, leyendas, espantos, gestas de la Independencia, amores y la fauna del llano.",
                 origen="Viene del romance español narrativo, que en el llano se llenó de temas, lugares y modismos venezolanos. Es una de las modalidades más antiguas del joropo; muchas letras corren de boca en boca y pierden a su autor.",
                 dondeYCuando="En los parrandos llaneros de la sabana y en festivales y torneos de joropo a ambos lados de la frontera (Torneo Internacional del Corrío Llanero, Puerto Carreño, desde 1987).",
                 ambiente="Arpa, cuatro y maracas en un golpe recio, en tono mayor y a tempo acelerado; voz fuerte del cantador. Lo contrario del pasaje, que es pausado y sentimental.",
                 publico="La gente del llano —vaqueros, campesinos, copleros— y quienes lo heredan en la ciudad; se canta como retrato del llanero: recio, valiente, altivo, noble y hospitalario."),
        desc="Canto narrativo y recio del llano: el cantador cuenta una historia sobre un golpe rápido de arpa, cuatro y maracas. Suena desafiante y orgulloso, y es de parranda, no de despecho.",
        nota="Ronda 3: fuente venezolana amplia (Orinoco Padre Río) más Wikipedia y musicallanera; ya no depende del texto de un restaurante."),
    "golpe-larense": dict(
        conf="alta",
        car="alegre/vivaz|emocion|pos|definitorio;devoto|emocion|pos|frecuente;picaresco|actitud|pos|frecuente;nostálgico (lejos del terruño)|emocion|neg|variable",
        f=[(TOC, "aire alegre y vivaz"),
           (TOC, "animan fiestas patronales, parrandas, velorios, bodas y reuniones comunitarias"),
           (TOC, "La devoción religiosa (muchos golpes son dedicados a santos)"),
           (TOC, "La crítica social y política picaresca"),
           ("es.wikipedia.org/wiki/Golpe_tocuyano", "El golpe tocuyano se ejecuta tradicionalmente al inicio del alba tras velorios"),
           ("eltocuyohistoriacolonial.blogspot.com/2013/04/historia-del-golpe", "es ágil, vivaz y rítmicamente rápido"),
           ("sentirlarense.blogspot.com/2007/10/el-golpe-larense", "es la expresión nostálgica que le brota de la garganta al tocuyano cuando lejos de su terruño, escucha entonar un Golpe")],
        ctx=dict(queEs="Música campesina cantada y bailada del estado Lara, sobre todo de El Tocuyo (golpe tocuyano; también carorense y sanareño), en compás ternario y con estribillos que el público repite.",
                 origen="Se formó en el valle de El Tocuyo desde el siglo XVII, de la mezcla de la música española con la indígena y la africana: cuerdas criollas (cuatro, cinco, medio-cinco, requinto) con tambora y maracas.",
                 dondeYCuando="Fiestas patronales (13 de junio, 8 de diciembre), parrandas, bodas, reuniones comunitarias y los pagos de promesa del Tamunangue; tradicionalmente al amanecer, tras los velorios.",
                 ambiente="Conjunto de cuatro a seis músicos, aire alegre y vivaz; letras sobre el trabajo del campo, la devoción a los santos y la crítica social picaresca.",
                 publico="Las comunidades campesinas y los pueblos de Lara, las radios comunitarias tocuyanas y grupos juveniles que lo aprenden en casas de cultura; para el tocuyano emigrado es canto de nostalgia y orgullo."),
        desc="Golpe campesino de Lara: alegre, vivaz y de estribillo coreado, entre la fiesta del santo y la parranda, con letras devotas o picarescas. Fuera de su tierra se oye con nostalgia.",
        nota="Ronda 3: tres fuentes tocuyanas más Wikipedia confirman el carácter festivo y devoto."),
    "gaita-oriental": dict(
        conf="media",
        car="familiar/comunitario|ambiente|pos|definitorio;doliente (también se canta en el duelo)|emocion|neg|variable",
        f=[("sierraalta.substack.com/p/la-gaita-margaritena", "La gaita margariteña no se formó en los escenarios ni en la industria cultural, sino en la vida cotidiana"),
           ("sierraalta.substack.com/p/la-gaita-margaritena", "en la familia, en las fiestas, en los encuentros comunitarios y también en el duelo"),
           ("radio.otilca.org/por-que-llamamos-gaita-a-la-gaita-margaritena-iii", "La gaita margariteña siempre ha estado presente en nuestras parrandas decembrinas"),
           ("soloenmargarita.blogspot.com/2014/12/musica-margaritena", "es cantada por un solista, sin coros y versificada en décima")],
        ctx=dict(queEs="Canto margariteño en décima (espinela), tradicionalmente a solo y sin coro, en 5/8 o 6/8; con la gaita antillana y el gaitón forma las «gaitas de oriente». No es pariente musical de la gaita zuliana.",
                 origen="Nace de la copla y el romance españoles y de la guitarra campesina en la isla de Margarita (Nueva Esparta); grabaciones de referencia de 1963–1964 (Quinteto Contrapunto, Canto Margariteño).",
                 dondeYCuando="En las parrandas decembrinas de Pascua, en la casa y la familia, en encuentros comunitarios y también en el duelo.",
                 ambiente="Voz solista que improvisa o canta décimas sobre guitarra o cuatro; a veces, por influencia del aguinaldo, con coro y tambor.",
                 publico="Margariteños de pueblos y familias con tradición decimista; hoy también intérpretes jóvenes de fuera de la isla."),
        desc="Décima cantada de Margarita, de casa y de parranda navideña: festiva y comunitaria, pero lo bastante íntima como para acompañar también un duelo.",
        nota="Ronda 3: fuentes margariteñas (Otilca, Sierraalta, Solo en Margarita) sostienen el contexto; el carácter afectivo sigue con pocas citas."),
    "merengue-oriental": dict(
        ctx=dict(queEs="Variante del merengue venezolano del oriente, sobre todo de Margarita y Sucre.",
                 origen="Sin fuente propia sobre su origen; aparece en discos de música oriental junto al merengue caraqueño.",
                 dondeYCuando="Sin fuente que lo precise.",
                 ambiente="Ritmo alegre y contagioso que invita a bailar (única fuente con carácter).",
                 publico="Sin fuente que lo precise."),
        desc="Merengue del oriente venezolano: alegre y bailable. Del resto (picardía, sensualidad) solo hay herencia del merengue venezolano.",
        nota="Ronda 3: sin fuentes nuevas; las «diversiones» margariteñas son otra forma (teatro callejero de Pascua y Carnaval), no se usan."),
    "motivo-guaiqueri": dict(
        conf="media", heredaDe=["merengue-oriental"],
        car="costumbrista/marinero|ambiente|pos|definitorio",
        f=[("es.wikipedia.org/wiki/Francisco_Mata", "Mata fue el creador del ritmo que se conoce como Motivo Guaiquerí, similar al merengue"),
           ("radio.otilca.org/ocho-anos-sin-francisco-mata", "muy semejante al merengue, pero con un compás y una acentuación musical distintos"),
           ("radio.otilca.org/los-sabores-margaritenos", "describe los momentos previos a la salida de uno de los tantos peñeros"),
           ("orinocopadrerio.blogspot.com/2014/01/los-cinco-grandes", "El Motivo Guaiquerí , ritmo que se popularizó en todo el país")],
        ctx=dict(queEs="Ritmo margariteño parecido al merengue, con otro compás, otra acentuación y otra manera de tocar el cuatro.",
                 origen="Lo creó Francisco «Chico Toño» Mata con el Conjunto Guaiquerí; su primera pieza fue «La Pesca» (1964). El nombre honra al pueblo guaiquerí, pescadores de Margarita.",
                 dondeYCuando="Se popularizó en todo el país desde los discos de Chico Toño; se oye en el repertorio de música oriental y en cantos a la Virgen del Valle.",
                 ambiente="Canciones costumbristas de la isla: la salida de los peñeros, la pesca, los dulces y comidas margariteñas, la devoción a la Virgen del Valle.",
                 publico="El oriente venezolano y la gente de mar de Margarita; luego, el público nacional de la música tradicional."),
        desc="Merengue a la margariteña inventado por Chico Toño Mata: bailable y costumbrista, canta la vida marinera de la isla.",
        nota="Ronda 3: deja de heredar de «música oriental» (que traía melancolía) y hereda del merengue oriental, que es su base según tres fuentes."),
    "tambor-afrovenezolano": dict(
        conf="alta",
        car="devoto|emocion|pos|definitorio;bailable|energia|-|definitorio;ritual (trance, comunión)|ambiente|neu|frecuente;comunitario|ambiente|pos|frecuente",
        f=[("es.wikipedia.org/wiki/Fiesta_de_San_Juan_de_Curiepe", "es música de golpe, con ritmo y por supuesto bailable, el canto expresa la devoción al santo"),
           ("en.wikipedia.org/wiki/Tambor_(dance)", "Tambor is a secular and religious coastal Afro-Venezuelan music and dance"),
           ("en.wikipedia.org/wiki/Tambor_(dance)", "It is a cultural manifestation in South America originating in the slaves from Africa"),
           ("notialternativo.wordpress.com/2013/06/23", "comienza la larga noche de entrega y devoción a san Juan"),
           ("panorama.onl/facetas/la-fiesta-de-san-juan", "Desde la víspera y, sobre todo, al amanecer, el pueblo se reúne"),
           ("porunavenezuelaposible.com/tambores-venezolanos", "los tambores crean un sentido de comunidad e identidad")],
        ctx=dict(queEs="Música y baile de tambores de la costa afrovenezolana (culo e' puya, mina y curbata, cumaco), con canto responsorial; religiosa y profana a la vez.",
                 origen="Herencia de los africanos esclavizados (tambores de origen kongo) en las haciendas de la costa, fundida con el culto católico a los santos.",
                 dondeYCuando="Fiestas de San Juan Bautista (23–24 de junio) en Barlovento, Curiepe, la costa de Aragua y Carabobo y barrios de Caracas como La Vega; velorio la víspera, misa, procesión y repique hasta el amanecer.",
                 ambiente="Altar del santo, licor, pañuelos y turbantes rojos, calor; ritmos que empiezan como invocación y crecen hasta el baile colectivo. Letras improvisadas sobre la vida, la esperanza y el amor.",
                 publico="Las comunidades afrodescendientes de la costa y sus cofradías, devotos de San Juan y vecinos; las fiestas de San Juan son Patrimonio Inmaterial de la Humanidad."),
        desc="El tambor de la costa: fiesta devota y nocturna a San Juan, bailable y colectiva, de repique que se alarga hasta el amanecer.",
        nota="Ronda 3: Wikipedia (es/en) y prensa venezolana confirman el carácter festivo-devoto propio; la herencia de sangueo y fulía queda como complemento."),
    "musica-andina-venezolana": dict(
        conf="media",
        car="cadencioso|energia|-|frecuente;festivo (encuentros de pueblo)|emocion|pos|variable;devoto (paraduras navideñas)|emocion|pos|variable",
        f=[("es.wikipedia.org/wiki/M%C3%BAsica_de_Venezuela", "el bambuco es un ritmo acompasado y cadencioso que tiene su origen en España y América"),
           ("es.wikipedia.org/wiki/M%C3%BAsica_de_Venezuela", "encontrándose en estos últimos bajo formas de melodías románticas"),
           ("es.wikipedia.org/wiki/M%C3%BAsica_de_Venezuela", "esta se desarrolla folkloricamente de manera colectiva"),
           ("es.wikipedia.org/wiki/Joropo_andino", "El joropo andino es interpretado con frecuencia en los encuentros festivos de los Andes"),
           ("es.wikipedia.org/wiki/Paradura_del_Ni%C3%B1o", "Las paraduras más tradicionales son las llamadas paraduras cantadas")],
        ctx=dict(queEs="Conjunto de ritmos de Táchira, Mérida y Trujillo: bambuco, vals, pasillo, joropo andino y música tachirense de raíz, con violín, bandolín, mandolina, tiple, cuatro y guitarra.",
                 origen="Mestizaje campesino de formas españolas (vals, pasillo, bambuco) con lo andino y lo llanero; el violín y el bandolín tachirense le dan su sonido propio.",
                 dondeYCuando="Encuentros festivos de los pueblos andinos y, de enero al 2 de febrero, las paraduras del Niño cantadas en casas y pueblos del páramo.",
                 ambiente="Melodías suaves, acompasadas y románticas; en lo tachirense, canto e improvisación colectivos sobre el «canto firme del bandolín».",
                 publico="Familias y comunidades de los Andes, incluidos los pueblos del páramo; en Zulia, Lara y Caracas llega como «melodías románticas»."),
        desc="Música de los Andes venezolanos: suave, cadenciosa y romántica, de violín y bandolín, para el encuentro del pueblo y la paradura navideña.",
        nota="Ronda 3: Wikipedia (Música de Venezuela, Joropo andino, Paradura del Niño) suma contexto y el rasgo cadencioso."),
    "vals-andino": dict(
        f=[("es.wikipedia.org/wiki/Vals_venezolano", "En los Andes venezolanos se crea el pasillo, forma de valse andino"),
           ("aleph.org.mx/que-es-el-vals-andino", "regiones donde se compone, se canta y se ejecuta el vals"),
           ("es.wikipedia.org/wiki/Joropo_andino", "a menudo junto a otros ritmos como merengues, valses, bambucos")],
        ctx=dict(queEs="El vals venezolano tal como se toca en Táchira, Mérida, Trujillo y Lara; en los Andes dio origen al pasillo.",
                 origen="Del vals europeo de salón, criollizado en Venezuela en el siglo XIX y adaptado en los Andes.",
                 dondeYCuando="En los encuentros festivos de los pueblos andinos, junto al joropo andino, el merengue y el bambuco.",
                 ambiente="Sin fuente propia sobre el ánimo: se toma el del vals venezolano y el de la música andina.",
                 publico="Las comunidades andinas, semillero de compositores y músicos de vals."),
        desc="El vals venezolano con acento andino: romántico, sentimental y algo nostálgico, de baile de pueblo y serenata (carácter heredado con justificación).",
        nota="Ronda 3: herencia JUSTIFICADA: tres fuentes lo sitúan como el vals venezolano de los Andes; no se halló una descripción propia de su ánimo."),
    "musica-coral": dict(
        conf="media",
        car="sereno|emocion|pos|frecuente;dramático|energia|-|frecuente;devoto/espiritual|emocion|pos|frecuente",
        f=[("thesoundatlas.org/discover/choral-music", "Sonic Qualities Acoustic Orchestral Straight Consonant Dramatic Chanted"),
           ("thesoundatlas.org/discover/choral-music", "Choral music has been inseparable from religious practice in the West for over a millennium"),
           ("choralfestcostarica.org/the-history-and-evolution-of-choral-music", "the serene beauty of a Renaissance motet, the dramatic intensity of a Baroque oratorio"),
           ("choralfestcostarica.org/the-history-and-evolution-of-choral-music", "in communal singing connected with ceremony, storytelling, worship and theater")],
        ctx=dict(queEs="Música escrita para coro: desde el canto llano y la polifonía hasta misas, oratorios, cantatas y obras corales contemporáneas.",
                 origen="El canto en grupo es universal; en Occidente la tradición coral nació ligada al culto (monasterios, catedrales, coral luterana) y luego pasó al concierto.",
                 dondeYCuando="Iglesias, salas de concierto, festivales corales y agrupaciones universitarias o comunitarias; en el catálogo, coros como la Schola Cantorum de Caracas y el Orfeón Universitario y obras como la Cantata criolla.",
                 ambiente="Voces acústicas y consonantes, de ritmo regular, a veces con orquesta; va de la serenidad del motete a la intensidad dramática del oratorio.",
                 publico="Fieles y público de concierto; buena parte del coro es aficionado: se canta en comunidad tanto como se escucha."),
        desc="Coro: voces juntas, serenas o dramáticas según la obra, nacidas del culto y hoy también de concierto y de comunidad.",
        nota="Ronda 3: Sound Atlas y Choral Fest. No se halló fuente sobre el movimiento coral venezolano (pendiente)."),
    "adoracion": dict(
        conf="media",
        car="congregacional/comunitario|ambiente|pos|definitorio;emotivo|emocion|pos|frecuente",
        f=[("dlkpraiseandworship.com/where-the-sound-began", "Congregational singing grew from choral recitations to communal anthems , shaped by emotion and experience"),
           ("dlkpraiseandworship.com/where-the-sound-began", "Clapping, dancing, spontaneous singing—it was all part of a spiritual awakening"),
           ("dlkpraiseandworship.com/where-the-sound-began", "saw young Christians trade hymnals for acoustic guitars"),
           ("en.wikipedia.org/wiki/Contemporary_worship", "contemporary worship uses contemporary worship music in an informal setting"),
           ("ktfnews.com/es/contemporary-worship-music", "La música de adoración contemporánea une las prácticas devocionales públicas y privadas")],
        ctx=dict(queEs="Canciones cristianas contemporáneas de alabanza y adoración, pensadas para que la congregación las cante.",
                 origen="Estados Unidos, años sesenta y setenta: el Jesus Movement cambió el himnario por la guitarra acústica; luego creció con conferencias, sellos y bandas de adoración.",
                 dondeYCuando="En el culto de iglesias evangélicas (bautistas, metodistas, pentecostales, no denominacionales), en conferencias de adoración y en la oración privada.",
                 ambiente="Formato de banda pop-rock en un ambiente informal; aplausos, baile y canto espontáneo; himnos colectivos movidos por la emoción.",
                 publico="Congregaciones evangélicas, con fuerte presencia juvenil desde su origen."),
        desc="Alabanza para cantar en grupo: devota, emotiva y comunitaria, de banda moderna y culto informal.",
        nota="Ronda 3: se evita el artículo de Wikipedia «Contemporary worship music» (marcado por texto generado) y una web polémica contraria al género."),
    "folk-celta": dict(
        conf="media",
        car="agridulce (alegría y pena)|emocion|neg|frecuente;bailable|energia|-|frecuente;identitario|actitud|pos|variable",
        f=[("celticmusik.com/what-is-celtic-music", "This music shows the joy, sorrow, struggles, and wins of a people in its sound."),
           ("celticmusik.com/what-is-celtic-music", "Music had a main function in dancing, storytelling, and other community events."),
           ("es.wikipedia.org/wiki/M%C3%BAsica_celta", "El movimiento musical celta, de carácter romántico"),
           ("es.wikipedia.org/wiki/M%C3%BAsica_celta", "La escena de la música celta implica un gran número de festivales de música")],
        ctx=dict(queEs="Música tradicional de Irlanda, Escocia, Bretaña, Galicia y otras naciones celtas, y el folk moderno que la reinterpreta (gaita, violín, arpa, flauta, bodhrán).",
                 origen="Tradiciones de baile y canto de los pueblos celtas, mantenidas a veces como resistencia cultural; resurgió desde los años setenta (Clannad, Alan Stivell).",
                 dondeYCuando="Fiestas locales y festoù-noz, sesiones en pubs y una red de festivales (Lorient, Ortigueira, Celtic Connections); también en Latinoamérica.",
                 ambiente="Danzas rápidas junto a baladas narrativas: alegría y pena en la misma música.",
                 publico="Comunidades de las naciones celtas y su diáspora, y aficionados del folk en todo el mundo."),
        desc="Folk celta: baile y relato, entre la alegría de la danza y la pena de la balada, con orgullo de identidad.",
        nota="Ronda 3: el «carácter romántico» de Wikipedia lleva [cita requerida]; por eso se queda en «media»."),
    "rock-fusion": dict(
        conf="media",
        car="enérgico|energia|-|frecuente;virtuoso/exploratorio|actitud|neu|frecuente",
        f=[("en.wikipedia.org/wiki/Jazz_fusion", "The pioneers of fusion emphasized exploration, energy, electricity, intensity, virtuosity, and volume."),
           ("clubgre2jazz.com/es/guias/que-es-el-jazz-fusion", "combina la improvisación, la armonía y la complejidad rítmica del jazz con la energía eléctrica"),
           ("clubgre2jazz.com/es/jazz/estilos/jazz-fusion", "En España, la fusión y el jazz-rock tienen una presencia fuerte en festivales y salas")],
        ctx=dict(queEs="Rock que se mezcla con otras músicas; las fuentes describen sobre todo el jazz-rock: improvisación y armonía del jazz con la electricidad del rock y el funk.",
                 origen="Finales de los sesenta (Miles Davis y su entorno: Corea, Hancock, McLaughlin), cuando músicos de jazz criados con el rock adoptaron guitarras eléctricas y teclados.",
                 dondeYCuando="Salas de conciertos y festivales de jazz y rock.",
                 ambiente="Guitarras distorsionadas, baterías contundentes, teclados; secciones improvisadas largas, virtuosismo y volumen.",
                 publico="Músicos y oyentes atentos a la ejecución: público de jazz que buscaba energía y público de rock que buscaba complejidad."),
        desc="Rock que se abre a otras músicas: enérgico, virtuoso y de improvisación. En el catálogo son bandas venezolanas como Todas las Abuelas Son Feas, Animal Estelar o Hojalata Suite.",
        nota="Ronda 3: las fuentes hablan del jazz-rock (pariente documentado); falta una fuente sobre la fusión del rock venezolano."),
    "metal-extremo": dict(
        conf="alta",
        car="contundente/violento|energia|-|definitorio;inconformista|actitud|neu|frecuente",
        f=[("ca.wikipedia.org/wiki/Extreme_metal", "El metal extrem és un terme utilitzat per englobar els subgèneres de heavy metal més agressius."),
           ("webmetalextremo.com/guias/metal-extremo", "voces guturales, afinaciones más graves, riffs de enorme densidad"),
           ("webmetalextremo.com/guias/metal-extremo", "El metal extremo sigue vivo porque nunca nació para encajar."),
           ("webmetalextremo.com/guias/metal-extremo", "funcionan como puntos de encuentro donde el metal extremo se reconoce a sí mismo como comunidad internacional"),
           ("bravorock.com/noticias/obscene-extreme-2026", "un punto de peregrinación anual para miles de seguidores del metal extremo")],
        ctx=dict(queEs="Paraguas de los subgéneros más agresivos del metal: thrash, death, black, grindcore y el doom extremo.",
                 origen="De finales de los setenta y los ochenta (Alemania, Escandinavia, Suramérica, Suiza, Estados Unidos): el thrash abrió el camino y el death le dio voces guturales, afinaciones graves y baterías que golpean.",
                 dondeYCuando="Salas pequeñas del circuito underground, demos y festivales especializados (Obscene Extreme, Maryland Deathfest, Hellfest, Wacken).",
                 ambiente="Velocidad o lentitud aplastante, densidad, violencia sonora deliberada; atmósferas sin salida.",
                 publico="Una comunidad internacional fiel, que peregrina a festivales; música que «nunca nació para encajar»."),
        desc="Lo más agresivo del metal: contundente, oscuro e intenso, música de culto underground y de comunidad.",
        nota="Ronda 3: tres fuentes nuevas además de la anterior."),
    "technical-metal": dict(
        conf="media",
        car="complejo/virtuoso|actitud|neu|definitorio;agresivo|emocion|neg|frecuente;tenso/disonante|ambiente|neg|frecuente",
        f=[("thesoundatlas.org/discover/technical-death-metal", "Technical Death Metal adds labyrinthine compositional complexity to death metal's sonic extremity."),
           ("thesoundatlas.org/discover/technical-death-metal", "Sonic Qualities Crushingly Heavy Atmospheric Driving Chromatic Aggressive Virtuosic"),
           ("thesoundatlas.org/discover/technical-death-metal", "Many founding practitioners were self-taught musicians from modest backgrounds"),
           ("en.wikipedia.org/wiki/Technical_death_metal", "The technical death metal genre has also been influenced by mostly jazz fusion")],
        ctx=dict(queEs="Death metal de composición laberíntica: cambios de compás, armonía cromática y disonante, ejecución virtuosa.",
                 origen="Finales de los ochenta en Estados Unidos, Canadá y Europa (Death, Atheist, Cynic, Gorguts), con influencia del jazz fusión y del thrash progresivo; muchos pioneros eran autodidactas de origen modesto.",
                 dondeYCuando="Circuito underground del death metal, sellos y blogs especializados; en el catálogo, demos y discos de bandas venezolanas (Puah, 15 Weeks).",
                 ambiente="Pesadez aplastante a tempos muy altos, tensión permanente, precisión como valor central.",
                 publico="Oyentes y músicos que valoran la destreza instrumental tanto como la brutalidad."),
        desc="Death metal de precisión: agresivo, tenso y virtuoso; se escucha tanto con la cabeza como con el cuerpo.",
        nota="Ronda 3: Sound Atlas y Wikipedia."),
    "dark-metal": dict(
        conf="media",
        car="introspectivo|emocion|neu|frecuente;triste/solitario|emocion|neg|frecuente;romántico/sensual|emocion|pos|variable",
        f=[("en.wikipedia.org/wiki/Dark_metal", "Lyrics are generally dark and introspective with inspiration from gothic fiction as well as personal experiences."),
           ("en.wikipedia.org/wiki/Dark_metal", "the bleak, icy atmospherics of goth rock with the loud guitars and aggression of heavy metal"),
           ("es.wikipedia.org/wiki/Dark_metal", "Suele abordar temas relacionados con el amor, la pasión, la soledad, la tristeza")],
        ctx=dict(queEs="Metal oscuro de atmósfera gótica: guitarras pesadas con teclados, voces graves y letras introspectivas. Wikipedia lo trata como metal gótico; el término también se usa para bandas entre el black y el doom.",
                 origen="Principios de los noventa en el norte de Inglaterra (Paradise Lost, My Dying Bride, Anathema), del death-doom y el rock gótico; se extendió por Escandinavia, Alemania y Holanda.",
                 dondeYCuando="Escenas góticas y metaleras de Europa y América; en el catálogo, bandas venezolanas como Noctambulath y Vrantia y el recopilatorio Venezuela Dark Side.",
                 ambiente="Atmósferas frías y desoladas; temas de amor, pasión, soledad, tristeza, sangre y oscuridad, con influencia de la poesía y el romanticismo.",
                 publico="Público metalero cercano a la subcultura gótica."),
        desc="Metal sombrío y melancólico: oscuro, introspectivo y triste, a veces romántico.",
        nota="Ronda 3: se usa el metal gótico como pariente documentado (redirección de Wikipedia)."),
    "death-groove-metal": dict(
        conf="media",
        car="pesado|energia|-|definitorio;callejero|ambiente|neu|frecuente",
        f=[("es.wikipedia.org/wiki/Groove_metal", "centrándose más en la pesadez que en la velocidad"),
           ("en.wikipedia.org/wiki/Extreme_metal", "forged a streetwise, death-derived groove metal"),
           ("thesoundatlas.org/discover/groove-metal", "Sonic Qualities Crushingly Heavy Dense Danceable Chromatic Aggressive Virtuosic")],
        ctx=dict(queEs="Death metal con el groove del groove metal: riffs pesados y sincopados a medio tiempo en vez de velocidad constante.",
                 origen="Años noventa: el groove metal nace del thrash en Nueva Orleans, Nueva York y Texas (Exhorder, Prong, Pantera) y bandas como Sepultura lo acercan al death.",
                 dondeYCuando="Escena metalera de los noventa en adelante; sin discos en el catálogo por ahora.",
                 ambiente="Densidad aplastante, agresividad y un pulso que invita a moverse.",
                 publico="Metaleros de escena; es música de mosh."),
        desc="Death metal con groove: pesado, agresivo y callejero, más de golpe rítmico que de velocidad.",
        nota="Ronda 3: herencia JUSTIFICADA (death + groove metal) y dos rasgos propios citados."),
    "oi": dict(
        conf="alta", heredaDe=None, reemplazar=True,
        car="combativo (de clase obrera)|actitud|pos|definitorio;himno coreable (cantos de fútbol y de taberna)|ambiente|pos|definitorio;callejero/rudo|actitud|neu|definitorio",
        f=[("en.wikipedia.org/wiki/Oi!", "Stylistic origins Punk rock pub rock drinking songs football chants"),
           ("en.wikipedia.org/wiki/Oi!", "The music and its associated subculture aimed to unite punks , skinheads , and generally disaffected working-class youth."),
           ("en.wikipedia.org/wiki/Oi!", "movement was a rough brand of working-class rebellion."),
           ("es.wikipedia.org/wiki/Oi!", "Las canciones trataban del desempleo, los derechos de los trabajadores, el acoso de la policía")],
        ctx=dict(queEs="Punk de la calle y la clase obrera, de estribillos para corear en grupo, ligado a la subcultura skinhead.",
                 origen="Este de Londres, 1979–1981 (Cockney Rejects, Sham 69, Angelic Upstarts); el nombre lo popularizó el periodista Garry Bushell. Mezcla punk, pub rock, ska, canciones de taberna y cánticos de fútbol.",
                 dondeYCuando="Pubs, conciertos de barrio y tabernas; el ambiente de grada de fútbol pasa al concierto.",
                 ambiente="Coros masivos, guitarras simples y directas; letras sobre desempleo, derechos laborales, abuso policial, violencia callejera, fútbol, sexo y alcohol.",
                 publico="Juventud obrera, punks y skinheads. Hubo infiltración de extrema derecha en los ochenta, pero muchas bandas fundadoras la rechazaron y existe una larga tradición Oi! antirracista y de izquierda. En el catálogo: bandas venezolanas como Piolet (Rock Proletario) o Acción Directa."),
        desc="Punk obrero de estribillo coreado: combativo, rudo y de calle, más rebelde y solidario que desolado.",
        nota="Ronda 3: deja de heredar del street punk (que le daba «desolador», sin apoyo) y pasa a carácter propio con Wikipedia (es/en)."),
}


def main(camp1, camp2, out, camp3=None, camp4=None):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import fuentes_web as F
    urls = []; pagina = {}
    for camp in [c for c in (camp1, camp2, camp3, camp4) if c]:
        for f in glob.glob(camp + "/grupos/*.json"):
            if not f.endswith(".map.json"):
                for d in json.load(open(f))["documentos"]:
                    if d.get("sha256"):
                        urls.append(d["url"]); pagina.setdefault(d["url"], f"{camp}/pages/{d['sha256']}.html")
    urls = sorted(set(urls))
    nrm = lambda t: re.sub(r"[^a-z0-9]+", " ", F.norm(t)).strip()
    corta = lambda u: re.sub(r"^https?://(www\.)?", "", u)

    def res(p, cita=""):
        c = [u for u in urls if corta(u).startswith(p)]
        if len(c) > 1 and cita:  # varias capturas con el mismo prefijo: la que contiene la cita
            c = [u for u in c if nrm(cita)[:60] in nrm(F.texto(open(pagina[u], errors="ignore").read()))][:1]
        if len(set(c)) != 1:
            raise SystemExit(f"URL {'ambigua' if c else 'sin captura'}: {p} {c[:3]}")
        return c[0]

    def car(s):
        out = []
        for x in filter(None, s.split(";")):
            es, eje, val, fz = x.split("|")
            out.append([es, eje, None if val == "-" else val, fz])
        return out

    perf = {p["slug"]: p for p in json.load(open(RAIZ / "perfil-generos-rym.json"))["generos"]}
    muestra = json.load(open(RAIZ / "caracter-muestra-0.1.0.src.json"))
    gen = []
    for g in muestra["generos"]:
        r = REV.get(g["slug"])
        if r:
            g = dict(g)
            g["caracter"] = g["caracter"] + car(";".join(r.get("caracter_extra", [])))
            g["fuentes"] = g["fuentes"] + [[res(u, c), c] for u, c in r.get("fuentes", [])]
            for k in ("familia", "confianza", "heredaDe"):
                if k in r:
                    g[k] = r[k]
            g["nota"] = r["nota"]
            g["revisado"] = "0.2.0"
        gen.append(g)
    vistos = {g["slug"] for g in gen}
    for e in L:
        assert e["slug"] not in vistos, e["slug"]
        vistos.add(e["slug"])
        g = {"slug": e["slug"], "familia": e["familia"], "comparadoCon": e["comparadoCon"], "caracter": car(e["car"]),
             "contraste": e["contraste"], "fuentes": [[res(u, c), c] for u, c in e["fuentes"]], "confianza": e["confianza"],
             "lote": 2}
        if e["nota"]:
            g["nota"] = e["nota"]
        if e["heredaDe"]:
            g["heredaDe"] = e["heredaDe"]
        p = perf.get(e["slug"])
        if p and p.get("tipico"):
            g["comunidadRym"] = {"discos": p["discosRym"],
                                 "tipico": [[t["descriptor"], round(t["share"], 2)] for t in p["tipico"][:7]]}
        gen.append(g)
    # ronda 2: añade rasgos y citas (o reemplaza el carácter si la ronda corrige la anterior)
    for g in gen:
        r = R2.get(g["slug"])
        if not r:
            continue
        nuevos = car(r.get("car", ""))
        if r.get("reemplazar"):
            g["caracter"] = nuevos
        else:
            ya = {c[0] for c in g["caracter"]}
            g["caracter"] += [c for c in nuevos if c[0] not in ya]
        g["fuentes"] = g["fuentes"] + [[res(u, c), c] for u, c in r.get("f", [])]
        if r.get("conf"):
            g["confianza"] = r["conf"]
        if r.get("nota"):
            g["nota"] = (g.get("nota", "") + " " + r["nota"]).strip()
        g["ronda2"] = True
    # ronda 3: contexto social (qué es, origen, dónde y cuándo, ambiente, público) + rasgos y citas
    for g in gen:
        r = R3.get(g["slug"])
        if not r:
            continue
        nuevos = car(r.get("car", ""))
        if r.get("reemplazar"):
            g["caracter"] = nuevos
        else:
            ya = {c[0] for c in g["caracter"]}
            g["caracter"] += [c for c in nuevos if c[0] not in ya]
        g["fuentes"] = g["fuentes"] + [[res(u, c), c] for u, c in r.get("f", [])]
        if r.get("conf"):
            g["confianza"] = r["conf"]
        if "heredaDe" in r:
            if r["heredaDe"]:
                g["heredaDe"] = r["heredaDe"]
            else:
                g.pop("heredaDe", None)
        g["contexto"] = r["ctx"]
        g["descripcion"] = r["desc"]
        if r.get("nota"):
            g["nota"] = (g.get("nota", "") + " " + r["nota"]).strip()
        g["ronda3"] = True
    # herencia: copia el carácter (definitorio/frecuente) del género indicado o, si no está, su perfil RYM
    por = {g["slug"]: g for g in gen}
    for g in gen:
        if not g.get("heredaDe"):
            continue
        propios = {c[0] for c in g["caracter"]}; her = []; origen = []
        for s in g["heredaDe"]:
            src = por.get(s)
            if src and src["caracter"]:
                items = [c for c in src["caracter"] if c[3] in ("definitorio", "frecuente", "heredado")]
                origen.append(f"{s} (carácter)")
            elif perf.get(s, {}).get("tipico"):
                items = [[t["es"], t["eje"], t["valencia"], "heredado"] for t in perf[s]["tipico"] if t["share"] >= 0.08]
                origen.append(f"{s} (perfil RYM, {perf[s]['discosRym']} discos)")
            else:
                origen.append(f"{s} (sin datos)"); items = []
            for c in items:
                if c[0] not in propios:
                    propios.add(c[0]); her.append([c[0], c[1], c[2], "heredado"])
        g["caracter"] += her
        g["herencia"] = origen
    salida = dict(muestra, version="crv-genre-feel-0.2.2", generos=gen)
    salida["fuerza"] = dict(muestra["fuerza"], heredado="copiado de un género pariente o de la familia; pesa menos que un rasgo propio")
    salida["confianzas"] = {"alta": "varias fuentes coinciden", "media": "fuentes buenas pero pocas, o con matices",
                            "baja": "una fuente o fuentes flojas", "heredado": "sin carácter propio: lo toma de su familia",
                            "sin_caracter": "categoría funcional, temática o paraguas: no tiene carácter típico"}
    salida["contexto"] = ("ronda 3: por género, qué es, origen, dóndeYCuando, ambiente y público, redactado con las "
                          "citas del género; no cambia pesos, solo explica el carácter")
    json.dump(salida, open(out, "w"), ensure_ascii=False, indent=1)
    import collections
    print(len(gen), collections.Counter(g["confianza"] for g in gen))
    for g in gen:
        if g.get("herencia"):
            print(" ", g["slug"], "←", ", ".join(g["herencia"]), "→", [c[0] for c in g["caracter"] if c[3] == "heredado"])


if __name__ == "__main__":
    main(*sys.argv[1:6])
