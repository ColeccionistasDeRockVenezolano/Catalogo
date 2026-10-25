# CRV — Plan del buscador unificado con Laya en cinco etapas

**Versión:** `crv-unified-search-plan-1.1.0`  
**Fecha:** 2026-10-17  
**Revisión:** 2026-10-17; ampliación de trazabilidad y criterios de aceptación solicitada por Brian.  
**Responsable de decisiones editoriales:** Brian  
**Proyecto:** `/home/brian/apps/Coleccionistas De Rock Venezolano`  
**Estado:** plan documental solicitado. Las cinco etapas están pendientes; este documento no ejecuta implementación, migraciones, entrenamiento, clasificación musical o despliegue.

## Objetivo y condiciones de Brian

Construir un buscador sólido que interprete búsquedas directas, emocionales y contextuales, incluidas combinaciones; conserve la UI y mejore la UX; responda con rapidez, evidencia y seguridad; y use Laya especializado para las decisiones semánticas.

El sistema tendrá observabilidad de consultas no identificadas, patrones similares, búsquedas directas, errores y búsquedas sin resultados. Se unificará con lo ya creado, contará con alimentación continua y se operará desde **un único espacio en el menú de administradores existente**.

### Autoridad y reglas que atraviesan las cinco etapas

1. Las decisiones explícitas de Brian, sus correcciones y los estados editoriales aprobados prevalecen sobre inferencias, nuevas fuentes y modelos posteriores. La prioridad se implementa con reglas y permisos comprobables; no depende solo del prompt ni del fine-tuning.
2. Una predicción nunca sobrescribe una decisión humana. La contradicción abre revisión con evidencia y motivo. Cambiar una regla editorial requiere una decisión explícita, atribuida y versionada.
3. Se conserva lo solicitado por el visitante: requisitos, exclusiones, preferencias, alternativas y fragmentos no interpretados. No se relajan restricciones para llenar resultados.
4. Género, actividad, emoción, energía, ambiente y temática permanecen separados. Las 22 familias de facetas del piloto complementan esos ejes y necesitan revisión antes de activarse.
5. Identidad y alcance preceden a cualquier asociación: artista, álbum, pista, grabación/versión y edición cuando se conozca. La falta de evidencia es desconocimiento, no una negación.
6. `+shoutbox` y sus clasificaciones permanecen retirados. Capturas de Last.fm o RYM pueden servir de vocabulario sin acreditar asociaciones de homónimos.
7. Se aprovechan código, datos, contratos, auditoría y herramientas existentes. No se crea una segunda aplicación de descubrimiento, un segundo panel aislado o un almacén de decisiones musicales incompatible.
8. Las selecciones y sugerencias diarias usan `src/shared/daily-cycle.ts`, servidor como autoridad y cambio a las 00:00 de `America/Caracas`. React conserva `DailyCycleProvider`, `useDailyCycle` y `useDailyAsync`.
9. Se preservan las reglas vigentes de audiovisuales, características combinables de publicaciones y marcas de tiempo de YouTube. Un video no origina por sí solo un disco o pista; las marcas siguen vinculadas al video concreto.
10. La autorización actual comprende crear y revisar este plan. El comienzo de su implementación será una instrucción posterior de Brian.
11. No deducir actividades de escucha únicamente de género, emoción, ambiente, ritmo, energía o temática. Una actividad solicitada por el visitante se reconoce como intención; su adecuación a una obra requiere evidencia y criterio propios. «Triste» no acredita estudiar, «reggaetón» no acredita bailar y un viaje relatado no acredita conducir.
12. Toda entrega distingue **observación atribuida de la fuente**, **interpretación del análisis** y **propuesta para el buscador**. Las tres capas mantienen vínculos trazables y estados propios; una hipótesis del análisis no se publica como declaración de una comunidad.

### Qué completa la revisión 1.1.0

Se incorporan una matriz de todos los bloques del informe de recursos, un protocolo exigible para repetir y contrastar el análisis de reseñas, y una matriz que conecta los acuerdos de esta conversación con etapas y comprobaciones. La revisión completa el alcance documental; las mediciones de calidad, rapidez y cobertura del sistema se realizarán durante las etapas correspondientes.

## Punto de partida: unificar el trabajo anterior

Este plan reúne y actualiza el alcance de los documentos del 10 y 16 de octubre. Es la referencia de planificación para el nuevo buscador; los planes y handoffs anteriores se conservan como historia y evidencia, con sus fechas y límites. Una cabecera antigua de «propuesta» no significa que los componentes nunca se hayan implementado.

El handoff del 10 de octubre documenta implementación técnica de sus cuatro fases: sugerencias, métricas, contextos por pista y recomendaciones. También distingue código preparado, funcionalidades activadas y falta de datos reales. Ese estado es histórico: no certifica por sí solo lo desplegado hoy.

| Componente anterior | Base que se conserva | Unificación prevista |
| --- | --- | --- |
| Búsqueda global e índice | `src/api/search-index.ts`, `src/api/repositories/search.ts`, `src/api/routes/search.ts`; nombres, alias, IDs y caché | Una vía rápida de entidades integrada con el nuevo plan semántico |
| UI y autocompletado | `CatalogSearchInput`, `SearchPage`, `RotatingSearchExample`, `catalogSearchSuggestions` | Misma identidad visual, navegación y controles; sugerencias adaptadas a la intención |
| Sugerencias editoriales | `src/discovery/{suggestions,curation,merge}.ts`, tablas de `0052_discovery` | Mismos IDs, elegibilidad, evidencia, estados, vigencias y decisiones humanas |
| Métricas de exposición | `metrics.ts`, `aggregate.ts`, `trends.ts`, tablas de `0053_discovery_metrics` | Conservar el embudo impresión → aceptación → búsqueda atribuida → visita; integrarlo con observabilidad general sin cambiar su significado |
| Consultas sin resultados | `src/api/search-misses.ts`, `GET /search/misses`, `0072_search_misses` | Reutilizar su almacenamiento/agregación donde corresponda y ampliar causas, contexto y trazabilidad; diferenciar el legado de los nuevos eventos |
| Contextos por pista | `track-context*`, tablas de `0054_track_contexts`, `crv-contexts-v1`, `perceived-energy-v1` | Extender contratos y evidencia por pista, preservando aprobaciones/evaluaciones |
| Recomendaciones y feedback | `recommendation-*`, `recommendations.ts`, `0056_discovery_recommendations` | Unificar intención, recuperación, abstención, feedback y versiones con el buscador principal |
| Emociones Last.fm | `entity_user_tags`, `entity_emotions`, decisiones de `emotion_tag_decisions`, `CurationEmotionsPage` | Incorporar vocabulario y decisiones revisadas al espacio único; migrar significados con revisión, sin reproducir el detector léxico prioritario como arquitectura definitiva |
| Géneros y relaciones | `src/genres/*`, `data/genres/taxonomy.json`, `artist-neighbors.ts`, claims/evidencias | Ampliar mapa descriptivo y correspondencias; distinguir semejanza sonora de relaciones de integrantes o sellos |
| Auditoría y reversibilidad | Runs, diario, decisiones, redirecciones y deshacer/rehacer existentes | Reutilizar el mismo control de cambios y resolver colisiones de fusiones |

**Datos de referencia observados en el análisis del 17 de octubre:** 282 categorías musicales activas, cinco con descripción, 123.831 pistas y cero asignaciones contextuales de pistas. Se volverán a medir al iniciar la etapa 1; no son compromisos de cobertura futura.

El archivo local `data/genres/taxonomy.json` conserva jerarquías y alias, pero sus entradas no contienen descripciones. No debe sobrescribir sin revisión las descripciones o decisiones existentes en la base.

## Resumen de las cinco etapas

| Etapa | Resultado principal | Dependencia |
| --- | --- | --- |
| 1 | Consolidación de lo existente, contrato único, observabilidad base y acceso administrativo único | Inventario y decisiones de producto |
| 2 | Conocimiento musical trazable y alimentación incremental por artista/álbum/pista/versión | Contratos e inventario de etapa 1 |
| 3 | Laya especializado, calibrado y evaluado con datos revisados | Vocabulario estable y corpus de etapa 2; observaciones de etapa 1 |
| 4 | Buscador y sugerencias unificados, con UX existente e instrumentación completa | Índices/evidencia y modelo que superen las evaluaciones |
| 5 | Operación continua, patrones de búsqueda, mejora revisada y despliegue controlado | Sistema integrado y métricas verificables |

Cada etapa entrega resultados revisables y una comprobación de salida. Ninguna se considera terminada por tener tablas, código o un modelo exportado sin comprobar su funcionamiento y cobertura.

## Etapa 1 — Consolidación, contratos y observabilidad base

### Objetivo

Actualizar el inventario y convertir las piezas existentes en una sola línea de trabajo. Definir y habilitar, cuando se implemente esta etapa, la medición básica antes de entrenar o cambiar el comportamiento público del buscador.

### Trabajo

- Revisar los planes y handoffs anteriores, código, migraciones realmente aplicadas, banderas, timers, endpoints, paneles y servicios desplegados. Preservar el árbol de trabajo ajeno.
- Elaborar una matriz por componente: conservar, ampliar, integrar o retirar mediante compatibilidad. Distinguir implementado, desplegado, activo, con datos y validado musicalmente.
- Definir un único contrato de intención versionado: búsqueda directa, emocional y contextual como capacidades combinables; entidades objetivo/referencia; seis dimensiones; facetas; AND/OR; exclusiones; preferencias; restricciones desconocidas y ambigüedades.
- Reutilizar los mecanismos actuales de aprobación, feedback, snapshots, fusión y deshacer. No fijar números de nuevas migraciones hasta comprobar los existentes ni modificar `public` sin necesidad documentada.
- Definir autoridad editorial y comprobar que una actualización de modelo, fuente, alias o índice no cambia decisiones de Brian.
- Construir el acceso administrativo único y conectar primero las lecturas disponibles. Los apartados todavía no implementados mostrarán su estado real.
- Establecer una línea base de rapidez, carga, errores, búsquedas y cobertura, con versiones del instrumento. La instrumentación inicial debe indicar cuándo usa lógica antigua y cuándo no puede identificar una intención con suficiente respaldo.
- Abrir el registro de recursos del anexo A y comprobar disponibilidad, localización, estado, cobertura y responsable de cada fila. Una fuente no disponible o diferida conserva motivo y tarea; no desaparece del inventario ni se presenta como ya integrada.

### Un solo espacio de administración

**Ubicación propuesta:** `Administrar → Buscador y descubrimiento`, dentro de `web/src/components/AdminNavigation.tsx`. Ruta raíz propuesta: `/administrar/buscador`; el nombre de ruta se confirmará contra el router existente al implementar, manteniendo un único acceso principal.

Apartados internos del mismo espacio:

1. **Resumen:** salud, volumen, latencia, tipos de búsqueda, errores, vacíos y cobertura.
2. **Consultas y patrones:** consultas no reconocidas, grupos similares, ejemplos, causas, historial y tareas de revisión.
3. **Conocimiento:** intenciones, mapa de géneros/estilos, correspondencias, facetas, comparaciones y evidencia por entidad.
4. **Sugerencias:** elegibilidad, ejemplos directos/emocionales/contextuales, vigencia, exposición y embudo actual.
5. **Alimentación:** fuentes, lotes, progreso, fallos, pendientes, reintentos y fecha de actualización.
6. **Laya y evaluación:** datasets, revisiones, modelos, calibración, pruebas, comparación y activación/reversión.
7. **Reglas e historial:** decisiones de Brian, cambios, contradicciones, snapshots y deshacer.

Reubicar o enlazar los controles de búsqueda/emociones ya existentes con los mismos IDs y decisiones. Las URLs anteriores conservarán redirecciones o enlaces de continuidad. Curaduría general y edición del catálogo mantienen sus funciones; las tareas relacionadas se abren desde este espacio sin duplicar casos o formularios de decisión.

### Contrato de observabilidad requerido desde esta etapa

La observabilidad distingue cuatro ejes que pueden coexistir:

| Eje | Valores orientativos | Ejemplo |
| --- | --- | --- |
| Tipo de petición | directa, emocional, contextual; combinación derivada; no determinada | Una referencia a un artista no es automáticamente una búsqueda directa de ese artista |
| Interpretación | identificada, parcial, ambigua, no reconocida, fuera de alcance, indisponible | No se pudo interpretar «sin gritos» con el vocabulario disponible |
| Resolución de entidad | resuelta, ambigua, inexistente en catálogo, referencia externa, no aplica | Se comprende que busca un artista, pero no se encuentra su identidad |
| Resultado | con resultados, sin resultados, parcial, fallo técnico | La petición se entendió, pero no hay pistas con evidencia suficiente |

Los estados finales de resultado son excluyentes por snapshot; los ejes de interpretación, tipos e incidentes no lo son. No sumar contadores solapados como si fueran un total.

#### Qué se considera una búsqueda

- Una búsqueda lógica se confirma con Enter, «Ver todos», aceptación de una intención sugerida que ejecuta consulta, o selección explícita de una entidad en el autocompletado.
- Seleccionar directamente una entidad se registra como navegación de búsqueda directa y se distingue de una página de resultados; evita dejar fuera el uso más rápido del buscador.
- El tecleo, las peticiones de autocompletado y los refrescos son tráfico/previas, con contadores propios, sin aumentar el total de búsquedas confirmadas.
- `search_id` identifica la operación lógica; `request_id`/`attempt_id`, sus peticiones/reintentos. Los reintentos no duplican la operación lógica. Una consulta modificada y confirmada origina otra búsqueda.
- Las respuestas desde caché también cuentan como uso. Una respuesta atrasada o cancelada antes de confirmarse no cuenta como búsqueda completada.
- El backend acredita interpretación, recuperación y fallos; el frontend comunica confirmación, selección y visualización con correlación validada. Se reutiliza el patrón de tickets/recibos del embudo donde sea aplicable.

#### Contadores y listas obligatorios

| Métrica o bandeja | Definición operativa |
| --- | --- |
| Búsquedas totales | `search_id` confirmados distintos; autocompletado separado |
| Búsquedas directas | Intención de localizar una entidad; vistas de directas puras y combinadas, con denominadores explícitos |
| Búsquedas emocionales/contextuales/mixtas | Tipos presentes y distribución de combinaciones; distinguir carácter musical de estado del oyente |
| No identificadas | Consultas confirmadas no reconocidas, parciales, ambiguas o fuera de alcance; ejemplos conservados, motivo y fragmento pendiente |
| Entidades no resueltas | Nombres/alias ausentes, ambiguos o referencias externas, sin asumir que se desconoció toda la intención |
| Sin resultados | Recuperación completada correctamente y cero resultados que cumplan lo exigido; motivo de catálogo, evidencia o restricciones |
| Con error técnico | Búsquedas distintas con incidente: timeout, proveedor, base, respuesta inválida, limitación, sobrecarga, red o cliente; fallos terminales aparte |
| Patrones similares | Grupos de consultas equivalentes o relacionadas con variantes, frecuencia, resultados, causas y decisión de revisión |
| Sugerencias | Impresiones realmente visibles, aceptaciones, búsquedas atribuidas y visitas; conservar los denominadores y reglas del embudo existente |
| Rendimiento | p50/p95/p99 por vía y componente; tiempo total percibido separado del servidor, aciertos de caché y arranque en frío |
| Calidad del registro | Eventos recibidos, duplicados, excluidos, perdidos, pendientes y fallidos; cobertura de correlación y última agregación |

Un fallo de Laya es indisponibilidad técnica, no prueba de intención irreconocible. Un error no se cuenta como cero resultados. Si la vía directa responde pero falla una parte semántica, se registra respuesta parcial e incidente.

#### Datos mínimos por operación y protección del texto

Contrato lógico sugerido: `crv-search-observability-v1`, adaptando las tablas actuales antes de decidir qué ampliaciones nuevas hacen falta.

- Identificador lógico y de intento, fecha del servidor, punto de entrada, confirmación y origen libre/sugerido.
- Tipo(s), estado de interpretación, entidades resueltas o pendientes, plan validado o fragmentos pendientes, causa estructurada de abstención.
- Muestra de consulta problemática **sanitizada y útil**, forma normalizada, huella y longitud. Conservar negaciones, artistas, cifras y diferencias semánticas. Preparar un límite de consulta natural de hasta 1.000 caracteres sujeto a validación de tokens/carga; no heredar el recorte histórico de 60 como política definitiva.
- Cantidad de resultados por tipo, resultado final, errores tipados, latencias por fase, caché y degradación.
- Versiones de modelo, preguntas, reglas, diccionario, correspondencias, índice y evidencia publicable. Guardar la interpretación observada; un reprocesamiento posterior se almacena como otro análisis, sin reescribir lo ocurrido.
- Referencia opcional a sugerencia, recibo y configuración de exposición; ningún evento hereda una atribución que no se haya acreditado.
- No almacenar IP, cookies, tokens, cuenta ni huellas persistentes de persona en esta analítica. Los límites antiautomatización pueden usar claves efímeras sin persistirlas como perfil.
- Redactar datos personales incidentales antes de persistir muestras y antes de generar representaciones semánticas. Limitar también querystrings, logs HTTP, trazas, errores y exportaciones; no basta con proteger la tabla.
- Registrar contadores de todas las búsquedas elegibles y guardar ejemplos acotados para diagnóstico, especialmente las no identificadas y vacías. El panel informa muestreo, límites, pérdidas y tráfico excluido. No presentar sesiones como personas únicas.
- Retención propuesta: muestras sanitizadas y eventos detallados, 30 días; agregados anónimos y estadísticas de patrones, 180 días. Los ejemplos de entrenamiento se conservan solo tras revisión/desidentificación, en datasets versionados; no se copia automáticamente todo el tráfico.

El registro se desacopla de la respuesta con cola/buffer acotado, vaciado por lotes, idempotencia y observación de pérdidas. Una avería de la analítica no bloquea la búsqueda. Si falla PostgreSQL, el incidente debe poder observarse en un canal operativo independiente de esa misma escritura fallida. No prometer registro sin pérdidas: medirlo y mostrarlo.

#### Compatibilidad histórica

`search_misses` actualmente conserva consultas sin resultados con límites y agregación propios; puede recibir previas sin confirmación. El embudo de descubrimiento mide búsquedas atribuibles a sugerencias, no todas las consultas. No se suman ambas fuentes al nuevo total.

Mantener `legacy`/versión y procedencia, mapear únicamente campos acreditados y conservar los originales. No reconstruir series diarias a partir de solo contador/primera/última fecha. Revisar las purgas con respaldo antes de cualquier cambio de retención.

Los tiempos se almacenan en UTC. Los nuevos cortes diarios del tablero usan la fecha editorial de Caracas calculada por el servidor; las series históricas UTC del embudo se identifican y conservan separadas. Una conversión solo procede con eventos suficientes, una metodología versionada y comprobación de totales; no se mezclan días de distinta duración o corte.

### Entregables y salida

- [ ] Matriz de reutilización y transición, con estado técnico/operativo actualizado y rutas antiguas cubiertas.
- [ ] Registro del anexo A contrastado con el informe completo: cada recurso tiene destino, etapa, prioridad, estado y criterio; los retirados o diferidos también quedan documentados.
- [ ] Contratos únicos de interpretación, evidencia publicable, métricas y autoridad editorial.
- [ ] Entrada administrativa única con lecturas del legado y estado explícito de lo pendiente.
- [ ] Línea base e instrumentación comprobada para confirmaciones, directas, desconocidas, vacías y errores.
- [ ] Pruebas de deduplicación, exclusión de administración/bots/pruebas, caché, privacidad y conservación del legado.
- [ ] Criterios de evaluación y presupuestos de latencia definidos con sus mediciones iniciales.

## Etapa 2 — Conocimiento musical, taxonomía y alimentación incremental

### Objetivo

Construir conocimiento consultable a partir de los recursos existentes, con identidad y evidencia por nivel, conservando el vocabulario y las decisiones actuales.

### Trabajo

- Completar descripciones de géneros y estilos: fuentes, instrumentos/roles, timbres, ritmos, formas, voces, producción, rasgos definitorios, frecuentes y variables. Aprovechar las cinco descripciones actuales; no deducir rasgos de todas las canciones desde un género.
- Revisar las correspondencias RYM → CRV: equivalencia, especialización, relación parcial o pendiente. Conservar término original, nivel principal/secundario, fuente y versión. Revisar alias demasiado amplios sin reescribir asignaciones humanas.
- Consolidar el diccionario 0.1.0 y revisar las 22 familias de facetas propuestas. Registrar qué se aprueba, redefine o pospone; no activar todas por el mero hecho de figurar en el informe.
- Reutilizar IDs de artistas, álbumes y pistas; tratar obra/grabación/edición con relaciones documentadas. Una pista ya tiene espacio en la base; falta asociarle evidencia específica y navegación contextual.
- Reparar las extracciones de reseñas antes de aplicarlas: autores/fechas ausentes, spans truncados, reseñas conjuntas, citas, idiomas y duplicados. La unidad de trabajo es afirmación + objeto + fuente + estado.
- Relacionar comunidad, conocimiento general, reseña y nota individual sin fundir sus autoridades. Rating mide evaluación; `weight` y orden de tags no son probabilidades de verdad ni personas auditadas.
- Registrar similitudes por aspecto: origen, referencia, voz/guitarras/producción/composición/ambiente, sentido, afirmación o negación, fuente, alcance y testigos. Permitir referencias externas verificadas sin incorporarlas ficticiamente al catálogo venezolano.
- Mantener propuestas, decisiones aprobadas, contradicciones y evaluaciones separadas. Conservar evidencia aunque una fuente audiovisual deje de estar disponible.

### Recursos y uso

| Fuente | Valor para el sistema | Condición |
| --- | --- | --- |
| RYM: fichas, géneros, descriptores y reseñas | Vocabulario, descripción, contexto y comparaciones por álbum/pista | El inventario corregido encontró 1.705 fichas con descriptores de 7.328; la presencia del campo no es cobertura |
| Last.fm: tags de artista/álbum, métricas y similares | Vocabulario y señales de afinidad/popularidad de su comunidad | Identidad y alcance revisados; excluir shouts y homónimos; 4.812 respuestas con tags no prueban 4.812 álbumes distintos verificados |
| Aqustico | Géneros por canción, playlists y 14.988 pares de similitud del informe | Revisar identidades y significado de cada relación |
| MusicBrainz, Discogs y fuentes oficiales | Identidad, ediciones, créditos y estilos | Aplicar políticas y vínculos existentes, no nombre coincidente |
| Letras, blogs, Sincopa, prensa, Bandcamp y otros archivos | Temática, contexto, sonido y documentación | Atribución, fecha, nivel y distinción entre biografía, letra y opinión |
| Plataformas de metadatos | Duración, fecha, idioma, explicitud y disponibilidad según cobertura | Preservar ámbito y versión; popularidad no implica adecuación |
| Audio propio | Comprobar diferencias audibles y versiones | Revisión/metodología de audio separadas; Laya recibe texto y no escucha audio |

La matriz detallada del **anexo A** forma parte del alcance de esta etapa. Esta tabla es su resumen; no sustituye la revisión por recurso y campo.

### Protocolo obligatorio para repetir el análisis de reseñas

Se adopta el método del piloto como especificación de trabajo, con las comprobaciones siguientes. Sus **42 hallazgos, 22 familias de facetas y 56 consultas** son antecedentes trazables y material de desarrollo, sujetos a contraste en obras nuevas. No se dan por validados para todo el corpus ni se convierten automáticamente en clasificaciones.

#### 1. Disponibilidad, identidad y selección

- Fijar un corte coherente del corpus y un manifiesto con archivos, huellas, fechas, URLs, versión de extractor y discrepancias. Contar publicaciones, páginas efectivamente guardadas, reseñas únicas, cuentas distintas y versiones de texto; páginas vacías, bloqueadas o repetidas no amplían la muestra.
- Para el estudio de álbumes con varias páginas, exigir al menos dos páginas útiles efectivamente capturadas. Documentar las excepciones como otro estrato, sin presentarlas como cumplimiento de ese requisito.
- Resolver artista, álbum y objeto RYM mediante identificadores, repertorio, encabezados y vínculos documentados. Registrar vínculo con CRV como resuelto, externo, ambiguo o pendiente; verificar RYM no acredita automáticamente el vínculo con CRV. Edición no conocida permanece desconocida.
- Seleccionar contrastes de género/estilo, época, idioma, voces, producción, estructura, recepción y volumen de reseñas. Registrar por qué se incluye cada álbum y qué perspectivas quedan poco cubiertas; evitar concentración en un solo artista o género.
- Como punto de partida reproducible, hasta veinte reseñas válidas por álbum se leen todas; por encima, tomar por página las notas mínima y máxima, con desempate por longitud y luego ID. Añadir un estrato explícito de reseñas sin nota y conservar frases breves relevantes. Registrar IDs y cualquier cambio producido al reparar extracciones.
- Ese muestreo favorece contraste y extremos. Para estimar frecuencias o mayorías de la comunidad, usar censo o selección probabilística documentada con denominadores y cobertura. No extrapolar porcentajes del piloto a RYM, CRV o todos los oyentes.
- Reservar álbumes y familias de textos que no participen en diseñar las categorías. En parte del nuevo material, hacer una primera anotación sin mostrar puntuaciones/tags y después cruzar las capas, registrando si el contexto cambió la lectura.

#### 2. Unidad y esquema mínimo de anotación

La unidad es **afirmación + objeto + aspecto + fuente + estado**. Una reseña puede aportar varias unidades; no se multiplica el número de testigos por ello. Cada registro debe permitir volver desde el hallazgo al fragmento y a su captura.

| Grupo de campos | Información exigida |
| --- | --- |
| Identificadores y localización | Estudio, publicación RYM, ID de reseña, cuenta, página, URL, archivo/huella y selector o localizador del fragmento |
| Tiempo y texto | Fecha visible, edición del texto si se conoce, fecha de captura, fragmento original breve, idioma, traducción/paráfrasis marcada y versión del extractor |
| Objeto y alcance | Artista, álbum completo, pista nombrada, segmento, grabación, edición, audiovisual u otra obra; límites y condiciones de escucha |
| Afirmación | Descripción sonora, letra, gusto, comparación, experiencia, contexto, dato factual o intención autoral atribuida; valor y referente concretos |
| Aspectos musicales | Instrumentos y roles, timbre, voz, producción, ritmo, estructura, evolución, emociones, energía, ambiente, actividad, temática y atributos emergentes |
| Estado y valoración | Afirmado, negado, hipotético, condicional, citado, posible ironía, corregido/retirado o incierto; agrado/desagrado/mixto/descriptivo separado |
| Puntuaciones | Nota individual del álbum con escala y ausencia explícita; notas escritas en texto y por pista por separado; nota comunitaria con votos y fecha en otra capa |
| Relaciones y dependencia | Apoya, precisa, contradice, cita o no comprueba; duplicado/revisión/reseña conjunta/voz de tercero; procedencia común y posibles dependencias |
| Interpretación y destino | Interpretación del analista, alternativa plausible, incertidumbre, concepto existente o candidato, consulta humana beneficiada, revisor y decisión |

Un elogio genérico puede conservarse como valoración sin generar un atributo. La ironía, una traducción incierta o un texto truncado requieren revisión; no se completan desde el género ni desde la nota.

#### 3. Cruce de cuatro procedencias sin fusionarlas

1. **Géneros y tags de comunidad:** término literal, fuente, nivel de entidad, género principal/secundario cuando exista, fecha/captura, política y medida documentada. No atribuirlos al autor de una reseña ni interpretar orden o peso como confianza.
2. **Conocimiento del género/estilo:** definición y rasgos documentados, distinguiendo definitorio, frecuente y variable; excepciones y ámbito histórico/geográfico. Sirve para interpretar o proponer comprobaciones, sin completar atributos ausentes de un álbum o pista.
3. **Texto de la reseña:** quién describe qué, objeto, frase, condición de escucha y estado. «Parece un saxofón» no equivale a crédito verificado; una metáfora no acredita equipo o técnica.
4. **Puntuación de esa cuenta:** evaluación con escala y objeto; gusto por el rasgo anotado aparte. La nota global, nota por pista, media de ficha, votos de utilidad y popularidad no son intercambiables ni ponderan veracidad.

El cruce registra si las capas apoyan, precisan, discrepan o no resuelven una afirmación. Un tag y una reseña de la misma plataforma no se cuentan como dos oyentes independientes. El mapa de géneros no constituye otro testimonio sobre la obra.

#### 4. Patrones, contradicciones y minorías

- Comparar primero objeto, edición, tramo, aspecto y condición de escucha. Bases variadas y entrega vocal uniforme son aspectos compatibles; una canción instrumental no convierte en instrumental al álbum completo.
- Repeticiones del mismo ID son una reseña con varias capturas. La misma cuenta aporta una voz por aspecto y objeto; conservar revisiones y retirar del soporte activo lo corregido por confusión.
- Textos duplicados, traducciones, citas, reseñas conjuntas y comentarios atribuidos a amigos conservan una cadena común. Autores con cuentas distintas no equivalen a personas independientes verificadas; informar posibles dependencias sin acusar copia por frases genéricas.
- Para cada patrón, mostrar reseñas válidas examinadas, cuentas distintas que lo expresan, cadenas de evidencia tras deduplicación y casos que lo contradicen o matizan. «Independencia no determinada» es un estado permitido y visible.
- Separar **desacuerdo descriptivo** de **valoración opuesta del mismo rasgo**. Si dos autores reconocen sintetizadores prominentes y uno los disfruta mientras otro los rechaza, preservar el rasgo atribuido y las dos preferencias; no promediarlo hasta ocultar la diferencia.
- Conservar opiniones minoritarias e indicios aislados con atribución, alcance y posibles explicaciones. El silencio de otros reseñistas no es desacuerdo ni ausencia del rasgo. No llamar «consenso» a una recurrencia de la muestra.
- Para cada hallazgo entregar fragmentos breves trazables, testigos/contratestigos, alcance, interpretación alternativa y ejemplos de consultas. Distinguir observación, interpretación y propuesta en el análisis por álbum y en la comparación entre álbumes.

#### 5. Suficiencia y límites para el uso futuro

| Estado analítico | Regla operativa propuesta | Uso permitido y límite |
| --- | --- | --- |
| Indicio aislado | Una afirmación directa con identidad y alcance legibles | Atribuir a un reseñista; conservar como candidato, sin presentar rasgo consolidado |
| Recurrencia provisional | Al menos tres cuentas distintas con el mismo aspecto/objeto, tras revisar citas y duplicados | Informar repetición y dependencias pendientes; el umbral es editorial, no garantía estadística ni publicación automática |
| Coincidencia documental | Documento adecuado y observación referidos al mismo objeto/aspecto | Distinguir hecho documental de percepción; no sumar el documento como otro reseñista |
| Desacuerdo relevante | Perspectivas incompatibles tras revisar alcance, o valoraciones opuestas de un rasgo compartido | Conservar polos, testigos y condiciones; no imponer etiqueta por mayoría de notas |
| Interpretación atribuida | Lectura simbólica, narrativa o intención inferida | Mostrar atribución; acreditar intención autoral exige otra fuente apropiada |
| No evaluable | Identidad/edición/alcance inciertos, truncamiento, ironía no resuelta o parte no oída | Abstención y tarea de revisión; no completar por similitud o estilo |
| Ausencia acreditada en su alcance | Negación explícita más cobertura pertinente de la unidad | Solo sustenta exclusión dentro de ese objeto/versión; falta de mención no acredita ausencia |

Estos estados pueden coexistir: un rasgo puede ser recurrente y recibir valoraciones opuestas. No reducirlos a una única puntuación de confianza. Una fuente primaria adecuada puede acreditar un crédito sin tres reseñistas; repetir una percepción no la convierte en dato técnico.

La suficiencia analítica no autoriza una asignación al catálogo. La publicación futura exige identidad y alcance adecuados al atributo, criterio específico aprobado, evidencia pertinente y decisión editorial. Energía conserva `perceived-energy-v1`.

**Actividades:** distinguir uso real declarado, recomendación explícita, escena deseada/imaginada, actividad representada e ironía. «Escuché esto estudiando» es un testimonio con condiciones; no prueba adecuación universal. Emoción, género o ritmo por sí solos nunca bastan para asignar estudiar, dormir, correr, bailar, conducir o intimidad.

#### 6. Diccionario, facetas y consultas resultantes

- Para cada concepto del diccionario existente y cada una de las 22 familias candidatas, registrar: reutilizar, precisar, proponer como dimensión/atributo/relación nueva, diferir o rechazar; definición, sinónimos españoles/venezolanos, falsos amigos, ámbito, evidencia motivadora, criterio y decisión.
- No forzar sonido, voz, instrumentos, producción, letras, estructura, arco del álbum, repetición, duración percibida, familiaridad cultural o evolución con escuchas dentro de una emoción. Mantener la expresión original junto al concepto normalizado.
- Registrar por separado carácter musical, experiencia del oyente, contenido temático y petición. Nostalgia autobiográfica no equivale automáticamente a letra sobre el pasado; sexualidad temática no acredita sensualidad ni actividad íntima.
- Cada necesidad genera consultas con resultado esperado: entidades objetivo/referencia, dimensiones/facetas, sinónimos, AND/OR, requisitos/preferencias, exclusiones, alcance, evidencia necesaria, incertidumbre y explicaciones admitidas/prohibidas.
- Exigir evidencia de cada condición sobre la misma unidad buscada; no juntar rasgos de pistas distintas para afirmar que una sola pista cumple todo. Las condiciones desconocidas no satisfacen negaciones ni se eliminan silenciosamente.
- Mantener versiones distintas de estudio, diccionario, correspondencias, anotación, dataset y modelo. Aprobar una extensión semántica no implica migración, entrenamiento o clasificación automática.

#### 7. Entrega y validación de cada repetición

Entregar inventario/manifiesto, muestra y motivos, anotaciones trazables, análisis por álbum, comparación entre álbumes, hallazgos con alternativas, decisiones sobre facetas y matriz de consultas. Cualquier álbum o aspecto no evaluado se declara como tal.

Un subconjunto se anota de forma independiente antes de acordar criterios e incluye textos breves, multilingües, contradictorios y difíciles. Revisar traducciones relevantes; medir acuerdo por aspecto, alcance y relación con evidencia, además de precisión de soporte y generalizaciones indebidas. Registrar adjudicaciones y confusiones sin ocultarlas en una media.

No declarar saturación por un número fijo de álbumes. Registrar aspectos nuevos por lote, contrastarlos en obras reservadas y documentar qué dimensiones siguen descubriendo necesidades. Los umbrales de aceptación se acuerdan antes de abrir la prueba final; si no se alcanzan, se mantiene propuesta/revisión. La exploración del piloto no sustituye esta validación.

### Alimentación continua: una sola cadena operativa

**Captura existente → manifiesto/identidad → extracción → afirmaciones y candidatos → interpretación Laya → validación/editorial → índice publicado → observación.**

- Reutilizar capturadores, campañas y el refresco semanal Last.fm; inventariar qué timers están activos antes de crear ninguno. No instalar un segundo refresco equivalente.
- Descubrir capturas nuevas o cambiadas con huella y versión; cursor y lote reanudables. Clave idempotente por fuente, objeto, huella y versión de extractor/esquema.
- Identidad ambigua, homónimo, edición incierta o contradicción: bandeja de revisión. Una captura nueva no concede confianza retrospectiva a todo el perfil.
- Procesar solo cambios y entidades afectadas. Un modelo nuevo genera propuestas comparables, sin borrar aprobaciones anteriores.
- Publicar únicamente los datos autorizados por las políticas de Brian. Captura y propuesta pueden automatizarse; los cambios editoriales siguen la política de revisión acordada.
- Las aprobaciones, retiros, fusiones y deshacer invalidan lo afectado en búsqueda/sugerencias. La retirada no debe seguir visible por una caché antigua.
- Proteger la búsqueda interactiva frente a los lotes: presupuesto de CPU/GPU, prioridad, concurrencia acotada, timeouts, reintentos con backoff, bloqueo/lease y cola de fallos revisable.
- Un único tablero de lotes registra fuente, entradas nuevas/cambiadas, extraídas, interpretadas, pendientes, aprobadas, rechazadas, publicadas, fallidas y última actualización. Mostrar razones y ETA solo si hay mediciones que la sostengan.

### Entregables y salida

- [ ] Mapa descriptivo versionado y cobertura por género/estilo visibles.
- [ ] Correspondencias RYM–CRV revisadas con conservación de términos originales y decisiones humanas.
- [ ] Piloto ampliado por artista/álbum/pista/versión con evidencia y evaluación musical independiente.
- [ ] Paquete completo del protocolo: disponibilidad real, identidad, muestra reproducible, autores/duplicados/dependencias y anotaciones con las cuatro procedencias separadas.
- [ ] Análisis por álbum y comparación que preserven coincidencias, desacuerdos, minorías y rasgos valorados de forma opuesta; cada hallazgo tiene fuente, alcance, alternativa y consulta beneficiada.
- [ ] Los 42 hallazgos del piloto mantienen sus IDs/estado; las 22 familias y los conceptos del diccionario tienen decisión explícita, sin activación automática ni pérdidas de sinónimos.
- [ ] Suficiencia y revisión independiente documentadas; actividades y exclusiones no se derivan de género/emoción ni de ausencia de menciones.
- [ ] Cada fila del anexo A tiene evidencia de aprovechamiento o motivo de exclusión/diferimiento; disponibilidad no se presenta como integración ni cobertura musical.
- [ ] Relaciones de parecido explicables y consultas combinadas respaldadas.
- [ ] Cadena incremental reanudable: repetir lote no duplica evidencia, decisiones ni jobs efectivos.
- [ ] Panel Alimentación y Conocimiento integrado en el espacio único; conflictos accionables y datos privados protegidos.

## Etapa 3 — Especialización y evaluación de Laya

### Objetivo

Preparar modelos para interpretar consultas y evidencia con decisiones tipadas, calibración y evaluación propias de CRV, sin convertir el modelo en autoridad editorial o memoria del catálogo.

### Responsabilidades

**Laya para consultas:** tipo(s) de búsqueda, función de entidades, emoción solicitada frente a estado del oyente, actividad, facetas candidatas, negación, alternativas, preferencia, alcance e incertidumbre. Un segmentador/resolutor propone fragmentos y candidatos; el modelo decide entre opciones y un compilador validado construye el plan. Laya no genera cadenas arbitrarias, SQL o IDs inexistentes.

**Laya para evidencia:** naturaleza y objeto de una afirmación, característica candidata, negación/duda, comparación, valoración, cita, posible ironía y necesidad de revisión. Elegir entre fragmentos/objetos candidatos mantiene la trazabilidad; se revisa cualquier extracción abierta necesaria.

El checkpoint multilingüe y preguntas de opciones acotadas son el punto de partida. Evitar una elección única entre todas las emociones, géneros y facetas: usar decisiones jerárquicas y múltiples etiquetas cuando la petición las contiene. Registrar rutas, truncamiento, presupuestos de tokens y probabilidades por tarea.

### Dataset y fine-tuning

- Consolidar ejemplos reales revisados, sin tomar predicciones antiguas como verdad. La matriz de 133 consultas y las 56 del piloto son especificaciones de desarrollo, no 189 casos independientes de prueba final.
- Incorporar únicamente anotaciones que superen el protocolo de etapa 2, conservando cuenta/cadena y ámbito para separar conjuntos. Validar por separado extracción de afirmaciones, decisión tipada sobre evidencia e interpretación de consultas; un acierto de una tarea no acredita las demás.
- Incluir español venezolano, variaciones ortográficas, nombres cortos/alias, títulos emocionales, referencias externas, intenciones mixtas, negación/OR/preferencias y pedidos no soportados.
- Ejemplos adversos obligatorios: «Estoy triste, quiero algo alegre», «Busca la canción Amor», «música nocturna para estudiar», «parecido a X en las guitarras», «sin voces» frente a voz sampleada, y comentarios que corrigen una confusión de identidad.
- Para evidencia, combinar frases cortas y largas, textos multilingües, temas de canciones específicas, juicios negativos informativos, dependencia entre autores y escucha parcial.
- Usar consultas problemáticas como candidatos de revisión. Solo los ejemplos desidentificados y aprobados pasan al dataset; la frecuencia no crea una etiqueta correcta ni una decisión editorial.
- Separar entrenamiento, selección/validación, calibración y prueba final. Agrupar por artista/obra/versión, autor, duplicado y familia de paráfrasis para impedir fugas entre conjuntos.
- Comparar el modelo base con fine-tuning y con las reglas actuales. Evaluar ajuste de cabeza/encoder congelado o ajuste más amplio según compatibilidad y memoria, sin prometer una técnica antes de comprobarla.
- Entorno de entrenamiento aislado, versiones y huellas fijadas, configuración reproducible y rollback. El SDK observado es 0.3.20 y la GPU es RTX 3050 de 6 GB; realizar prueba de memoria/tiempo antes de decidir capacidad local o recursos distintos. No actualizar producción por ejecutar un notebook externo.
- Conservar una ficha por modelo: datos y decisiones incluidas, versiones, métricas, límites, latencia, calibración, umbrales por tarea y regresiones. Los umbrales se eligen con datos reservados; no heredar 0,5 como garantía universal.

### Evaluación y aprobación

Medir interpretación completa de condiciones, resolución de entidades, precisión por eje y combinación, errores de negación/alcance, incertidumbre, cobertura y pertinencia musical. Medir también sobreconfianza y abstención excesiva, no solo exactitud sobre los casos que el modelo decide contestar.

La evaluación histórica de doce solicitudes se utilizó durante ajustes y acertó diez contando abstenciones; no es holdout ni validación musical. Conservarla como regresión técnica, sin presentarla como medida suficiente del nuevo modelo.

Las pruebas de autoridad editorial deben demostrar que una predicción contradictoria no cambia una decisión humana, aunque su probabilidad sea alta. La energía musical mantiene `perceived-energy-v1`; interpretar que alguien pide energía alta es distinto de asignarla a una grabación.

### Entregables y salida

- [ ] Datasets revisados, procedencia y divisiones documentadas; pruebas finales reservadas.
- [ ] Modelos o configuraciones especializadas para consultas y evidencia, con evaluación separada.
- [ ] Calibración y umbrales medidos; casos sin respaldo devuelven incertidumbre.
- [ ] Los casos de minoría, valoración opuesta, dependencia, alcance y actividad del protocolo tienen resultados esperados y pruebas reservadas, con errores por tarea visibles.
- [ ] Comparación con el baseline, incluyendo precisión, cobertura, latencia y respeto de condiciones.
- [ ] Panel Laya y evaluación conectado a artefactos y decisiones; activación de modelo atribuida y reversible.
- [ ] Ningún modelo pasa a público solo por exportarse o mejorar una media; superar los criterios acordados por tarea y las regresiones editoriales/seguridad.

## Etapa 4 — Integración del buscador, sugerencias y UX

### Objetivo

Servir una experiencia única con las tres formas de búsqueda, combinaciones, resultados explicables y observabilidad completa, preservando la UI.

### Recuperación y ordenación

- Reutilizar el índice actual para nombres/alias y ofrecer resultados directos sin esperar innecesariamente al modelo. La interpretación semántica conserva las referencias y modificadores explícitos.
- Resolver entidades objetivo frente a semillas de similitud. Bandas, dúos, solistas y proyectos siguen siendo artistas; no crear fichas de persona por el tipo de proyecto.
- Compilar un plan estricto desde la interpretación. Validar opciones, IDs, tipos, rangos, longitud, restricciones y contradicciones antes de ejecutar consultas parametrizadas.
- Recuperar únicamente entidades existentes y evidencia publicable en su nivel. Para una petición de canción no heredar silenciosamente los rasgos del álbum o artista.
- Requisitos y exclusiones gobiernan elegibilidad; evidencia/relevancia gobiernan orden; preferencias y diversidad se aplican después. Popularidad o estrellas no reemplazan lo solicitado.
- Explicar coincidencias desde evidencia y plantillas revisadas, con referencias cuando aporten contexto. Un fragmento mencionado como parecido no se presenta como prueba de identidad.
- Si no hay cobertura, devolver ese estado y permitir cambiar condiciones explícitamente. Una sugerencia de ampliación nunca ejecuta el cambio sin decisión del visitante.

### Misma UI, UX más informativa

- Mantener campo principal, autocompletado agrupado, filas de resultados, navegación y estilos; ampliar los componentes actuales.
- Adaptar sugerencias al texto: nombres/alias para directa; formulaciones emocionales/contextuales y combinaciones respaldadas para descubrimiento. Distinguir ejemplos del campo vacío de coincidencias mientras se escribe.
- Mostrar interpretación breve y editable: requisitos reconocidos, exclusiones, referencias y fragmentos pendientes. No forzar un selector inicial de modo.
- Preguntar solo por ambigüedades que cambian resultados; conservar consulta, filtros y selección en URL/estado navegable. No sustituir texto ni mover foco por una respuesta tardía.
- Presentar estados distintos para consulta no reconocida, entidad no resuelta, ausencia de resultados, evidencia insuficiente y fallo técnico.
- Conservar teclado, foco, toque, pausa/omisión, movimiento reducido y estados accesibles de carga/error; evitar anuncios continuos del lector de pantalla.
- Las sugerencias de descubrimiento deben tener elegibilidad y cobertura comprobadas. No ofrecer ejemplos de recomendaciones que el sistema todavía no pueda sostener.
- Integrar el embudo actual, las búsquedas libres y el feedback sin contar dos veces una misma confirmación. El feedback de otra persona no altera preferencias del visitante.

### Rapidez y seguridad

- Índices preparados e invalidación acotada; caché por consulta/plan y versiones relevantes; deduplicación de peticiones en vuelo y cancelación de previas.
- Modelo residente, preguntas agrupadas y candidatos acotados; sin llamadas a proveedores ni revisión de todo el corpus por búsqueda.
- Publicación de índices coherente con decisiones vigentes. Validar elegibilidad/retiradas al servir; evitar mezclar vocabularios o modelos incompatibles en una respuesta.
- Servicio Laya privado, autenticación, límites de entrada/tokens/cuerpo, deadlines, concurrencia acotada y recuperación ante fallos. El navegador no recibe credenciales ni acceso al modelo interno.
- APIs públicas de recuperación sin permisos de escritura editorial. Rutas administrativas con permisos y CSRF del proyecto; salida textual escapada y documentos externos tratados como datos.
- Separar duración del servidor, red, debounce actual de 250 ms, inferencia, recuperación y render. Objetivos iniciales propuestos: p95 de servidor menor de 150 ms para directa y 500 ms para semántica en caliente, sujetos a medición representativa y revisión explícita antes del despliegue; no son resultados actuales.

### Entregables y salida

- [ ] Una respuesta/plan coherentes para búsquedas directas, emocionales, contextuales y mixtas.
- [ ] Sugerencias y explicaciones adaptadas, con todos los controles y navegación preservados.
- [ ] Cada escenario solicitado por Brian produce el evento/contador correcto: directa, no identificada, patrón relacionado, error y cero resultados.
- [ ] Cache hits, reintentos, navegación directa, eventos duplicados y respuestas canceladas verificados sin inflación de contadores.
- [ ] Pruebas de contrato, seguridad, accesibilidad, carga y UX en escritorio/móvil; comparación visual acotada con la UI vigente.
- [ ] Sin regresiones del buscador directo ni relajación silenciosa de requisitos; degradación clara cuando falta Laya o evidencia.

## Etapa 5 — Operación continua, patrones, mejora y despliegue

### Objetivo

Operar y mejorar el sistema desde el espacio único de administración, con alimentación continua, observabilidad fiable y activación reversible.

### Patrones de búsqueda similares

- Agrupar primero coincidencias exactas normalizadas y variantes ortográficas comprobadas. Conservar muestras representativas y frecuencias sin convertir cada error en un alias.
- Añadir agrupación semántica sobre texto sanitizado y planes: entidades, tipo(s), conceptos, negaciones, alternativas, duración y demás restricciones. «Triste» y «sin tristeza» nunca deben unirse como intención equivalente.
- Generar candidatos de similitud con índices/rasgos y comparar conjuntos pequeños. Laya puede decidir equivalente, relacionada, distinta o incierta; evitar comparar todas las consultas con todas.
- Un grupo presenta representante, variantes, volumen, distribución de tipos/resultados/errores, primera/última fecha, modelo/reglas y fragmentos pendientes. Las representaciones de consultas sanitizadas también tienen retención y acceso administrativo.
- Unir/dividir grupos es una decisión revisable. Relacionadas no significa equivalentes: preservar subgrupos con restricciones distintas y permitir corregir una agrupación errónea.
- Separar similitud entre consultas de similitud entre artistas/obras. No crear relaciones musicales porque dos búsquedas coincidan en un grupo.

### Bandeja de mejora y ciclo de alimentación

**Consulta problemática o fuente nueva → caso agrupado → diagnóstico → propuesta revisable → decisión → actualización incremental → evaluación → medición posterior.**

| Diagnóstico | Acción propuesta desde el mismo panel |
| --- | --- |
| Nombre/alias ausente o identidad ambigua | Revisar identidad y proponer alias/vínculo documentado; no fusionar por coincidencia |
| Expresión o sinónimo no reconocido | Proponer ejemplo y regla/diccionario; revisión previa al dataset |
| Negación, alcance o referencia mal interpretados | Caso de regresión y candidato de entrenamiento de consultas |
| Consulta entendida sin conocimiento musical suficiente | Crear tarea de evidencia/curaduría por pista o álbum |
| Correspondencia RYM demasiado amplia | Revisar término original y relación taxonómica, conservando decisiones previas |
| Resultado poco pertinente | Revisar evidencia, ámbito, ordenación y feedback; no subir popularidad para ocultar el problema |
| Timeout, proveedor, base, sobrecarga o cola | Incidente operativo con código, frecuencia, latencia y resolución |
| Captura duplicada, homónimo o extracción defectuosa | Corrección del lote/extractor y reprocesamiento acotado sin tocar aprobaciones humanas |

- Reutilizar las colas de curaduría existentes y sus IDs. El nuevo panel crea/enlaza tareas y abre el detalle correspondiente; no inventa una bandeja de decisiones paralela.
- Actualizar fuentes mediante sus mecanismos existentes y cuotas/cadencias aprobadas. Reprocesar por cambios de fuente/extractor/diccionario/modelo; publicar índices después de validar.
- Programar agregación, retención y revisión de fallos independientemente de la captura. Desactivar analítica no debe detener su purga; respaldos/exportaciones también necesitan caducidad.
- Mostrar heartbeat, último lote correcto, próximo programado, atraso, volumen, fallos, reintentos y elementos bloqueados. Distinguir sin datos de proceso detenido.
- Revisar patrones y ejemplos por lotes. Reentrenar únicamente tras cambios suficientes y revisión del dataset, sin aprendizaje automático por cada clic, consulta o aprobación.
- Comparar cada modelo/correspondencia nueva con producción usando conjunto reservado y modo sombra. La sombra no duplica búsquedas, feedback ni exposición pública.

### Despliegue y vigilancia

- Desplegar por compatibilidad: backend capaz de servir contratos existentes, instrumentación validada, índice/modelo preparados, frontend compatible y activación por banderas.
- Conservar las protecciones existentes y comprobar las que están en código frente a lo efectivamente publicado, incluida la exclusión de asociaciones Last.fm no verificadas.
- Preparar captura y jobs de retención antes de activar. Comprobar correlación y cobertura para evitar un tablero aparentemente vacío que en realidad no registra.
- Activación gradual, comparación por versiones/cohortes de exposición y posibilidad de apagar solo interpretación, sugerencias o recolección sin perder la búsqueda directa.
- Alarmas por subida de desconocidas/errores/vacíos, caída de registros, saturación, cola creciente, modelo o índice desactualizado, fuente detenida, tasa anormal de rechazo y tareas de retención fallidas. Definir umbrales con la línea base y volumen mínimo; pocas consultas no justifican una tendencia.
- El panel muestra latencia, error técnico, no interpretación y cobertura musical por separado. Los rankings o «tendencias en CRV» necesitan metodología/muestra y no se publican automáticamente por disponer de contadores.
- Reversión mediante bandera/modelo/índice anterior y decisiones auditadas. Evitar rollback completo del proyecto o borrado de evidencias como operación normal.
- Documentar manual operativo, recuperación, restauración probada, rutas/servicios y responsables. No fijar un calendario hasta medir volumen, revisión humana y entrenamiento.

### Entregables y salida

- [ ] Operación completa desde `Administrar → Buscador y descubrimiento`, con roles y continuidad de enlaces anteriores.
- [ ] Patrones y consultas problemáticas con acciones de revisión, agrupaciones corregibles y seguimiento de resolución.
- [ ] Actualizadores, agregación y purga comprobados tras reinicio, caída y reintento; sin procesos duplicados.
- [ ] Registro de qué fuente, regla o decisión alimentó cada cambio e índice, respetando siempre las decisiones de Brian.
- [ ] Mejora medida antes/después en conjunto comparable, sin inventar causalidad o popularidad a partir de exposición distinta.
- [ ] Despliegue controlado y reversión verificados; observabilidad operativa aun cuando falle el componente medido.

## Comprobaciones transversales de aceptación

| Caso | Resultado exigido |
| --- | --- |
| Nombre exacto de banda/dúo/solista | Entidad correcta y contador directo, conservando alias y navegación |
| «Estoy triste, ponme algo alegre» | Se busca carácter alegre; no se transforma en tristeza solicitada |
| «Parecido a 30 Seconds to Mars, para correr, sin gritos» | Referencia + actividad + exclusión conservadas; cada condición requiere evidencia propia |
| «Busca la canción Amor» | Título tratado como entidad, sin convertirlo en tema amor |
| Consulta incomprensible | Muestra sanitizada, causa, contador y bandeja; no resultado inventado |
| Intención clara sin canciones con respaldo | Cero resultados por cobertura, distinto de error o no interpretación |
| Laya falla y hay coincidencia directa | Coincidencia disponible, degradación explícita e incidente técnico observable |
| Caché y reintentos | Una búsqueda lógica y varios intentos trazables; contadores sin duplicación |
| Dos consultas con negación opuesta | Grupos semánticos distintos o relacionados con diferencia explícita |
| Autor cita otra reseña o corrige disco | Una cadena de evidencia o corrección; no falso consenso |
| Brian rechaza/corrige un atributo | Modelo/lote posterior no lo reactiva; contradicción a revisión |
| Cambia una pista/versión, hay fusión o deshacer | Identidad, evidencia, métricas históricas e índices mantienen su alcance |
| Se retira una sugerencia | No vuelve por caché/ticket antiguo; historia conservada |
| Cruce de medianoche/dispositivos | Selección común Caracas y series de métricas con corte/versiones explícitos |
| Falla el colector o la base | Búsqueda protegida, pérdidas/atraso visibles y recuperación acotada |
| Usuario administrador o tráfico automatizado | Tráfico separado/excluido según contrato; sin entrenar con pruebas como si fueran público |
| Se desactiva captura | La retención continúa y el tablero explica el estado |
| Nuevo modelo o dataset | Evaluación reservada, ficha y decisión de activación; sin despliegue por exportación automática |
| Una frase copiada aparece en varias cuentas/páginas | Cadena y revisiones conservadas; no aumenta artificialmente testigos independientes |
| Un rasgo gusta a una cuenta y disgusta a otra | Rasgo atribuido y preferencias separadas; las estrellas no deciden cuál descripción es verdadera |
| Una opinión relevante tiene un solo testigo | Indicio aislado visible y atribuible; no se borra por minoritario ni se presenta como consenso |
| «Ambient para dormir» sin evidencia de uso/adecuación | Intención reconocida; adecuación desconocida, sin completar actividad por género |
| Un reseñista relata un viaje en autobús | Escena o tema atribuido; no recomendación automática para conducir o viajar |
| Una reseña solo describe la pista de cierre | Evidencia limitada a esa pista/versión; no asignación de ese rasgo al disco completo |
| Falta una fuente del informe o se decide diferirla | Registro del anexo A con causa, etapa, prioridad y tarea; no omisión silenciosa |

## Anexo A — Matriz de aprovechamiento del informe y de los antecedentes

**Fuente base:** `reports/alimentar-laya-contexto-2026-10-16.md`, incluidos sus nueve bloques y su actualización editorial. Ante contradicciones, prevalecen las correcciones posteriores de Brian y los inventarios trazables. Las cifras y estados del informe son históricos; este anexo define qué comprobar y aprovechar, sin volver a certificar la base o las capturas hoy.

Las filas R01–R40 cubren los recursos del informe; R41–R44 conectan los antecedentes de esta conversación y el ciclo de mejora. R45–R46 registran fuentes capturadas después del informe (AOTY y fanzines), por decisión de Brian del 2026-10-25. **E1…E5** remiten a las cinco etapas. La columna de etapa indica inventario primero y uso posterior; ninguna fila obliga a desplegar una señal sin cobertura y validación.

### Registro y prioridades comunes

Cada fila tendrá un registro en **Alimentación/Conocimiento del espacio administrativo único**, enlazado a las tareas de curaduría actuales. Campos obligatorios: ID de recurso, ruta/tabla/captura y campo exactos, procedencia/canal, objeto y nivel, fecha/huella, volumen bruto/válido/único, identidad, cobertura, política, prioridad, responsable, estado, extracción pendiente, destino, validación, etapa, última actualización, tarea de revisión y evidencia de aceptación.

Estados distintos: disponible, parcial, pendiente de inventario, extraído, candidato, revisado, publicado, bloqueado, diferido o retirado. Las columnas operativas permiten representar más de una condición; «aplicado» en un informe antiguo no acredita «publicado y usable para esta intención». Una fila con recursos compuestos se desglosa por objeto/campo cuando sus estados difieran.

Prioridad inicial para planificación: **P0**, identidad, autoridad, retiro de ruido, compatibilidad y medición; **P1**, evidencia musical y lenguaje necesarios para consultas validadas; **P2**, enriquecimientos complementarios. El orden es dependencia, no calendario. Todo diferimiento requiere motivo y condición de reanudación; excluir ruido o una señal no pertinente también es un resultado documentado.

### A.1. RYM — bloque 1

| ID / recurso | Campos aprovechables | Uso concreto | Validación necesaria | Etapa / prioridad | Criterio de aceptación |
| --- | --- | --- | --- | --- | --- |
| R01 · Géneros de fichas | `rec.genres`, términos principales/secundarios, ID y captura; claims ya existentes | Mapa RYM–CRV y consulta por género/estilo conservando especificidad | Identidad de publicación, procedencia y relación exacta/especialización/parcial; decisión humana vigente | E1 → E2/E4; P1 | Cada término usado tiene original, relación versionada y alcance; no sustituye asignación humana ni borra subestilos |
| R02 · Descriptores comunitarios | `release_pri_descriptors`, literal, captura, nivel y posición solo como dato | Sinónimos y candidatos de faceta por álbum | Campo con contenido frente a solo presencia; 1.705/7.328 y 309 términos del inventario corregido como referencia; sin confianza por posición | E1 → E2/E3; P1 | Extracción reproducible y cada candidato con fuente; ninguna atribución a pista por herencia |
| R03 · Ratings y discografía de fichas de artista | `avg_rating`, votos, `disco_avg_rating`, `disco_ratings`, `disco_reviews` y fecha | Contexto de recepción y filtros explícitos que se aprueben | Escala, fecha, publicación resuelta y diferencia entre media, votos y número de reseñas; deduplicar snapshots | E1 → E2/E4; P2 | Población/fecha/escala visibles; no se usa nota como calidad objetiva, rasgo sonoro o verdad del texto |
| R04 · Reseñas y nota individual | ID, cuenta, fecha, título, texto completo, estrellas, utilidad, página y URL | Afirmaciones, patrones, opiniones y comparaciones para necesidades humanas | Protocolo de etapa 2 completo, recuperación desde HTML y alcance; 1.004 reseñas/145 páginas/39 publicaciones como corte histórico | E1 → E2/E3/E4; P1 | Cada hallazgo vuelve al fragmento y nota de su cuenta; disponibilidad, unicidad y dependencia documentadas |
| R05 · Notas por pista en reseñas | `reviews[].tracks`, título/número, nota, cuenta y escala | Distinguir preferencias por canción y evolución de recepción dentro del disco | Bloque del autor, pista/edición resuelta o pendiente; no confundir con tracklist global | E1 → E2/E4; P1 | Notas vinculadas a su objeto sin inventar atributos ni promediar con notas del álbum |
| R06 · Idiomas de publicación | `Languages`, literal, captura y alcance | Consulta de idioma y necesidades de comprensión | Idioma de obra frente a texto de reseña; idiomas mixtos y edición; no inferir traducción disponible | E1 → E2/E4; P1 | Condición de idioma respaldada en la unidad buscada; estado desconocido conservado |
| R07 · Bios, origen y actividad | Bios y capturas `Currently`, origen/formación, ciudad/país y fechas | Desambiguación, escena, geografía y período documentados | Residencia actual frente a origen; versión de bio sintetizada frente a evidencia original | E1 → E2/E4; P0 identidad / P2 facetas | Cada relación temporal/geográfica conserva sentido, fecha y fuente; no describe origen de cada canción por herencia |
| R08 · Discografía y tipos pendientes | `rows {h,t,y,ty}`, `rec.kind`, DJ Mix/Mixtape | Resolver publicaciones y habilitar categorías combinables aprobadas | Distinguir tipo de lanzamiento, característica y edición; pendientes requieren decisión expresa | E1 → E2/E4; P0 identidad / P2 filtros | No se reclasifica por cantidad de pistas; DJ Mix/Mixtape conservan pendiente hasta decisión |
| R09 · Pistas y créditos | `rec.tracks`, `rec.creditLinks`, persona/rol | Resolver canciones, participantes e instrumentos documentados | Créditos frente a percepción del reseñista; edición, alias, persona y rol exactos | E1 → E2/E4; P1 | IDs actuales reutilizados; rol acreditado trazable y sin extensión automática a todo el repertorio |
| R10 · Portadas, fotos y enlaces | `og`, imágenes, pendientes de carátula, enlaces RYM de escucha | Identificación y presentación del resultado, acceso a la obra | Entidad/edición y origen de imagen/enlace; disponibilidad separada del conocimiento musical | E1 → E2/E4/E5; P2 | No duplicar campañas ni entidades; imagen/enlace ausente no borra evidencia ni genera emociones |

### A.2. Last.fm — bloques 2 y 6

| ID / recurso | Campos aprovechables | Uso concreto | Validación necesaria | Etapa / prioridad | Criterio de aceptación |
| --- | --- | --- | --- | --- | --- |
| R11 · Tags de artista y clasificación anterior | `entity_user_tags`, término, `weight`, `emotions`, modelo y `emotion_tag_decisions` | Vocabulario, sinónimos y comparación con la ontología anterior | Identidad de página y pertinencia de cada asociación; tag/etiqueta del modelo/decisión humana separados | E1 → E2/E3; P0 confianza / P1 vocabulario | Los 1.750 términos sirven léxicamente; los 1.280 IDs históricos no se presentan como artistas verificados; predicciones no son gold |
| R12 · Tags de respuestas de álbum | `album.tags.tag[]`, objeto, captura y términos | Vocabulario al nivel álbum y facetas candidatas | Deduplicación e identidad artista–álbum–edición; corrección: 4.812 respuestas con tags y 1.125 términos, no álbumes únicos verificados | E1 → E2/E3; P1 | Inventario por respuesta/entidad/cobertura y asociaciones revisadas; no trasladar tag de artista a álbum/pista |
| R13 · Métricas Last.fm | `entity_metrics`, listeners/playcount por artista, álbum y pista, fecha | Contexto de popularidad de esa plataforma y filtros si se aprueban | Identidad, nivel, unidad, fecha y duplicados; volumen no acredita nacionalidad ni pertinencia | E1 → E2/E4/E5; P2 | Plataforma/población/fecha explícitas; no representa popularidad universal ni oculta requisitos de búsqueda |
| R14 · Similares de artista | `similar.artist[]`, origen/destino, orden/medida disponible y captura | Candidatos de afinidad y referencias «parecido a» | Identidad de ambos extremos, naturaleza comunitaria y dirección; similitud no es parentesco ni rasgo acústico probado | E1 → E2/E4; P1 | Relación con procedencia/aspecto conocido o desconocido y alcance; referencia externa no crea artista ficticio en CRV |
| R15 · Tracklists y bios | `album.tracks`, biografía y original/síntesis | Resolver repertorio y contexto documentado | Artista/álbum exactos, edición, duplicados y mezcla de homónimos | E1 → E2/E4; P0 identidad / P2 contexto | Captura no crea pistas o asociaciones por nombre coincidente; sintetizado conserva evidencia de origen |
| R16 · Shouts, cachés y agregados retirados | `+shoutbox`, cuarentenas de comentarios/emociones, `entity_shouts`, `entity_emotions` y vías de recarga | Control del retiro y prevención de reintroducción | Verificar exclusión en fuente, jobs, API, interfaz, cachés, datasets y despliegue; distinguir tablas vacías de protección efectivamente activa | E1 → E5; P0 | Sin uso como evidencia, vocabulario de este proyecto, entrenamiento o clasificación; conservar solo respaldo histórico excluido según política vigente |

### A.3. Identidad y APIs de metadatos — bloques 3, 4 y 5

| ID / recurso | Campos aprovechables | Uso concreto | Validación necesaria | Etapa / prioridad | Criterio de aceptación |
| --- | --- | --- | --- | --- | --- |
| R17 · MusicBrainz, identidad y relaciones | MBID, país/área, tipo de artista, vida, miembros/períodos/ciudad | Identidad estable, desambiguación y relaciones con tiempo | Reutilizar identidades/claims, resolver homónimos y distinguir banda/persona | E1 → E2/E4; P0 | Vínculos acreditados y períodos conservados; no emparejar únicamente por nombre o país |
| R18 · MusicBrainz, publicaciones y tags | Release-groups, primera edición, tipo, tags/géneros, `tagPolicy` e imports | Contraste de publicación y taxonomía por canal | Estado real de importación, autorizado/editorial/comunidad y objeto; no habilitar imports por figurar en el informe | E1 → E2/E4; P1 | Término, política y correspondencia revisados; sin reemplazar fecha de edición concreta por primera edición |
| R19 · Discogs, perfiles e identidad | `realname`, `profile`, `urls`, imágenes, IDs y enlaces sociales/escucha | Identidad, documentación y presentación | Perfil frente a release/persona, origen de imagen y vínculo exacto; decisiones previas | E1 → E2/E4; P0 identidad / P2 presentación | Reutilizar enlaces e identidades; biografía o foto no se convierte en atributo sonoro |
| R20 · Discogs, estilos y sellos | Géneros/estilos externos, imports `authorized`, `tagPolicy`, datos de release/sello | Mapa de estilos y filtro documental de sello | Cajones amplios frente a taxonomía CRV; «Latin» ignorado por decisión editorial y relaciones temporales | E1 → E2/E4; P1 | Política de Brian preservada y correspondencias parciales visibles; sello no implica sonido parecido |
| R21 · Spotify | Tracklist, `duration_ms`, `explicit`, `release_date`, copyright, portadas | Duración, explicitud, fecha/edición y presentación | Identidad artista–release–pista/versión, unidad de duración, cobertura y original del dato | E1 → E2/E4; P1 metadatos / P2 imágenes | No confundir duración real con duración percibida; explicitud no determina tema sexual ni idoneidad para actividad |
| R22 · Deezer | `genres.data[]`, `label`, `release_date`, UPC y portadas | Género de plataforma, sello, edición y enlaces de identidad | Taxonomía gruesa, UPC por edición y correspondencia de publicación | E1 → E2/E4; P1 | Metadatos por su nivel y mapa revisado; no trasladar género como emoción |
| R23 · iTunes | Género, imágenes y enlaces de álbum | Contraste de metadatos y presentación | Identidad de edición y correspondencia taxonómica; aprovechar campañas existentes | E1 → E2/E4; P2 | Género identificado como de plataforma; ninguna imagen implica clasificación |
| R24 · TheAudioDB | Estilo, sello, formación, país y bios ES/EN | Contexto, identidad y candidato taxonómico | Campo disponible frente a ausente, fecha/objeto y fuente de bio | E1 → E2/E4; P2 | Solo se usan campos efectivamente presentes y documentados; no rellenar por similitud de nombres |
| R25 · Wikidata | Identificadores externos e imágenes | Cruce de identidad y presentación | ID exacto, entidad/rol y fuente de imagen | E1 → E2/E4; P0 identidad / P2 imágenes | No tratar este lote como fuente de género tipado que no contiene |
| R26 · Wikipedia ES/EN | Biografía original, idioma, captura y síntesis ya aplicada | Contexto histórico/geográfico y candidatos de evidencia | Página, revisión/captura, referencias y diferencias entre idiomas; síntesis no es testigo independiente | E1 → E2/E3/E4; P2 | Cada afirmación relevante conserva fuente/alcance; texto biográfico no hereda rasgos a todo el catálogo |

### A.4. Webs, archivos y audiovisuales — bloque 7

| ID / recurso | Campos aprovechables | Uso concreto | Validación necesaria | Etapa / prioridad | Criterio de aceptación |
| --- | --- | --- | --- | --- | --- |
| R27 · Musicavenezuela.com | Bios, géneros, álbum/tipo/año/sello, letras, créditos Letra/Música, fotos y videos | Tema lírico, autoría, documentación e identidad | Texto de letra frente a comentario, versión, autor/intérprete y audiovisual separado | E1 → E2/E3/E4; P1 | Tema sustentado por fragmento/objeto; una letra sobre sexo no acredita adecuación íntima |
| R28 · Aqustico | Canción/duración/featurings, discos/tipos, géneros por canción, 232 playlists y 14.988 pares de similitud del corte | Evidencia al nivel pista, contexto curatorial y afinidad | Identidad y semántica de relación/playlist; no heredar idoneidad solo por título de lista | E1 → E2/E4/E5; P1 | Pistas actuales enlazadas sin duplicación; parecido y contexto con fuente y criterio revisados |
| R29 · Metal Archives VE | Banda/género, discos/sello/fecha/formato, pistas/duración, lineup y personas | Identidad, instrumentos acreditados, estilo, época y edición | Persona/banda/rol, publicación y mapa del vocabulario de la fuente | E1 → E2/E4; P0 identidad / P1 evidencia | Créditos y género con alcance; formato/lineup no asignan características a canciones no documentadas |
| R30 · Sincopa y extra | Claims de tracklists, géneros, sellos y encabezados históricos | Repertorio, taxonomía y contexto documental | Relación con claims ya importados y procedencia original; evitar doble conteo | E1 → E2/E4; P1 | Documento y claim derivados comparten cadena; no se suman como dos corroboraciones |
| R31 · Blogs y feeds | Posts, título/categorías, HTML, bios y fotos de rockdevzla, lobotoradio, hippito, RHV, rockzuela, coleccionistas WP y descargas-metal, con inventario de los ocho feeds reales | Lenguaje humano, prensa, comparaciones y contexto de escena | Inventariar los feeds efectivos, autor/fecha, republicaciones, citas y alcance del post | E1 → E2/E3/E4; P1 texto / P2 fotos | Afirmaciones trazables; una categoría del blog no se convierte automáticamente en género del álbum |
| R32 · Fotos de blogs y menciones | Imagen, `mentions.jsonl`, artista y página de origen | Identificación y presentación con procedencia | Homónimos, persona fotografiada y relación con publicación | E1 → E2/E4; P2 | Foto y mención conservan fuente; no producen emoción, género ni parecido musical |
| R33 · Venciclopedia | Artículo y wikitexto, ID/captura | Contexto histórico e identidad | Páginas con contenido efectivo, referencias y edición | E1 → E2/E3/E4; P2 | Disponibilidad real y afirmación documentadas, sin contar artículo vacío como evidencia |
| R34 · Bandcamp | Perfiles/labels, ubicación y catálogo | Identidad, sello y contexto editorial de publicación | Artista frente a sello; página propia frente a inferencia; ubicación de qué objeto y fecha | E1 → E2/E4/E5; P1 | Vínculos y alcance documentados; ubicación de sello no se convierte en origen del artista |
| R35 · MySpace | Perfil, artista e imágenes | Identidad y contexto histórico | Captura histórica, homónimo, enlaces y vigencia | E1 → E2/E4; P2 | Distinguir estado histórico de disponibilidad actual; no suponer continuidad de proyecto |
| R36 · SoundCloud | Perfil y set por disco, enlaces verificados del lote | Acceso y resolución de repertorio | Mantener evidencia de verificación, entidad/versión y disponibilidad | E1 → E2/E4/E5; P2 | Reutilizar enlaces aplicados; enlace caído no borra obra ni prueba ausencia de música |
| R37 · YouTube y datos aplicados | Videos, descripciones, secciones, créditos, `media.youtube_*`, `media.video_*`, marcas, video–álbum y audiovisuales | Documentación, reproducción de pista existente y acceso audiovisual | Video concreto/CD/lado, cero válido, alias exacto, duración y objeto; respetar excepción Gasolina–Blues Criollo | E1 → E2/E4/E5; P1 | No crear discos/pistas por video o capítulos; ambiguos sin asignar, marcas fuera de duración a revisión |
| R38 · Prensa escaneada | `media_links` tipo `scan`, imagen/documento, página, fecha y procedencia | Créditos, historia, géneros y contexto documentados | Transcripción/OCR frente a original, alcance y legibilidad; si no hay texto, trabajo pendiente | E1 → E2/E3/E4; P1 evidencia / P2 extracción | Cada afirmación vuelve a página/fragmento; OCR dudoso se revisa antes de entrar a texto de Laya |

### A.5. Audio y contenido propio — bloque 8

| ID / recurso | Campos aprovechables | Uso concreto | Validación necesaria | Etapa / prioridad | Criterio de aceptación |
| --- | --- | --- | --- | --- | --- |
| R39 · Audio y assets propios | `/mnt/1tb/Shared/crv-ic`, `tracks`, `demos`, `song_covers`, `onerpm`, `livewire-tmp`, `aqustico-assets` y explorer existente | Contrastar duración/versión, preservar portadas y preparar escucha humana específica | Archivo exacto, master/demo/preview, relación con pista/edición, huella y acceso; no exponer rutas privadas | E1 → E2/E4; P1 verificación / P2 enriquecimiento | No inferir obra completa desde preview ni convertir Laya textual en analizador de audio; cualquier medición de audio tendrá método y revisión propios |
| R40 · Migración y ledger propio | Ledger de artistas, álbumes, sellos y géneros, rutas y relaciones de `migracion` | Resolver procedencia, identidad y correspondencias históricas | IDs actuales frente a legados, duplicados, versión y vínculo con archivos | E1 → E2/E5; P0 identidad | Migración no crea un segundo catálogo ni revive decisiones retiradas; cada enlace es auditable |

El resumen del bloque 9 del informe se distribuye entre R02, R12, R16, R04, R03, R14/R28 y R06/R08/R20/R22. Su prioridad antigua de aplicar shouts está anulada por Brian; tampoco se adopta el umbral por posición de descriptores ni la equivalencia rating = calidad objetiva.

### A.6. Ontología, piloto, legado y observación de búsquedas

| ID / recurso | Campos aprovechables | Uso concreto | Validación necesaria | Etapa / prioridad | Criterio de aceptación |
| --- | --- | --- | --- | --- | --- |
| R41 · Ontología y diccionario existentes | Diez contextos, seis categorías emocionales amplias, 64 conceptos propuestos, sinónimos ES, géneros/alias/descripciones, `artists.themes` y glosario EN–ES | Reutilizar, precisar y proponer con seis ejes separados y facetas adicionales | Clasificación de cada término, ambigüedades y estado de propuesta; preservar slugs/decisiones y no heredar temas de artista a pistas | E1 → E2/E3/E4; P1 | Tabla de reutilización/novedad y diccionario versionado; 133 consultas conservadas como especificación, no desempeño probado |
| R42 · Piloto RYM y evidencia | 42 hallazgos, testigos, 22 familias, método, 56 consultas, inventarios/huellas y siete álbumes estudiados | Semilla del protocolo, comparación y desarrollo del vocabulario | Limitaciones de selección, independencia y anotación de un analista; reserva de álbumes nuevos | E1 → E2/E3; P1 | IDs, citas y alcance conservados; ninguna de las 22 familias se activa sin decisión; no afirmar saturación ni validación musical general |
| R43 · Descubrimiento previo | Plan/handoff de octubre, sugerencias, métricas, contextos por pista, recomendaciones/feedback, auditoría y administración | Unificación de contratos, pantallas, decisiones, jobs y seguimiento | Inventario técnico/desplegado/activo/con datos; compatibilidad de IDs, tickets y significado de métricas | E1 → E4/E5; P0 | Una operación y una cola de decisiones por caso, con continuidad de enlaces y sin duplicación de índices/paneles equivalentes |
| R44 · Consultas observadas y patrones | `search_misses`, eventos de sugerencias y nuevo contrato de búsquedas confirmadas, errores, desconocidas y vacías | Diagnóstico, contadores y candidatos revisables de sinónimos/dataset/evidencia | Sanitización, correlación/idempotencia, versión, denominador, retención, exclusiones y grupos con restricciones conservadas | E1 → E3/E4/E5; P0 | Contadores fiables y acciones desde el mismo espacio; frecuencia/clic/error no crean por sí solos etiquetas ni entrenamiento |

### A.7. Fuentes posteriores al informe

| ID / recurso | Campos aprovechables | Uso concreto | Validación necesaria | Etapa / prioridad | Criterio de aceptación |
| --- | --- | --- | --- | --- | --- |
| R45 · AOTY, reseñas y notas | `user_reviews_all.jsonl` (cuenta, nota 0–100, fecha relativa, likes, texto), `critic_reviews.csv` (medio, autor, nota, extracto, enlace), `ratings_all.jsonl` e `histograms.jsonl` | Procedencia de reseñas separada de RYM: afirmaciones, patrones de recepción y vocabulario en inglés, español y portugués; extractos de crítica citados | Cruce álbum AOTY–publicación CRV por identidad, no solo por nombre; fecha relativa reconstruida desde la captura y marcada aproximada; escala 0–100 distinta de RYM; extracto frente a crítica completa; concentración en Arca (~75 %) | E2 → E2/E3/E4; P1 texto / P2 notas | Cada hallazgo vuelve a reseña y cuenta AOTY; no se suma a RYM como corroboración independiente; extracto conserva medio, autor y enlace; nota no es calidad objetiva |
| R46 · Fanzines de punkenvenezuela (OCR) | `corpus.jsonl` (texto OCR por documento y página, método, calidad), `matches.jsonl` (menciones con contexto y fuerza) y documento original | Vocabulario venezolano de escena, temática y contexto histórico; menciones documentadas de artistas y discos | OCR frente a página original y páginas de calidad baja; homónimos y menciones débiles; fecha y número del fanzine; opinión frente a dato | E2 → E2/E3/E4; P1 vocabulario / P2 evidencia | Cada afirmación vuelve a documento, página y fragmento; OCR dudoso se revisa antes de entrar a texto de Laya; una mención débil no vincula artista ni cuenta como cobertura musical |

## Anexo B — Acuerdos de la conversación y comprobación de cobertura

Esta matriz define lo que una ejecución deberá demostrar. La cobertura de un requisito en el documento no lo marca como implementado ni aprobado musicalmente.

| Acuerdo de Brian | Dónde se desarrolla | Comprobación exigida |
| --- | --- | --- |
| Retirar primero `+shoutbox` y desconfiar de homónimos | Reglas 5–6; E1/E5; R11–R16 | Protección real comprobada en datos/servicios desplegados; fuentes retiradas fuera de ingestión, datasets y resultados |
| Aprovechar el informe completo de recursos | E1/E2; anexo A, R01–R40 | Cada bloque y campo útil tiene registro, destino y aceptación o diferimiento motivado |
| Separar seis dimensiones, con sinónimos españoles y reglas múltiples | E1/E2/E3; R41; protocolo 6 | Reutilización/novedad explícita, AND/OR/negación/preferencia/alcance y vocabulario venezolano evaluados |
| Analizar reseñas realmente capturadas de álbumes diversos y multipágina | E2, protocolo 1; R04/R42 | Manifiesto de páginas útiles, identidad, muestra/IDs y sesgos documentados |
| Vincular tags, conocimiento del género, texto y nota de cada cuenta, conservándolos por separado | E2, protocolo 2–3; R01–R05 | Cuatro procedencias trazables; ratings individuales, por pista y medios sin intercambio de significado |
| Encontrar necesidades humanas y patrones entre reseñistas | E2, protocolo 4–7 | Hallazgos con citas, alcance, alternativas, testigos y consultas; coincidencias/desacuerdos/minorías visibles |
| Usar y ampliar los 42 hallazgos, 22 familias, método y 56 consultas | E2/E3; R42 | Revisión de cada antecedente y validación en obras reservadas; no activación automática ni test final contaminado |
| Mapa de características por género y estilo y normalización RYM–CRV | E2; R01/R18/R20/R29/R41 | Rasgo definitorio/frecuente/variable, excepciones y correspondencia versionada con términos de origen conservados |
| Espacio propio para cada canción y evidencia limitada al objeto mencionado | E2/E4; R05/R09/R21/R28 | IDs de pista existentes reutilizados y versiones/ediciones resueltas; sin trasladar rasgo de una pista al disco |
| Comparaciones como «parecido a 30 Seconds to Mars» | E2/E4; R14/R28; protocolo 4/6 | Referencia, aspecto y dirección interpretados; candidato respaldado y referencia externa permitida sin alta ficticia |
| Buscador sólido para directa, emocional y contextual con sugerencias adaptadas | E3/E4 | Una consulta combinada conserva requisitos, exclusiones y referencias; sugerencias elegibles con cobertura |
| Mantener UI, mejorar UX, rapidez y seguridad | E4 | Continuidad visual/navegación/accesibilidad, latencias medidas y validación de permisos/entradas/fallos |
| Dar a Laya su papel y prepararlo con fine-tuning | E3/E4 | Tareas tipadas separadas, datasets revisados, evaluación/calibración y artefactos reproducibles; no memorizar catálogo como sustituto de recuperación |
| Mantener lo que Brian indica por encima del modelo | Reglas 1–2; E1/E3/E5 | Una predicción o lote contradictorio no sobrescribe ni reactiva una decisión humana; historial y revisión atribuibles |
| Guardar desconocidas, similares, directas, errores y búsquedas vacías | E1/E4/E5; R44 | Eventos confirmados y contadores distintos sin duplicación; muestras útiles sanitizadas y agrupaciones corregibles |
| Unificar algo similar creado anteriormente y seguir alimentándolo | Punto de partida; E1/E2/E5; R43 | Reutilización de IDs/contratos/colas/jobs y cadena incremental reanudable, sin decisiones duplicadas |
| Un único espacio en el menú de administradores existente | E1/E5 | `Administrar → Buscador y descubrimiento` concentra lecturas y tareas relacionadas, con continuidad de URLs previas |
| Plan de cinco etapas en el escritorio; sin implementar todavía | Encabezado y E1–E5 | Este documento contiene cinco etapas; entrega limitada a documentación y todas las ejecuciones siguen pendientes |

## Historial de versiones del plan

| Versión | Fecha | Cambio |
| --- | --- | --- |
| `1.0.0` | 2026-10-17 | Plan inicial en cinco etapas: unificación, observabilidad, conocimiento, Laya, UX y operación |
| `1.1.0` | 2026-10-17 | Completa trazabilidad de recursos y acuerdos; incorpora protocolo de reseñas, contradicciones/minorías/suficiencia y sus comprobaciones de salida, manteniendo las cinco etapas |

## Referencias y trazabilidad del plan

### Documentos anteriores del escritorio

- [Plan de descubrimiento 2026-10-10](CRV_PLAN_DESCUBRIMIENTO_2026-10-10.md).
- [Handoff de descubrimiento 2026-10-10](CRV_HANDOFF_DESCUBRIMIENTO_2026-10-10.md): implementación y límites de las cuatro fases previas.
- [Plan Last.fm 2026-10-16](PLAN_LASTFM_METRICAS_EMOCIONES_2026-10-16.md): conservar como histórico. Las instrucciones posteriores de Brian retiran shouts y condicionan asociaciones a identidad; este plan no reautoriza lo retirado.

### Recursos del repositorio

- [Informe de recursos con correcciones](</home/brian/apps/Coleccionistas De Rock Venezolano/reports/alimentar-laya-contexto-2026-10-16.md>).
- [Diccionario de intenciones 0.1.0](</home/brian/apps/Coleccionistas De Rock Venezolano/docs/INTENCIONES_HUMANAS_0.1.0.md>) y [matriz de 133 consultas](</home/brian/apps/Coleccionistas De Rock Venezolano/reports/intenciones-humanas/v0.1.0/matriz-consultas.md>).
- [Piloto RYM](</home/brian/apps/Coleccionistas De Rock Venezolano/reports/rym-reviews-piloto/v0.1.0/INFORME.md>), [22 familias de facetas](</home/brian/apps/Coleccionistas De Rock Venezolano/reports/rym-reviews-piloto/v0.1.0/FACETAS_PROPUESTAS.md>), [método](</home/brian/apps/Coleccionistas De Rock Venezolano/reports/rym-reviews-piloto/v0.1.0/METODO.md>) y [56 consultas](</home/brian/apps/Coleccionistas De Rock Venezolano/reports/rym-reviews-piloto/v0.1.0/CONSULTAS_PRUEBA.md>).
- [Sugerencias existentes](</home/brian/apps/Coleccionistas De Rock Venezolano/docs/DISCOVERY_PHASE_1.md>), [métricas existentes](</home/brian/apps/Coleccionistas De Rock Venezolano/docs/DISCOVERY_PHASE_2.md>), [contextos por pista](</home/brian/apps/Coleccionistas De Rock Venezolano/docs/DISCOVERY_PHASE_3.md>) y [recomendaciones](</home/brian/apps/Coleccionistas De Rock Venezolano/docs/DISCOVERY_PHASE_4.md>).
- [Día editorial común](</home/brian/apps/Coleccionistas De Rock Venezolano/docs/DAILY_CYCLE.md>), [menú administrativo actual](</home/brian/apps/Coleccionistas De Rock Venezolano/web/src/components/AdminNavigation.tsx>) y [consultas sin resultados actuales](</home/brian/apps/Coleccionistas De Rock Venezolano/src/api/search-misses.ts>).
- [Laya: decisiones estructuradas](https://nandhakishorm.github.io/laya/structured/) y [ejemplo oficial de fine-tuning](https://github.com/NandhaKishorM/laya/blob/main/notebooks/laya_finetune_typed_decisions_2xT4_kaggle.ipynb). Referencias técnicas; versiones/compatibilidad se fijarán al implementar, sin copiar condiciones de otro dominio como resultados de CRV.

## Estado de esta entrega documental

Se creó este archivo en el escritorio y se actualizó a 1.1.0 a petición de Brian. Para esta revisión se contrastaron el plan, el informe completo de recursos, el diccionario y el método/facetas del piloto. Se verificaron estructura, enlaces locales y cobertura documental. No se modificaron los planes antiguos, el repositorio, la base de datos, los servicios, las banderas, el menú ni los modelos. Las cinco etapas de implementación permanecen pendientes.
