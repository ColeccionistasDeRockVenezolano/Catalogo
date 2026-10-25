#!/usr/bin/env python3
"""Quinta prueba final reservada de interpretación de consultas (etapa 3, criterios 1.4.0).

Redacción: DeepSeek flash a partir de una especificación por categoría, con conceptos, géneros y
nombres del catálogo sorteados con semilla fija (draft_reserved_query_v3.py con semilla 59; borrador en
`tmp-analysis/unified-search-stage3-v14/reserved-5-draft/drafts.jsonl`). Etiquetas: Claude, el
2026-10-25, sin pasar el sistema por estas frases. Las frases con una cláusula cuya etiqueta sería
discutible (propósito vago, valoración, «suave», «para recordar», género fuera del registro dentro de
una alternativa) se recortaron (`note` con el texto original) o se descartaron; las de «contradicción»
que no cumplían su especificación formal y las tres de ruido (repetidas de 3.0.0) se sustituyeron.
`draft` es el índice de la línea del borrador. Quedan 224 casos; no se completan con frases propias.

Convenciones: las de las pruebas 3.0.0 y 4.0.0, con una corrección:
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

OUT = Path(__file__).resolve().parents[2] / "docs/unified-search/stage3/datasets/query-test-reserved-5.json"
cases: list[dict] = []


def c(draft, cat, text, status, req=(), exc=(), any_=(), pref=(), ctx=0, ent=(), pending=0, alts=(), facet=None, note=None):
    cases.append({"id": f"F{len(cases)+1:03d}", "category": cat, "text": text, "draft": draft, "gold": {
        "status": status, "req": sorted(req), "exc": sorted(exc), "any": sorted(sorted(g) for g in any_),
        "pref": sorted(pref), "ctx": ctx, "ent": [dict(zip(("role", "kind", "literal"), e)) for e in ent],
        "pending": pending, "alts": sorted(alts), "facet": facet}, **({"note": note} if note else {})})


V, P, U, E, C, K = "query_valid", "partial", "unsupported", "entity_lookup", "clarify", "contradiction"
cut = lambda original: f"recortada del borrador: «{original}»"
# --- Actividad ---
c(0, "activity", "música para prepararme para dormir", V, ["activity:sleep"], note=cut("música para prepararme para dormir y desconectar el cerebro"))
c(1, "activity", "ponme algo para relajarme después del trabajo", V, ["activity:relaxation"], note=cut("ponme algo suave para relajarme después del trabajo") + "; «suave» es ambiguo")
c(2, "activity", "qué música pongo para un momento íntimo con mi pareja", V, ["activity:intimacy"])
c(3, "activity", "necesito música para concentrarme mientras estudio", V, ["activity:concentration"])
c(4, "activity", "música para una reunión familiar festiva", V, ["activity:celebration"])
c(5, "activity", "algo para entrenar en el gimnasio", V, ["activity:exercise"], note=cut("algo con ritmo para entrenar en el gimnasio"))
c(6, "activity", "ponme algo para caminar por la ciudad", V, ["activity:walking"], note=cut("ponme algo para caminar tranquilo por la ciudad") + "; «tranquilo» modifica al oyente")
c(7, "activity", "música para meditar diez minutos al despertar", V, ["activity:meditation"])
c(8, "activity", "música de fondo para una tarde de conversación con amigos", V, ["activity:socializing"])
c(9, "activity", "quiero bailar en mi cumpleaños, dame algo movido", V, ["activity:dancing", "energy:energy-high"], note="«en mi cumpleaños» es circunstancia sin «para»")
c(10, "activity", "música para desahogarme cuando estoy molesto", V, ["activity:catharsis"], ctx=1)
c(11, "activity", "algo que me ayude a quedarme dormido rápido", V, ["activity:sleep"])
c(12, "activity", "música instrumental para relajarme en el sofá", V, ["genre:instrumental", "activity:relaxation"])
c(13, "activity", "canciones para un rato de intimidad", V, ["activity:intimacy"], note=cut("canciones para un rato de intimidad sin letras raras"))
c(14, "activity", "música para trotar media hora sin parar", V, ["activity:running"])
# --- Emoción ---
c(15, "emotion", "música para sentirme solo en casa un rato", V, ["emotion:lonely"])
c(16, "emotion", "canciones bien agresivas para descargar la rabia", V, ["emotion:angry", "activity:catharsis"])
c(17, "emotion", "temas tristes que te partan el alma", V, ["emotion:sad"])
c(18, "emotion", "canciones con tensión que te mantengan en vilo", V, ["emotion:tense"])
c(19, "emotion", "música esperanzadora para cuando necesito creer que algo bueno viene", V, ["emotion:hopeful"], note="la cláusula de «para cuando» es relleno")
c(20, "emotion", "canciones que me den nostalgia de mi infancia", V, ["emotion:nostalgic"])
c(21, "emotion", "música de autoafirmación para levantarme con seguridad", V, ["emotion:confident"])
c(22, "emotion", "canciones de añoranza", V, ["emotion:nostalgic"], note=cut("canciones contemplativas de pérdida y añoranza"))
c(23, "emotion", "temas alegres", V, ["emotion:joyful"], note=cut("temas alegres sin que sean puro ruido bailable"))
c(24, "emotion", "música rebelde para sentirme libre", V, ["emotion:rebellious"])
c(25, "emotion", "canciones románticas y tiernas de verdad", V, ["emotion:romantic"])
c(26, "emotion", "música eufórica para sentirme exaltado", V, ["emotion:euphoric"])
c(27, "emotion", "canciones sensuales con esa vibra", V, ["emotion:sensual"], note=cut("canciones sensuales con esa vibra suave"))
c(28, "emotion", "música agridulce que mezcle emociones encontradas", V, ["emotion:bittersweet"])
c(29, "emotion", "canciones serenas para estar tranquilo", V, ["emotion:serene"], note=cut("canciones serenas para estar tranquilo sin dormirme"))
# borrador 30 («temas para cuando uno se siente solo pero sin ponerse triste») descartado: estado y exclusión sin pedido claro
# --- Energía ---
c(31, "energy", "música tranquila para estudiar sin distraerme", V, ["emotion:serene", "activity:concentration"])
c(32, "energy", "canciones movidas para hacer ejercicio en el gym", V, ["energy:energy-high", "activity:exercise"])
# borrador 33 («algo suave para poner de fondo mientras ceno») descartado: «suave» ambiguo y cena sin encuentro
c(34, "energy", "temas con mucho ritmo para armar la fiesta", V, ["energy:energy-high", "activity:celebration"])
c(35, "energy", "playlist ni muy lenta ni muy acelerada para el carro", V, ["energy:energy-medium", "activity:travel"])
# --- Ambiente ---
c(36, "atmosphere", "música con ambiente etéreo flotante", V, ["atmosphere:ethereal"])
c(37, "atmosphere", "música oscura instrumental para ambientar", V, ["atmosphere:dark", "genre:instrumental"])
c(38, "atmosphere", "canciones con ambiente amenazante tenso", V, ["atmosphere:ominous", "emotion:tense"])
c(39, "atmosphere", "música misteriosa enigmática", V, ["atmosphere:mysterious"], note=cut("música misteriosa enigmática para pensar"))
c(40, "atmosphere", "música festiva para poner en una reunión", V, ["atmosphere:festive", "activity:socializing"])
c(41, "atmosphere", "canciones oníricas que suenen irreales", V, ["atmosphere:dreamy"])
c(42, "atmosphere", "música nocturna para escuchar de madrugada", V, ["atmosphere:nocturnal"])
c(43, "atmosphere", "música envolvente que te rodee", V, ["atmosphere:atmospheric"])
c(44, "atmosphere", "música cálida acogedora", V, ["atmosphere:warm"], note=cut("música cálida acogedora para el hogar"))
c(45, "atmosphere", "música épica grandiosa de fondo", V, ["atmosphere:epic"])
c(46, "atmosphere", "música fría y distante para concentrarme", V, ["atmosphere:cold", "activity:concentration"])
c(47, "atmosphere", "música espaciosa con mucha reverberación", P, ["atmosphere:spacious"], pending=1, note="la reverberación es producción, pendiente")
c(48, "atmosphere", "música íntima para escuchar a solas", V, ["atmosphere:intimate"])
# --- Tema ---
c(49, "theme", "temas con letras eróticas y sensuales", V, ["theme:sexuality"])
c(50, "theme", "música con historias de ciencia ficción", V, ["theme:science-fiction"])
c(51, "theme", "canciones sobre identidad cultural y pertenencia", V, ["theme:identity"])
c(52, "theme", "letras que hablen de la naturaleza y el medio ambiente", V, ["theme:nature"])
c(53, "theme", "canciones que hablen de drogas y alcohol", V, ["theme:substances"])
c(54, "theme", "temas que hablen de la muerte y el duelo", V, ["theme:death"])
c(55, "theme", "canciones de protesta y contenido político", V, ["theme:politics"])
c(56, "theme", "canciones que cuenten historias de guerra", V, ["theme:war"])
c(57, "theme", "temas sobre la vida cotidiana y la sociedad", V, ["theme:society"])
c(58, "theme", "canciones con letras sobre historia y memoria", V, ["theme:history"])
c(59, "theme", "música que hable de violencia y crimen", V, ["theme:violence"])
c(60, "theme", "canciones humorísticas o de sátira", V, ["theme:humor"])
c(61, "theme", "temas sobre migración y exilio", V, ["theme:migration"])
# --- Género ---
c(62, "genre", "temas de horror punk", V, ["genre:horror-punk"], note=cut("temas de horror punk para la noche de brujas"))
c(63, "genre", "ponme algo de post-grunge noventero", V, ["genre:post-grunge", "decade:1990s"])
c(64, "genre", "merengue bien movido para la fiesta", V, ["genre:merengue", "energy:energy-high", "activity:celebration"])
c(65, "genre", "música de cámara para estudiar", V, ["genre:musica-de-camara", "activity:concentration"], note=cut("música de cámara para estudiar tranquilo"))
c(66, "genre", "hardcore punk rápido y fuerte", V, ["genre:hardcore-punk", "energy:energy-high"])
# borrador 67 («reggae y ska para el fin de semana») descartado: «y» entre géneros sin alcance claro
c(68, "genre", "rock acústico", V, ["genre:rock-acustico"], note=cut("rock acústico suave para la tarde"))
c(69, "genre", "tech house para bailar toda la noche", V, ["genre:tech-house", "activity:dancing"])
c(70, "genre", "rock sureño con guitarras bien pesadas", P, ["genre:rock-sureno"], pending=1, note="instrumentación pendiente")
c(71, "genre", "flamenco con guitarra y palmas", P, ["genre:flamenco"], pending=1, note="instrumentación pendiente")
c(72, "genre", "guaracha para prender la rumba", V, ["genre:guaracha", "activity:celebration"])
c(73, "genre", "dark ambient para desconectarme", V, ["genre:dark-ambient", "activity:relaxation"])
c(74, "genre", "new wave de los ochenta", V, ["genre:new-wave", "decade:1980s"], note=cut("clásicos de new wave de los ochenta"))
c(75, "genre", "metal latino con mucha potencia", V, ["genre:metal-latino", "energy:energy-high"])
c(76, "genre", "nu metal de los dos mil", V, ["genre:nu-metal", "decade:2000s"], note=cut("nu metal de los dos mil para recordar"))
# --- Y ---
c(77, "and", "música de salsa para limpiar la casa con mucha energía", P, ["genre:salsa", "energy:energy-high"], pending=1)
c(78, "and", "baladas románticas para dedicar a mi pareja", P, ["genre:balada", "emotion:romantic"], pending=1, note=cut("baladas románticas para dedicar a mi pareja una noche tranquila") + "; dedicar queda pendiente")
c(79, "and", "reggaetón para el gym que me ponga agresivo", V, ["genre:reggaeton", "activity:exercise", "emotion:angry"])
c(80, "and", "música de relajación para estudiar sin distraerme", V, ["activity:relaxation", "activity:concentration"])
c(81, "and", "vallenatos tristes para llorar un desamor con una cerveza", V, ["genre:vallenato", "emotion:sad", "activity:catharsis", "theme:breakup"])
c(82, "and", "rock en español para un road trip con amigos", V, ["genre:rock-latino", "activity:travel"])
c(83, "and", "merengue para una fiesta familiar alegre y movida", V, ["genre:merengue", "activity:celebration", "emotion:joyful", "energy:energy-high"])
c(84, "and", "jazz para cenar en pareja con ambiente íntimo", V, ["genre:jazz", "activity:socializing", "atmosphere:intimate"], note=cut("jazz suave para cenar en pareja con ambiente íntimo"))
c(85, "and", "cumbia para bailar en el patio un domingo relajado", V, ["genre:cumbia", "activity:dancing"])
c(86, "and", "música instrumental épica para trabajar", V, ["genre:instrumental", "atmosphere:epic", "activity:concentration"], note=cut("música instrumental épica para trabajar con motivación"))
c(87, "and", "bachata sensual", V, ["genre:bachata", "emotion:sensual"], note=cut("bachata sensual para conquistar a alguien en una cita"))
c(88, "and", "rap latino con letras de protesta para sentirme rebelde", P, ["genre:hip-hop", "theme:politics", "emotion:rebellious"], pending=1, note="procedencia pendiente")
c(89, "and", "música cristiana alegre para animar un culto juvenil", P, ["genre:musica-cristiana", "emotion:joyful"], pending=1)
c(90, "and", "chill out al atardecer", V, ["genre:downtempo"], note=cut("chill out para tomar algo en la playa al atardecer"))
c(91, "and", "salsa para hacer ejercicio en casa", V, ["genre:salsa", "activity:exercise"], note=cut("salsa brava para hacer ejercicio en casa con ganas"))
c(92, "and", "pop nostálgico de los 2000", V, ["genre:pop", "emotion:nostalgic", "decade:2000s"], note=cut("pop nostálgico de los 2000 para recordar mi adolescencia"))
c(93, "and", "música de meditación para dormir profundo y tranquilo", V, ["activity:meditation", "activity:sleep"])
c(94, "and", "rock para desahogarme después del trabajo", V, ["genre:rock", "activity:catharsis"], note="recortada de «rock pesado para desahogar la rabia después del trabajo»")
c(95, "and", "música de fondo para leer un libro en casa", V, ["activity:concentration"], note=cut("música de fondo suave para leer un libro en casa"))
c(96, "and", "perreo para una fiesta de cumpleaños", P, ["activity:celebration"], pending=1, note=cut("perreo intenso para prender una fiesta de cumpleaños") + "; «perreo» no está en el registro")
c(97, "and", "música llanera con nostalgia", V, ["genre:joropo", "emotion:nostalgic"], note=cut("música llanera para recordar mi tierra con nostalgia"))
c(98, "and", "electrónica alegre para limpiar", P, ["genre:electronica", "emotion:joyful"], pending=1, note=cut("electrónica alegre para limpiar y motivarme temprano"))
# borrador 99 («boleros para una noche de lluvia melancólica con vino») descartado: ocasión discutible
c(100, "and", "música tropical bailable", V, ["genre:musica-tropical", "activity:dancing"], note=cut("música tropical bailable para animar a los abuelos en reunión"))
# --- O ---
c(101, "or", "música romántica o despecho para llorar un rato", V, ["activity:catharsis"], any_=[["emotion:romantic", "theme:breakup"]])
# borrador 102 (champeta) y 103 («acústico») descartados: una alternativa fuera del registro
c(104, "or", "cumbia o vallenato para el paseo en carro", V, ["activity:travel"], any_=[["genre:cumbia", "genre:vallenato"]])
c(105, "or", "rock o pop en español de los noventa", P, ["decade:1990s"], any_=[["genre:rock", "genre:pop"]], pending=1, note="idioma pendiente")
c(106, "or", "música cristiana o instrumental para orar", P, any_=[["genre:musica-cristiana", "genre:instrumental"]], pending=1, note="orar queda pendiente")
c(107, "or", "bachata o boleros para una cena romántica", V, ["activity:socializing", "emotion:romantic"], any_=[["genre:bachata", "genre:bolero"]])
# borrador 108 («movido o suave») y 109 («hip hop latino para motivarme») descartados
c(110, "or", "jazz o bossa nova para la sobremesa", V, ["activity:socializing"], any_=[["genre:jazz", "genre:bossa-nova"]])
# --- Negación ---
c(111, "negation", "algo para poner en una fiesta que no sea reggaetón", V, ["activity:celebration"], exc=["genre:reggaeton"])
c(112, "negation", "canciones tristes pero que no hablen de desamor", V, ["emotion:sad"], exc=["theme:breakup"])
c(113, "negation", "playlist para el gym que no sea electrónica", V, ["activity:exercise"], exc=["genre:electronica"])
c(114, "negation", "algo romántico que no sea balada", V, ["emotion:romantic"], exc=["genre:balada"])
c(115, "negation", "música para dormir sin sonidos de la naturaleza", P, ["activity:sleep"], pending=1)
c(116, "negation", "rock pero nada de metal", V, ["genre:rock"], exc=["genre:metal"])
c(117, "negation", "música alegre que no sea infantil", V, ["emotion:joyful"], exc=["genre:musica-infantil"])
c(118, "negation", "algo para trabajar sin voces ni letras", P, ["activity:concentration"], pending=1)
c(119, "negation", "música navideña pero que no sea la típica de siempre", P, ["genre:musica-navidena"], pending=1, note="popularidad pendiente")
c(120, "negation", "canciones de fiesta que no sean viejas", P, ["activity:celebration"], pending=1, note="antigüedad pendiente")
c(121, "negation", "música relajante que no sea chill out", V, ["activity:relaxation"], exc=["genre:downtempo"])
# borrador 122 («algo motivador»), 123 («música latina sin pop comercial»), 124 («de amor» negado) descartados
c(125, "negation", "fondo para cenar sin jazz", V, ["activity:socializing"], exc=["genre:jazz"])
c(126, "negation", "música para correr que no tenga letra", P, ["activity:running"], pending=1)
# borrador 127 («algo clásico»: clásica u oldies) descartado
# --- Preferencia ---
c(128, "preference", "canciones para limpiar la casa un domingo, preferiblemente que sean movidas", P, pref=["energy:energy-high"], pending=1)
c(129, "preference", "música de los 80 en español, mejor si es de baladas románticas", P, ["decade:1980s"], pref=["genre:balada", "emotion:romantic"], pending=1, note="idioma pendiente")
c(130, "preference", "playlist para la playa, ojalá con salsa", P, pref=["genre:salsa"], pending=1, note=cut("playlist para la playa, ojalá con salsa y merengue venezolano"))
c(131, "preference", "algo para estudiar, de preferencia sin letra", P, ["activity:concentration"], pending=1, note=cut("algo para estudiar tranquilo, de preferencia sin letra"))
c(132, "preference", "temas de aguinaldos y parrandas, si es posible de artistas de mi región", P, ["genre:aguinaldo"], pending=1, note="procedencia preferida pendiente")
c(133, "preference", "música para fiesta de cumpleaños, idealmente que todos bailen", V, ["activity:celebration"], pref=["activity:dancing"])
c(134, "preference", "canciones para el gimnasio, preferiblemente reggaetón", V, ["activity:exercise"], pref=["genre:reggaeton"], note=cut("canciones para el gimnasio, preferiblemente reggaetón viejo y rápido"))
# --- Estado del oyente ---
c(135, "listener", "ando con el ánimo por el suelo, ponme algo que me levante", C, ctx=1, alts=["emotion:joyful", "emotion:euphoric", "emotion:confident"], note="«que me levante» como «que me anime»")
c(136, "listener", "estoy contento porque me salió el trabajo, quiero algo para celebrar", V, ["activity:celebration"], ctx=1)
c(137, "listener", "me siento nostálgico y quiero escuchar algo de los años que ya pasaron", U, ctx=1, pending=1, note="antigüedad pendiente, como S148 de 3.0.0")
c(138, "listener", "estoy que no duermo bien esta semana, dame algo tranquilo para relajarme", V, ["emotion:serene", "activity:relaxation"], ctx=1)
c(139, "listener", "ando enamorado perdido, ponme canciones románticas", V, ["emotion:romantic"], ctx=1)
c(140, "listener", "me siento con mucha energía hoy, quiero algo que me ponga a bailar", V, ["activity:dancing"], ctx=1)
# borrador 141 («algo que me acompañe») descartado: sin pedido
c(142, "listener", "ando estresado con el trabajo, ponme algo instrumental para concentrarme", V, ["genre:instrumental", "activity:concentration"], ctx=1)
c(143, "listener", "me siento orgulloso de mi tierra, quiero escuchar música de aquí", U, ctx=1, pending=1, note="procedencia pendiente")
c(144, "listener", "estoy con mis panas y queremos rumba, pon algo que todos sepan", P, ["activity:celebration"], ctx=1, pending=1, note="popularidad pendiente")
c(145, "listener", "me siento un poco solo esta noche, dame algo suave para acompañarme", C, ctx=1, alts=["emotion:serene", "energy:energy-low"])
# borrador 146 («recordar viejas épocas … clásicos que todos conozcan») descartado
# --- No representables ---
c(147, "unsupported", "canciones de 120 bpm exactos para entrenar", P, ["activity:exercise"], pending=1)
c(148, "unsupported", "temas que duren más de 7 minutos para un viaje largo en carretera", P, ["activity:travel"], pending=1)
c(149, "unsupported", "playlist en 3/4 para bailar con mi pareja", P, ["activity:dancing"], pending=1)
c(150, "unsupported", "música que no sea en inglés ni en español para estudiar", P, ["activity:concentration"], pending=1)
c(151, "unsupported", "canciones con solo voz de mujer y guitarra acústica", U, pending=1)
c(152, "unsupported", "algo con voz masculina ronca y piano de fondo para llorar", P, ["activity:catharsis"], pending=1)
c(153, "unsupported", "temas grabados en vivo en un bar pequeño", U, pending=1)
c(154, "unsupported", "versiones remasterizadas de discos viejos para escuchar en el carro", P, ["activity:travel"], pending=1)
c(155, "unsupported", "música lo-fi con ruido de lluvia y voz muy baja para dormir", P, ["activity:sleep"], pending=1, facet="candidate:production.fidelity-aesthetic")
c(156, "unsupported", "álbum conceptual que se escuche de corrido sin cortes", U, pending=1)
c(157, "unsupported", "discos con temas enlazados que no se puedan separar", U, pending=1, facet="candidate:structure.continuity")
c(158, "unsupported", "canciones que mejoran mientras más las escuchas", U, pending=1, facet="candidate:reception.acclimatization")
c(159, "unsupported", "música con cuerdas de sintetizador analógico y batería acústica", U, pending=1)
c(160, "unsupported", "temas de menos de dos minutos para pasar rápido de canción", U, pending=1)
c(161, "unsupported", "playlist en 6/8 para cocinar tranquilo un domingo", U, pending=2, note="compás y cocinar")
c(162, "unsupported", "canciones con coros grabados al fondo y aplausos", U, pending=1)
c(163, "unsupported", "música con voz femenina susurrada y bajo profundo para leer", P, ["activity:concentration"], pending=1)
c(164, "unsupported", "temas en 90 bpm con letra en portugués para caminar", P, ["activity:walking"], pending=2, note="tempo e idioma")
c(165, "unsupported", "álbumes que suben de intensidad poco a poco sin parar", U, pending=1, facet="candidate:structure.arc")
# --- Década ---
c(166, "decade", "música romántica de los años 70", V, ["emotion:romantic", "decade:1970s"], note=cut("música romántica de los años 70 para dedicar"))
c(167, "decade", "rock en español de los 80", V, ["genre:rock-latino", "decade:1980s"], note=cut("rock en español de los 80 bien arrecho"))
c(168, "decade", "canciones tristes de los 90 para llorar", V, ["emotion:sad", "decade:1990s", "activity:catharsis"])
c(169, "decade", "pop bailable de los 2000 para una fiesta", V, ["genre:pop", "activity:dancing", "decade:2000s", "activity:celebration"])
# --- Aclarar (la palabra ambigua sin el complemento del borrador) ---
c(170, "clarify", "necesito música caliente", C, alts=["emotion:sensual", "atmosphere:warm", "energy:energy-high"], note=cut("necesito música caliente para la fiesta"))
c(171, "clarify", "pon algo bien intenso", C, alts=["emotion:tense", "energy:energy-high"], note="sustituye «pon algo intenso para entrenar» («pon algo intenso» ya estaba en otra prueba)")
c(172, "clarify", "quiero escuchar algo con aura", C, alts=["emotion:confident", "atmosphere:epic", "energy:energy-high"])
c(173, "clarify", "busco canciones de amor", C, alts=["theme:love", "emotion:romantic", "activity:intimacy"])
c(174, "clarify", "pon música de sexo", C, alts=["activity:intimacy", "theme:sexuality"])
c(175, "clarify", "quiero algo psicodélico", C, alts=["atmosphere:psychedelic", "genre:rock-psicodelico"])
c(176, "clarify", "necesito música para animarme", C, alts=["emotion:joyful", "emotion:euphoric", "emotion:confident"])
c(177, "clarify", "busco algo pesado", C, alts=["genre:metal", "energy:energy-high"])
c(178, "clarify", "pon música suave", C, alts=["emotion:serene", "energy:energy-low"])
c(179, "clarify", "quiero escuchar algo oscuro", V, ["atmosphere:dark"], note="«oscuro» no es ambiguo en el léxico (como en 4.0.0)")
# --- Contradicciones (el borrador solo formulaba una de forma formal) ---
c(180, "contradiction", "salsa pero que no sea salsa", K, note="sustituye el borrador 180")
c(181, "contradiction", "música de mucha energía pero con energía baja", K, note="sustituye el borrador 181 (movido frente a tranquilo no es incompatible en el léxico)")
c(182, "contradiction", "algo romántico sin nada de romanticismo", K, note="sustituye el borrador 182")
c(183, "contradiction", "canciones tristes que no sean tristes", K, note="sustituye el borrador 183")
c(184, "contradiction", "música épica pero sin nada épico", K, note="sustituye el borrador 184")
# --- Otros idiomas ---
c(185, "multilingual", "music to study late at night without distractions", V, ["activity:concentration"])
c(186, "multilingual", "songs for a morning run", V, ["activity:running"], note=cut("upbeat songs for a morning run that keep me motivated"))
c(187, "multilingual", "sad songs for a rainy afternoon", V, ["emotion:sad"], note=cut("sad songs for a rainy afternoon feeling nostalgic") + "; la tarde es circunstancia")
c(188, "multilingual", "reggaeton for a barbecue with friends", V, ["genre:reggaeton", "activity:socializing"], note=cut("chill reggaeton for a backyard barbecue with friends"))
c(189, "multilingual", "rock anthems for a road trip", V, ["genre:rock", "activity:travel"], note=cut("classic rock anthems for a road trip") + "; «classic rock» no está en el registro")
# --- Género por descripción (sorteado y vecinos que encajan con lo descrito) ---
D = C
c(190, "described", "beat oscuro con hi-hats rápidos y bajo retumbante, voz amenazante y pausada", D, alts=["genre:trap", "genre:drill", "genre:hip-hop"])
c(191, "described", "pop con sintetizadores brillantes y batería programada, voz dulce con efectos", D, alts=["genre:synth-pop", "genre:electropop", "genre:dance-pop", "genre:pop"])
c(192, "described", "metal rápido con coros épicos, solos de guitarra veloces y teclados sinfónicos", D, alts=["genre:power-metal", "genre:metal-sinfonico", "genre:power-metal-progresivo", "genre:metal-progresivo"])
c(193, "described", "sonido pesado, gutural, batería a toda velocidad y guitarras distorsionadas al máximo", D, alts=["genre:death-metal", "genre:brutal-death-metal", "genre:grindcore"])
c(194, "described", "electrónica británica con subgrave profundo y ritmo sincopado que rompe el compás", D, alts=["genre:dubstep", "genre:drum-and-bass", "genre:electronica"])
c(195, "described", "música con melodías folclóricas y ritmos tradicionales de un país, con instrumentos autóctonos", D, alts=["genre:musica-tradicional", "genre:folk"])
c(196, "described", "canciones con guitarras limpias, coros pegajosos y producción pulida", D, alts=["genre:pop-rock", "genre:power-pop", "genre:soft-rock"])
c(197, "described", "improvisación jazzística sobre base de rock, con solos de guitarra y teclados", D, alts=["genre:jazz-rock", "genre:jazz-fusion", "genre:rock-progresivo"])
c(198, "described", "ritmos de baile con secuenciadores, voz roboticada y atmósfera industrial", D, alts=["genre:ebm", "genre:industrial", "genre:aggrotech"])
c(199, "described", "base electrónica rápida con voz cantada en patois y bajo dominante", D, alts=["genre:dancehall", "genre:ragga"])
c(200, "described", "canciones cortísimas, velocidad extrema, gritos y blast beats", D, alts=["genre:grindcore", "genre:noisecore"])
c(201, "described", "metal con arpegios rápidos, escalas clásicas y solos técnicos de inspiración barroca", D, alts=["genre:neoclasica", "genre:power-metal"])
# borrador 202 descartado: casi igual a S201 de la prueba 4.0.0
# --- Entidades (nombres sorteados del catálogo) ---
c(203, "entity", "busca la canción La Escoba", E, ent=[("target", "track", "la escoba")])
c(204, "entity", "busca la canción Billo en Television", E, ent=[("target", "track", "billo en television")])
c(205, "entity", "busca la canción La Perrendenga", E, ent=[("target", "track", "la perrendenga")])
c(206, "entity", "busca la canción Rock The Nation", E, ent=[("target", "track", "rock the nation")])
c(207, "entity", "la canción «Carboebullido»", E, ent=[("target", "track", "carboebullido")])
c(208, "entity", "el tema Rosa Amelia", E, ent=[("target", "track", "rosa amelia")])
c(209, "entity", "el tema Edgar Alexander - El Cisne", E, ent=[("target", "track", "edgar alexander - el cisne")])
c(210, "entity", "busca el disco Danny Boy", E, ent=[("target", "album", "danny boy")])
c(211, "entity", "el disco Covers Vol.1", E, ent=[("target", "album", "covers vol.1")])
c(212, "entity", "busca la banda Andrea González", E, ent=[("target", "artist", "andrea gonzalez")])
c(213, "entity", "José Alejandro Delgado", E, ent=[("target", "artist", "jose alejandro delgado")])
c(214, "entity", "Akapellah", E, ent=[("target", "artist", "akapellah")])
c(215, "entity", "Guillermo Soto", E, ent=[("target", "artist", "guillermo soto")])
c(216, "entity", "Samuel Sahlieh", E, ent=[("target", "artist", "samuel sahlieh")])
c(217, "entity", "Jesus Carvajal", E, ent=[("target", "artist", "jesus carvajal")])
c(218, "entity", "Pedro R. Bastidas", E, ent=[("target", "artist", "pedro r. bastidas")])
c(219, "entity", "Klan-Foot", E, ent=[("target", "artist", "klan-foot")])
c(220, "entity", "Sodom’s Child", E, ent=[("target", "artist", "sodom’s child")])
c(221, "entity", "temas de Caracas Sincrónica", E, ent=[("target", "artist", "caracas sincronica")])
c(222, "entity", "discos de Aborigen", E, ent=[("target", "artist", "aborigen")])
c(223, "entity", "canciones de PPD", E, ent=[("target", "artist", "ppd")])
c(224, "entity", "la canción From Twilight To Light", E, ent=[("target", "track", "from twilight to light")])
c(225, "entity", "el tema Gaita De Venezuela", E, ent=[("target", "track", "gaita de venezuela")])
c(226, "entity", "canción \"Quédate Conmigo\"", E, ent=[("target", "track", "quedate conmigo")])
# --- Parecido ---
c(227, "similarity", "algo parecido a Los Martinis", V, ["similarity:overall"], ent=[("reference", "artist", "los martinis")])
c(228, "similarity", "bandas como Autarquia", V, ["similarity:overall"], ent=[("reference", "artist", "autarquia")])
c(229, "similarity", "música similar a Epitafio", V, ["similarity:overall"], ent=[("reference", "artist", "epitafio")])
c(230, "similarity", "parecido a Orestes Gómez en la voz", V, ["similarity:voice"], ent=[("reference", "artist", "orestes gomez")])
c(231, "similarity", "al estilo de La Sonora Balacera en las guitarras", V, ["similarity:guitars"], ent=[("reference", "artist", "la sonora balacera")])
c(232, "similarity", "que suene como Amputacion en la producción", V, ["similarity:production"], ent=[("reference", "artist", "amputacion")])
c(233, "similarity", "como La Unión pero más triste", P, ["similarity:overall"], ent=[("reference", "artist", "la union")], pending=1, note="comparativo no representable")
c(234, "similarity", "parecido a Mala Junta en el ambiente", V, ["similarity:atmosphere"], ent=[("reference", "artist", "mala junta")])
c(235, "similarity", "algo al estilo de Coprophagist Satisfaction para manejar", V, ["similarity:overall", "activity:travel"], ent=[("reference", "artist", "coprophagist satisfaction")])
# --- Ruido (el borrador repetía las tres de 3.0.0) ---
c(236, "noise", "jkjkj ppp", "unrecognized", note="sustituye «qwrt pfff» (repetida de 3.0.0)")
c(237, "noise", "cosas", "unrecognized", note="sustituye «temas» (repetida de 3.0.0)")
c(238, "noise", "algo fino", "unrecognized", note="sustituye «algo nice» (repetida de 3.0.0); valoración sin criterio: relleno")

for case in cases:
    case["split"] = "test_reserved"
    case["author"] = "Redacción DeepSeek flash (borrador sorteado, semilla 59) · etiquetas Claude (encargo de Brian, 2026-10-25)"
body = {"version": "crv-query-test-reserved-5.0.0", "authoredAt": "2026-10-25",
        "authoredBefore": "cualquier corrección de la versión 1.4.0, entrenamiento de modelos nuevos y cualquier ejecución del sistema sobre estas frases",
        "authoredAfter": "evaluación única de crv-query-heads-0.7.0 sobre la prueba 4.0.0 (ya de desarrollo)",
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
