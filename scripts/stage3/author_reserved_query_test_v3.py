#!/usr/bin/env python3
"""Tercera prueba final reservada de interpretación de consultas (etapa 3, criterios 1.2.0).

Redacción: DeepSeek flash a partir de una especificación por categoría, con conceptos, géneros y
nombres del catálogo sorteados con semilla fija (draft_reserved_query_v3.py; borrador en el staging
`tmp-analysis/unified-search-stage3-v12/reserved-3-draft/drafts.jsonl`). Etiquetas: Claude, el
2026-10-25, sin pasar el sistema por estas frases. Las frases del borrador con una cláusula cuya
etiqueta sería discutible (propósito vago, valoración, ambigüedad no pedida) se recortaron y llevan
`note` con el texto original; las de las categorías «aclarar» y «contradicción» que no cumplían su
especificación formal se sustituyeron (`note`). `draft` es el índice de la línea del borrador.

Convenciones (además de las de 1.0.0 y 2.0.0):
- Concepto pedido + restricción no representable = `partial`; solo no representable = `unsupported`.
- Idioma, tempo, duración, instrumentación, versión en vivo o remasterizada, procedencia y «para» +
  ocasión fuera del vocabulario (limpiar la casa, playa) quedan pendientes.
- Valoraciones sin criterio («nice», «que peguen») y circunstancias de tiempo o lugar sin «para» son relleno.
- Ruido: `unrecognized` sin pendientes (en 1.0.0 y 2.0.0, T247 y R247 decían `pending: 1` con
  `unrecognized`, combinación imposible para el compilador).
"""
from __future__ import annotations
import hashlib, json
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "docs/unified-search/stage3/datasets/query-test-reserved-3.json"
cases: list[dict] = []


def c(draft, cat, text, status, req=(), exc=(), any_=(), pref=(), ctx=0, ent=(), pending=0, alts=(), facet=None, note=None):
    cases.append({"id": f"S{len(cases)+1:03d}", "category": cat, "text": text, "draft": draft, "gold": {
        "status": status, "req": sorted(req), "exc": sorted(exc), "any": sorted(sorted(g) for g in any_),
        "pref": sorted(pref), "ctx": ctx, "ent": [dict(zip(("role", "kind", "literal"), e)) for e in ent],
        "pending": pending, "alts": sorted(alts), "facet": facet}, **({"note": note} if note else {})})


V, P, U, E, C, K = "query_valid", "partial", "unsupported", "entity_lookup", "clarify", "contradiction"
cut = lambda original: f"recortada del borrador: «{original}»"
# --- Actividad ---
c(0, "activity", "música para concentrarme mientras estudio", V, ["activity:concentration"], note=cut("música para concentrarme mientras estudio y no distraerme"))
c(1, "activity", "playlist para salir a trotar todas las mañanas", V, ["activity:running"])
c(2, "activity", "canciones para descansar un rato", V, ["activity:relaxation"], note=cut("canciones suaves para descansar un rato después del trabajo"))
c(3, "activity", "música para el gym", V, ["activity:exercise"], note=cut("música para el gym que me mantenga activo"))
c(4, "activity", "temas para el cumpleaños de mi mamá", V, ["activity:celebration"], note=cut("temas para poner en la reunión del cumpleaños de mi mamá"))
c(5, "activity", "canciones para sacar lo que siento cuando estoy molesto", V, ["activity:catharsis"], ctx=1)
c(6, "activity", "música para un momento íntimo con mi pareja", V, ["activity:intimacy"], note="«íntimo» califica el momento, no el ambiente de la música")
c(7, "activity", "algo para cuando vienen amigos a conversar", V, ["activity:socializing"], note=cut("algo de fondo para cuando vienen amigos a conversar a la casa"))
c(8, "activity", "sonidos para meditar quince minutos al día", V, ["activity:meditation"])
c(9, "activity", "música para un viaje largo en carretera", V, ["activity:travel"])
c(10, "activity", "playlist para caminar por el parque", V, ["activity:walking"], note=cut("playlist para caminar por el parque sin aburrirme"))
c(11, "activity", "canciones que inviten a bailar", V, ["activity:dancing"], note=cut("canciones que inviten a bailar en la fiesta"))
c(12, "activity", "música tranquila para quedarme dormido", V, ["emotion:serene", "activity:sleep"], note=cut("música tranquila para quedarme dormido rápido"))
c(13, "activity", "algo sin letra para rendir en la oficina", P, ["activity:concentration"], pending=1, note="sin letra: no representable")
c(14, "activity", "temas para correr media hora", V, ["activity:running"], note=cut("temas con buen ritmo para correr media hora"))
c(15, "activity", "música para bajar revoluciones antes de acostarme", V, ["activity:relaxation"])
c(16, "activity", "playlist para acompañar la rutina de pesas", V, ["activity:exercise"])
# --- Emoción ---
c(17, "emotion", "música para sentirme seguro de mí mismo", V, ["emotion:confident"])
c(18, "emotion", "canciones bien alegres", V, ["emotion:joyful"], note=cut("canciones alegres para levantar el ánimo"))
c(19, "emotion", "temas que me den euforia", V, ["emotion:euphoric"], note=cut("temas que me den euforia y ganas de gritar"))
c(20, "emotion", "canciones de rebeldía", V, ["emotion:rebellious"], note=cut("canciones de rebeldía para romper con todo"))
c(21, "emotion", "temas que generen tensión", V, ["emotion:tense"], note=cut("música tensa que me mantenga al filo"))
c(22, "emotion", "canciones tranquilas para estar en calma", V, ["emotion:serene"])
c(23, "emotion", "música de rabia para desahogarme", V, ["emotion:angry", "activity:catharsis"])
c(24, "emotion", "canciones sensuales", V, ["emotion:sensual"], note=cut("canciones sensuales para ambientar"))
c(25, "emotion", "temas tristes", V, ["emotion:sad"], note=cut("temas tristes para cuando tengo el bajón"))
c(26, "emotion", "canciones con esperanza", V, ["emotion:hopeful"], note=cut("canciones con esperanza para no rendirme"))
c(27, "emotion", "una canción melancólica", V, ["emotion:melancholic"], note=cut("música melancólica para pensar en lo perdido"))
c(28, "emotion", "temas agridulces", V, ["emotion:bittersweet"], note=cut("canciones agridulces que mezclen risa y llanto"))
c(29, "emotion", "música que me dé nostalgia", V, ["emotion:nostalgic"], note=cut("música que me dé nostalgia de mi infancia"))
c(30, "emotion", "temas solitarios", V, ["emotion:lonely"], note="sustituye «canciones de soledad para estar a solas» (soledad es ambigua entre tema y emoción)")
c(31, "emotion", "temas románticos y tiernos", V, ["emotion:romantic"], note=cut("temas románticos y tiernos para dedicar"))
c(32, "emotion", "algo que suene a confianza sin ser épico", V, ["emotion:confident"], exc=["atmosphere:epic"])
# --- Energía ---
c(33, "energy", "música de poca energía para estudiar", V, ["energy:energy-low", "activity:concentration"], note="sustituye «música tranquila para estudiar sin distraerme» (tranquila es serenidad, no energía)")
c(34, "energy", "temas movidos para prender la fiesta", V, ["energy:energy-high", "activity:celebration"])
c(35, "energy", "algo de energía baja para dormir", V, ["energy:energy-low", "activity:sleep"], note="sustituye «algo suave para dormir relajado»")
c(36, "energy", "canciones con mucha energía para el gym", V, ["energy:energy-high", "activity:exercise"], note="sustituye «canciones con buen ritmo para el gym»")
c(37, "energy", "playlist ni muy lenta ni muy acelerada", V, ["energy:energy-medium"], note=cut("playlist ni muy lenta ni muy acelerada para la oficina"))
# --- Ambiente ---
c(38, "atmosphere", "música épica para entrenar", V, ["atmosphere:epic", "activity:exercise"], note=cut("música épica para cuando estoy motivado entrenando"))
c(39, "atmosphere", "canciones etéreas para relajarme", V, ["atmosphere:ethereal", "activity:relaxation"], note=cut("canciones etéreas para relajarme y volar mentalmente"))
c(40, "atmosphere", "música festiva para una reunión en mi casa", V, ["atmosphere:festive", "activity:socializing"], note=cut("música festiva para animar la reunión en mi casa"))
c(41, "atmosphere", "canciones con sonido espacioso", V, ["atmosphere:spacious"], note=cut("canciones con sonido espacioso como flotando en el espacio"))
c(42, "atmosphere", "música íntima y cercana", V, ["atmosphere:intimate"], note="sustituye «música íntima para una noche tranquila en pareja»")
c(43, "atmosphere", "temas misteriosos para leer", V, ["atmosphere:mysterious", "activity:concentration"], note=cut("temas misteriosos para leer novela de suspenso"))
c(44, "atmosphere", "canciones con atmósfera psicodélica", V, ["atmosphere:psychedelic"], note="sustituye «rock psicodélico con ambiente alucinante» (mezclaba el género)")
c(45, "atmosphere", "música sombría", V, ["atmosphere:dark"], note="sustituye «música oscura para ambientar una película de terror»")
c(46, "atmosphere", "sonidos fríos y distantes para concentrarme", V, ["atmosphere:cold", "activity:concentration"])
c(47, "atmosphere", "música amenazante", V, ["atmosphere:ominous"], note=cut("música amenazante para un juego de rol de villanos"))
c(48, "atmosphere", "canciones cálidas para un domingo acogedor", V, ["atmosphere:warm"])
c(49, "atmosphere", "música nocturna para manejar de madrugada", V, ["atmosphere:nocturnal", "activity:travel"])
c(50, "atmosphere", "temas envolventes", V, ["atmosphere:atmospheric"], note=cut("temas envolventes que me rodeen por todos lados"))
c(51, "atmosphere", "canciones oníricas", V, ["atmosphere:dreamy"], note=cut("música onírica para imaginar mundos irreales"))
# --- Temática ---
c(52, "theme", "canciones de protesta contra el gobierno y la injusticia", V, ["theme:politics"])
c(53, "theme", "temas que hablen de sentirse solo y aislado del mundo", V, ["theme:loneliness"])
c(54, "theme", "música que cuente la vida diaria de la gente en el barrio", V, ["theme:society"])
c(55, "theme", "canciones sobre guerras y soldados en el frente", V, ["theme:war"])
c(56, "theme", "letras de contenido erótico y sexual", V, ["theme:sexuality"])
c(57, "theme", "canciones con historias de dragones, hadas y mitología", V, ["theme:fantasy"])
c(58, "theme", "temas que hablen de ansiedad, depresión y salud mental", V, ["theme:mental-health"])
c(59, "theme", "canciones que narren crímenes, violencia y delincuencia", V, ["theme:violence"])
c(60, "theme", "canciones que hablen de amor bonito", V, ["theme:love"])
c(61, "theme", "temas de despecho y ruptura amorosa", V, ["theme:breakup"])
c(62, "theme", "canciones que hablen de la naturaleza, ríos y montañas", V, ["theme:nature"])
c(63, "theme", "música con letras religiosas o espirituales", V, ["theme:spirituality"])
c(64, "theme", "canciones cómicas y de sátira social", V, ["theme:humor"])
c(65, "theme", "temas sobre identidad cultural y sentirse parte de algo", V, ["theme:identity"])
c(66, "theme", "canciones que cuenten hechos históricos y la memoria del pueblo", V, ["theme:history"])
# --- Género ---
c(67, "genre", "ponme algo de soft rock", V, ["genre:soft-rock"], note="sustituye «ponme algo suave de rock para la tarde» (el borrador no nombraba el género)")
c(68, "genre", "quiero escuchar jazz rap", V, ["genre:jazz-rap"], note="sustituye «quiero escuchar rap con jazz de fondo»")
c(69, "genre", "música rock psicodélica de los sesenta", V, ["genre:rock-psicodelico", "decade:1960s"])
c(70, "genre", "algo de harmonica blues", V, ["genre:harmonica-blues"], note="sustituye «blues con armónica bien bueno»")
c(71, "genre", "djent para entrenar", V, ["genre:djent", "activity:exercise"], note=cut("djent pesado para entrenar"))
c(72, "genre", "canciones de golpe y estribillo", V, ["genre:golpe-y-estribillo"], note=cut("canciones de golpe y estribillo que peguen"))
c(73, "genre", "punk bien rabioso para desahogarme", V, ["genre:punk", "emotion:angry", "activity:catharsis"])
c(74, "genre", "stoner metal", V, ["genre:stoner-metal"], note=cut("stoner metal lento y pesado"))
c(75, "genre", "drum and bass para correr", V, ["genre:drum-and-bass", "activity:running"])
c(76, "genre", "metal latino con sabor de acá", P, ["genre:metal-latino"], pending=1, note="procedencia pendiente")
c(77, "genre", "un bambuco bien colombiano", P, ["genre:bambuco"], pending=1, note="procedencia pendiente")
c(78, "genre", "folk metal con instrumentos raros", P, ["genre:folk-metal"], pending=1)
c(79, "genre", "grindcore cortito", P, ["genre:grindcore"], pending=1, note=cut("grindcore cortito y brutal") + "; la duración queda pendiente")
c(80, "genre", "gabán para bailar", V, ["genre:gaban", "activity:dancing"], note=cut("gabán para bailar en la fiesta"))
c(81, "genre", "algo de goregrind", V, ["genre:goregrind"], note="sustituye «goregrind bien enfermo»")
# --- Y ---
c(82, "and", "música de salsa para limpiar la casa", P, ["genre:salsa"], pending=1, note=cut("música de salsa para limpiar la casa con ganas"))
c(83, "and", "algo de reggaetón para precalentar en el gym", V, ["genre:reggaeton", "activity:exercise"], note=cut("algo de reggaetón viejo para precalentar en el gym"))
c(84, "and", "baladas románticas y nocturnas", V, ["genre:balada", "emotion:romantic", "atmosphere:nocturnal"], note="sustituye «baladas románticas para una noche de lluvia tranquila»")
c(85, "and", "cumbia para la carretera", V, ["genre:cumbia", "activity:travel"], note=cut("cumbia para carretera larga con los panas"))
c(86, "and", "canciones serenas para estudiar", V, ["emotion:serene", "activity:concentration"], note="sustituye «música relajante para estudiar y concentrarme sin dormirme»")
c(87, "and", "rock en español para desahogarme cuando estoy arrecho", V, ["genre:rock-latino", "activity:catharsis"], ctx=1)
c(88, "and", "bachata para una cena", V, ["genre:bachata", "activity:socializing"], note="sustituye «bachata suave para cenar con mi pareja»")
c(89, "and", "electrónica para correr temprano con energía", V, ["genre:electronica", "activity:running", "energy:energy-high"])
c(90, "and", "vallenato nostálgico", V, ["genre:vallenato", "emotion:nostalgic"], note="sustituye «música de vallenato para recordar a mi familia lejos»")
c(91, "and", "canciones tristes para llorar un rato", V, ["emotion:sad", "activity:catharsis"], note=cut("canciones tristes para llorar un rato a solas"))
c(92, "and", "merengue para un cumpleaños", V, ["genre:merengue", "activity:celebration"], note=cut("merengue para fiesta de cumpleaños animada"))
c(93, "and", "instrumental tranquilo para trabajar", P, ["emotion:serene", "activity:concentration"], pending=1, note=cut("instrumental tranquilo para trabajar de noche") + "; instrumental queda pendiente")
c(94, "and", "jazz para leer un libro con un café", V, ["genre:jazz", "activity:concentration"])
c(95, "and", "música de protesta latinoamericana para sentirme rebelde", P, ["theme:politics", "emotion:rebellious"], pending=1, note="procedencia pendiente")
c(96, "and", "reggaetón para armar la fiesta en casa", V, ["genre:reggaeton", "activity:celebration"], note="sustituye «perreo intenso para armar la rumba en casa»")
c(97, "and", "boleros para la madrugada con un trago", V, ["genre:bolero", "atmosphere:nocturnal"])
c(98, "and", "música cristiana tranquila", V, ["genre:musica-cristiana", "emotion:serene"], note="sustituye «música cristiana suave para orar en la mañana»")
c(99, "and", "pop en inglés para manejar", P, ["genre:pop", "activity:travel"], pending=1, note="sustituye «pop en inglés para cantar a grito herido en el carro»; idioma pendiente")
c(100, "and", "salsa para entrenar con mucha energía", V, ["genre:salsa", "activity:exercise", "energy:energy-high"], note="sustituye «salsa brava para entrenar boxeo con adrenalina»")
c(101, "and", "joropo para bailar", V, ["genre:joropo", "activity:dancing"], note="sustituye «música andina para meditar y conectar con la naturaleza» (música andina no es género del registro)")
c(102, "and", "trap latino esperanzador", V, ["genre:trap-latino", "emotion:hopeful"], note="sustituye «trap latino para motivarme a salir adelante»")
c(103, "and", "canciones de despecho tristes", V, ["theme:breakup", "emotion:sad"], note="sustituye «canciones de despecho para después de una ruptura»")
c(104, "and", "música tropical alegre para un día de playa", P, ["genre:musica-tropical", "emotion:joyful"], pending=1, note="la playa no es actividad del vocabulario")
c(105, "and", "rap en español para reflexionar", P, ["genre:hip-hop"], pending=1, note=cut("rap en español para pensar y reflexionar solo") + "; idioma y reflexionar pendientes")
# --- O ---
c(106, "or", "música para fiesta o para dormir", V, any_=[["activity:celebration", "activity:sleep"]])
c(107, "or", "algo de salsa o de reggaetón para limpiar la casa", P, any_=[["genre:salsa", "genre:reggaeton"]], pending=1)
c(108, "or", "baladas o boleros románticos", V, ["emotion:romantic"], any_=[["genre:balada", "genre:bolero"]], note="sustituye «baladas románticas o rancheras para dedicar a mi pareja»")
c(109, "or", "algo triste o melancólico", V, any_=[["emotion:sad", "emotion:melancholic"]], note=cut("quiero algo triste o melancólico para cuando llueve"))
c(110, "or", "rock o pop en español para un viaje en carretera", P, ["activity:travel"], any_=[["genre:rock", "genre:pop"]], pending=1, note="idioma pendiente")
c(111, "or", "música calmada o íntima para estudiar", V, ["activity:concentration"], any_=[["emotion:serene", "atmosphere:intimate"]], note="sustituye «música relajada o instrumental para estudiar de noche»")
c(112, "or", "cumbia o merengue para bailar", V, ["activity:dancing"], any_=[["genre:cumbia", "genre:merengue"]], note=cut("cumbia o merengue para bailar en el cumpleaños"))
c(113, "or", "algo alegre o eufórico", V, any_=[["emotion:joyful", "emotion:euphoric"]], note="sustituye «algo alegre o animado para levantar el ánimo en el trabajo»")
c(114, "or", "jazz o bossa nova para una cena", V, ["activity:socializing"], any_=[["genre:jazz", "genre:bossa-nova"]], note="sustituye «jazz o bossa nova para cenar tranquilo en casa»")
c(115, "or", "música de protesta o sobre la identidad", V, any_=[["theme:politics", "theme:identity"]], note="sustituye «música de protesta o folclórica para recordar a mi tierra»")
c(116, "or", "rap o rock alternativo para entrenar en el gimnasio", V, ["activity:exercise"], any_=[["genre:hip-hop", "genre:rock-alternativo"]])
# --- Negación ---
c(117, "negation", "música para estudiar sin letra", P, ["activity:concentration"], pending=1)
c(118, "negation", "playlist de rock que no sea triste", V, ["genre:rock"], exc=["emotion:sad"], note="sustituye «playlist de rock que no sea pesado» (pesado es ambiguo)")
c(119, "negation", "canciones alegres pero que no sean infantiles", V, ["emotion:joyful"], exc=["genre:musica-infantil"])
c(120, "negation", "música romántica sin cursilerías", P, ["emotion:romantic"], pending=1)
c(121, "negation", "algo para la fiesta que no sea reggaetón", V, ["activity:celebration"], exc=["genre:reggaeton"])
c(122, "negation", "música tranquila sin piano", P, ["emotion:serene"], pending=1)
c(123, "negation", "canciones tristes pero no de desamor", V, ["emotion:sad"], exc=["theme:breakup"])
c(124, "negation", "música para el gimnasio que no sea electrónica", V, ["activity:exercise"], exc=["genre:electronica"])
c(125, "negation", "playlist navideña sin gaitas", V, ["genre:musica-navidena"], exc=["genre:gaita"], note="sustituye «playlist navideña sin villancicos» (villancico es la propia música navideña)")
c(126, "negation", "música en español que no sea balada", P, exc=["genre:balada"], pending=1, note="idioma pendiente")
c(127, "negation", "algo para dormir sin ruido blanco", P, ["activity:sleep"], pending=1)
c(128, "negation", "rock sin guitarras eléctricas", P, ["genre:rock"], pending=1)
c(129, "negation", "música para trabajar sin voces ni coros", P, ["activity:concentration"], pending=1)
c(130, "negation", "fiesta sin salsa ni merengue", V, ["activity:celebration"], exc=["genre:salsa", "genre:merengue"])
c(131, "negation", "música esperanzadora que no sea épica", V, ["emotion:hopeful"], exc=["atmosphere:epic"], note="sustituye «música motivadora que no sea épica»")
c(132, "negation", "canciones para bailar sin reggaetón", V, ["activity:dancing"], exc=["genre:reggaeton"], note="sustituye «canciones de verano sin playa»")
c(133, "negation", "música cristiana que no sea coral", P, ["genre:musica-cristiana"], pending=1)
c(134, "negation", "algo relajante que no sea jazz", V, ["activity:relaxation"], exc=["genre:jazz"])
c(135, "negation", "música para leer, nada de rock", V, ["activity:concentration"], exc=["genre:rock"], note="sustituye «música para leer sin distracciones ni letra»")
# --- Preferencia ---
c(136, "preference", "canciones de salsa, preferiblemente de los 70", V, ["genre:salsa"], pref=["decade:1970s"], note=cut("canciones viejas de salsa preferiblemente de los 70"))
c(137, "preference", "música para estudiar ojalá sin letra", P, ["activity:concentration"], pending=1)
c(138, "preference", "baladas románticas de preferencia en español", P, ["genre:balada", "emotion:romantic"], pending=1, note="idioma pendiente")
c(139, "preference", "playlist de reguetón, mejor si es de los 2000", V, ["genre:reggaeton"], pref=["decade:2000s"], note=cut("playlist de reguetón viejo mejor si es de los 2000"))
c(140, "preference", "canciones tristes para llorar si es posible que no sean tan conocidas", P, ["emotion:sad", "activity:catharsis"], pending=1, note="popularidad pendiente")
c(141, "preference", "música cristiana, idealmente tranquila", V, ["genre:musica-cristiana"], pref=["emotion:serene"], note="sustituye «música cristiana para orar idealmente suave»")
c(142, "preference", "temas de rock latinoamericano preferiblemente en vivo", P, ["genre:rock-latino"], pending=1, note="versión en vivo pendiente")
# --- Estado del oyente ---
c(143, "listener", "estoy contento hoy, ponme algo bailable", V, ["activity:dancing"], ctx=1, note=cut("estoy contento hoy ponme algo de música bailable para seguir así"))
c(144, "listener", "ando triste y necesito canciones esperanzadoras", V, ["emotion:hopeful"], ctx=1, note="sustituye «… canciones que me acompañen sin ponerme peor»")
c(145, "listener", "me siento con mucha energía, dame música para entrenar", V, ["activity:exercise"], ctx=1, note=cut("me siento con mucha energía para entrenar dame música rápida"))
c(146, "listener", "estoy relajado en casa, ponme algo tranquilo", V, ["emotion:serene"], ctx=1, note="sustituye «… ponme algo suave para seguir tranquilo»")
c(147, "listener", "ando nostálgico y quiero escuchar música vieja de mi época", U, ctx=1, pending=1, note="la época no se representa")
c(148, "listener", "me siento enamorado y quiero canciones románticas", V, ["emotion:romantic"], ctx=1, note=cut("… canciones románticas para dedicar"))
c(149, "listener", "estoy estresado del trabajo, ponme algo para relajarme", V, ["activity:relaxation"], ctx=1, note="sustituye «… ponme algo instrumental que me calme»")
c(150, "listener", "ando con ganas de fiesta, pon música para bailar", V, ["activity:dancing"], ctx=1, note="sustituye «… aunque estoy cansado busca música movida»")
c(151, "listener", "me siento solo esta noche y quiero música alegre", V, ["emotion:joyful"], ctx=1, note="sustituye «… música para pensar un rato»")
c(152, "listener", "estoy feliz porque conseguí trabajo y necesito música para celebrar", V, ["activity:celebration"], ctx=1)
c(153, "listener", "ando aburrido en el tráfico, ponme algo enérgico", V, ["energy:energy-high"], ctx=1, note="sustituye «… ponme algo entretenido y variado»")
c(154, "listener", "me siento motivado, dame música para estudiar", V, ["activity:concentration"], ctx=1, note="sustituye «… dame música sin letra que no distraiga»")
# --- No representables ---
c(155, "unsupported", "canciones de 120 bpm para entrenar", P, ["activity:exercise"], pending=1)
c(156, "unsupported", "temas que duren menos de dos minutos", U, pending=1)
c(157, "unsupported", "algo en 3/4 para bailar", P, ["activity:dancing"], pending=1, note=cut("algo en 3/4 para bailar con mi pareja"))
c(158, "unsupported", "música que esté en francés para estudiar", P, ["activity:concentration"], pending=1)
c(159, "unsupported", "playlist con voz de mujer y letras de despecho", P, ["theme:breakup"], pending=1, note="sustituye «playlist con voz de mujer para el despecho»")
c(160, "unsupported", "canciones con voz de hombre para poner en la carretera", P, ["activity:travel"], pending=1)
c(161, "unsupported", "temas que solo tengan guitarra acústica y piano", U, pending=1)
c(162, "unsupported", "música con saxofón y batería para una cena", P, ["activity:socializing"], pending=1)
c(163, "unsupported", "grabaciones en vivo que suenen como en el concierto", U, pending=1)
c(164, "unsupported", "versiones remasterizadas de discos viejos", U, pending=1)
c(165, "unsupported", "cosas lo-fi para dormir", P, ["activity:sleep"], pending=1, facet="candidate:production.fidelity-aesthetic")
c(166, "unsupported", "temas donde la voz queda enterrada", U, pending=1, facet="candidate:vocals.prominence", note="sustituye «canciones con la voz bien al fondo de la mezcla» (casi igual a R201 de la prueba 2.0.0)")
c(167, "unsupported", "temas que usen samples de películas", U, pending=1, facet="candidate:production.sources")
c(168, "unsupported", "álbumes donde las canciones van enlazadas sin pausas", U, pending=1, facet="candidate:structure.continuity")
c(169, "unsupported", "discos conceptuales para escuchar completos", U, pending=1, facet="candidate:structure.narrative")
c(170, "unsupported", "música que mejora mientras más la escuchas", U, pending=1, facet="candidate:reception.acclimatization")
c(171, "unsupported", "canciones en portugués para limpiar la casa", U, pending=1)
c(172, "unsupported", "temas de 140 bpm para correr", P, ["activity:running"], pending=1, note="sustituye «temas de 90 bpm para caminar tranquilo» (casi igual a un caso de la prueba 2.0.0)")
c(173, "unsupported", "playlist instrumental con cuerdas para leer", P, ["activity:concentration"], pending=1)
# --- Década ---
c(174, "decade", "música romántica de los años 60", V, ["emotion:romantic", "decade:1960s"], note=cut("música romántica de los años 60 para recordar viejos amores"))
c(175, "decade", "rock en español de los 80 para una fiesta", V, ["genre:rock-latino", "decade:1980s", "activity:celebration"], note=cut("rock en español de los 80 bien movido para una fiesta"))
c(176, "decade", "canciones tristes de los 90 para llorar un rato", V, ["emotion:sad", "decade:1990s", "activity:catharsis"])
c(177, "decade", "temas alegres de los 2000 para hacer ejercicio", V, ["emotion:joyful", "decade:2000s", "activity:exercise"], note=cut("temas alegres y bailables de los 2000 para hacer ejercicio"))
# --- Aclarar (el borrador explicaba su propia ambigüedad; se sustituyen por la palabra ambigua sola) ---
c(178, "clarify", "canciones bien calientes", C, alts=["emotion:sensual", "atmosphere:warm", "energy:energy-high"], note="sustituye el borrador 178")
c(179, "clarify", "pon algo intenso", C, alts=["emotion:tense", "energy:energy-high"], note="sustituye el borrador 179")
c(180, "clarify", "playlist con aura", C, alts=["emotion:confident", "atmosphere:epic", "energy:energy-high"], note="sustituye el borrador 180")
c(181, "clarify", "canciones para recordar", C, alts=["emotion:nostalgic", "theme:history"], note="sustituye el borrador 181")
c(182, "clarify", "música de amor", C, alts=["theme:love", "emotion:romantic", "activity:intimacy"], note="sustituye el borrador 182")
c(183, "clarify", "canciones de sexo", C, alts=["activity:intimacy", "theme:sexuality"], note="sustituye el borrador 183")
c(184, "clarify", "algo bien psicodélico", C, alts=["atmosphere:psychedelic", "genre:rock-psicodelico"], note="sustituye el borrador 184")
c(185, "clarify", "música que me anime", C, alts=["emotion:joyful", "emotion:euphoric", "emotion:confident"], note="sustituye el borrador 185")
c(186, "clarify", "rock y alegre o melancólico", C, note="sustituye el borrador 186; mezcla de Y y O sin alcance")
c(187, "clarify", "Odio", C, alts=["emotion:angry"], ent=[("target", None, "odio")], note="sustituye el borrador 187; también es banda del catálogo")
c(188, "clarify", "(salsa para bailar) o (bolero para cenar)", C, note="sustituye el borrador 188; DNF no representable")
# --- Contradicciones (el borrador no las formulaba como contradicción formal) ---
c(189, "contradiction", "música triste pero sin tristeza", K, note="sustituye el borrador 189")
c(190, "contradiction", "metal que no sea metal", K, note="sustituye el borrador 190")
c(191, "contradiction", "algo de energía alta pero de energía baja", K, note="sustituye el borrador 191")
c(192, "contradiction", "canciones románticas sin nada romántico", K, note="sustituye el borrador 192")
c(193, "contradiction", "música épica que no sea épica", K, note="sustituye el borrador 193")
# --- Otros idiomas ---
c(194, "multilingual", "focus music for studying", V, ["activity:concentration"], note="sustituye «music to study late at night without lyrics»")
c(195, "multilingual", "happy songs for a road trip", V, ["emotion:joyful", "activity:travel"], note="sustituye «feel good songs for a rainy afternoon»")
c(196, "multilingual", "reggae for dancing", V, ["genre:reggae", "activity:dancing"], note="sustituye «chill reggae vibes for a beach day»")
c(197, "multilingual", "sad songs to cry and let it out", V, ["emotion:sad", "activity:catharsis"])
c(198, "multilingual", "high energy workout playlist for the gym", V, ["energy:energy-high", "activity:exercise"])
# --- Género por descripción (géneros sorteados; alternativas: el sorteado y sus vecinos que encajan con lo descrito) ---
D = C
c(199, "described", "Suena un arpa con cuerdas suaves, el ritmo es lento, la voz canta versos largos y melancólicos", D, alts=["genre:pasaje", "genre:joropo", "genre:tonada", "genre:musica-tradicional"], note="se quitó «y como montuno» del borrador")
c(200, "described", "Guitarras con reverb, bajo melódico, batería sencilla y una voz medio susurrada, producción de garaje pero limpia", D, alts=["genre:indie-rock", "genre:rock-alternativo", "genre:garage-rock", "genre:dream-pop", "genre:shoegaze"])
c(201, "described", "Riffs pesados con guitarra distorsionada, pero se escuchan tambores latinos y letras en español con gritos", D, alts=["genre:metal-latino", "genre:nu-metal", "genre:metal"])
c(202, "described", "Es rápido y agresivo, con gritos punk y riffs de metal, cambios de tempo y coros coreados", D, alts=["genre:punk-metal", "genre:crossover-thrash", "genre:hardcore-punk", "genre:metalcore", "genre:thrash-metal"])
c(203, "described", "Tres acordes rápidos, batería simple y voz directa, sonido crudo y sin producción", D, alts=["genre:punk-rock", "genre:punk", "genre:garage-rock", "genre:hardcore-punk"])
c(204, "described", "Tambores de distintos tamaños, polirritmia, cantos de llamada y respuesta, sonido de costa", D, alts=["genre:tambor-afrovenezolano", "genre:sangueo"])
c(205, "described", "Voz teatral con vibrato exagerado, guitarras con riff pegajoso, coros grandilocuentes y estética de maquillaje", D, alts=["genre:glam-rock", "genre:hard-rock"])
c(206, "described", "Bajo profundo con slide, hi-hats rápidos y voz hablada con flow agresivo y sombrío", D, alts=["genre:drill", "genre:trap"])
c(207, "described", "Ritmo lento y relajado, bajo redondo, guitarra en contratiempo, coros espirituales y letras de resistencia", D, alts=["genre:roots-reggae", "genre:reggae"])
c(208, "described", "Guitarras ultra distorsionadas, blast beats, voz gutural incomprensible y cambios de ritmo brutales", D, alts=["genre:brutal-death-metal", "genre:death-metal", "genre:death-metal-tecnico", "genre:grindcore"])
c(209, "described", "Ritmo rápido y bailable con tambores metálicos, sintetizadores brillantes y voz energética de fiesta", D, alts=["genre:soca", "genre:dancehall"])
c(210, "described", "Metales en contratiempo, guitarra rítmica saltarina, bajo caminante y coros pegajosos", D, alts=["genre:ska", "genre:ska-punk", "genre:reggae-y-ska", "genre:rocksteady"])
c(211, "described", "Canto solista con versos improvisados, acompañamiento de cuatro y tambor, tono narrativo y pausado", D, alts=["genre:galeron", "genre:malaguena", "genre:musica-oriental", "genre:polo-oriental"])
# --- Entidades (nombres sorteados del catálogo) ---
c(212, "entity", "busca la canción Todo y Nada", E, ent=[("target", "track", "todo y nada")])
c(214, "entity", "busca la canción Incógnita", E, ent=[("target", "track", "incognita")])
c(215, "entity", "busca la canción Chicos Inflados", E, ent=[("target", "track", "chicos inflados")])
c(216, "entity", "la canción «Crisis Urbana»", E, ent=[("target", "track", "crisis urbana")])
c(217, "entity", "el tema Elizabeth Verse", E, ent=[("target", "track", "elizabeth verse")])
c(218, "entity", "el tema Endless Quest", E, ent=[("target", "track", "endless quest")])
c(219, "entity", "busca el disco Todo Vivaldi", E, ent=[("target", "album", "todo vivaldi")])
c(220, "entity", "el disco Betamax", E, ent=[("target", "album", "betamax")])
c(221, "entity", "busca la banda Daidalos", E, ent=[("target", "artist", "daidalos")])
c(222, "entity", "Okubo", E, ent=[("target", "artist", "okubo")])
c(223, "entity", "Raza Sur", E, ent=[("target", "artist", "raza sur")])
c(224, "entity", "No Habrá Futuro", E, ent=[("target", "artist", "no habra futuro")])
c(225, "entity", "Sieben", E, ent=[("target", "artist", "sieben")])
c(226, "entity", "Giselle Brass", E, ent=[("target", "artist", "giselle brass")])
c(227, "entity", "Bioss", E, ent=[("target", "artist", "bioss")])
c(228, "entity", "DJ Rey", E, ent=[("target", "artist", "dj rey")])
c(229, "entity", "Derna", E, ent=[("target", "artist", "derna")])
c(230, "entity", "temas de Alberto Conde Grupo", E, ent=[("target", "artist", "alberto conde grupo")])
c(231, "entity", "discos de Zoller", E, ent=[("target", "artist", "zoller")])
c(232, "entity", "canciones de Porfi Jiménez y Su Orquesta", E, ent=[("target", "artist", "porfi jimenez y su orquesta")])
c(233, "entity", "la canción Luces De La Ciudad", E, ent=[("target", "track", "luces de la ciudad")])
c(234, "entity", "el tema Echa Pa' Jazz", E, ent=[("target", "track", "echa pa' jazz")])
c(235, "entity", "canción \"Doce cascaseles\"", E, ent=[("target", "track", "doce cascaseles")])
# --- Parecido ---
c(236, "similarity", "algo parecido a José Natalio Estrada", V, ["similarity:overall"], ent=[("reference", "artist", "jose natalio estrada")])
c(237, "similarity", "bandas como Spiralheadz", V, ["similarity:overall"], ent=[("reference", "artist", "spiralheadz")])
c(238, "similarity", "música similar a Blackops", V, ["similarity:overall"], ent=[("reference", "artist", "blackops")])
c(239, "similarity", "parecido a Sevenfeet en la voz", V, ["similarity:voice"], ent=[("reference", "artist", "sevenfeet")])
c(240, "similarity", "al estilo de Korpus Inc. en las guitarras", V, ["similarity:guitars"], ent=[("reference", "artist", "korpus inc.")])
c(241, "similarity", "que suene como Gabriel Dávila en la producción", V, ["similarity:production"], ent=[("reference", "artist", "gabriel davila")])
c(242, "similarity", "como Grupo Espiga pero más triste", P, ["similarity:overall"], ent=[("reference", "artist", "grupo espiga")], pending=1, note="comparativo no representable")
c(243, "similarity", "parecido a SALAS en el ambiente", V, ["similarity:atmosphere"], ent=[("reference", "artist", "salas")])
c(244, "similarity", "algo al estilo de Deveron para manejar", V, ["similarity:overall", "activity:travel"], ent=[("reference", "artist", "deveron")])
# --- Ruido ---
c(245, "noise", "qwrt pfff", "unrecognized")
c(246, "noise", "temas", "unrecognized")
c(247, "noise", "algo nice", "unrecognized", note="valoración sin criterio: relleno")

for case in cases:
    case["split"] = "test_reserved"
    case["author"] = "Redacción DeepSeek flash (borrador sorteado) · etiquetas Claude (encargo de Brian, 2026-10-25)"
body = {"version": "crv-query-test-reserved-3.0.0", "authoredAt": "2026-10-25",
        "authoredBefore": "elección de modelo, entrenamiento de crv-query-heads-0.6.0 y cualquier ejecución del sistema sobre estas frases",
        "authoredAfter": "evaluación única de crv-query-heads-0.5.0 sobre la prueba 2.0.0 y las correcciones del léxico 0.3.0 y del compilador 0.2.0 hechas con esa prueba (ya de desarrollo)",
        "policy": "Prueba final reservada: no se usa para desarrollo, reglas, umbrales ni entrenamiento.",
        "cases": cases}
assert len(cases) == 247, len(cases)
assert len({c_["text"].lower() for c_ in cases}) == 247
text = json.dumps(body, ensure_ascii=False, indent=1) + "\n"
OUT.write_text(text)
print(len(cases), hashlib.sha256(text.encode()).hexdigest())
