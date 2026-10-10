# Evaluación integral de Coleccionistas de Rock Venezolano

Fecha: 10 de octubre de 2026. Casos principales: Jeremías, Apache, La Banana Voladora y Caramelos de Cianuro.

**Evaluación global: 12/20.** El catálogo, las relaciones, la búsqueda y el motor de cambios auditados están bastante desarrollados. La experiencia de investigar una ficha, aprovechar toda la información encontrada, preparar cambios coherentes y terminar su enriquecimiento todavía presenta bloqueos importantes. Para ese objetivo específico —el que motivó esta revisión— la valoración es **8/20**.

Se observaron problemas reproducibles en las propuestas, la conservación de citas durante su preparación, las imágenes, el modelo de fechas, la claridad de los puntajes, la navegación administrativa y la integridad histórica. Una interfaz visualmente consistente y cientos de pruebas aprobadas no compensan esos bloqueos del recorrido principal.

## 1. Método y límites de la evaluación

Se revisaron la aplicación en navegador, las rutas y componentes, el modelo de datos, la investigación y planificación con IA, el motor de curaduría, las operaciones de catálogo, la trazabilidad, las pruebas y los procedimientos operativos.

La evidencia incluye 66 registros en la pasada inicial de navegador y 25 capturas/mediciones adicionales; estas últimas completan cargas que la primera pasada había capturado prematuramente. Se probaron escritorio de 1440 px, móvil de 390 px y fichas públicas a 320 px. Se ejecutó axe 4.10.3 para criterios WCAG A/AA, y se comprobaron búsqueda, navegación entre pestañas, foco de modal, Escape, retorno del foco, apertura de propuestas guardadas, un enlace de pista y recuperación de un error controlado.

La web examinada fue el bundle publicado en `http://127.0.0.1:3120/crv/`. Las vistas públicas consultaron la API publicada. Para examinar administración sin disponer de credenciales, se simuló exclusivamente la sesión administrativa del navegador y se usaron las rutas Fastify actuales mediante `app.inject`, con la base real configurada en **solo lectura**. Se suprimió la recuperación de trabajos al arrancar ese proceso aislado para evitar interferir con trabajos reales. Todas las escrituras del navegador quedaron bloqueadas. Las pruebas de escritura y reversibilidad usaron PostgreSQL desechable.

**No se modificaron fichas, no se ejecutaron nuevas investigaciones de pago y no se desplegaron correcciones durante esta auditoría.** Se consultaron investigaciones y propuestas ya existentes y se reprodujo la preparación de su contexto, que ocurre antes de llamar al modelo. La evidencia biográfica procede del catálogo y sus informes guardados; esta auditoría no certifica de nuevo la verdad histórica de cada afirmación consultando todas sus fuentes externas.

La evaluación de UX combina observación real en navegador y juicio experto. **No es una prueba con usuarios humanos**, ni permite afirmar tasas de éxito, tiempos de aprendizaje o satisfacción. Tampoco es una prueba de penetración o de carga distribuida. Las funciones no accionadas en producción se contrastaron mediante código y contratos, y se señalan como tales.

El workspace contenía numerosos cambios previos y cambios concurrentes. La base real tenía migraciones hasta `0052`; el código y los contratos incluyen `0053`. Se distingue deliberadamente lo publicado de lo que está en desarrollo. Los puntajes son criterios de evaluación, no probabilidades ni métricas estadísticas.

Evidencia: [carpeta de auditoría](ui-qa/auditoria-integral-2026-10-10/), [navegador inicial](ui-qa/auditoria-integral-2026-10-10/browser-evidence.json), [pasada adicional](ui-qa/auditoria-integral-2026-10-10/supplemental-evidence.json), [interacciones focalizadas](ui-qa/auditoria-integral-2026-10-10/focused-browser-evidence.json), [datos consultados](ui-qa/auditoria-integral-2026-10-10/data-evidence.json), [contexto y citas](ui-qa/auditoria-integral-2026-10-10/context-evidence.json).

## 2. Puntajes por funcionalidad

Escala: 1–4, inviable o muy incompleto; 5–8, fallos importantes del objetivo; 9–12, utilizable con intervención frecuente; 13–16, sólido con carencias concretas; 17–19, completo y bien comprobado; 20, excepcional y validado sostenidamente. La media simple de estas 29 dimensiones es 11,93, redondeada a **12/20**. El promedio no elimina los bloqueos críticos particulares.

| Dimensión | /20 | Evaluación |
|---|---:|---|
| Modelo del catálogo | 16 | Entidades y relaciones ricas; faltan precisión de fechas y separación clara de obra/edición/soporte. |
| Crear, editar y retirar fichas | 16 | Validación, transacciones y auditoría; formularios extensos y operaciones dispersas. |
| Búsqueda, alias y filtros | 17 | Los cuatro casos se encuentran; navegación contextual útil. El límite de resultados no ofrece suficiente continuidad. |
| Membresías, créditos y vínculos | 15 | Modelo y controles completos; períodos poco poblados y revisión pesada. |
| Fusiones, divisiones y conversiones | 16 | Previsualización, comprobación de estado, conservación y deshacer. El motor necesita mejor evidencia editorial de identidad/edición. |
| Géneros de artista y disco | 14 | Taxonomía y proyección desde discos; roles editoriales y evidencia pueden confundirse con hechos de fuente. |
| Investigación y lectura de fuentes | 11 | Guardado, citas y lectura por fragmentos; restricciones del lector y resultados históricos de versiones anteriores. |
| Verificación individual y comparación | 10 | Informes y comparación existen; puntaje no mide cobertura y organizaciones quedan fuera. |
| Aprovechamiento de información adicional | 6 | Los datos se guardan como sugerencias, pero su transformación en cambios pierde contexto y evidencia. |
| Propuestas con IA | 7 | Hay operaciones aplicables y revisables; bloqueo de contexto y planes vacíos/contradictorios. |
| Validación documental de propuestas | 8 | Una cita válida puede respaldar solo una parte de una operación; prueba sintética demuestra aceptación demasiado amplia. |
| Extracción y envío de imágenes | 11 | 65 candidatas abiertas en curaduría; no cubre uniformemente informes anteriores ni todas las entidades. |
| Calidad y clasificación de imágenes | 8 | Resolución declarada visible; portada en cola de retratos, variantes repetidas y URLs fallidas seleccionables. |
| Detectores y categorías de curaduría | 12 | Motor extenso y análisis dirigido; precisión desigual, ruido histórico y demasiadas categorías al mismo nivel. |
| Autocorrección | 9 | Lista blanca y límites; algunas acciones confunden integridad estructural con corrección histórica. Está desactivada por defecto. |
| Historial y deshacer | 14 | Arquitectura fuerte y contratos aprobados; existen cambios fuera de runs y cobertura histórica incompleta. |
| Interfaz pública | 16 | Identidad visual consistente, lectura clara, estados de carga y navegación; fichas incompletas ocupan mucho espacio. |
| UX administrativa y carga cognitiva | 9 | Muchos puntos de entrada y decisiones fragmentadas; el usuario debe reconstruir el flujo entre módulos. |
| Adaptación móvil | 12 | Navegación y fichas generalmente adaptadas; desbordamiento real de galería y recorridos largos. |
| Accesibilidad | 11 | Buen comportamiento de pestañas y modal comprobado; fallos de contraste reproducidos. |
| Rendimiento | 15 | División de código, búsqueda y análisis dirigido; medición local, sin demostración bajo carga real o red lenta. |
| Errores y recuperación de trabajos | 11 | Error recuperable con reintento probado; reinicios y recuperación de trabajos requieren mejor continuidad. |
| Autenticación y permisos | 15 | Roles, sesión, CSRF y limitación de login; sesiones en memoria y operación dependiente de un proceso. |
| Pruebas y control de regresiones | 10 | Suite amplia; primera pasada con fallos, lint rojo y ausencia de navegador/accesibilidad en CI. |
| Despliegue, respaldo y recuperación | 12 | Scripts y comprobaciones existen; respaldo no incluye medios localizados y publicación no es atómica. |
| Procedencia e integridad histórica | 10 | Claims, fuentes y diario; `doctor` detecta filas/auditorías/identidades externas incompletas. |
| Métricas y observabilidad | 11 | Resumen operativo y consumo de IA; falta medir conversión de hechos investigados en datos útiles y calidad de extracción. |
| Descubrimiento musical | 12 | Sugerencias editoriales existentes; métricas nuevas son prototipo interno, aún no migrado en la base real. |
| Documentación y operación cotidiana | 12 | Documentación abundante; versiones y capacidades publicadas/desarrolladas necesitan distinguirse mejor. |

## 3. Los cuatro casos reales

Los números siguientes describen las fichas almacenadas durante la consulta. Un disco sin pistas o portada significa que ese dato falta en el catálogo, no que no exista una fuente que lo documente.

| Caso | Ficha | Discos | Sin pistas | Sin portada | Investigación guardada | Preparación actual de propuestas |
|---|---:|---:|---:|---:|---|---|
| Jeremías | artista 6912; persona 15368 | 3 | 3 | 3 | 232 referencias, 200 fragmentos procesados, 409 sugerencias | Bloqueada por presupuesto de contexto; también fallan tres peticiones concretas probadas. |
| Apache | artista 1681 | 19 | 15 | 16 | 98 referencias, 190 unidades, 10 sugerencias | 31 pendientes; 26 quedan sin citas tras el recorte. |
| La Banana Voladora | artista 1212 | 2 | 0 | 0 | 30 referencias, 206 unidades, 13 sugerencias | 27 pendientes; 26 quedan sin citas tras el recorte. Hay un lote aplicado correctamente. |
| Caramelos de Cianuro | artista 58 | 32 | 1 | 9 | 108 referencias, 743 unidades, 19 sugerencias | 55 pendientes; 54 quedan sin citas tras el recorte. Un plan promete un cambio que no contiene. |

Valoración de preparación para completar cada ficha mediante el recorrido observado: **Jeremías 7/20, Apache 10/20, La Banana Voladora 14/20, Caramelos 11/20**. Son juicios sobre el funcionamiento y el estado de los datos, no una valoración del artista ni una certificación de su discografía.

### Jeremías

El informe más reciente, de reglas v6, indica que se procesaron 40 unidades de ficha y 200 fragmentos de fuentes. Esto demuestra que la versión actual sí tiene un recorrido de lectura mucho mayor que una consulta superficial. Sin embargo, los resultados no llegan bien al siguiente paso.

Hay 409 sugerencias adicionales: 108 de imágenes, 72 de biografía, 66 de discografía, 50 de pistas, 28 de discos faltantes, 23 de géneros, 22 de redes, 21 de sellos, 10 de identidad y 9 de estado. La cola administrativa reúne esas sugerencias y 21 faltantes: **430 elementos, a 12 por página, 36 páginas**. No son 430 mejoras ya validadas; requieren identificación, agrupación y contraste.

Se reprodujo el error «El contexto excede el presupuesto. Selecciona un disco o una tarea más concreta» al preparar una revisión general y al seleccionar `suggested.0`, `suggested.215` y `tracks.27694.empty`. La instrucción específica no evita que el sistema arrastre todos los pendientes. Es un bloqueo real del recorrido antes de consultar la IA.

Los tres álbumes tienen cero pistas y ninguna portada aplicada. Sí existen **19 fotos candidatas y 46 candidatas de portada**, repartidas entre esos tres discos, abiertas en curaduría. La extracción ha producido resultados; su revisión, clasificación y aplicación siguen incompletas.

La persona asociada ya tiene imagen local. Su biografía contiene una fecha exacta de nacimiento, pero `birth_date`, `birth_city` y `nationality` están vacíos. La ficha de artista tampoco tiene foto aplicada. El sistema almacena información narrativa y vinculada, pero no la transforma de forma consistente en datos estructurados y propuestas de reutilización.

Los planes guardados 18, 16 y 15 tienen cero operaciones. Algunos conservan instrucciones antiguas restrictivas. El generador actual ya invita a aprovechar información adicional: no corresponde atribuir esas instrucciones guardadas al prompt vigente. Falta identificar versiones y contexto de los planes para que un plan vacío anterior no parezca el resultado del sistema actual.

### Apache

La búsqueda identifica al artista y su contexto. Existen propuestas de seis operaciones, por lo que no todo el recorrido de IA está inoperante. Aun así, la ficha tiene 15 de 19 discos sin pistas y 16 sin portada.

El contexto de planificación queda en 36.969 caracteres y seis evidencias. De 31 pendientes, solo cinco conservan citas enlazadas. La reducción mantiene el nombre de los problemas, pero quita el respaldo necesario para resolverlos.

### La Banana Voladora

Es el ejemplo más favorable de los cuatro: dos álbumes con pistas y portadas. El plan 5 aplicó cuatro operaciones en el run 18942: dos fusiones y dos correcciones de roles. Su comprobación dirigida cerró dos conflictos de alias y no encontró problemas nuevos provocados por ese lote.

La descripción actual distingue el debut de 1994 y el segundo álbum de 1997. Una descripción histórica previa que llamaba al debut «único álbum» no se contabiliza como defecto vigente: fue contrastada con el estado actual y ya no está presente.

Quedan dudas documentales explícitas, incluida una pista adicional y períodos de membresías. Eso es preferible a borrar información para hacer coincidir el catálogo con una sola fuente. El problema pendiente está en la siguiente planificación: de 27 tareas, 26 pierden sus citas al reducir el contexto.

### Caramelos de Cianuro

La ficha presenta buena navegación, discografía extensa y propuestas útiles de géneros. Hay 32 discos, uno sin pistas y nueve sin portada. Los informes anteriores a v6 se marcan desactualizados en la lectura actual; sus porcentajes históricos no deben compararse directamente con el de Jeremías.

Se reprodujo en navegador la contradicción del plan 11: el resumen dice que se propone añadir la pertenencia de Alejandro Viloria, pero `operations` y `unresolved` están vacíos. La UI muestra «Sin cambios preparados» y no ofrece ninguna acción para ese cambio anunciado.

También existen fichas con títulos cercanos y diferencias de soporte o repertorio, como `Flor De Fuego` y `Flor De Fuego (CD/DVD)`. Esto exige comparación de edición y contenido; la semejanza del título no autoriza fusionarlas. El estado estructurado «Desconocido» y períodos incompletos contrastan con una biografía narrativa extensa.

## 4. Hallazgos prioritarios y cómo comprobar su corrección

P1 significa bloqueo importante o riesgo de exactitud/integridad; P2, defecto relevante de uso u operación; P3, mejora. No se encontró evidencia suficiente para declarar una caída general o corrupción activa que justifique P0.

### P1 — A. Preparar una propuesta falla cuando la investigación es rica

**Confirmado por ejecución.** `src/curation/ai/context.ts:305` incorpora todos los pendientes incluso cuando se ha seleccionado uno. A partir de la línea 383 intenta reducir otras partes, pero conserva una lista que puede exceder el presupuesto; en la línea 429 termina lanzando el error. El caso de Jeremías falla en las cuatro peticiones probadas.

Corrección necesaria: trabajo por lotes con estado persistente. Una petición amplia debe poder procesar varios lotes y acumular sus propuestas; una petición específica debe cargar su hallazgo, su entidad, sus citas y las dependencias necesarias. Nada debería desaparecer porque no cupo en una llamada. La información restante queda pendiente recuperable.

Aceptación: las cuatro peticiones reproducidas terminan sin ese error, cada hecho queda aplicado, propuesto, en conflicto, considerado ya presente o pendiente con motivo, y no exige al usuario trocear manualmente el informe.

### P1 — B. El recorte conserva pendientes y elimina sus citas

**Confirmado por ejecución.** `context.ts:395–417` recorta evidencias a 12, después seis y hasta una; `context.ts:433` elimina de cada pendiente los IDs que dejaron de existir. Apache pierde citas en 26/31 pendientes, La Banana en 26/27 y Caramelos en 54/55.

Corrección necesaria: presupuesto por hallazgo y lote, con evidencia inseparable del dato. Recuperar citas por ID al preparar cada operación. La taxonomía y el esquema completos no deberían desplazar la evidencia pertinente del artista.

Aceptación: ningún hallazgo respaldado en el informe llega sin respaldo a planificación por un simple límite de contexto; se conserva su trazabilidad también después de reintentos y cambios de versión.

### P1 — C. La relevancia de una cita no valida todos los datos propuestos

**Confirmado con ejemplos sintéticos; no es prueba de que esos datos ficticios se hayan aplicado al catálogo.** `src/curation/ai/evidence.ts:66` permite una creación de álbum si la cita menciona el título. El ejemplo probado añade año, portada y una pista inventados y devuelve `true`. En la línea 95 basta una palabra larga compartida para considerar relevante un texto narrativo; una biografía con premios inventados también pasa.

Además, al aceptar una propuesta, `src/curation/ai/store.ts:432` trata la operación como revisión editorial explícita. El ejecutor conserva validaciones estructurales, pero la aceptación permite superar el control documental. Las advertencias no deben quedar escondidas bajo detalles mientras el botón comunica una aceptación aparentemente comprobada.

Corrección necesaria: evidencia por campo y por relación, con sujeto y edición identificados. Separar visualmente «dato documentado» de «decisión editorial», manteniendo el flujo ágil de aceptación autorizado. No hace falta añadir confirmaciones repetidas; sí mostrar qué se está aceptando y qué parte no tiene respaldo.

Aceptación: los dos ejemplos sintéticos quedan señalados o bloqueados como respaldo insuficiente; una cita del título no valida pistas, fechas, créditos o imágenes que no contiene.

### P1 — D. Acciones estructurales contradicen el criterio documental

**Confirmado por código; no se ejecutaron estas acciones en producción.** En `src/curation/actions/structural.ts` se ofrecen:

- `fijar_anio_formacion`, línea 188: deduce formación del disco más antiguo. Eso no prueba cuándo se formó el artista.
- `renumerar_consecutivo`, línea 369: cierra huecos de numeración sin demostrar que no falta una pista.
- `retirar_huerfana`, línea 1281: clasifica retirar una entidad sin vínculos como nivel 0. Estar huérfana no demuestra que la ficha sea inválida.
- `vaciar_anio`, línea 126: sus precondiciones comprueban existencia y que el campo siga poblado; necesitan volver a comprobar la anomalía factual que autorizó vaciarlo.

La autocorrección está desactivada por defecto y no había reglas habilitadas en la tabla consultada. No se afirma que esté eliminando estas fichas automáticamente. El riesgo existe en el significado y elegibilidad de las acciones, incluidas las manuales.

Corrección necesaria: reservar el nivel determinista para equivalencias realmente demostrables y requerir evidencia/editorialidad para estos casos. El verificador, los prompts y las acciones deben compartir una misma política de conservación.

### P1 — E. La integridad histórica no está completa

**Confirmado por `npm run doctor`.** Detectó 830 filas canónicas sin auditoría, 2.325 auditorías sin claim y diez identidades externas sobre fichas inexistentes, también contabilizadas sobre fichas fusionadas. No se suman como veinte incidentes independientes. El diario registra 1.479 cambios recientes sin run, que no pueden deshacerse desde el historial web.

Corrección necesaria: reconciliar identidad externa y redirecciones, reconstruir procedencia donde haya evidencia y señalar explícitamente los cambios que no son reversibles. Las escrituras extraordinarias deben usar el motor auditado o dejar un run de mantenimiento reconocible.

Aceptación: `doctor` sin errores de estas categorías, con un informe explícito de cualquier excepción histórica que no pueda reconstruirse.

### P2 — F. Planes sin operaciones y resumen incompatible

**Confirmado en datos y navegador.** Caramelos plan 11 promete un integrante sin generar operación ni duda. Jeremías tiene varias propuestas guardadas vacías, y la página selecciona por defecto la más reciente (`web/src/pages/AiCurationPage.tsx:82`). El historial distingue propuestas principalmente por fecha y estado, lo que dificulta encontrar una anterior útil.

Corrección necesaria: validar coherencia entre resumen, operaciones y pendientes; ofrecer «sin cambios: motivos» cuando sea realmente correcto. Mostrar tema, versión, número de cambios y estado en el historial.

Aceptación: ningún plan anuncia un cambio ausente; el resultado vacío explica si el dato ya existe, falta evidencia, falta modelo compatible o hubo un fallo.

### P2 — G. Imágenes seleccionables aunque fallen, y categorías incorrectas

**Confirmado en navegador y código.** Se observó «No carga» junto a «Usar esta» habilitado, incluida una candidata de `www.alborde.com` en la pasada focalizada. `web/src/pages/CurationImagesPage.tsx:225` conserva la acción aunque `failed` sea verdadero. Elegir la candidata escribe su URL; no garantiza que el recurso se haya descargado y esté disponible de forma estable.

Se inspeccionó visualmente una imagen de Apple Music de **Un día más en el gran circo** dentro de la cola de fotos de artista. La imagen contiene nombre, título y diseño de portada. Es un error de clasificación comprobado, aunque la portada también pueda ser un recurso útil para su disco.

La galería contiene versiones del mismo recurso en distintos formatos/tamaños y fotografías con varios artistas o texto de evento. No todas son apropiadas para una imagen de perfil. Se conoce tamaño declarado para 45 de las 65 candidatas; esos metadatos no certifican calidad visual. El componente prefiere el tamaño declarado al natural cargado (`CurationImagesPage.tsx:201`).

Corrección necesaria: identificar retrato, portada, contraportada, presentación, cartel y recurso irrelevante; agrupar variantes de la misma imagen; comprobar descarga, dimensiones reales y edición; recomendar las mejores sin impedir que el curador compare otras. Mantener fuente y decisión. Integrar la localización de medios ya existente en el recorrido de elección cuando proceda.

Aceptación: un recurso fallido no puede seleccionarse como imagen verificada; la portada observada aparece en su álbum; se conservan varias candidatas útiles en curaduría con identidad y resolución comprobadas, y las variantes no se presentan como decisiones independientes.

Capturas: [portada en la cola de fotos](ui-qa/auditoria-integral-2026-10-10/focused-artist-photo-apple-11.png), [galería de portadas](ui-qa/auditoria-integral-2026-10-10/admin-curaduria-imagenes-1440.png), [fotos de Jeremías](ui-qa/auditoria-integral-2026-10-10/admin-jeremias-fotos-1440.png).

### P2 — H. Fecha conocida narrativamente, desconocida estructuralmente

**Confirmado en la persona 15368.** La biografía contiene nacimiento el 19 de septiembre de 1973, pero el campo de nacimiento está vacío. Es un caso claro de información disponible que no está alimentando todos los lugares apropiados de la ficha.

Además, `src/api/routes/catalog-writes.ts:30` y los campos de persona exigen una fecha `AAAA-MM-DD`. No existe un campo equivalente para «solo se conoce el año», aunque ese es un requisito explícito de la investigación solicitada. No se debe rellenar un 1 de enero ficticio.

Corrección necesaria: precisión de fecha —año, mes, día, aproximación, intervalo y desconocido— y propuestas para datos estructurados derivados de texto con cita. Una persona y su identidad artística deben tener roles y campos diferenciados, con reutilización explícita de hechos e imágenes pertinentes.

### P2 — I. Un enlace real de pista termina en página inexistente

**Reproducido por clic.** «Ver ficha» en Propuestas con IA para `kind=track&id=1` lleva a `/crv/pistas/1`, que muestra «Página no encontrada». `AiCurationPage.tsx:22` construye esa ruta, pero `web/src/App.tsx` no registra una ficha independiente de pista. Otras partes de la aplicación ya enlazan las pistas al disco.

Corrección necesaria: resolver el álbum y abrir la pista dentro de él, o implementar una ruta compatible. Aceptación: todo tipo seleccionable de ficha tiene un destino válido.

### P2 — J. Puntaje alto con cobertura baja

**Confirmado por datos y cálculo.** Jeremías obtiene 90,2, pero solo 16 de 40 unidades entran al cálculo documental; los faltantes y no verificados se excluyen. La UI explica esta regla bajo «Cómo interpretar el puntaje», lo que mejora la transparencia, pero el número sigue dominando la lectura de una ficha con todos sus discos sin pistas y sin portada aplicada.

El puntaje no es una probabilidad de verdad, un porcentaje de campos completos ni el porcentaje de fuentes leídas. La ejecución de 200 fragmentos corresponde a páginas utilizables seleccionadas para ese proceso; no demuestra que todas las 232 referencias hayan aportado evidencia válida o todas sus afirmaciones sean del artista correcto.

Corrección necesaria: presentar juntos respaldo de datos contrastados, cobertura de ficha, información pendiente y contradicciones. «Investigación terminada» y «ficha completada» son estados distintos.

### P2 — K. Respaldo y despliegue no cubren todo el producto

**Confirmado por scripts.** `scripts/db-backup.sh` guarda PostgreSQL y `data/raw`, pero no `web/public/media`, donde existen imágenes localizadas referenciadas por fichas. Registrar commit y estado dirty no recupera por sí solo los cambios no versionados del workspace. Hay scripts de restauración y comprobación; no se afirma que el sistema carezca de respaldo.

`scripts/deploy.sh` construye directamente sobre `web/dist-public` antes de terminar las comprobaciones. No usa una carpeta de release con sustitución atómica ni obliga a pasar toda la suite antes de publicar. Reiniciar la API cierra las sesiones en memoria. La recuperación de trabajos al arrancar necesita distinguir trabajos propios de los que otro proceso pudiera tener en ejecución.

Corrección necesaria: respaldar medios y su relación con la base, validar restauración completa y publicar un release verificado con reversión. Persistir sesiones o comunicar adecuadamente su expiración. Ejecutar trabajos con propietario/lease y recuperación explícita.

### P2 — L. Frescura de fuente archivada puede comunicarse mal

**Confirmado por código.** `src/ambiguity/web-search.ts:164` puede recuperar HTML archivado cuando falla la obtención; al devolver la página, la línea 193 usa la fecha actual como `fetchedAt`. Es necesario distinguir captura original, lectura de archivo y consulta actual. Abrir una copia histórica hoy no la convierte en fuente actualizada hoy.

El lector también trabaja sobre HTML estático y contenido acotado. No cubre de manera general DOM renderizado, documentos PDF, texto dentro de portadas ni OCR de contraportadas. Son capacidades necesarias para muchos tracklists y créditos de discos, con extracción verificable y preservación del original.

## 5. UI/UX observada y carga cognitiva

### Lo que funciona

La estética oscura tiene coherencia, las fichas públicas presentan una identidad clara y la separación de lectura/administración permite consultar sin exponer operaciones al visitante. Hay estados de carga, ausencia de datos y error, imágenes ampliables, pestañas y enlaces contextuales. La búsqueda encuentra los cuatro artistas y distingue resultados por entidad, con información de disco/artista en las pistas.

El modal de edición de La Banana Voladora mantuvo el foco dentro después de 30 pulsaciones de Tab, cerró con Escape y devolvió el foco al botón inicial, en escritorio y móvil. Las flechas cambiaron la pestaña seleccionada. Un error 500 controlado presentó «Reintentar» y el reintento recuperó la ficha real. No hubo errores JavaScript de página en los recorridos iniciales examinados.

### La administración exige reconstruir demasiadas decisiones

La página de IA de Jeremías presentó 97 controles expuestos en la página, 37 dentro del primer viewport de escritorio, contando navegación. La cola de 430 elementos mezcla campos faltantes, propuestas de imágenes, biografía, géneros y nuevas entidades. Cada tarea exige abrir evidencia y preparar una corrección. La propuesta elegida aparece después de la cola y otros paneles. El usuario debe recordar qué dato vio, en qué propuesta está y si ya fue aplicado.

Apache presentó 199 controles expuestos en su página de IA; la ficha del disco 211, 437; el disco 140, 563. Estos recuentos incluyen enlaces y acciones de filas y **no significan que todos estén a la vez en el primer viewport**. Sí muestran cuánto crece la superficie de decisión en fichas con créditos abundantes.

La galería de portadas presenta 46 candidatas de tres discos, 172 controles y unos 7.257 px de altura en la medición inicial de escritorio. La cola de fotos presenta 19 candidatas y 87 controles. Falta una búsqueda por ficha, entrada directa al conjunto del artista, agrupación por recurso y orden útil por identidad/calidad.

El panorama de curaduría expone menú, múltiples indicadores, alertas de precisión y categorías antes de ayudar a resolver un caso. La captura completada muestra 189 controles y un bloque extenso de advertencias. Los porcentajes de precisión observada —algunos muy bajos— proceden de decisiones humanas e historial; no se trataron como una evaluación independiente de falsos positivos. Aun así, su presentación exige interpretar demasiados indicadores y no traduce el estado en una siguiente tarea clara.

Recomendación de flujo: abrir una ficha, pulsar «Investigar y completar», mostrar un resultado agrupado por **Datos, Discografía, Imágenes y Dudas**, con fuentes y antes/después junto a cada propuesta. Mostrar primero las mejoras concretas listas para decidir, reunir variantes de un mismo hecho y mantener las opciones avanzadas accesibles bajo demanda. Un lugar claro debe indicar qué se investigó, qué se aprovechó y qué queda pendiente. La revisión humana sigue disponible sin obligar a reconstruir todo el recorrido.

### Móvil y accesibilidad

A 390 px, la cola de fotos tiene un ancho de documento de 405 px: una etiqueta de dominio largo fuerza la celda a unos 205 px y desborda. Se reprodujo en ambas pasadas. Las fichas públicas examinadas a 320 px no tuvieron desbordamiento horizontal del documento. Algunas barras de pestañas/filtros se desplazan horizontalmente dentro de su contenedor; eso no equivale al desbordamiento de toda la página.

La ficha móvil de Jeremías dedica buena parte de la primera pantalla a un gran marcador sin foto y numerosos datos vacíos. No impide navegar, pero desplaza la discografía y las acciones útiles. La curaduría móvil reduce el menú, aunque sigue requiriendo recorridos verticales largos.

axe detectó contraste insuficiente en `.page-kicker` (3,96:1), contador activo de pestaña (2,72:1) y botones de retirar/deshacer (aproximadamente 3:1 para texto pequeño). El texto normal requiere 4,5:1 en el criterio AA aplicable. [WCAG: contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Se registraron tamaños de controles menores de 44 px como indicador de comodidad táctil; **no se contaron automáticamente como incumplimientos AA**. WCAG 2.2 AA usa 24 × 24 px con excepciones y condiciones de separación. [WCAG: tamaño mínimo de objetivos](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Esta pasada automática y las comprobaciones de teclado no constituyen certificación completa de accesibilidad.

El detector de diseño de Impeccable produjo tres advertencias heurísticas sobre pestañas laterales y la fuente Inter. Se contrastaron con el contexto de diseño y no se consideran bugs: son decisiones intencionales. Los problemas de contraste y desbordamiento sí están respaldados por mediciones y capturas.

## 6. Completitud del catálogo y capacidades faltantes

Hay 4.766 artistas, 15.607 discos, 32.145 personas, 2.875 organizaciones y 121.199 pistas. Solo 1.320 artistas tienen imagen —27,7 %—, aunque 14.307 discos tienen portada —91,7 %—. El 8,6 % de los discos, 1.340, no tiene pistas. En personas, 677 tienen nacimiento estructurado y 162 fallecimiento; la ausencia de fallecimiento no es un defecto para alguien vivo. De 10.043 membresías, 7.877 no tienen ningún extremo temporal registrado.

Hay 3.255 hallazgos abiertos, 3.419 ignorados y 381.778 resueltos. El último análisis completo consultado tardó unos nueve segundos y detectó 6.674 casos incluyendo ignorados; no se confunde ese total con los abiertos. Los 26 informes de verificación guardados corresponden a ejecuciones, no a 26 entidades distintas ni a cobertura del catálogo entero.

| Requisito solicitado | Capacidad existente | Lo que falta para completarlo |
|---|---|---|
| Portadas y fotos de buena calidad | Extracción, candidatos, galería, resolución declarada y localización por scripts | Descarga comprobada, resolución natural, identificación de uso, variantes agrupadas y recomendación por calidad real. |
| Varias imágenes a curaduría | Cola de artista y álbum, decisiones auditadas | Cobertura uniforme de informes anteriores, acceso directo desde la ficha y conservar alternativas útiles sin ruido. |
| Tracklist de CD | Pistas, números de disco/pista, créditos y operaciones de alta | Extraer la lista por edición/soporte, contrastar integridad, leer contraportadas/PDF cuando sea necesario y conservar dudas. |
| Géneros de artista y disco | Taxonomía, asignaciones y proyección desde álbumes | Mantener evidencia, separar género de artista/obra/edición y diferenciar prioridad editorial de afirmación de fuente. |
| Redes sociales | Vínculos de artista y canales específicos de disco | Confirmar cuenta oficial y propietario, fechas de validación y estados de enlace caído sin crear alias por parecido. |
| Nacimiento y fallecimiento | Fechas exactas de persona y estado de fallecimiento | Precisión parcial y traslado documentado desde narrativa a campos estructurados. |
| Sellos | Organizaciones, sello de álbum y créditos | Verificación de organización, sello de edición frente a asociación histórica del artista, nombres/alias y sucesiones. |
| Alias / AKA | Tablas y gestores de alias por entidad | Resolver alias por identidad y período, distinguir homónimos y conservar fuente sin mezclar personas. |
| Aprovechar todo lo relevante | Sugerencias guardadas y operaciones de catálogo amplias | Inventario persistente de hechos, cruce con el estado actual, agrupación y trazabilidad hasta propuesta/aplicación/pendiente. |
| Crear fichas desde investigación | La IA puede crear entidades y álbumes | Resolver referencias y dependencias por etapas sin presupuestar todo el catálogo en una sola llamada. |

Las organizaciones tienen ficha, relaciones y curaduría, pero el verificador/comparador general solo admite persona, artista y álbum (`src/verification/types.ts:1`). Las pistas se administran como parte del disco. Ingesta, adaptadores, YouTube, streaming y medios existen y tienen contratos; varios recorridos dependen de CLI/scripts y no están integrados en una experiencia sencilla de completar ficha.

Como contradicción adicional fuera de los cuatro casos, Polydor muestra una biografía que delimita publicaciones entre 1966 y 1979 y una discografía asociada con registros de 1962 y 1986. Esto demuestra divergencia interna texto/datos; no se decidió desde esta auditoría cuál afirmación histórica es correcta.

El sistema completo necesita un registro de hechos que distinga explícitamente **encontrado → contrastado → ya presente / propuesto / en conflicto / pendiente → aplicado → comprobado**. La tarea del usuario puede delimitar la prioridad sin provocar pérdida de otros hechos relevantes. Deben mantenerse límites de recursos por llamada, pero resolverse mediante lotes, recuperación y acumulación; eliminarlos sin mecanismo de continuidad no garantiza completar el trabajo.

## 7. Pruebas ejecutadas y resultado

| Comprobación | Resultado observado |
|---|---|
| Unitarias backend | 718 aprobadas, 1 fallida; 719 total, 74 archivos. |
| Unitarias web | 42 aprobadas, 6 archivos. |
| Contratos completos | 438 aprobados, 8 fallidos; 446 total, 64 archivos; unos 11 min 43 s. |
| Repetición focalizada | 14/14 aprobados: métricas de descubrimiento y curaduría incremental. |
| Tipos backend | Primera ejecución falló por unión de tipos en prueba nueva de descubrimiento; última ejecución aprobada. No se corrigió código de producto desde esta auditoría. |
| Tipos web y build web | Aprobados. Build de verificación en `web/dist`; no se publicó `dist-public`. |
| Lint | Primera ejecución: 29 errores; ejecución final: 27, principalmente scripts de mantenimiento y una fixture TSX. El harness nuevo de auditoría pasa su lint focalizado. |
| `doctor` | Falló por auditorías/claims e identidades externas; diario advierte cambios sin run. |
| Navegador | Búsqueda, fichas, administración, teclado, historial de propuestas, error/reintento y imágenes examinados; fallos descritos arriba. |

La repetición focalizada aprobó los dos fallos inicialmente encontrados de tiempo del análisis y número de reintentos del agregado. El análisis de régimen de la fixture tardó 4.835 ms, frente a 5.449 ms en la ejecución concurrente inicial; la verificación dirigida, 129 ms. Esto justifica tratar el primer fallo temporal como variabilidad de entorno, no como caída funcional. La fixture del test contiene 117.946 filas según su propio log; su descripción «doble del catálogo real» es histórica y no representa el tamaño actual consultado.

Los otros seis fallos de contratos de la primera pasada quedan pendientes:

1. Dos expectativas enumeran migraciones hasta `0052`, aunque el runner ya aplica `0053`: expectativas desactualizadas.
2. La búsqueda ahora devuelve un disco al buscar el alias de su artista, mientras el test esperaba cero: hay que decidir y probar la política vigente.
3. La taxonomía devuelve 20 familias y el test espera 16: expectativa desactualizada o cambio no reconciliado.
4. Cinco claves foráneas de `ingest` sin índice que comience por sus columnas: planes `run_id`, jobs de verificación/comparación `report_id` y dos columnas de investigación de personas. Es un déficit real de esquema, aunque no demuestre latencia actual.
5. Revertir aisladamente `0027` falla por dependencias posteriores de `parent_genre_id`: el procedimiento/prueba de rollback debe respetar esas dependencias. El rollback completo del runner no se declaró roto por este error aislado.

La unitaria fallida de comparación esperaba tres llamadas y recibió siete tras la ampliación de lectura de fuentes. El contrato de comparación sí aprobó. No es evidencia suficiente para afirmar que toda comparación está rota; sí exige actualizar una prueba que compruebe el resultado documental y no solo el número histórico de llamadas.

La CI ejecuta tipos, lint, cobertura unitaria backend, contratos y build web. No incluye las unitarias web ni recorridos de navegador/axe en sus jobs. La suite amplia es una fortaleza; mantenerla parcialmente roja reduce su capacidad de detectar regresiones verdaderas.

## 8. Orden recomendado de trabajo y criterio de sistema completo

| Orden | Trabajo | Resultado comprobable |
|---:|---|---|
| 1 | Corregir contexto y ejecución por lotes | Jeremías y sus tres peticiones focalizadas funcionan; todos los pendientes mantienen sus citas. |
| 2 | Validación de respaldo por campo y coherencia de planes | Ningún resumen anuncia una operación inexistente; las pruebas de datos inventados detectan respaldo insuficiente. |
| 3 | Normalizar hechos y reutilización entre fichas | Nacimiento, sellos, géneros, redes, alias, pistas e imágenes encontrados llegan a una propuesta o pendiente identificado. |
| 4 | Clasificar y comprobar imágenes | Varias opciones útiles por ficha, portada/retrato separados, tamaños naturales y enlaces fallidos controlados. |
| 5 | Unificar el recorrido administrativo | Una ficha conduce a investigación, resultado agrupado, decisiones y comprobación; las opciones avanzadas no dominan la primera pantalla. |
| 6 | Resolver política de fechas, ediciones y acciones estructurales | No se inventan días, formación, numeraciones ni fusiones de soportes diferentes para hacer desaparecer alertas. |
| 7 | Reparar integridad y dejar controles de calidad utilizables | `doctor` explica o elimina huecos; tipos, lint y pruebas aprobados; navegador y accesibilidad incorporados a CI. |
| 8 | Completar continuidad operativa | Restauración de medios y base comprobada; releases verificables; sesiones y trabajos sobreviven o se recuperan claramente. |

Una prueba de aceptación final debe recorrer los cuatro artistas: investigar, abrir las fuentes pertinentes, conservar la información adicional, preparar cambios aplicables, enviar varias imágenes correctas a curaduría, aceptar una decisión en una base de prueba, comprobar campos/relaciones, detectar efectos posteriores y deshacer sin perder información previa. Para Caramelos debe incluir ediciones diferentes; para La Banana, conservar su resultado correcto sin reabrir duplicados ya decididos; para Apache, completar discos vacíos con evidencia; para Jeremías, reutilizar hechos entre persona, artista y álbumes.

La meta no es que todos los campos terminen poblados a cualquier precio. La meta es que **ningún hecho pertinente y documentado se pierda**, ninguna falta de evidencia se disfrace de certeza y el usuario pueda terminar una revisión sin conocer la arquitectura interna del sistema.
