#!/usr/bin/env python3
"""Sexta prueba final reservada de interpretación de consultas (etapa 3, criterios 1.5.0).

Redacción: DeepSeek flash a partir de una especificación por categoría, con conceptos, géneros y
nombres del catálogo sorteados con semilla fija (draft_reserved_query_v3.py con semilla 71; borrador en
`tmp-analysis/unified-search-stage3-v15/reserved-6-draft/drafts.jsonl`). Etiquetas: Claude, el
2026-10-25, sin pasar el sistema por estas frases. Las frases con una cláusula cuya etiqueta sería
discutible (propósito vago, valoración, «suave», «para recordar», género fuera del registro dentro de
una alternativa) se recortaron (`note` con el texto original) o se descartaron; las de «contradicción»
que no cumplían su especificación formal y las tres de ruido (repetidas de 3.0.0) se sustituyeron.
`draft` es el índice de la línea del borrador. Las cláusulas de refuerzo o elaboración («que te levante el ánimo»,
«para estar en calma») se conservan: son relleno y forman parte de cómo se escribe una consulta real.

Convenciones: las de la prueba 5.0.0 (incluida la corrección de «instrumental»), y además:
- Un subgénero fuera del registro conserva el género padre y queda pendiente («cumbia villera», «salsa brava»),
  como en 4.0.0 (S123); en 5.0.0 «salsa brava» y «perreo» no conservaban padre.
- Una circunstancia de tiempo o clima («un día de lluvia», «para diciembre») es relleno.
Convenciones anteriores (pruebas 3.0.0 y 4.0.0):
- «Instrumental» nombrado («música instrumental», «algo instrumental») es `genre:instrumental`, como en la
  matriz de desarrollo (Q105) y en el mapa de géneros; describirlo («sin voces», «sin letra») queda pendiente
  (M05). En 3.0.0 (S094, S174) y 4.0.0 (S012, S150) se etiquetó como pendiente: error de convención.
- Concepto pedido + restricción no representable = `partial`; solo no representable = `unsupported`.
- Idioma, tempo, duración, compás, instrumentación, voz, versión en vivo o remasterizada, procedencia,
  popularidad o antigüedad y «para» + ocasión fuera del vocabulario (limpiar, cocinar, orar, playa) quedan pendientes.
- Valoraciones sin criterio y circunstancias de tiempo o lugar son relleno; «con amigos» junto a otra
  actividad es circunstancia, y solo un encuentro (cena, reunión, conversación) es `activity:socializing`.
- Un género fuera del registro (perreo, champeta, salsa brava) no se traduce a otro: queda pendiente.
- Ruido: `unrecognized` sin pendientes.
"""
from __future__ import annotations
import hashlib, json
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "docs/unified-search/stage3/datasets/query-test-reserved-6.json"
cases: list[dict] = []


def c(draft, cat, text, status, req=(), exc=(), any_=(), pref=(), ctx=0, ent=(), pending=0, alts=(), facet=None, note=None):
    cases.append({"id": f"G{len(cases)+1:03d}", "category": cat, "text": text, "draft": draft, "gold": {
        "status": status, "req": sorted(req), "exc": sorted(exc), "any": sorted(sorted(g) for g in any_),
        "pref": sorted(pref), "ctx": ctx, "ent": [dict(zip(("role", "kind", "literal"), e)) for e in ent],
        "pending": pending, "alts": sorted(alts), "facet": facet}, **({"note": note} if note else {})})


V, P, U, E, C, K = "query_valid", "partial", "unsupported", "entity_lookup", "clarify", "contradiction"
cut = lambda original: f"recortada del borrador: «{original}»"
# --- Actividad ---
c(0, "activity", "ponme algo bueno para bailar esta noche con mis panas", V, ["activity:dancing"])
c(1, "activity", "música para caminar tranquilo por la playa un domingo", V, ["activity:walking"], note="«tranquilo» modifica al oyente; «por la playa» es lugar")
c(2, "activity", "qué pongo en el carro para un viaje largo a la montaña", V, ["activity:travel"])
c(3, "activity", "necesito música que no me distraiga mientras estudio para el examen", V, ["activity:concentration"])
# borrador 4 («algo suave para meditar…») descartado: «suave» junto a otro pedido
c(5, "activity", "playlist para el cumpleaños de mi mamá con toda la familia", V, ["activity:celebration"])
c(6, "activity", "música que me motive en el gym cuando levanto pesas", V, ["activity:exercise"])
c(7, "activity", "ponme algo para descansar un rato en el sofá después del trabajo", V, ["activity:relaxation"])
c(8, "activity", "ritmo para salir a trotar por el parque en la mañana", V, ["activity:running"])
c(9, "activity", "música para un momento íntimo con mi pareja esta noche", V, ["activity:intimacy"])
c(10, "activity", "algo que me ayude a agarrar sueño rápido", V, ["activity:sleep"])
c(11, "activity", "música de fondo para cuando vienen amigos a conversar a la casa", V, ["activity:socializing"])
c(12, "activity", "ponme algo que me ayude a desahogarme, estoy que exploto", V, ["activity:catharsis"], ctx=1)
c(13, "activity", "quiero bailar salsa con mi pareja en la sala", V, ["activity:dancing", "genre:salsa"])
c(14, "activity", "algo para caminar al trabajo con audífonos", V, ["activity:walking"])
c(15, "activity", "música para el bus en un viaje de ocho horas", V, ["activity:travel"])
c(16, "activity", "qué me recomiendas escuchar mientras hago la tarea de la universidad", V, ["activity:concentration"])
# --- Emoción ---
c(17, "emotion", "canciones que transmitan rabia y furia", V, ["emotion:angry"])
c(18, "emotion", "música alegre que te levante el ánimo", V, ["emotion:joyful"])
c(19, "emotion", "temas de autoafirmación y seguridad en uno mismo", V, ["emotion:confident"])
c(20, "emotion", "canciones agridulces que mezclen emociones encontradas", V, ["emotion:bittersweet"])
c(21, "emotion", "música que me haga recordar tiempos pasados", V, ["emotion:nostalgic"])
# borrador 22 («ritmo lento y envolvente») descartado: tempo o energía discutible
c(23, "emotion", "temas con tensión musical sostenida que te mantengan en vilo", V, ["emotion:tense"])
c(24, "emotion", "canciones eufóricas para sentir exaltación", V, ["emotion:euphoric"])
c(25, "emotion", "música que dé esperanza y optimismo", V, ["emotion:hopeful"])
# borrador 26 («melancólicos para contemplar la añoranza») descartado: melancolía y nostalgia a la vez
c(27, "emotion", "canciones rebeldes que transmitan liberación", V, ["emotion:rebellious"])
c(28, "emotion", "música que exprese soledad y aislamiento", V, ["emotion:lonely"])
c(29, "emotion", "temas serenos y tranquilos para estar en calma", V, ["emotion:serene"])
# borrador 30 (tristes + melancólico) descartado: dos cualidades cercanas
c(31, "emotion", "música romántica y tierna para dedicar", P, ["emotion:romantic"], pending=1, note="dedicar queda pendiente, como en 5.0.0")
# borrador 32 («rabia contenida») descartado
# --- Energía ---
c(33, "energy", "música tranquila para dormir", V, ["emotion:serene", "activity:sleep"])
c(34, "energy", "canciones movidas para hacer ejercicio", V, ["energy:energy-high", "activity:exercise"])
c(35, "energy", "playlist alegre para limpiar la casa", P, ["emotion:joyful"], pending=1)
# borrador 36 («algo suave para estudiar») descartado
c(37, "energy", "temas con mucho ritmo para una fiesta", V, ["energy:energy-high", "activity:celebration"])
# --- Ambiente ---
c(38, "atmosphere", "música que suene misteriosa como de película de enigma", V, ["atmosphere:mysterious"])
c(39, "atmosphere", "canciones con ambiente amenazante pero sin letra de violencia", V, ["atmosphere:ominous"], exc=["theme:violence"])
c(40, "atmosphere", "música etérea flotante y ligera", V, ["atmosphere:ethereal"])
c(41, "atmosphere", "algo musical que evoque la noche", V, ["atmosphere:nocturnal"])
c(42, "atmosphere", "música épica grandiosa y dramática", V, ["atmosphere:epic"])
c(43, "atmosphere", "canciones con sonido íntimo y cercano", V, ["atmosphere:intimate"])
c(44, "atmosphere", "música con sonido cálido y acogedor", V, ["atmosphere:warm"])
c(45, "atmosphere", "música festiva de ambiente alegre", V, ["atmosphere:festive", "emotion:joyful"])
c(46, "atmosphere", "canciones con sonido frío y distante", V, ["atmosphere:cold"])
c(47, "atmosphere", "música con ambiente oscuro y sombrío", V, ["atmosphere:dark"])
c(48, "atmosphere", "música espaciosa con mucha amplitud en la mezcla", V, ["atmosphere:spacious"], note="la amplitud de la mezcla es la definición del concepto")
c(49, "atmosphere", "música onírica que suene a ensueño", V, ["atmosphere:dreamy"])
c(50, "atmosphere", "música con ambiente psicodélico explícito", V, ["atmosphere:psychedelic"])
# --- Tema ---
c(51, "theme", "canciones que hablen de dios y la fe", V, ["theme:spirituality"])
c(52, "theme", "temas sobre el alcohol y las drogas", V, ["theme:substances"])
c(53, "theme", "música que hable de sentirse solo y aislado", V, ["theme:loneliness"])
c(54, "theme", "canciones sobre la identidad cultural y pertenecer a un lugar", V, ["theme:identity"])
c(55, "theme", "canciones de violencia y crimen en la letra", V, ["theme:violence"])
c(56, "theme", "canciones que hablen de amor", V, ["theme:love"])
c(57, "theme", "canciones de protesta y política", V, ["theme:politics"])
c(58, "theme", "canciones que hablen de la muerte y el duelo", V, ["theme:death"])
c(59, "theme", "canciones sobre la guerra", V, ["theme:war"])
c(60, "theme", "temas de fantasía y mitología en las letras", V, ["theme:fantasy"])
c(61, "theme", "canciones de desamor y ruptura", V, ["theme:breakup"])
c(62, "theme", "canciones que hablen de la naturaleza", V, ["theme:nature"])
c(63, "theme", "canciones de ciencia ficción en la letra", V, ["theme:science-fiction"])
# --- Género ---
c(64, "genre", "música de gabán para una fiesta", V, ["genre:gaban", "activity:celebration"])
c(65, "genre", "ponme cumbia para bailar", V, ["genre:cumbia", "activity:dancing"])
c(66, "genre", "jazz afrocubano instrumental relajado", V, ["genre:jazz-afrocubano", "genre:instrumental", "emotion:serene"])
# borrador 67 («metal industrial bien pesado») descartado: «pesado» con género
c(68, "genre", "bandas de metalcore nuevas", P, ["genre:metalcore"], pending=1, note="novedad pendiente")
c(69, "genre", "ska alegre para el carro", V, ["genre:ska", "emotion:joyful", "activity:travel"])
# borrador 70 («onda nueva venezolana clásica») descartado: dos pendientes discutibles
c(71, "genre", "pop rock en español de los 2000", P, ["genre:pop-rock", "decade:2000s"], pending=1, note="idioma pendiente")
c(72, "genre", "tech house para el gimnasio", V, ["genre:tech-house", "activity:exercise"])
c(73, "genre", "hard rock de los ochenta", V, ["genre:hard-rock", "decade:1980s"])
# borrador 74 («para destrozar») descartado: propósito vago
c(75, "genre", "downtempo para estudiar tranquilo", V, ["genre:downtempo", "activity:concentration"])
c(76, "genre", "gaita de furro para diciembre", V, ["genre:gaita-de-furro"])
c(77, "genre", "power metal épico con coros", P, ["genre:power-metal", "atmosphere:epic"], pending=1, note="coros: voz pendiente")
c(78, "genre", "drone metal largo y ambiental", P, ["genre:drone-metal", "atmosphere:atmospheric"], pending=1, note="duración pendiente")
# --- Y ---
c(79, "and", "música cristiana alegre para limpiar la casa un sábado", P, ["genre:musica-cristiana", "emotion:joyful"], pending=1)
c(80, "and", "bachata romántica para dedicar a mi pareja", P, ["genre:bachata", "emotion:romantic"], pending=1)
c(81, "and", "rock en español para descargar la rabia después del trabajo", V, ["genre:rock-latino", "activity:catharsis"])
c(82, "and", "reggaetón para hacer ejercicio con mucha energía", V, ["genre:reggaeton", "activity:exercise", "energy:energy-high"])
c(83, "and", "baladas tranquilas para estudiar de noche", V, ["genre:balada", "emotion:serene", "activity:concentration"])
c(84, "and", "salsa brava para una fiesta familiar", P, ["genre:salsa", "activity:celebration"], pending=1, note="«salsa brava» no está en el registro")
c(85, "and", "música instrumental relajante para meditar antes de dormir", V, ["genre:instrumental", "activity:relaxation", "activity:meditation"])
c(86, "and", "cumbia villera para el asado del domingo", P, ["genre:cumbia", "activity:socializing"], pending=1, note="«cumbia villera» no está en el registro")
c(87, "and", "rap latino de protesta con letras que hagan pensar", P, ["genre:hip-hop", "theme:politics"], pending=1, note="procedencia pendiente")
c(88, "and", "música romántica en inglés para una cena especial", P, ["emotion:romantic", "activity:socializing"], pending=1, note="idioma pendiente")
c(89, "and", "merengue movido para animar una reunión aburrida", V, ["genre:merengue", "energy:energy-high", "activity:socializing"])
c(90, "and", "música triste para llorar a gusto un domingo de lluvia", V, ["emotion:sad", "activity:catharsis"])
# borrador 91 («electrónica suave») descartado
c(92, "and", "vallenato alegre para viajar en carretera", V, ["genre:vallenato", "emotion:joyful", "activity:travel"])
c(93, "and", "música de los 80 para recordar la juventud con nostalgia", V, ["decade:1980s", "emotion:nostalgic"])
# borradores 94 («superar una ruptura»), 95 («divertida»), 96 («noche elegante») descartados
c(97, "and", "música épica motivadora para entrenar en el gimnasio", V, ["atmosphere:epic", "activity:exercise"])
# borrador 98 («boleros suaves») descartado
c(99, "and", "música navideña en familia durante diciembre", V, ["genre:musica-navidena"])
c(100, "and", "indie latino tranquilo para leer un libro en casa", P, ["genre:indie-rock", "emotion:serene", "activity:concentration"], pending=1, note="procedencia pendiente")
c(101, "and", "música tropical bailable para la playa con amigos", P, ["genre:musica-tropical", "activity:dancing"], pending=1, note="playa pendiente")
# borrador 102 («superación personal … levantarme el ánimo») descartado
# --- O ---
# borrador 103 (una alternativa fuera del vocabulario) descartado
c(104, "or", "algo romántico o más bien bailable para una fiesta", V, ["activity:celebration"], any_=[["emotion:romantic", "activity:dancing"]])
c(105, "or", "canciones tristes o alegres para un día de lluvia", V, any_=[["emotion:sad", "emotion:joyful"]])
c(106, "or", "salsa o merengue para bailar con mi pareja", V, ["activity:dancing"], any_=[["genre:salsa", "genre:merengue"]])
c(107, "or", "algo tranquilo o movido para el gimnasio", V, ["activity:exercise"], any_=[["emotion:serene", "energy:energy-high"]])
# borrador 108 («motivacional») descartado
c(109, "or", "bachata o reguetón viejo para una reunión familiar", P, ["activity:socializing"], any_=[["genre:bachata", "genre:reggaeton"]], pending=1, note="antigüedad pendiente")
# borrador 110 («instrumental o con letra») descartado
c(111, "or", "cumbia o vallenato para un viaje en carretera", V, ["activity:travel"], any_=[["genre:cumbia", "genre:vallenato"]])
# borrador 112 («subir el ánimo») descartado
# --- Negación ---
c(113, "negation", "canciones tristes que no sean de desamor", V, ["emotion:sad"], exc=["theme:breakup"])
c(114, "negation", "algo para dormir sin ruido ni gritos", P, ["activity:sleep"], pending=1)
c(115, "negation", "música cristiana que no sea tan lenta", P, ["genre:musica-cristiana"], pending=1, note="atenuación pendiente")
c(116, "negation", "rock sin guitarras distorsionadas", P, ["genre:rock"], pending=1)
c(117, "negation", "música para el gym que no sea electrónica", V, ["activity:exercise"], exc=["genre:electronica"])
c(118, "negation", "cumbias pero que no sean tan repetitivas", P, ["genre:cumbia"], pending=1)
c(119, "negation", "algo alegre que no sea infantil", V, ["emotion:joyful"], exc=["genre:musica-infantil"])
c(120, "negation", "jazz para cenar sin saxofón", P, ["genre:jazz", "activity:socializing"], pending=1)
c(121, "negation", "música de concentración nada de lo-fi", P, ["activity:concentration"], pending=1)
c(122, "negation", "canciones para llorar que no hablen de ex", V, ["activity:catharsis"], exc=["theme:breakup"])
c(123, "negation", "música bailable que no sea tan movida", P, ["activity:dancing"], pending=1, note="atenuación pendiente")
c(124, "negation", "algo para trabajar sin distracciones ni voces", P, ["activity:concentration"], pending=1)
c(125, "negation", "música navideña que no sea tan empalagosa", P, ["genre:musica-navidena"], pending=1)
c(126, "negation", "electrónica para leer sin beats fuertes", P, ["genre:electronica", "activity:concentration"], pending=1)
# borrador 127 (idioma y popularidad) descartado
# --- Preferencia ---
# borradores 128–130 descartados: varias restricciones pendientes o «bravas» discutible
c(131, "preference", "cumbias para una fiesta familiar, ojalá que sean movidas y no tan tristes", P, ["genre:cumbia", "activity:celebration"], pref=["energy:energy-high"], pending=1, note="atenuación pendiente")
c(132, "preference", "rock latinoamericano para escuchar tranquilo, idealmente bandas de los noventa", V, ["genre:rock-latino"], pref=["decade:1990s"])
# borradores 133–134 descartados
# --- Estado del oyente ---
c(135, "listener", "ando con el ánimo por el suelo hoy, ponme algo que me levante el espíritu", C, ctx=1, alts=["emotion:joyful", "emotion:euphoric", "emotion:confident"])
c(136, "listener", "estoy feliz porque conseguí trabajo nuevo, recomiéndame música para celebrar", V, ["activity:celebration"], ctx=1)
c(137, "listener", "me siento nostálgico y con ganas de recordar viejos tiempos, pon algo de los 90", V, ["decade:1990s"], ctx=1)
c(138, "listener", "ando con mucho estrés en el trabajo, necesito música tranquila para relajarme", V, ["emotion:serene", "activity:relaxation"], ctx=1)
c(139, "listener", "estoy enamorado y quiero una lista de canciones románticas para dedicar", P, ["emotion:romantic"], ctx=1, pending=1)
c(140, "listener", "me siento con energía y ganas de entrenar, dame música movida para el gym", V, ["energy:energy-high", "activity:exercise"], ctx=1)
c(141, "listener", "ando triste porque extraño mi tierra, ponme música venezolana que me haga sentir cerca", U, ctx=1, pending=1, note="procedencia pendiente")
c(142, "listener", "estoy en una fiesta con amigos y necesito música bailable que todos conozcan", P, ["activity:dancing"], ctx=1, pending=1, note="popularidad pendiente")
c(143, "listener", "me siento melancólico un domingo por la tarde, ponme algo suave para acompañar", C, ctx=1, alts=["emotion:serene", "energy:energy-low"])
c(144, "listener", "ando sin dormir por el insomnio, ponme música tranquila para dormir", V, ["emotion:serene", "activity:sleep"], ctx=1)
c(145, "listener", "estoy contento porque es mi cumpleaños, ponme música para festejar en casa", V, ["activity:celebration"], ctx=1)
c(146, "listener", "me siento con ganas de llorar y desahogarme, dame canciones tristes que acompañen", V, ["emotion:sad"], ctx=1)
# --- No representables ---
c(147, "unsupported", "canciones que vayan a 120 bpm exactos para correr", P, ["activity:running"], pending=1)
c(148, "unsupported", "temas de menos de dos minutos que no decaigan", U, pending=1)
c(149, "unsupported", "música en 7/8 para estudiar", P, ["activity:concentration"], pending=1)
c(150, "unsupported", "playlist en francés para cocinar relajado", U, pending=2, note="idioma y cocinar")
c(151, "unsupported", "algo con voz femenina y guitarra acústica nada más para llorar tranquilo", P, ["activity:catharsis"], pending=1)
c(152, "unsupported", "pistas que empiecen con batería sola", U, pending=1)
c(153, "unsupported", "discos grabados en vivo en un bar pequeño", U, pending=1)
c(154, "unsupported", "versiones remasterizadas de los ochenta para el carro", P, ["decade:1980s", "activity:travel"], pending=1)
c(155, "unsupported", "lo-fi con ruido de vinilo para dormir", P, ["activity:sleep"], pending=1, facet="candidate:production.fidelity-aesthetic")
c(156, "unsupported", "temas con saxofón y nada de sintetizadores", U, pending=2, note="un atributo pedido y otro excluido")
c(157, "unsupported", "álbum conceptual que cuente una sola historia de principio a fin", U, pending=1, facet="candidate:structure.narrative")
c(158, "unsupported", "temas enlazados sin pausas entre ellos", U, pending=1, facet="candidate:structure.continuity")
c(159, "unsupported", "voz al fondo de la mezcla con la batería adelante", U, pending=1, facet="candidate:vocals.prominence")
c(160, "unsupported", "canciones con sample de películas viejas", U, pending=1, facet="candidate:production.sources")
c(161, "unsupported", "música que suene a color azul y melancolía", P, ["emotion:melancholic"], pending=1)
c(162, "unsupported", "temas que ganen con las escuchas y al principio no enganchen", U, pending=1, facet="candidate:reception.acclimatization")
c(163, "unsupported", "pistas de percusión sin melodía para entrenar", P, ["activity:exercise"], pending=1)
c(164, "unsupported", "música instrumental en mandarín para leer", P, ["genre:instrumental", "activity:concentration"], pending=1)
c(165, "unsupported", "canciones de exactamente tres minutos y medio para un viaje corto", P, ["activity:travel"], pending=1)
# --- Década ---
c(166, "decade", "música romántica de los 80 para dedicar", P, ["emotion:romantic", "decade:1980s"], pending=1)
c(167, "decade", "rock de los 70 bueno para escuchar en carretera", V, ["genre:rock", "decade:1970s", "activity:travel"])
c(168, "decade", "temas tristes de los 2000 para cuando estás bajoneado", V, ["emotion:sad", "decade:2000s"])
# --- Aclarar ---
c(169, "clarify", "canciones de caliente", C, alts=["emotion:sensual", "atmosphere:warm", "energy:energy-high"])
# borrador 170 («intensa para estudiar») descartado
c(171, "clarify", "aura", C, alts=["emotion:confident", "atmosphere:epic", "energy:energy-high"])
# borrador 172 («amor»: también título del catálogo) descartado
c(173, "clarify", "canciones para animarme", C, alts=["emotion:joyful", "emotion:euphoric", "emotion:confident"])
c(174, "clarify", "música pesada", C, alts=["genre:metal", "energy:energy-high"])
# borrador 175 («dulce») descartado: no es ambiguo del léxico
# --- Contradicciones (el borrador no las formulaba de forma formal) ---
c(176, "contradiction", "merengue pero sin merengue", K, note="sustituye el borrador 176")
c(177, "contradiction", "música de energía baja y de mucha energía", K, note="sustituye el borrador 177")
c(178, "contradiction", "canciones relajantes que no sean relajantes", K, note="sustituye el borrador 178")
c(179, "contradiction", "algo sensual pero nada sensual", K, note="sustituye el borrador 179")
c(180, "contradiction", "música oscura sin nada oscuro", K, note="sustituye el borrador 180")
# --- Otros idiomas ---
# borrador 181 («chill») descartado: ambiguo
c(182, "multilingual", "happy songs to clean the house and dance", P, ["emotion:joyful", "activity:dancing"], pending=1)
c(183, "multilingual", "romantic dinner background music", V, ["emotion:romantic", "activity:socializing"])
# borrador 184 («fast beat») descartado
c(185, "multilingual", "sad songs for a rainy day", V, ["emotion:sad"])
# --- Género por descripción ---
D = C
c(186, "described", "guitarras rápidas con solos melódicos y voz gutural, suena brutal pero con melodía", D, alts=["genre:death-metal-melodico", "genre:death-metal"])
c(187, "described", "música de margarita con cuatro y tambor, tempo tranquilo y letra picaresca", D, alts=["genre:musica-oriental", "genre:polo-oriental", "genre:galeron", "genre:malaguena"])
c(188, "described", "arpa, cuatro y maracas con ritmo de seis por derecho y zapateo", D, alts=["genre:golpe-llanero", "genre:joropo"])
c(189, "described", "metal con voces femeninas etéreas, teclados y atmósfera oscura y romántica", D, alts=["genre:metal-gotico", "genre:metal-sinfonico"])
c(190, "described", "ruido extremo, gritos, distorsión total y canciones de diez segundos", D, alts=["genre:grindcore", "genre:noisecore"])
c(191, "described", "música de Lara con violín, tambor y letra jocosa, se baila en rueda", D, alts=["genre:golpe-larense", "genre:tamunangue"])
c(192, "described", "violín, flauta y arpa con melodías antiguas de origen irlandés", D, alts=["genre:folk-celta", "genre:folk"])
c(193, "described", "música súper pesada, blast beats y gruñidos incomprensibles, sin melodía", D, alts=["genre:brutal-death-metal", "genre:grindcore", "genre:death-metal"])
c(194, "described", "grabación casera con sonido sucio, chillidos y producción cruda de cassette", D, alts=["genre:raw-black-metal", "genre:black-metal"])
c(195, "described", "trompetas, congas, piano y coros con sabor caribeño para bailar", D, alts=["genre:salsa", "genre:musica-tropical", "genre:son", "genre:timba"])
c(196, "described", "ritmo lento con bajo pesado, letras de conciencia social y espiritualidad", D, alts=["genre:roots-reggae", "genre:reggae"])
c(197, "described", "metal rápido con voces agudas, coros épicos y solos virtuosos", D, alts=["genre:power-metal", "genre:speed-metal", "genre:heavy-metal"])
c(198, "described", "tambores de procesión con sensación ternaria y cantos afrovenezolanos", D, alts=["genre:tambor-afrovenezolano", "genre:sangueo"])
# --- Entidades ---
c(199, "entity", "busca la canción Papel Aluminio", E, ent=[("target", "track", "papel aluminio")])
c(200, "entity", "busca la canción I Know It's You", E, ent=[("target", "track", "i know it's you")])
c(201, "entity", "busca la canción Largo e sostenuto work", E, ent=[("target", "track", "largo e sostenuto work")])
c(202, "entity", "busca la canción Mouthfucker", E, ent=[("target", "track", "mouthfucker")])
c(203, "entity", "la canción «Talkie Talkie»", E, ent=[("target", "track", "talkie talkie")])
c(204, "entity", "el tema Libera Tu Mente", E, ent=[("target", "track", "libera tu mente")])
c(205, "entity", "el tema ¿Cuándo será?", E, ent=[("target", "track", "¿cuando sera?")])
c(206, "entity", "busca el disco 2 Depressiv Ways to Die", E, ent=[("target", "album", "2 depressiv ways to die")])
c(207, "entity", "el disco Runes", E, ent=[("target", "album", "runes")])
c(208, "entity", "busca la banda Recipe Morado", E, ent=[("target", "artist", "recipe morado")])
c(209, "entity", "Eztado kritiko", E, ent=[("target", "artist", "eztado kritiko")])
c(210, "entity", "Syntagma Ensemble", E, ent=[("target", "artist", "syntagma ensemble")])
c(211, "entity", "Urban Menace", E, ent=[("target", "artist", "urban menace")])
c(212, "entity", "Ahankar", E, ent=[("target", "artist", "ahankar")])
c(213, "entity", "Alfredo Naranjo", E, ent=[("target", "artist", "alfredo naranjo")])
c(214, "entity", "Demarchi", E, ent=[("target", "artist", "demarchi")])
c(215, "entity", "Eduardo Noriega", E, ent=[("target", "artist", "eduardo noriega")])
c(216, "entity", "MAAN", E, ent=[("target", "artist", "maan")])
c(217, "entity", "temas de Holocausto", E, ent=[("target", "artist", "holocausto")])
c(218, "entity", "discos de Surverial", E, ent=[("target", "artist", "surverial")])
c(219, "entity", "canciones de Michael Lawrence", E, ent=[("target", "artist", "michael lawrence")])
c(220, "entity", "la canción Rumba loca", E, ent=[("target", "track", "rumba loca")])
c(221, "entity", "el tema The Six - Voy, Chica", E, ent=[("target", "track", "the six - voy, chica")])
c(222, "entity", "canción \"Santa Barabara Bendita\"", E, ent=[("target", "track", "santa barabara bendita")])
# --- Parecido ---
c(223, "similarity", "algo parecido a Miercoles Insolitos", V, ["similarity:overall"], ent=[("reference", "artist", "miercoles insolitos")])
c(224, "similarity", "bandas como Grupo Sierra", V, ["similarity:overall"], ent=[("reference", "artist", "grupo sierra")])
c(225, "similarity", "música similar a Ensamble Gurrufío", V, ["similarity:overall"], ent=[("reference", "artist", "ensamble gurrufio")])
c(226, "similarity", "parecido a Flesh Impaled en la voz", V, ["similarity:voice"], ent=[("reference", "artist", "flesh impaled")])
c(227, "similarity", "al estilo de Cinema Doom en las guitarras", V, ["similarity:guitars"], ent=[("reference", "artist", "cinema doom")])
c(228, "similarity", "que suene como Anguera en la producción", V, ["similarity:production"], ent=[("reference", "artist", "anguera")])
c(229, "similarity", "como Menoles pero más triste", P, ["similarity:overall"], ent=[("reference", "artist", "menoles")], pending=1, note="comparativo no representable")
c(230, "similarity", "parecido a New Caracas en el ambiente", V, ["similarity:atmosphere"], ent=[("reference", "artist", "new caracas")])
c(231, "similarity", "algo al estilo de Luis Rafael Mojica para manejar", V, ["similarity:overall", "activity:travel"], ent=[("reference", "artist", "luis rafael mojica")])
# --- Ruido (el borrador repetía las tres de 3.0.0) ---
c(232, "noise", "zzzz qq", "unrecognized", note="sustituye «qwrt pfff» (repetida de 3.0.0)")
c(233, "noise", "vainas", "unrecognized", note="sustituye «temas» (repetida de 3.0.0)")
c(234, "noise", "algo chido", "unrecognized", note="sustituye «algo nice» (repetida de 3.0.0); valoración sin criterio")

for case in cases:
    case["split"] = "test_reserved"
    case["author"] = "Redacción DeepSeek flash (borrador sorteado, semilla 71) · etiquetas Claude (encargo de Brian, 2026-10-25)"
body = {"version": "crv-query-test-reserved-6.0.0", "authoredAt": "2026-10-25",
        "authoredBefore": "cualquier corrección de la versión 1.5.0, entrenamiento de modelos nuevos y cualquier ejecución del sistema sobre estas frases",
        "authoredAfter": "evaluación única de crv-query-heads-0.7.0 sobre la prueba 5.0.0 (ya de desarrollo)",
        "policy": "Prueba final reservada: no se usa para desarrollo, reglas, umbrales ni entrenamiento.",
        "cases": cases}
n = len(cases)
assert len({c_["text"].lower() for c_ in cases}) == n
used = {x["text"].lower() for f in OUT.parent.glob("query-*.json") if f != OUT for x in json.loads(f.read_text())["cases"]}
assert not used & {c_["text"].lower() for c_ in cases}, used & {c_["text"].lower() for c_ in cases}
lex = json.loads((OUT.parents[1] / "query-lexicon.json").read_text())
known = {x["id"] for x in lex["concepts"]} | {f"genre:{g['slug']}" for g in lex["genres"]} | {x["id"] for x in lex["facets"]}
for c_ in cases:
    g = c_["gold"]
    for k in [*g["req"], *g["exc"], *g["pref"], *g["alts"], *(x for a in g["any"] for x in a), *([g["facet"]] if g["facet"] else [])]:
        assert k in known or k.startswith(("decade:", "similarity:")), (c_["id"], k)
text = json.dumps(body, ensure_ascii=False, indent=1) + "\n"
OUT.write_text(text)
print(n, hashlib.sha256(text.encode()).hexdigest())
