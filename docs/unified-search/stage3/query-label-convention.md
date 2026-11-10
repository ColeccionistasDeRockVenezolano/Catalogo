# Convención de etiquetado de consultas (crv-query-label-convention-1.0.0)

Decisión de Brian (2026-11-10, versión 1.8.0): «Convención escrita + reglas».

La etiqueta de una consulta real sigue estas reglas, escritas antes de etiquetar el lote 3 y antes de construir el intérprete 1.8.0. Recogen las decisiones de Brian de los lotes 1 y 2 y la práctica de esas etiquetas. Las dudas que no resuelve el texto se preguntan a Brian. Lo que nadie entiende queda fuera como «no sé».

El vocabulario es el congelado: léxico de consultas (`query-lexicon.json`), mapa de géneros, conceptos y décadas. La etiqueta no inventa conceptos.

## 1. Exigido (`req`)

- Un concepto, género o década del vocabulario dicho en la consulta.
- También cuenta una paráfrasis inequívoca: «bajar el cortisol» es relajación y «quince años» es celebración.
- Un subgénero fuera del vocabulario se etiqueta como su padre más un pendiente («viking metal» → metal + 1).
- «X que es», «X rym», «grupos de X» y «bandas de X» piden el género X.
- «música venezolana» dicha tal cual es el género `musica-venezolana`.
- «para niños» o «infantil» es `musica-infantil`.

## 2. Nombres (`ent`)

- **Solo un nombre:** `entity_lookup`. Incluye «canciones de X», «música nueva de X» o «música vieja X», con «nueva»/«vieja» como pendiente.
- **Nombre más condición:** `query_valid` o `partial` con el nombre como destino. El evaluador marca crítico cualquier condición en un `entity_lookup`.
- **Parecido:** «como X», «tipo X» y «parecidas a X» son `similarity:overall` con X como referencia.
- **Clase:** artista o canción cuando se sabe. Si es un nombre suelto que no se conoce, sin clase.
- **Obras:** una obra con nombre propio (serie, película, videojuego, programa, anime) es un nombre destino sin clase.
- **Nunca son nombre:** un lugar o un gentilicio.

## 3. Pendiente (`pending`)

Todo fragmento que acota el resultado y no está en el vocabulario. Se cuenta uno por restricción.
- Procedencia: país, región, ciudad o gentilicio («rock venezolano», «death metal angola», «polos margariteños»).
- Idioma: «en inglés», «en español», «kpop» como idioma.
- Tempo y velocidad: «rápida», «lenta», «con ritmo».
- Época relativa o año: «nueva», «vieja», «viejitas», «actual», «2025», «de antes».
- Instrumentos y sonidos de fondo: «piano», «violín», «sonidos del mar», «bambú», «handpan».
- Público, ocasión o actividad fuera del vocabulario: «para hombres», «para bañarse», «boda», «xbox».
- Formato o duración: «en vivo», «live», «1 hora», «drum track».
- Popularidad: «éxitos», «lo mejor», «top».
- Cualidades de sonido que el vocabulario no tiene: «saturada», «recia».

## 4. Relleno (lista cerrada)

Solo es relleno lo que está en esta lista; lo demás que acota es pendiente:
- palabras de pedido y cortesía: música, canciones, temas, playlist, lista, quiero, busco, ponme, recomiéndame, «para escuchar»;
- «mix», «enganchados», «mixtas»;
- preguntas de definición sobre un género: «que es», «significado», «rym», «wiki»;
- un número suelto de una o dos cifras (numeración: «noise 9», «rock para viajar 4»);
- interjecciones y emoticonos: «xd», «jaja»;
- la repetición de una condición ya dicha: «art pop arte», «canciones tristes videos tristes»;
- el soporte sin acotar: «videos», «audio»;
- la plataforma donde se busca: «youtube», «spotify», «wattpad»;
- valoraciones vagas que no acotan: «chida», «bonita», «buena», «bien».

## 5. Estados

- `query_valid`: todo lo pedido está representado (exigidos, nombres, contexto del oyente) y no queda pendiente.
- `partial`: algo representado y al menos un pendiente.
- `entity_lookup`: solo nombres, sin condiciones; puede llevar pendientes.
- `unsupported`: solo pendientes.
- `clarify`: un término ambiguo aislado («suave» solo → `serene` / `energy-low`; «música de amor»).
- `contradiction`: pide y excluye lo mismo («música sin música»).
- `unrecognized`: no pide música del catálogo. Por ejemplo:
  - preguntas generales, compras, teoría o instrumentos para tocar;
  - ruido de teclado y pruebas;
  - una consulta hecha solo de palabras de pedido («recomiéndame una música»).

## 6. Contexto del oyente (`ctx`)

«Estoy triste» o «tengo sueño» describen al oyente: cuentan en `ctx`, no son condiciones.
