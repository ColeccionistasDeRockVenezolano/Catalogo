#!/usr/bin/env python3
"""Cuarta prueba final reservada de interpretación de consultas (etapa 3, criterios 1.3.0).

Redacción: DeepSeek flash a partir de una especificación por categoría, con conceptos, géneros y
nombres del catálogo sorteados con semilla fija (draft_reserved_query_v3.py con semilla 47; borrador en
`tmp-analysis/unified-search-stage3-v13/reserved-4-draft/drafts.jsonl`). Etiquetas: Claude, el
2026-10-25, sin pasar el sistema por estas frases. Las frases del borrador con una cláusula cuya
etiqueta sería discutible (propósito vago, valoración, ambigüedad no pedida) se recortaron y llevan
`note` con el texto original; las de las categorías «aclarar» y «contradicción» que no cumplían su
especificación formal se sustituyeron (`note`). `draft` es el índice de la línea del borrador.

Convenciones: las mismas de la prueba 3.0.0, sin cambios:
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

OUT = Path(__file__).resolve().parents[2] / "docs/unified-search/stage3/datasets/query-test-reserved-4.json"
cases: list[dict] = []


def c(draft, cat, text, status, req=(), exc=(), any_=(), pref=(), ctx=0, ent=(), pending=0, alts=(), facet=None, note=None):
    cases.append({"id": f"S{len(cases)+1:03d}", "category": cat, "text": text, "draft": draft, "gold": {
        "status": status, "req": sorted(req), "exc": sorted(exc), "any": sorted(sorted(g) for g in any_),
        "pref": sorted(pref), "ctx": ctx, "ent": [dict(zip(("role", "kind", "literal"), e)) for e in ent],
        "pending": pending, "alts": sorted(alts), "facet": facet}, **({"note": note} if note else {})})


V, P, U, E, C, K = "query_valid", "partial", "unsupported", "entity_lookup", "clarify", "contradiction"
cut = lambda original: f"recortada del borrador: «{original}»"
# --- Actividad ---
c(0, "activity", "ponme algo para bailar el sábado", V, ["activity:dancing"], note=cut("ponme algo para bailar en la fiesta del sábado"))
c(1, "activity", "música para relajarme en la casa después del trabajo", V, ["activity:relaxation"], note=cut("música suave para relajarme en la casa después del trabajo") + "; «suave» es ambiguo")
c(2, "activity", "necesito temas para entrenar en el gimnasio", V, ["activity:exercise"])
c(3, "activity", "algo tranquilo para caminar por el parque temprano", V, ["emotion:serene", "activity:walking"])
c(4, "activity", "playlist para salir a correr por la mañana", V, ["activity:running"])
c(5, "activity", "canciones para desahogarme cuando estoy harto de todo", V, ["activity:catharsis"], ctx=1)
c(6, "activity", "música para el cumpleaños de mi mamá con la familia", V, ["activity:celebration"])
c(7, "activity", "sonidos para meditar unos minutos antes de dormir", V, ["activity:meditation"], note="«antes de dormir» es circunstancia")
c(8, "activity", "algo que me ayude a dormir profundamente", V, ["activity:sleep"])
c(9, "activity", "música para el viaje largo en carretera a la playa", V, ["activity:travel"])
c(10, "activity", "temas para la intimidad con mi pareja", V, ["activity:intimacy"])
c(11, "activity", "música instrumental para concentrarme mientras estudio", P, ["activity:concentration"], pending=1)
c(12, "activity", "algo para conversar con amigos en la casa", V, ["activity:socializing"], note=cut("algo de fondo para conversar con amigos en la casa"))
c(13, "activity", "quiero ritmo movido para bailar en mi cuarto", V, ["energy:energy-high", "activity:dancing"])
c(14, "activity", "pon algo relajante para descansar la mente", V, ["activity:relaxation"])
c(15, "activity", "que suene algo con energía para hacer ejercicio en casa", V, ["energy:energy-high", "activity:exercise"])
c(16, "activity", "música para trotar un rato por la avenida", V, ["activity:running"])
# --- Emoción ---
c(17, "emotion", "música que me ponga eufórico", V, ["emotion:euphoric"], note="sustituye «música que te ponga a brincar de la emoción»")
c(18, "emotion", "canciones bien alegritas", V, ["emotion:joyful"], note="sustituye «canciones alegres para levantar el ánimo»")
c(19, "emotion", "temas melancólicos", V, ["emotion:melancholic"], note=cut("temas melancólicos de despedidas"))
c(20, "emotion", "música con actitud rebelde", V, ["emotion:rebellious"], note="sustituye «música de protesta y liberación» (protesta es tema)")
c(21, "emotion", "canciones tristes para llorar a gusto", V, ["emotion:sad", "activity:catharsis"])
c(22, "emotion", "música bien sensual", V, ["emotion:sensual"], note=cut("música sensual para la noche"))
c(23, "emotion", "canciones de rabia y furia", V, ["emotion:angry"])
c(24, "emotion", "canciones románticas y tiernas", V, ["emotion:romantic"])
c(25, "emotion", "música tensa de suspenso", V, ["emotion:tense"])
c(26, "emotion", "canciones agridulces", V, ["emotion:bittersweet"], note=cut("canciones agridulces que mezclan risa y llanto"))
c(27, "emotion", "música tranquila y calmada", V, ["emotion:serene"], note="sustituye «música tranquila para calmar la mente»")
c(28, "emotion", "canciones esperanzadoras", V, ["emotion:hopeful"], note=cut("canciones esperanzadoras para tiempos difíciles"))
c(29, "emotion", "canciones nostálgicas", V, ["emotion:nostalgic"], note="sustituye «música que me recuerde mi infancia» (recordar es ambiguo)")
c(30, "emotion", "canciones que suenen solitarias", V, ["emotion:lonely"], note="sustituye «canciones para sentirme solo y en paz»")
c(31, "emotion", "playlist de euforia total para celebrar", V, ["emotion:euphoric", "activity:celebration"])
# --- Energía ---
c(32, "energy", "algo con poca energía para concentrarme", V, ["energy:energy-low", "activity:concentration"], note="sustituye «música tranquila para estudiar sin distraerme»")
c(33, "energy", "algo movidito para hacer ejercicio en casa", V, ["energy:energy-high", "activity:exercise"])
c(34, "energy", "playlist de energía media para cenar con mi pareja", V, ["energy:energy-medium", "activity:socializing"], note="sustituye «playlist suave para cenar con mi pareja»")
c(35, "energy", "temas de mucha energía para limpiar la casa", P, ["energy:energy-high"], pending=1, note="sustituye «temas con buen ritmo para limpiar rápido»; limpiar queda pendiente")
c(36, "energy", "música de baja energía para dormir la siesta", V, ["energy:energy-low", "activity:sleep"], note="sustituye «música relajada para dormir la siesta»")
# --- Ambiente ---
c(37, "atmosphere", "música con ambiente cálido y acogedor", V, ["atmosphere:warm"], note=cut("música con ambiente cálido y acogedor para estar en casa"))
c(38, "atmosphere", "canciones etéreas", V, ["atmosphere:ethereal"], note=cut("canciones etéreas con textura leve y suspendida"))
c(39, "atmosphere", "una canción envolvente", V, ["atmosphere:atmospheric"], note=cut("música envolvente que te rodee por todos lados"))
c(40, "atmosphere", "música con sonido frío y distante", V, ["atmosphere:cold"])
c(41, "atmosphere", "temas épicos de escala grandiosa", V, ["atmosphere:epic"])
c(42, "atmosphere", "música con ambiente amenazante", V, ["atmosphere:ominous"], note=cut("música con ambiente amenazante y tenso"))
c(43, "atmosphere", "canciones con ambiente misterioso y enigmático", V, ["atmosphere:mysterious"])
c(44, "atmosphere", "temas oníricos", V, ["atmosphere:dreamy"], note=cut("música onírica que suene irreal"))
c(45, "atmosphere", "temas íntimos", V, ["atmosphere:intimate"], note=cut("música íntima para escuchar de cerca"))
c(46, "atmosphere", "temas con ambiente oscuro y sombrío", V, ["atmosphere:dark"])
c(47, "atmosphere", "música espaciosa con mezcla amplia", V, ["atmosphere:spacious"])
c(48, "atmosphere", "música nocturna que evoque la noche", V, ["atmosphere:nocturnal"])
c(49, "atmosphere", "canciones con ambiente psicodélico", V, ["atmosphere:psychedelic"], note=cut("canciones con ambiente psicodélico explícito"))
c(50, "atmosphere", "música con ambiente festivo y alegre", V, ["atmosphere:festive", "emotion:joyful"])
# --- Temática ---
c(51, "theme", "canciones sobre migrantes que dejan su país", V, ["theme:migration"])
c(52, "theme", "temas que hablan del exilio y dejar la patria", V, ["theme:migration"])
c(53, "theme", "música que trate la muerte y el duelo por un ser querido", V, ["theme:death"])
c(54, "theme", "canciones que hablan de la soledad y el aislamiento", V, ["theme:loneliness"])
c(55, "theme", "temas cuya letra hable de salud mental", V, ["theme:mental-health"])
c(56, "theme", "canciones que hablen de la naturaleza y el medio ambiente", V, ["theme:nature"])
c(57, "theme", "música con letras de ciencia ficción y futuristas", V, ["theme:science-fiction"])
c(58, "theme", "canciones sobre la vida cotidiana y la sociedad", V, ["theme:society"])
c(59, "theme", "temas de desamor y ruptura", V, ["theme:breakup"])
c(60, "theme", "canciones con letras de humor y sátira", V, ["theme:humor"])
c(61, "theme", "música que trate la historia y la memoria", V, ["theme:history"])
c(62, "theme", "canciones de política y protesta social", V, ["theme:politics"])
c(63, "theme", "temas sobre identidad y pertenencia cultural", V, ["theme:identity"])
c(64, "theme", "canciones que hablen de espiritualidad y religión", V, ["theme:spirituality"])
c(65, "theme", "música con letras de fantasía y mitología", V, ["theme:fantasy"])
# --- Género ---
c(66, "genre", "música ska para poner en una fiesta", V, ["genre:ska", "activity:celebration"])
c(67, "genre", "jazz afrocubano tranquilo", V, ["genre:jazz-afrocubano", "emotion:serene"], note="sustituye «jazz afrocubano instrumental para escuchar tranquilo»")
c(68, "genre", "post grunge de los 2000", V, ["genre:post-grunge", "decade:2000s"], note=cut("post grunge de los 2000 bien rockero"))
c(69, "genre", "guaracha para bailar con la familia", V, ["genre:guaracha", "activity:dancing"])
c(70, "genre", "raw black metal", V, ["genre:raw-black-metal"], note=cut("raw black metal bien crudo y ruidoso"))
c(71, "genre", "trance para entrenar con energía", V, ["genre:trance", "activity:exercise", "energy:energy-high"])
c(72, "genre", "future house de la buena para el gym", V, ["genre:future-house", "activity:exercise"])
c(73, "genre", "trap latino para la fiesta con los panas", V, ["genre:trap-latino", "activity:celebration"])
c(74, "genre", "speed metal", V, ["genre:speed-metal"], note=cut("speed metal rápido y con guitarrazos"))
c(75, "genre", "electrónica para estudiar concentrado", V, ["genre:electronica", "activity:concentration"])
c(76, "genre", "nueva canción latinoamericana de protesta", V, ["genre:nueva-cancion", "theme:politics"])
c(77, "genre", "folk celta con violines y flautas", P, ["genre:folk-celta"], pending=1, note="instrumentación pendiente")
c(78, "genre", "hard rock para manejar", V, ["genre:hard-rock", "activity:travel"], note="sustituye «hard rock clásico para cantar a gritos»")
c(79, "genre", "new age para dormir", V, ["genre:new-age", "activity:sleep"], note=cut("new age relajante para dormir"))
c(80, "genre", "onda nueva de los 70", V, ["genre:onda-nueva", "decade:1970s"], note=cut("onda nueva venezolana de los 70"))
# --- Y ---
c(81, "and", "salsa para cocinar", P, ["genre:salsa"], pending=1, note="sustituye «canciones de salsa para limpiar la casa con ganas» (casi igual a la prueba 3.0.0); cocinar queda pendiente")
c(82, "and", "baladas románticas tranquilitas", V, ["genre:balada", "emotion:romantic", "emotion:serene"], note="sustituye «baladas románticas para dedicar a mi pareja tranquilito»")
c(83, "and", "reggaetón para el gimnasio con mucha energía", V, ["genre:reggaeton", "activity:exercise", "energy:energy-high"], note=cut("reggaetón viejo para el gimnasio con mucha energía"))
c(84, "and", "música cristiana para dormir", V, ["genre:musica-cristiana", "activity:sleep"], note="sustituye «música cristiana para orar antes de dormir en paz»")
c(85, "and", "rock latino para viaje por carretera con amigos", V, ["genre:rock-latino", "activity:travel"])
c(86, "and", "vallenato para celebrar un cumpleaños", V, ["genre:vallenato", "activity:celebration"], note="sustituye «vallenato para celebrar cumpleaños feliz»")
c(87, "and", "jazz para estudiar concentrado", V, ["genre:jazz", "activity:concentration"], note=cut("jazz suave para estudiar concentrado de noche"))
c(88, "and", "cumbia para bailar en reunión familiar sin parar", V, ["genre:cumbia", "activity:dancing"])
c(89, "and", "música clásica para leer un libro", V, ["genre:musica-clasica", "activity:concentration"], note=cut("música clásica para leer un libro relajado"))
c(90, "and", "bachata de desamor para llorar", V, ["genre:bachata", "theme:breakup", "activity:catharsis"], note="sustituye «bachata para sanar un desamor llorando un rato»")
c(91, "and", "merengue de los 90 para prender la fiesta", V, ["genre:merengue", "decade:1990s", "activity:celebration"], note="sustituye «merengue para prender la fiesta con nostalgia de los 90»")
c(92, "and", "rap para correr con rabia", V, ["genre:hip-hop", "activity:running", "emotion:angry"], note="sustituye «rap en español para correr con rabia y motivación»")
c(93, "and", "boleros nostálgicos y románticos", V, ["genre:bolero", "emotion:nostalgic", "emotion:romantic"], note="sustituye «boleros para recordar a mi mamá con cariño»")
c(94, "and", "electrónica para trabajar en la compu", V, ["genre:electronica", "activity:concentration"], note=cut("electrónica para trabajar en la compu sin distracciones"))
c(95, "and", "música serena para meditar al amanecer", V, ["emotion:serene", "activity:meditation"], note="sustituye «música de relajación para yoga al amanecer en calma»")
c(96, "and", "pop latino alegre para manejar", V, ["genre:pop-latino", "emotion:joyful", "activity:travel"], note="sustituye «pop latino para cantar a todo pulmón en el carro feliz»")
c(97, "and", "cumbia con melancolía", V, ["genre:cumbia", "emotion:melancholic"], note="sustituye «chicha peruana para recordar mi tierra con melancolía» (chicha no está en el registro)")
c(98, "and", "reggae tranquilo para compartir con amigos", V, ["genre:reggae", "emotion:serene", "activity:socializing"], note="sustituye «reggae para una tarde de playa tranquilo con amigos»")
c(99, "and", "rock para compartir con los compas el fin de semana", V, ["genre:rock", "activity:socializing"], note="sustituye «música de banda para tomar con los compas el fin de semana»")
c(100, "and", "tango romántico para una cena", V, ["genre:tango", "emotion:romantic", "activity:socializing"], note="sustituye «tango para una cena romántica elegante»")
c(101, "and", "salsa con mucha energía para bailar", V, ["genre:salsa", "energy:energy-high", "activity:dancing"], note="sustituye «salsa brava para despertar con energía por la mañana»")
c(102, "and", "indie melancólico", V, ["genre:indie-rock", "emotion:melancholic"], note="sustituye «indie en español para pensar en la vida un domingo gris»")
c(103, "and", "folk para meditar", V, ["genre:folk", "activity:meditation"], note="sustituye «música andina para meditar en la montaña en silencio» (música andina no es género del registro)")
c(104, "and", "canciones infantiles alegres", V, ["genre:musica-infantil", "emotion:joyful"], note="sustituye «canciones infantiles para jugar con los niños contentos»")
# --- O ---
c(105, "or", "algo de salsa o merengue para limpiar la casa", P, any_=[["genre:salsa", "genre:merengue"]], pending=1)
c(106, "or", "música nostálgica o melancólica", V, any_=[["emotion:nostalgic", "emotion:melancholic"]], note="sustituye «música triste o melancólica para cuando llueve» (casi igual a la prueba 3.0.0)")
c(107, "or", "canciones románticas o de despecho", V, any_=[["emotion:romantic", "theme:breakup"]], note=cut("canciones románticas o de despecho para dedicar"))
c(108, "or", "ponme reggaetón o trap latino", V, any_=[["genre:reggaeton", "genre:trap-latino"]], note="sustituye «ponme reggaetón o dembow que prenda la fiesta» (dembow no está en el registro)")
c(109, "or", "algo sereno o etéreo para estudiar", V, ["activity:concentration"], any_=[["emotion:serene", "atmosphere:ethereal"]], note="sustituye «algo tranquilo o acústico para estudiar»")
c(110, "or", "música para llorar o para bailar", V, any_=[["activity:catharsis", "activity:dancing"]], note="sustituye «música para llorar o para levantar el ánimo»")
c(111, "or", "rock o pop en español de los 90", P, ["decade:1990s"], any_=[["genre:rock", "genre:pop"]], pending=1, note="idioma pendiente, como en la prueba 3.0.0")
c(112, "or", "algo eufórico o rebelde para el gimnasio", V, ["activity:exercise"], any_=[["emotion:euphoric", "emotion:rebellious"]], note="sustituye «algo bailable o movido para el gimnasio»")
c(113, "or", "cumbia o vallenato para el cumpleaños", V, ["activity:celebration"], any_=[["genre:cumbia", "genre:vallenato"]], note="sustituye «cumbia o chicha para el cumpleaños»")
c(114, "or", "música para relajarse o para dormir", V, any_=[["activity:relaxation", "activity:sleep"]], note="sustituye «música relajante o para dormir sin letra»")
c(115, "or", "baladas o tangos para una cena", V, ["activity:socializing"], any_=[["genre:balada", "genre:tango"]], note="sustituye «baladas o boleros para una cena romántica»")
# --- Negación ---
c(116, "negation", "música para estudiar que no tenga letra", P, ["activity:concentration"], pending=1)
c(117, "negation", "playlist de fiesta sin reggaetón", V, ["activity:celebration"], exc=["genre:reggaeton"])
c(118, "negation", "canciones alegres que no sean de salsa", V, ["emotion:joyful"], exc=["genre:salsa"], note="sustituye «canciones alegres que no sean infantiles» (casi igual a la prueba 3.0.0)")
c(119, "negation", "algo para dormir sin ruido ni batería", P, ["activity:sleep"], pending=1)
c(120, "negation", "música romántica pero que no sea triste", V, ["emotion:romantic"], exc=["emotion:sad"])
c(121, "negation", "rock sin baladas", V, ["genre:rock"], exc=["genre:balada"])
c(122, "negation", "música para trabajar sin nada de metal", V, ["activity:concentration"], exc=["genre:metal"], note="sustituye «música para trabajar sin voces ni anuncios» (casi igual a la prueba 3.0.0)")
c(123, "negation", "cumbia que no sea villera", P, ["genre:cumbia"], pending=1, note="la cumbia villera no está en el registro")
c(124, "negation", "canciones de karaoke sin despecho", P, exc=["theme:breakup"], pending=1)
c(125, "negation", "música electrónica sin dubstep", V, ["genre:electronica"], exc=["genre:dubstep"])
c(126, "negation", "salsa sin letras de desamor", V, ["genre:salsa"], exc=["theme:breakup"])
c(127, "negation", "algo movido que no sea comercial", P, ["energy:energy-high"], pending=1, note="popularidad pendiente")
c(128, "negation", "música clásica que no sea ópera", V, ["genre:musica-clasica"], exc=["genre:opera"])
c(129, "negation", "playlist de gym sin metal", V, ["activity:exercise"], exc=["genre:metal"])
c(130, "negation", "música cristiana que no sea triste", V, ["genre:musica-cristiana"], exc=["emotion:sad"], note="sustituye «música cristiana que no sea tan lenta»")
c(131, "negation", "rap sin groserías", P, ["genre:hip-hop"], pending=1)
c(132, "negation", "música para cocinar sin jazz", P, exc=["genre:jazz"], pending=1)
c(133, "negation", "boleros que no sean tristes", V, ["genre:bolero"], exc=["emotion:sad"], note="sustituye «canciones viejitas que no sean rancheras»")
c(134, "negation", "música tranquila sin guitarra", P, ["emotion:serene"], pending=1, note="sustituye «música instrumental sin piano» (dos restricciones pendientes)")
# --- Preferencia ---
c(135, "preference", "salsa para bailar con mi pareja, ojalá romántica", V, ["genre:salsa", "activity:dancing"], pref=["emotion:romantic"], note="sustituye «canciones de salsa vieja para bailar con mi pareja ojalá bien románticas»")
c(136, "preference", "playlist de dancehall, preferiblemente de los 90", V, ["genre:dancehall"], pref=["decade:1990s"], note="sustituye «playlist de reggaetón viejo preferiblemente de los 2000 que no sea tan comercial»")
c(137, "preference", "música para cocinar, mejor si es bolero", P, pref=["genre:bolero"], pending=1, note="sustituye «música de planchar mejor si es boleros y baladas de los 80»")
c(138, "preference", "cumbias para una fiesta familiar de preferencia que todos se sepan", P, ["genre:cumbia", "activity:celebration"], pending=1, note="popularidad pendiente")
c(139, "preference", "rock en español para manejar, idealmente de los 80", V, ["genre:rock-latino", "activity:travel"], pref=["decade:1980s"], note="sustituye «… idealmente que no sea tan pesado»")
c(140, "preference", "vallenatos, si es posible de desamor", V, ["genre:vallenato"], pref=["theme:breakup"], note="sustituye «vallenatos para dedicar si es posible de desamor»")
c(141, "preference", "música cristiana, ojalá alegre", V, ["genre:musica-cristiana"], pref=["emotion:joyful"], note="sustituye «música cristiana para orar ojalá suave y sin mucha batería»")
# --- Estado del oyente ---
c(142, "listener", "estoy feliz, ponme algo movido", V, ["energy:energy-high"], ctx=1, note="sustituye «estoy feliz y con ganas de bailar, ponme algo movido para limpiar la casa»")
c(143, "listener", "ando triste y nostálgico, quiero canciones alegres", V, ["emotion:joyful"], ctx=1, note="sustituye «… canciones que me recuerden a mi tierra»")
c(144, "listener", "me siento agotado después del trabajo, ponme algo para relajarme", V, ["activity:relaxation"], ctx=1, note=cut("… ponme algo suave para relajarme"))
c(145, "listener", "estoy enamorado y quiero una playlist romántica", V, ["emotion:romantic"], ctx=1, note=cut("… playlist romántica para dedicarle a mi pareja"))
c(146, "listener", "ando con mucha energía hoy, dame música para entrenar en el gimnasio", V, ["activity:exercise"], ctx=1)
c(147, "listener", "me siento melancólico y quiero escuchar boleros", V, ["genre:bolero"], ctx=1, note=cut("… boleros viejos que me pongan a recordar"))
c(148, "listener", "estoy contento porque es mi cumpleaños, ponme algo alegre para celebrar con la familia", V, ["emotion:joyful", "activity:celebration"], ctx=1)
c(149, "listener", "ando estresado con el trabajo y necesito música instrumental para concentrarme", P, ["activity:concentration"], ctx=1, pending=1)
c(150, "listener", "me siento con sueño, ponme algo con mucha energía", V, ["energy:energy-high"], ctx=1, note="sustituye «… pero tengo que manejar, ponme algo animado para mantenerme despierto»")
c(151, "listener", "estoy aburrido en casa un domingo, recomiéndame música nueva para descubrir", U, ctx=1, pending=1, note="novedad pendiente")
c(152, "listener", "ando un poco bajoneado por una ruptura, ponme canciones para desahogarme", V, ["activity:catharsis"], ctx=1)
c(153, "listener", "me siento orgulloso de mis raíces, quiero escuchar joropo", V, ["genre:joropo"], ctx=1, note="sustituye «… música folclórica venezolana»")
# --- No representables ---
c(154, "unsupported", "canciones que estén entre 90 y 100 bpm para trotar", P, ["activity:running"], pending=1)
c(155, "unsupported", "temas que duren menos de dos minutos y medio", U, pending=1)
c(156, "unsupported", "música en compás de 3/4 para bailar con mi pareja", P, ["activity:dancing"], pending=1)
c(157, "unsupported", "canciones en portugués", U, pending=1, note=cut("canciones en portugués que no sean de Brasil"))
c(158, "unsupported", "algo con voz masculina grave", U, pending=1, note=cut("algo con voz masculina grave para la noche"))
c(159, "unsupported", "playlist con pura guitarra acústica", U, pending=1, note=cut("playlist con pura guitarra acústica y nada de batería"))
c(160, "unsupported", "canciones grabadas en vivo", U, pending=1, note=cut("canciones grabadas en vivo con público que se escuche"))
c(161, "unsupported", "versiones remasterizadas de los ochenta", P, ["decade:1980s"], pending=1)
c(162, "unsupported", "temas lo-fi", U, pending=1, facet="candidate:production.fidelity-aesthetic", note=cut("temas lo-fi con la voz bien al fondo de la mezcla"))
c(163, "unsupported", "álbumes que sean un solo viaje sin pausas entre temas", U, pending=1, facet="candidate:structure.continuity")
c(164, "unsupported", "discos conceptuales que cuenten una historia completa", U, pending=1, facet="candidate:structure.narrative")
c(165, "unsupported", "discos que ganan con cada escucha", U, pending=1, facet="candidate:reception.acclimatization", note="sustituye «canciones que mejoran mientras más las escuchas» (casi igual a la prueba 3.0.0)")
c(166, "unsupported", "música a 120 bpm exactos para clase de spinning", P, ["activity:exercise"], pending=1)
c(167, "unsupported", "temas con muchos samples de películas viejas", U, pending=1, facet="candidate:production.sources")
c(168, "unsupported", "canciones cantadas en francés para estudiar", P, ["activity:concentration"], pending=1, note=cut("canciones cantadas en francés para estudiar tranquilo"))
c(169, "unsupported", "algo con voz femenina para llorar un rato", P, ["activity:catharsis"], pending=1, note=cut("algo con solo piano y voz femenina para llorar un rato"))
c(170, "unsupported", "pistas que duren más de siete minutos para un viaje largo", P, ["activity:travel"], pending=1)
c(171, "unsupported", "música en vivo de festival", U, pending=1, note=cut("música en vivo de festival donde se sienta la gente"))
c(172, "unsupported", "canciones con voz susurrada", U, pending=1, note=cut("canciones con batería electrónica bien marcada y voz susurrada"))
# --- Década ---
c(173, "decade", "música romántica de los 80", V, ["emotion:romantic", "decade:1980s"], note=cut("música romántica de los 80 para dedicar"))
c(174, "decade", "rock de los 70 para viajar", V, ["genre:rock", "decade:1970s", "activity:travel"], note=cut("rock de los 70 bien pesado para viajar"))
c(175, "decade", "canciones alegres de los 90 para una fiesta", V, ["emotion:joyful", "decade:1990s", "activity:celebration"])
c(176, "decade", "música triste de los 2000 para llorar un rato", V, ["emotion:sad", "decade:2000s", "activity:catharsis"])
# --- Aclarar (como en 3.0.0: la palabra ambigua sin la explicación del borrador) ---
c(177, "clarify", "ponme algo caliente", C, alts=["emotion:sensual", "atmosphere:warm", "energy:energy-high"], note="sustituye el borrador 177")
c(178, "clarify", "canciones intensas", C, alts=["emotion:tense", "energy:energy-high"], note="sustituye el borrador 178")
c(179, "clarify", "temas con mucha aura", C, alts=["emotion:confident", "atmosphere:epic", "energy:energy-high"], note="sustituye el borrador 179")
c(180, "clarify", "quiero canciones de amor", C, alts=["theme:love", "emotion:romantic", "activity:intimacy"])
c(181, "clarify", "ponme algo de sexo", C, alts=["activity:intimacy", "theme:sexuality"])
c(182, "clarify", "música psicodélica", C, alts=["atmosphere:psychedelic", "genre:rock-psicodelico"], note=cut("música psicodélica para hoy"))
c(183, "clarify", "ponme algo que me anime", C, alts=["emotion:joyful", "emotion:euphoric", "emotion:confident"], note="sustituye «necesito animarme con música»")
c(184, "clarify", "algo suave", C, alts=["emotion:serene", "energy:energy-low"], note=cut("algo suave para la noche"))
c(185, "clarify", "busco música pesada", C, alts=["genre:metal", "energy:energy-high"])
c(186, "clarify", "salsa y alegre o romántica", C, note="sustituye «quiero algo oscuro» (oscuro no es ambiguo); mezcla de Y y O sin alcance")
c(186, "clarify", "Añoranzas", C, alts=["emotion:nostalgic"], ent=[("target", None, "anoranzas")], note="añadido; también es disco del catálogo (como «Odio» en 3.0.0)")
# --- Contradicciones (el borrador no las formulaba como contradicción formal) ---
c(187, "contradiction", "jazz pero sin jazz", K, note="sustituye el borrador 187")
c(188, "contradiction", "algo de energía baja y de energía alta a la vez", K, note="sustituye el borrador 188")
c(189, "contradiction", "música alegre que no sea alegre", K, note="sustituye el borrador 189")
c(190, "contradiction", "temas nostálgicos sin nostalgia", K, note="sustituye el borrador 190")
c(191, "contradiction", "algo oscuro pero sin oscuridad", K, note="sustituye el borrador 191")
# --- Otros idiomas ---
c(192, "multilingual", "music for studying late at night", V, ["activity:concentration"], note=cut("chill music for studying late at night"))
c(193, "multilingual", "songs for a workout at the gym", V, ["activity:exercise"], note=cut("upbeat songs for a workout at the gym"))
c(194, "multilingual", "romantic songs for a dinner", V, ["emotion:romantic", "activity:socializing"], note=cut("romantic songs for a date night dinner"))
c(195, "multilingual", "sad music for a long drive", V, ["emotion:sad", "activity:travel"], note="sustituye «happy feel good music for a road trip» (casi igual a la prueba 3.0.0)")
c(196, "multilingual", "relaxing jazz music", V, ["genre:jazz", "activity:relaxation"], note=cut("relaxing jazz for a rainy sunday morning"))
# --- Género por descripción (sorteado y vecinos que encajan con lo descrito) ---
D = C
c(197, "described", "música de guitarra y tiple con ritmo de vals en tres tiempos, canto a dos voces que suena a montaña andina", D, alts=["genre:bambuco", "genre:vals-andino", "genre:musica-tradicional"])
c(198, "described", "guitarras distorsionadas pesadas con batería agresiva y algún toque de percusión latina o letras en español", D, alts=["genre:metal-latino", "genre:nu-metal", "genre:metal"])
c(199, "described", "rock simple y directo, guitarras sucias, producción casera y batería básica que suena a garaje", D, alts=["genre:garage-rock", "genre:punk-rock", "genre:rock"])
c(200, "described", "arpa y cuatro con bajo y batería de jazz, armonías suaves y un cantar que flota entre joropo y bossa nova", D, alts=["genre:onda-nueva", "genre:joropo", "genre:bossa-nova", "genre:jazz-latino"])
c(201, "described", "death metal con voces guturales y partes lentas y pesadas de medio tiempo que invitan al slam", D, alts=["genre:slamming-brutal-death-metal", "genre:brutal-death-metal", "genre:death-metal"])
c(202, "described", "rock de guitarras limpias y ruidosas a la vez, voz íntima y arreglos variados sin un solo estilo fijo", D, alts=["genre:indie-rock", "genre:rock-alternativo"])
c(203, "described", "violín, flauta y arpa con percusión suave, melodías que suenan a Irlanda o Escocia y cambios según la región", D, alts=["genre:folk-celta", "genre:folk"])
c(204, "described", "guitarras con efectos raros, ecos, cintas invertidas y sonidos que parecen viajes mentales", D, alts=["genre:rock-psicodelico"])
c(205, "described", "música de cuerdas y tambores del oriente venezolano con cantos tradicionales y ritmo de joropo oriental", D, alts=["genre:musica-oriental", "genre:joropo", "genre:galeron", "genre:polo-oriental", "genre:malaguena"])
c(206, "described", "tres cubano, bongó, contrabajo y coros que se contestan con sabor y montuno", D, alts=["genre:son", "genre:salsa", "genre:guaracha"])
c(207, "described", "ritmo rapidísimo con breaks de batería entrecortados y un bajo muy grave que retumba", D, alts=["genre:drum-and-bass"])
c(208, "described", "gritos y guitarras duras que de pronto se vuelven melódicas y cambian de dinámica varias veces", D, alts=["genre:post-hardcore", "genre:emo", "genre:metalcore"])
c(209, "described", "batería programada seca, sintetizadores fríos y minimalistas con voz apagada y repetitiva", D, alts=["genre:coldwave", "genre:post-punk", "genre:darkwave", "genre:synth-pop"])
# --- Entidades (nombres sorteados del catálogo) ---
c(210, "entity", "busca la canción Workaholic", E, ent=[("target", "track", "workaholic")])
c(211, "entity", "busca la canción So eine Nacht unter Palmen", E, ent=[("target", "track", "so eine nacht unter palmen")])
c(212, "entity", "busca la canción Ramos De Amor", E, ent=[("target", "track", "ramos de amor")])
c(213, "entity", "busca la canción Las Plagas", E, ent=[("target", "track", "las plagas")])
c(214, "entity", "la canción «Africanía»", E, ent=[("target", "track", "africania")])
c(215, "entity", "el tema Ultrafunk", E, ent=[("target", "track", "ultrafunk")])
c(216, "entity", "el tema Guayabo Song", E, ent=[("target", "track", "guayabo song")])
c(217, "entity", "busca el disco Esperanza es desgracia", E, ent=[("target", "album", "esperanza es desgracia")])
c(218, "entity", "el disco Encuentros", E, ent=[("target", "album", "encuentros")])
c(219, "entity", "busca la banda Reflector", E, ent=[("target", "artist", "reflector")])
c(220, "entity", "Doctor No", E, ent=[("target", "artist", "doctor no")])
c(221, "entity", "Juan Francisco Zerpa", E, ent=[("target", "artist", "juan francisco zerpa")])
c(222, "entity", "Marcelo Beroy Rojas", E, ent=[("target", "artist", "marcelo beroy rojas")])
c(223, "entity", "Eterno Fulgor", E, ent=[("target", "artist", "eterno fulgor")])
c(224, "entity", "Pray", E, ent=[("target", "artist", "pray")])
c(225, "entity", "Odo'Sha", E, ent=[("target", "artist", "odo'sha")])
c(226, "entity", "Colmillo", E, ent=[("target", "artist", "colmillo")])
c(227, "entity", "Los Automaticos", E, ent=[("target", "artist", "los automaticos")])
c(228, "entity", "temas de Abstinencia", E, ent=[("target", "artist", "abstinencia")])
c(229, "entity", "discos de DAYNIGHT", E, ent=[("target", "artist", "daynight")])
c(230, "entity", "canciones de No Rew", E, ent=[("target", "artist", "no rew")])
c(231, "entity", "la canción Este Ritmo Nuevo", E, ent=[("target", "track", "este ritmo nuevo")])
c(232, "entity", "el tema Maps to the Deep Deep Ocean", E, ent=[("target", "track", "maps to the deep deep ocean")])
c(233, "entity", "canción \"Pasaje-atmósfera\"", E, ent=[("target", "track", "pasaje-atmosfera")])
# --- Parecido ---
c(234, "similarity", "algo parecido a Red Glass Tube", V, ["similarity:overall"], ent=[("reference", "artist", "red glass tube")])
c(235, "similarity", "bandas como v0d_", V, ["similarity:overall"], ent=[("reference", "artist", "v0d_")])
c(236, "similarity", "música similar a Victimas de la Democracia", V, ["similarity:overall"], ent=[("reference", "artist", "victimas de la democracia")])
c(237, "similarity", "parecido a Bak Trío en la voz", V, ["similarity:voice"], ent=[("reference", "artist", "bak trio")])
c(238, "similarity", "al estilo de Aurora Boreal en las guitarras", V, ["similarity:guitars"], ent=[("reference", "artist", "aurora boreal")])
c(239, "similarity", "que suene como Federíco Jr. en la producción", V, ["similarity:production"], ent=[("reference", "artist", "federico jr.")])
c(240, "similarity", "como Milicia Etílica pero más triste", P, ["similarity:overall"], ent=[("reference", "artist", "milicia etilica")], pending=1, note="comparativo no representable")
c(241, "similarity", "parecido a Raw Oath en el ambiente", V, ["similarity:atmosphere"], ent=[("reference", "artist", "raw oath")])
c(242, "similarity", "algo al estilo de No Parking para manejar", V, ["similarity:overall", "activity:travel"], ent=[("reference", "artist", "no parking")])
# --- Ruido (el borrador repetía las tres de 3.0.0) ---
c(243, "noise", "ñlkj asdf", "unrecognized", note="sustituye «qwrt pfff» (repetida de 3.0.0)")
c(244, "noise", "musiquita", "unrecognized", note="sustituye «temas» (repetida de 3.0.0)")
c(245, "noise", "algo bien chévere", "unrecognized", note="sustituye «algo nice» (repetida de 3.0.0); valoración sin criterio: relleno")

for case in cases:
    case["split"] = "test_reserved"
    case["author"] = "Redacción DeepSeek flash (borrador sorteado, semilla 47) · etiquetas Claude (encargo de Brian, 2026-10-25)"
body = {"version": "crv-query-test-reserved-4.0.0", "authoredAt": "2026-10-25",
        "authoredBefore": "cualquier corrección de la versión 1.3.0, entrenamiento de modelos nuevos y cualquier ejecución del sistema sobre estas frases",
        "authoredAfter": "evaluación única de crv-query-heads-0.6.0 sobre la prueba 3.0.0 (ya de desarrollo)",
        "policy": "Prueba final reservada: no se usa para desarrollo, reglas, umbrales ni entrenamiento.",
        "cases": cases}
assert len(cases) == 247, len(cases)
assert len({c_["text"].lower() for c_ in cases}) == 247
used = {x["text"].lower() for f in OUT.parent.glob("query-*.json") if f != OUT for x in json.loads(f.read_text())["cases"]}
assert not used & {c_["text"].lower() for c_ in cases}, used & {c_["text"].lower() for c_ in cases}
text = json.dumps(body, ensure_ascii=False, indent=1) + "\n"
OUT.write_text(text)
print(len(cases), hashlib.sha256(text.encode()).hexdigest())
