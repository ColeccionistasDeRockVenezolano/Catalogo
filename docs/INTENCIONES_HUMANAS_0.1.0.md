# Diccionario de intenciones humanas de CRV — propuesta 0.1.0

Versión: `crv-human-intents-0.1.0` · fecha editorial: 2026-10-16 · idioma: español,
con expresiones venezolanas · estado: **propuesta para revisión, sin importación**.

La propuesta conserva los géneros y las diez categorías contextuales existentes.
Añade una separación explícita de actividad, emoción, energía, ambiente y temática;
descompone las seis categorías emocionales amplias sin convertir sus asignaciones.
Incluye 64 conceptos de estas cinco dimensiones y referencias al registro existente
de géneros. No modifica la ontología almacenada ni clasifica artistas, discos o canciones.

## Entregables y alcance

| Archivo | Contenido |
| --- | --- |
| [diccionario.json](../reports/intenciones-humanas/v0.1.0/diccionario.json) | Definiciones, criterios, sinónimos ES, términos externos observados, compatibilidad y reglas. |
| [diccionario.md](../reports/intenciones-humanas/v0.1.0/diccionario.md) | Los 64 conceptos, sus sinónimos y definiciones en tablas legibles. |
| [matriz-consultas.md](../reports/intenciones-humanas/v0.1.0/matriz-consultas.md) | 133 casos legibles: 64 conceptos, 56 combinaciones y casos límite, una prueba de cobertura y 12 controles de evidencia. |
| [matriz-consultas.json](../reports/intenciones-humanas/v0.1.0/matriz-consultas.json) | Los mismos resultados esperados, con expresiones estructuradas. No son ejecuciones del buscador. |
| [inventario.json](../reports/intenciones-humanas/v0.1.0/inventario.json) | Fotografía de conteos y límites, con fecha y huella del corpus RYM. |
| [cobertura-lexica.json](../reports/intenciones-humanas/v0.1.0/cobertura-lexica.json) | Términos con candidatos de concepto y términos frecuentes pendientes o de otras facetas. No mide cobertura de canciones. |
| [contextos-crv.json](../reports/intenciones-humanas/v0.1.0/contextos-crv.json) | Diez definiciones y criterios actuales, leídos de la base. |
| [generos-crv.json](../reports/intenciones-humanas/v0.1.0/generos-crv.json) | Registro de géneros y alias; conservar slugs, actividad y jerarquía. |
| [vocabulario-lastfm.csv](../reports/intenciones-humanas/v0.1.0/vocabulario-lastfm.csv) | 1.750 etiquetas, sin nombres ni IDs de artistas atribuidos. |
| [vocabulario-lastfm-albumes.csv](../reports/intenciones-humanas/v0.1.0/vocabulario-lastfm-albumes.csv) | 1.125 términos de respuestas API de álbum; nivel y captura de procedencia conservados. |
| [vocabulario-rym.csv](../reports/intenciones-humanas/v0.1.0/vocabulario-rym.csv) | 309 descriptores y una captura local de referencia por término. |
| [inventariar.py](../reports/intenciones-humanas/v0.1.0/inventariar.py) | Reproducción del inventario: solo SELECT en una transacción de lectura y lectura de HTML locales. |
| [VALIDACION.md](../reports/intenciones-humanas/v0.1.0/VALIDACION.md) | Pruebas de regresión, conteos iniciales/finales y alcance operativo: protecciones de API/interfaz preparadas en código, sin despliegue. |

El punto de partida es [el informe aportado por Brian](../reports/alimentar-laya-contexto-2026-10-16.md).
Se contrastó con el código, la migración 0054, las capturas locales y consultas
`BEGIN ... READ ONLY`. No se ejecutó Laya, no se reimportaron comentarios, no se
aplicaron migraciones a CRV y no se hicieron escrituras en su base de datos.
Las pruebas de regresión de la retirada usan PostgreSQL desechable con datos ficticios.

## Retirada previa de +shoutbox y límite de confianza

La base ya tenía **cero comentarios y cero agregados emocionales** al comenzar esta
revisión. Los 20.521 comentarios retirados y sus ocho agregados anteriores permanecen
en los respaldos históricos descritos en [LASTFM_SHOUTBOX_REVIEW.md](LASTFM_SHOUTBOX_REVIEW.md).
No fue necesario borrar datos para esta entrega.

Quedaba una vía de recarga: el refresco semanal todavía invocaba carga y clasificación
de comentarios revisados. Se retiraron esas llamadas. Captura, importación de shouts
y clasificador de shouts ahora se bloquean antes de realizar operaciones, incluyendo
los flags antiguos. Las lecturas de emociones excluyen shouts y artistas sin identidad
revisada; Curaduría conserva términos para revisar su significado, pero oculta las
asociaciones de artista no verificadas. No se alteraron decisiones editoriales guardadas.

Una página Last.fm vinculada a un artista puede seguir mezclando tags de homónimos.
Nombre, URL, MBID, coincidencias de títulos o un número alto de oyentes no acreditan
cada asociación. El registro de identidad de página es un requisito previo, no una
verificación de cada etiqueta o comentario. La atribución de música exige evidencia
específica de la entidad y versión. **El contenido de +shoutbox queda excluido de esta
propuesta, incluidos sus archivos llamados verified y los cachés de clasificación.**

## Lo que existe realmente

| Capa | Vocabulario y estado comprobado | Implicación |
| --- | --- | --- |
| Contextos por pista | `crv-contexts-v1`: concentration, relaxation, celebration; joyful, melancholic, tense, serene; energy-low, energy-medium, energy-high. Cero propuestas, asignaciones y evaluaciones. | Hay criterios reutilizables, pero no cobertura de canciones en estas tablas. |
| Intérprete contextual | `crv-recommendations-v1`, una elección por dimensión en texto, una cláusula negativa final; el contrato estructurado permite varias etiquetas exigidas con AND. | Las alternativas, seis dimensiones y lenguaje ampliado de este documento necesitan una implementación posterior. |
| Capa emocional Last.fm | emocion, tristeza, enfocado, libertad, cachonda, aumenta_mi_aura; no_expresa_emocion y dudoso como salidas adicionales. Cero agregados publicados. | Mezcla significados y no constituye una ontología de seis dimensiones. |
| Géneros | 283 registros, 282 activos y 1.427 alias existentes. | Reutilizar el registro y filtrar actividad; no crear otro catálogo de géneros. Un alias también puede requerir desambiguación. |
| Temas de letras | 353 artistas con `artists.themes`; glosario EN→ES de 316 entradas, incluidos calificadores. | Reutilizar términos y traducciones; no heredarlos a canciones. El glosario también contiene estilos, nombres y características que requieren revisión. |
| Last.fm disponible | 6.564 filas, 1.750 términos, 1.280 IDs de artista sin verificación; cero artistas en `lastfm_artist_verifications`. | Disponibilidad léxica; no cobertura verificada de repertorio venezolano. |
| Last.fm álbumes crudos | 23.520 JSON inspeccionados; 9.792 respuestas de álbum, 4.812 con tags no vacíos y 1.125 términos distintos. | Unidad: respuesta capturada, sin afirmar álbumes únicos ni correspondencia verificada con CRV. |
| RYM disponible | 7.328 HTML del lote rym-nuevos; 7.328 con campo de descriptores, **1.705 con contenido**, 309 términos distintos. | La cifra del informe de 100 % describe presencia del campo, no descriptores efectivos. 23,3 % de las capturas contienen términos. |

Fuentes internas: [etapa 3](DISCOVERY_PHASE_3.md), [etapa 4](DISCOVERY_PHASE_4.md),
[emociones](EMOCIONES.md), [contrato contextual](../src/discovery/recommendation-contract.ts),
[intérprete contextual](../src/discovery/recommendation-interpreter.ts) y
[detector emocional](../src/api/repositories/emotions.ts).

El detector emocional devuelve la primera categoría coincidente, según prioridad.
Por ejemplo, sexo gana a tristeza o estudiar aunque la consulta pida varias cosas.
No modela negaciones, alternativas ni alcance temático. El léxico v3 evita parte del
ruido, pero fuerza asociaciones como workout→enfocado, muerte→tristeza o
fiesta→aumenta_mi_aura. Son incompatibles con una separación de dimensiones.
El umbral numérico de un modelo no demuestra identidad ni pertinencia musical.

## Lectura de las fuentes externas

Last.fm ofrece tags de artista, álbum y pista en métodos distintos; los de artista
se entregan ordenados por el valor de conteo del servicio. Esto permite estudiar
vocabulario, pero no trasladar etiquetas de nivel ni leerlas como probabilidades.
La documentación de [artist.getTopTags](https://www.last.fm/api/show/artist.getTopTags),
[track.getTopTags](https://www.last.fm/api/show/track.getTopTags) y
[tag.getTopTags](https://www.last.fm/api/show/tag.getTopTags) permite distinguir estos canales.

Este inventario analiza la cosecha local disponible, no un listado completo y actual
de todos los tags de Last.fm. Los conteos `captures` son filas de la cosecha por término;
`weight` es el valor guardado, no un conteo auditado de personas únicas ni confianza.
Predominan venezuela (648 capturas), rock (160), death metal (96), pop (91), black metal
(86) y metal (86). País, idioma, época, género y marcadores personales deben salir de
la clasificación afectiva, conservando su significado en la faceta correspondiente.
El vocabulario adicional de álbumes se leyó de `data/raw/lastfm-bio`; su unión con
los términos de artista se registra en cobertura-lexica.json. Se mantiene separado
para no mezclar niveles de entidad ni confundir respuestas repetidas con obras únicas.

Para RYM se extrajo exclusivamente el contenido de `span.release_pri_descriptors`
en las capturas. No se buscó la palabra Descriptors en el texto general ni en CSS.
La consulta web del [directorio de descriptores](https://rateyourmusic.com/music_descriptor/)
y la wiki no pudo recuperarse; los resultados aquí proceden de los HTML locales
identificables en el CSV. No se afirma haber verificado el directorio global en vivo.

Los términos RYM frecuentes incluyen male vocalist (970 páginas), rhythmic (557),
female vocalist (412), melodic (395), energetic (324), love (291), atmospheric (246),
party (233), instrumental (222), nocturnal (202), sexual (192), melancholic (159),
lo-fi (148), breakup (136) y dark (122). Los conteos son presencia por captura;
no son votos, aprobación del vínculo con CRV ni evidencia por canción. No se fija
un umbral por posición del descriptor: sin una medida documentada, su posición no
es confianza. Las capturas con páginas ajenas u homónimos conservan utilidad léxica,
pero sus asociaciones quedan fuera de cualquier atribución musical.

| Término disponible | Destino de interpretación propuesto | Lo que requiere otra evidencia |
| --- | --- | --- |
| rock, death metal, ambient | Género existente y su nivel de entidad | Emoción, actividad o energía. Ambient no demuestra concentración. |
| study, focus | Actividad concentration | Relajación, sueño o ausencia de voces. |
| party | Candidato a celebración o contenido sobre fiesta, según contexto | Alegría, baile o energía alta. |
| energetic | Candidato léxico de energía | Asignación energy-high: requiere perceived-energy-v1. |
| melancholic, sad, nostalgic | Emociones distintas | Temática de pérdida ni estado mental del oyente. |
| atmospheric, nocturnal, dark | Ambiente | Tristeza, muerte o género. |
| love, breakup, sexual, death | Temática candidata | Romance musical, tristeza o adecuación para sexo. |
| female vocalist, male vocalist | Metadatos de voz fuera de las seis dimensiones | Emoción y género; tampoco inferir identidad personal. |
| instrumental, acoustic, live | Arreglo, característica o versión documentada | Tipo de publicación, emoción o ambiente. |
| lo-fi, noisy, dense, sampling | Producción, textura o técnica, como facetas futuras | Calma, concentración o un nivel energético automático. |

Las reseñas RYM, bios, letras y otras fuentes del informe pueden ayudar en una etapa
posterior mediante fragmentos atribuidos a la entidad correcta. Esta entrega no los
clasifica ni los considera equivalentes a etiquetas o comentarios de +shoutbox.

## Las seis dimensiones

| Dimensión | Pregunta que representa | Ejemplo | Separación necesaria |
| --- | --- | --- | --- |
| Género | ¿Qué tradición o estilo se solicita? | rock progresivo, ska | Consultar géneros confirmados y conservar si pertenecen a artista o álbum. |
| Actividad | ¿Para qué quiere escuchar la persona? | estudiar, tener sexo, correr | Un uso solicitado no es una emoción ni un efecto universal de la música. |
| Emoción | ¿Qué carácter afectivo musical busca? | alegre, triste, sensual | No describir el estado clínico o psicológico de la persona. |
| Energía | ¿Qué intensidad musical percibida pide? | baja, media, alta | No deducir de tempo, género, volumen, fiesta o motivación. |
| Ambiente | ¿Qué espacio o atmósfera sonora busca? | oscuro, nocturno, íntimo | No confundir con letra, horario del sistema o actividad. |
| Temática | ¿De qué debe tratar la obra? | exilio, amor, guerra | Una letra sexual no prueba adecuación para sexo ni carácter sensual. |

La energía conserva **perceived-energy-v1**: revisión de actividad, dinámica y
densidad de la versión, con mediana ordinal y las observaciones ya exigidas en CRV.
No se sustituye por un adjetivo externo ni se propone un análisis de audio en esta etapa.

Las diez categorías contextuales conservan sus slugs, definiciones y criterios.
En el diccionario, `context` se presenta como actividad y `mood` como emoción;
es una correspondencia conceptual, sin cambiar los valores almacenados.
La temática normaliza vocabulario preexistente de artista; sus categorías por pista
todavía deben definirse y respaldarse en una implementación futura.

### Compatibilidad con las seis categorías emocionales amplias

| Categoría anterior | Reutilización de significado | Distinciones que deben preservarse |
| --- | --- | --- |
| emocion | Romance/ternura y temática amor | La palabra emoción sola no identifica un concepto; amor en letra no prueba romance musical. |
| tristeza | sad; conservar melancholic y añadir nostalgic | Tristeza, melancolía, nostalgia y contenido sobre muerte o ruptura se evalúan por separado. |
| enfocado | concentration, relaxation y serene | Dormir, meditar y entrenar son actividades distintas; no reasignar todas como concentración. |
| libertad | Rebeldía/liberación como carácter | Viaje es actividad, protesta es temática, desahogo es propósito de escucha. |
| cachonda | Sensualidad como carácter | Intimidad sexual es actividad; íntimo es ambiente; sexualidad es temática. |
| aumenta_mi_aura | Confianza/euforia y ambiente épico | Energía, celebración y baile tienen dimensiones propias; aura sin contexto requiere aclaración. |

`no_expresa_emocion` deja de funcionar como descarte semántico general: un género o
una actividad pueden ser relevantes aunque no expresen emoción. `dudoso` es un estado
de revisión. Distinguir no reconocido, ambiguo, irrelevante para estas dimensiones,
evidencia insuficiente y contradicción. Ninguno es una propiedad musical negativa.

## Diccionario y ampliaciones

Se proponen **64 conceptos**, además del registro de géneros: 13 actividades,
15 emociones, tres niveles de energía, 14 ambientes y 19 temas. Diez reutilizan
directamente crv-contexts-v1, 19 normalizan temas ya presentes y 35 son conceptos
adicionales. Todos los vínculos con canciones siguen pendientes.

| Dimensión | Categorías reutilizadas | Conceptos adicionales o normalizados |
| --- | --- | --- |
| Género | 282 géneros activos y alias del registro existente | Ningún género nuevo en esta propuesta. |
| Actividad | concentration, relaxation, celebration | sleep, meditation, dancing, exercise, running, walking, travel, intimacy, socializing, catharsis. |
| Emoción | joyful, melancholic, tense, serene | sad, nostalgic, romantic, sensual, angry, hopeful, euphoric, confident, lonely, rebellious, bittersweet. |
| Energía | energy-low, energy-medium, energy-high | Ningún nivel nuevo. |
| Ambiente | Significados antes mezclados en otras categorías | atmospheric, dark, nocturnal, ethereal, dreamy, epic, intimate, warm, cold, ominous, mysterious, psychedelic, festive, spacious. |
| Temática | Términos de artists.themes y glosario EN/ES | Amor, ruptura, sexualidad, muerte, sociedad, política, guerra, espiritualidad, naturaleza, identidad, migración, soledad, salud mental, fantasía, ciencia ficción, violencia, sustancias, historia y humor. |

Cada entrada JSON tiene ID estable con dimensión, nombre ES, definición, criterio
futuro de asignación, sinónimos españoles, referencia existente y términos externos.
`observedLastfm/observedRym` significa que el término aparece en los CSV, no que el
concepto esté aprobado para una entidad. Un término no observado puede figurar como
candidato lingüístico propuesto, con ambos indicadores en false.
`observedLastfmArtist` y `observedLastfmAlbum` conservan el nivel de la captura.

Los sinónimos son candidatos sujetos a sintaxis y alcance. «Para estudiar» y «para
concentrarme» reutilizan concentration; «para echar un pie» propone dancing. «Para
tener sexo» y «hacer el amor» proponen intimacy; «sensual» propone carácter afectivo;
«sobre sexo» pide temática. No se activan todos por compartir palabras.
«Caliente», «aura», «sexo» o «amor» aislados requieren contexto o aclaración.

El estado actual del oyente se conserva como contexto, no como filtro musical:
«estoy triste, ponme música alegre» pide joyful; no pide sad. «Para animarme» sin
otros detalles puede significar alegría, euforia o confianza y requiere aclaración.
Tampoco basta para fijar energía alta. «Estoy triste y quiero acompañar esa tristeza»
sí solicita explícitamente un carácter triste.

La cobertura léxica por conceptos se informa aparte del registro de géneros: los
términos sin candidato quedan pendientes o pertenecen a otras facetas; no se declaran
irrelevantes. Dos huecos explícitos para una revisión siguiente son nostalgia como
temática y fiesta como temática: los términos existen en el glosario, pero esta
versión solo representa nostalgia como carácter, celebración como actividad y festivo
como ambiente. Las consultas que exijan esos temas pendientes conservan la restricción
y se abstienen. No se recicla una categoría de otra dimensión para cubrir el hueco.

No se fuerza a los seis ejes información como idioma, país, fecha, duración,
instrumentación, voces, tipo de disco o calidad de producción. Las restricciones se
conservan como facetas existentes o necesidades futuras; si no pueden representarse,
se informa la limitación en vez de ejecutar solo una parte de la petición.

## Reglas de combinación y resolución

Estas reglas especifican el comportamiento futuro. No cambian el parser actual.

| Regla | Conducta propuesta | Ejemplo o consecuencia |
| --- | --- | --- |
| R1 · Intersección | Cada intención exigida se combina con AND, dentro y entre dimensiones. | Rock y ska para bailar exige ambos géneros y la actividad; no devuelve la unión. |
| R2 · Alcance semántico | Priorizar frase completa y construcciones para/sobre/de carácter/de ambiente. No completar otras dimensiones por asociación. | Tener sexo ≠ sexualidad ≠ sensual ≠ íntimo. «Para llorar» expresa desahogo, sin imponer tristeza musical. |
| R3 · Alternativas | OR explícito crea anyOf con alcance visible. Paréntesis y enumeraciones claras conservan agrupación. Ante alcance ambiguo, aclarar. | (rock OR ska) AND bailar; (rock AND estudiar) OR (ska AND bailar). |
| R4 · Negación | sin, excepto, excluye, no quiero y ni conservan su alcance; necesitan evidencia negativa aplicable. | Sin tristeza no se cumple por ausencia de sad. «No quiero triste ni melancólico» excluye ambos. |
| R5 · Preferencias | preferiblemente/si es posible son prefer, con explicación de lo satisfecho. No convertirlas en exigencias. | Rock y concentración obligatorios; nocturno preferido. |
| R6 · Abstención | No descartar palabras, restricciones, entidades o negaciones no representadas. Resolver lo inequívoco para explicar la duda, sin ejecutar una consulta parcial. | Aura, hot, doble negación atenuada o BPM sin faceta compatible requieren aclaración o estado unsupported. |
| R7 · Consistencia | Un concepto requerido y excluido es contradicción. Dos energías distintas en una rama AND son contradictorias. No declarar incompatibles dimensiones independientes. | Triste y energía alta es válido; estudiar y dormir puede dar cero cobertura, no se rechaza por intuición. |
| R8 · Géneros | Reutilizar slugs/alias activos y jerarquía documentada; nunca reglas por fragmentos o estereotipos. | black metal es género; no significa oscuro, triste o violento. Ambient no implica calma. |
| R9 · Normalización | Conservar original; minúsculas y acentos solo para búsqueda, con límites de palabra y prioridad a frases largas. Preservar ñ y evitar raíces arbitrarias o eliminación global de s. Deduplicar IDs repetidos. | Melancólica/MELANCÓLICA coinciden; coger el autobús no activa sexo. |
| R10 · Otras facetas | Conservar fechas, idioma, duración y características en filtros separados, con campo y nivel explícitos. | Años noventa se refiere al año de publicación de álbum salvo especificación; instrumental no es emoción. |
| R11 · Entidades | Nombres y títulos explícitos se resuelven con identidad/alias antes de interpretar sus palabras como intenciones. | Busca la canción «Amor» pide entidad, no temática amor. Homónimos sin resolver no se asignan. |
| R12 · Evidencia y cobertura | Recuperar únicamente con evidencia de entidad, versión, criterio y estado aplicables. No heredar artista→álbum→pista ni copiar entre ediciones. | Un descriptor de álbum o tema del artista queda como referencia de ese nivel. Cero cobertura produce lista vacía explicada. |

Las negaciones usan lógica con desconocidos: un criterio puede estar respaldado,
rechazado explícitamente, desconocido o en conflicto. Solo el rechazo utilizable
satisface `not` para un criterio musical; desconocido o conflicto no lo satisfacen.
En AND, todas las ramas deben cumplirse; en OR, al menos una rama completa debe
cumplirse. Negar un grupo aplica la misma evaluación con desconocidos, sin convertir
la falta de información en certeza. La exclusión de una entidad por ID es un filtro
de identidad y no requiere inventar una valoración musical negativa.

Para géneros, la expansión a descendientes debe mostrarse y usar relaciones existentes.
Las consultas por pistas conservan las referencias de género de artista/álbum como
`verifiedForTrack:false`; no se presentarán como un género verificado de la canción.
Una búsqueda sobre álbumes puede filtrar su género confirmado; no se amplía de nivel
silenciosamente para llenar resultados de canciones.

Si en el futuro se ordenan resultados, las exigencias determinan elegibilidad;
preferencias y evidencia revisada determinan el orden. La popularidad no demuestra
correspondencia con la intención. No relajar restricciones para rellenar resultados.
La salida debe explicar nivel, evidencia, incertidumbre y cobertura.

### Representación propuesta

Es una especificación nueva, no un cuerpo que se pueda enviar hoy a la API v1.

```json
{
  "dictionaryVersion": "crv-human-intents-0.1.0",
  "target": "track-edition",
  "expression": {
    "allOf": [
      { "anyOf": ["genre:rock", "genre:ska"] },
      "activity:intimacy",
      "emotion:melancholic",
      "energy:energy-low",
      "atmosphere:nocturnal",
      { "not": "theme:sexuality" }
    ]
  },
  "prefer": ["atmosphere:intimate"],
  "filters": {},
  "unresolvedSpans": []
}
```

Corresponde a «Rock o ska para tener sexo, melancólico, de energía baja y nocturno,
sin letras sexuales; preferiblemente íntimo». Las seis dimensiones se conservan sin
seleccionar una intención ganadora. También se deben registrar los fragmentos de
entrada, polaridad y motivo de resolución; una puntuación de interpretación no se
confunde con evidencia musical.

## Evaluación propuesta y siguiente etapa

La matriz de 133 casos es una especificación de interpretación y rechazo de evidencia.
Cada concepto tiene al menos una consulta; se incluyen AND, OR, negación, preferencias,
contradicciones, sinónimos regionales, títulos, homónimos, energía y falta de cobertura.
Los controles sintéticos no atribuyen características a obras reales. Se comprobó la
integridad de IDs y referencias del corpus; **no se afirma que el parser actual pase
estos casos**, ni se midió pertinencia musical sin canciones revisadas.

En una implementación posterior, medir por separado extracción por dimensión,
operador/alcance/polaridad, retención de restricciones, desambiguación y abstención.
Los 133 fixtures deberán coincidir con sus resultados revisados; pérdida silenciosa
de negación/restricción, fuga de homónimos, uso de shouts o herencia no acreditada
son fallos de aceptación. La precisión de recomendaciones necesitará un conjunto
independiente con evidencia musical, negativos explícitos e incertidumbre; no puede
deducirse de la exactitud del diccionario ni de estos conteos de etiquetas.

La revisión editorial debe decidir el alcance de las 35 ampliaciones, la granularidad
de los 19 temas y las expresiones ambiguas. Después se podrá diseñar un contrato v2,
la revisión de identidad y evidencia por unidad, y un piloto acotado de clasificación.
Esta entrega no contiene lotes de importación, migraciones ni asignaciones musicales.

## Versionado

`0.1.0` es un borrador inmutable con sus inventarios y resultados esperados. Una
corrección de redacción o alias inequívoco puede producir `0.1.1`; conceptos nuevos,
criterios o resolución semántica distintos requieren al menos `0.2.0`, con diferencia
de conceptos y matriz revisada. Antes de 1.0, ningún borrador autoriza publicar
asignaciones. Después de 1.0, los cambios incompatibles de significado requieren
versión mayor. Conservar IDs; retirar o reemplazar conceptos con historial explícito,
sin reinterpretar decisiones antiguas por cambiar una lista de sinónimos.

La versión del diccionario, la del intérprete/modelo y la del método de evidencia se
registrarán por separado. La propuesta no programa selecciones diarias. Si una
función futura las usa, debe respetar DailyCycle y el cambio de día a las 00:00 de
America/Caracas, con el servidor como autoridad, según [DAILY_CYCLE.md](DAILY_CYCLE.md).

## Historial

- 2026-10-16 · 0.1.0: retiro operativo de +shoutbox, inventario de solo lectura,
  separación de seis dimensiones, diez categorías preservadas, temas reutilizados,
  35 ampliaciones propuestas y 133 fixtures sin clasificación de canciones.
