# Buscador unificado — etapa 2 en curso

Referencia: [plan 1.1.0](PLAN_1.1.0.md), etapa 2 completa y anexo A. Este documento registra progreso; **no certifica el cierre de la etapa**. No se aplicaron 0085/0086/0087 a la base operativa, no se reemplazaron servicios ni se activaron asociaciones, modelos, capturadores o timers.

La instrucción de Brian del 17 de octubre encarga también a Codex la segunda lectura. Se registra como revisión del mismo analista: no constituye dos anotadores independientes ni autoriza a declarar validación musical independiente.

## Implementación comprobable

- `src/search/knowledge-contracts.ts`: unidad afirmación/objeto/aspecto/fuente, observación–interpretación–propuesta, cuatro procedencias separadas, estados de enunciado y gusto, dependencia/cadena, parecido por aspecto, referencia externa sin alta. El análisis de patrones informa cuentas y cadenas, discrepancias y límites. Nunca autoriza publicación.
- `src/search/review-protocol.ts`: recuperación desde HTML de autores/fechas, texto de spans anidados, URL/localizador, notas de álbum/pista separadas, huellas, revisiones y duplicados. Hasta veinte reseñas válidas se conservan todas; después, extremos de nota por página con desempate longitud/ID y estrato sin nota. Dos páginas útiles son requisito comprobado, no páginas declaradas. No se infiere prevalencia.
- `src/search/knowledge-feed.ts` y migración reversible `0086_search_knowledge_feed`: staging inmutable por recurso/objeto/huella/extractor/esquema, colisiones de contenido explícitas, cursor transaccional, lease recuperable, exclusión mutua, chunks de hasta cincuenta unidades/ventana de diez segundos, timeouts SQL y reintentos con backoff. Cinco fallos llevan a cola fallida; `retry` explícito conserva cursor y casos. Sin timer paralelo. La interpretación y la proyección de publicación ya están conectadas en la vía de conocimiento descrita abajo; la integración con recuperación global y sugerencias corresponde todavía a E4.
- Las afirmaciones reutilizan **`ingest.review_queue`** y los IDs reales del catálogo. No existe una segunda decisión musical. Resolver genéricamente un caso no publica evidencia. La decisión tipada de conocimiento conserva criterio, cita, revisión esperada, actor y run en el payload de ese mismo caso; los controles existentes de contextos, géneros y emociones conservan su autoridad. R16/shoutbox se rechaza antes de encolar. Un ID ausente o una versión que necesita relación documental va a revisión, sin crear fichas.
- `src/search/taxonomy-knowledge.ts` y `knowledge-evaluation.ts`: esquemas para rasgos definitorios/frecuentes/variables, correspondencias originales, soporte y acuerdo por aspecto/alcance. Una segunda pasada del mismo analista no se informa como independiente. Estos contratos necesitan completar su conexión al importador/editor y al paquete de evaluación final.
- `GET /search/administration/knowledge`: lectura administradora, sin caché compartida; proyección sin rutas de captura, textos completos, cuentas, inputs ni errores SQL. Ausencia de migración o de inventario se informa sin inventar registros.
- Conocimiento y Alimentación se amplían dentro de `/administrar/buscador`. Hay cobertura, filtro/paginación, conceptos/facetas, fases de los lotes, contradicciones y formulario editorial sobre el caso existente, además de carga, error/reintento y estados vacíos.

## Corpus y conservación

Los comandos leen capturas existentes y PostgreSQL; el inventario no escribe en la base.

```bash
npm run search:knowledge -- inventory
npm run search:resources:audit
npm run search:study
npm run search:knowledge -- status
npm run search:knowledge -- sync-study --dry-run
npm run search:knowledge -- sync-study
npm run search:knowledge -- enqueue /ruta/lote-validado.json
npm run search:knowledge -- work
npm run search:knowledge -- interpret 10
npm run search:laya:study
npm run search:knowledge:rehearsal
npm run search:knowledge -- retry 123
```

`enqueue/work/retry` requieren 0086; `interpret` requiere también 0087 aplicada al entorno que se quiera procesar. Para pruebas se usan contenedores PostgreSQL desechables. No ejecutarlos contra otra base suponiendo que un inventario ya acredita revisión musical.

Los artefactos están en `reports/unified-search-stage2/`:

| Artefacto | Evidencia y límite |
| --- | --- |
| `study.json` | 148 pares de páginas/capturas con huellas, discrepancias y selección; 42 publicaciones y 1.010 reseñas válidas. Tres fichas adicionales pertenecen al estrato de una página, sin contarlas como dos páginas útiles. Ocho publicaciones reservadas; sus textos no se incorporan al paquete. Identidades CRV del inventario general aún pendientes. |
| `genre-map.json` | Corte 0.11.0: 282 categorías activas, cinco descripciones conservadas y 178 propuestas documentadas con rasgos, frecuencia, excepciones, alcance y fuentes. **99 sin descripción**; los seis aspectos se contabilizan por separado y los ausentes no se rellenan por herencia. |
| `vocabulary.json` | Los 64 conceptos y las 22 familias conservan sus definiciones, sinónimos y estados de propuesta/reutilización/diferimiento. No hay activación ni decisión humana nueva. |
| `mappings.json` | 48 apariciones de 44 términos revisadas como propuestas analíticas, con términos/niveles/capturas y cruce anterior preservados. Se distinguen equivalencia, especialización, relación parcial y pendiente; técnicas, formatos y estéticas no se fuerzan a estilos. Cero aprobaciones o expansiones de consulta automáticas. |
| `pilot-findings.json` | Los 42 hallazgos, IDs/estados, 26 citas breves, 56 consultas y la matriz original de 133 consultas se conservan como desarrollo. No son holdout ni desempeño probado. |
| `resource-uses.json` | 44 filas; R16 excluido, R41/R42 conservados, R01/R02 con contexto de cinco fichas cruzado, R04 con extracción/anotaciones, R05 con notas por pista y R09 con IDs reutilizados; otros adaptadores diferidos explícitamente. No afirmar que ya se aprovecharon musicalmente. |
| `development-annotations.json` | Lectura completa de 28 reseñas capturadas en cinco publicaciones: Kid606, Weed420, La Vida Bohème (dos discos) y Viniloversus. Veintiuna unidades a nivel álbum/pista/tramo, con citas comprobadas contra HTML, vínculos documentales aceptados y IDs existentes. Edición desconocida sigue desconocida. Cuatro procedencias cruzadas con contexto de fichas comprobadas; comparación con Boards of Canada atribuida, aspecto concreto pendiente. |
| `independent-review-template.json` / `independent-review.json` | Cinco casos breves, ES/EN, contradictorios y difíciles; notas/tags separados del primer pase. `independent-review-context.json` se revela después. Regenerar **no sobrescribe** respuestas del revisor. Umbrales propuestos, no aprobados; prueba final cerrada. |
| `docs/unified-search/stage2/second-reading.json` | Segunda lectura de Codex, asignada por Brian («Tu»). Detecta discurso imaginado y cita como tales en K01/W05; adjudicaciones trasladadas a las lecturas de desarrollo. No es evaluación independiente, no tiene acuerdo interevaluador. |

La fecha local original de captura carece de huso documentado: se conserva en `capturedAtOriginal`, con instante UTC y huso desconocidos, en vez de inventar una conversión. No se modifica el reloj editorial común ni sus proveedores React.

## Verificación y pendientes de aceptación

Pruebas PostgreSQL: idempotencia, colisión, cursor/reanudación, lease vencido, trabajadores concurrentes, identidad ausente, privacidad/permisos y up/down/up conservando casos. Unitarias: atribución/ratings, cuentas/cadenas, gusto opuesto, alcance, actividad/energía, negaciones, fuentes retiradas, referencias externas, extracción y selección. Regresión de etapa 1 verificada. Navegador 1440/390: filtro, paginación, navegación al caso, error/reintento, sin errores JS ni desbordamiento; corpus real con jobs explícitamente sintéticos.

Estos avances **no satisfacen todavía** las once salidas de E2. Siguiente trabajo necesario, manteniendo el alcance del plan:

1. Completar descripciones/rasgos/fuentes/excepciones de géneros y estilos; revisar correspondencias RYM–CRV, no solo conservar el cruce anterior.
2. Completar revisión concepto por concepto/familia y su interfaz de decisiones con autoridad/historial existentes.
3. Ampliar diversidad musical de la muestra, ampliar el cruce de cuatro procedencias a otras obras, anotaciones por artista/grabación/edición y análisis comparativo completo. El subconjunto actual abarca cuatro artistas, pero sigue concentrado en obras recientes y solo dos discos cumplen el estrato de varias páginas.
4. Ejecutar la evaluación independiente requerida o registrar una instrucción explícita que cambie ese criterio. La segunda lectura de Codex mejora errores pero no cumple independencia. Fijar umbrales antes de abrir la reserva; registrar traducciones/acuerdos/adjudicaciones.
5. Implementar/validar adaptadores del anexo A y revisar cada campo, relaciones de parecido y consultas combinadas con incertidumbres y soporte por la misma unidad.
6. Extender los adaptadores y la interpretación al corpus completo; conectar recuperación/sugerencias de E4 con la proyección autorizada. La vía de conocimiento ya tiene interpretación versionada, decisión/publicación, retiro y deshacer comprobados; no equivale a la integración pública global completa.
7. Ampliar el ensayo a más recursos y medir su cobertura/latencia. El tablero ya distingue extraídas, interpretadas, pendientes, aprobadas, rechazadas, retiradas, publicadas, fallos y actualización; las interpretaciones de versiones distintas no inflan unidades. Registrar al final una auditoría requisito por requisito antes de marcar el objetivo completo.

## Conexión de interpretación, autoridad y publicación

`0087_search_knowledge_interpretations`, `knowledge-interpretation.ts` y `unified-search-laya.py` conservan propuestas por unidad/modelo/revisión del checkpoint/SDK/preguntas/entrada. El estado textual omite notas, tags, interpretación previa y veredicto editorial. El intérprete usa la instalación de la [guía Laya](/home/brian/.codex/skills/laya/SKILL.md), SDK local **0.3.20** y snapshot multilingüe **7b928d828b7b0e022f929d9bd2e44165aa270148**. Las cuatro preguntas tipadas tienen abstención. Se validan opciones, distribuciones y huellas antes de importar. Referencias contrastadas: [API oficial](https://nandhakishorm.github.io/laya/reference/) y [decisiones tipadas](https://nandhakishorm.github.io/laya/structured/); no se entrenó ni activó un modelo de consultas.

Un proceso Python usa exclusión por fichero, dos hilos CPU, presupuesto de memoria GPU y entradas acotadas; el llamador tiene exclusión PostgreSQL, timeout y límite de salida. No mantiene transacciones/bloqueos de filas mientras infiere ni instala timers. El fallo deja unidades pendientes. La revisión de modelo genera nuevas propuestas comparables, sin copiar evidencia ni tocar la decisión padre. Si discrepa de una aprobación humana, abre un caso deduplicado en la cola existente; ni siquiera una probabilidad de 1 reemplaza a Brian. Revisar explícitamente la decisión padre resuelve sus casos de contraste en el mismo run, reversible por diario.

`knowledge-publication.ts` implementa la decisión con comparación de revisión/huella, criterio versionado y cita exacta. La proyección `GET /search/knowledge/:kind/:id` es una lectura sin caché para artista/álbum/pista; muestra únicamente evidencia atribuida aprobada y su alcance. No crea géneros/contextos ni etiquetas de catálogo. La aprobación genérica de la cola no satisface el contrato. Aprobación, retiro y deshacer/rehacer se leen directamente; no hay una copia publicada que pueda quedar antigua. Cambio de identidad o vínculo de cola, retirada del claim documental, pérdida de verificación Last.fm o modificación de la anotación invalidan la lectura. Falta de mención nunca satisface una negación. La energía continúa en los controles `perceived-energy-v1`; una reseña no acredita por sí sola un hecho documental ni una actividad.

El formulario se abre en `Administrar → Buscador y descubrimiento → Conocimiento`, con `revision=<id del caso>`. Presenta observación, interpretación, alternativa, incertidumbre, propuestas Laya y bloqueos antes de la decisión. El actor viene de la sesión, no del cuerpo enviado. Comparte cola, runs, historial y deshacer; no crea un almacén alternativo de decisiones. Publicar cita, rechazar y retirar están comprobados en navegador con fixtures explícitos; la autorización real y el efecto SQL se verifican por separado.

Evidencia adicional:

- `laya-development-interpretations.json`: diez ejecuciones reales de Laya sobre fragmentos del corpus de desarrollo. Algunas decisiones discrepan de la lectura; no se informa calidad musical aprobada ni calibración. El routing original puede contener rutas locales y solo se conserva en el artefacto/almacén privado; la API proyecta únicamente modelo/versión/preguntas/opciones.
- `chain-rehearsal.json`: copia mínima de IDs/títulos operativos a PostgreSQL desechable, cuatro jobs, diez unidades, diez interpretaciones, diez casos y cero publicaciones. Repetir lotes/inferencia importada no duplica registros. No se fingió aprobación musical de estas obras.
- `test/contract/search-knowledge-publication.test.ts`: cita/criterio, aprobación genérica sin efecto, revisiones concurrentes obsoletas, retiro/deshacer/rehacer, identidad cambiada, inferencia divergente sin sobrescritura, casos de contraste y su reversión. Los permisos/origen/esquema estricto de las nuevas rutas también se comprueban en el contrato de etapa 2.
- `browser/report.json`: 1440/390, filtro/paginación, formulario de aprobar/retirar, payload con revisión esperada, error/reintento, sin errores JS ni desbordamiento.

El objetivo completo permanece activo: el ensayo técnico no sustituye las 256 categorías sin descripción, la revisión semántica de correspondencias/conceptos/facetas, los adaptadores del anexo A y la evaluación musical independiente del protocolo.

### Documentación de géneros y correspondencias

Las fuentes editables son `docs/unified-search/stage2/genre-descriptions.json` y `mapping-review.json`. El inventario valida identidades activas, referencias de cada rasgo y la huella real de las capturas del piloto antes de regenerar artefactos. Una descripción nueva nunca reemplaza el texto editorial existente. El panel distingue ambos estados y expone alcance, excepciones, aspectos sin documentar y enlaces; las correspondencias conservan el nivel RYM y muestran su fundamento. Los datos generales no autorizan asignaciones a obras.

Las 18 propuestas cubren ambient, dark ambient, dream pop, electropop, synth-pop, house, techno, dubstep, drum and bass, downtempo, chillwave, glitch, IDM, joropo, black metal, death metal, doom metal y thrash metal. Se mantiene pendiente lo que las fuentes no acreditan. La documentación de joropo delimita los rasgos llaneros para no generalizarlos a sus otras vertientes. Field Recording conserva destino pendiente; Adult Contemporary se identifica como formato y Vapornoise mantiene relación parcial con Noise. No se modifica ninguna asignación humana.

Verificación de esta pasada: 21 pruebas (14 unitarias y siete de contrato con PostgreSQL desechable), typecheck backend/web, build web y lint de los archivos cambiados pasan. Navegador 1440/390 verifica los desplegables de rasgos/fuentes y Field Recording sin destino, además de los flujos anteriores. `verification/taxonomy-result.json` registra los resultados. El lint global de esta pasada falla con 45 errores y dos advertencias en archivos ajenos a estos cambios; no se reporta como aprobado ni se modifica ese trabajo.

### Cruce de cuatro procedencias y comparación de desarrollo

`npm run search:study` ahora contrasta las dos fichas RYM guardadas con sus metadatos, URL canónica, encabezados y vínculos CRV documentados. `community-crossing.json` fija rutas y huellas del corte; una modificación detiene la regeneración. `rym-release-community.ts` separa géneros principales/secundarios, descriptores y media/votos del texto de reseña. La fecha original se conserva sin inventar UTC o huso. Las capas de anotación incluyen el objeto del tag (álbum), su localizador, fuente y huella; no se convierte en un tag de pista.

`four-source-crossing.json` contiene diez cruces explícitos, dos manifiestos y cero testigos adicionales. La nota individual y la comunitaria siguen siendo evaluaciones, nunca peso de verdad. Las definiciones generales referenciadas conservan versión/huella y estado propuesto. Cada cruce explica si precisa o no resuelve el enunciado. No cambió el texto de las afirmaciones al revelar contexto. Instrumental y male vocalist coexisten en la ficha de Weed420: se conserva esa situación junto a «casi no tiene letras ni voces», sin declarar ausencia vocal total. La ficha de Kid606 describe el álbum; energetic/manic no contradicen por sí solos la descripción de Parenthood.

`development-analysis.json`, regenerado desde anotaciones y `comparative-reading.json`, presenta dos análisis por álbum con denominadores de reseñas/cuentas y cinco comparaciones: desarrollo, textura/fuentes, voz, recepción y parecido. Cada comparación enlaza unidades, distingue observación/interpretación, registra alternativa/incertidumbre y una consulta beneficiada; también declara una explicación que las fuentes no autorizan. No hay matriz ejecutada de consultas combinadas ni validación musical independiente todavía.

El ensayo actualizado almacena cuatro jobs, diez unidades con las cuatro procedencias y diez interpretaciones; repetir crea cero registros adicionales. La importación enlaza las predicciones por clave del artefacto y hash exacto del estado textual, nunca por posición en un array. Las nuevas capas no cambian ese estado: se comprueba la compatibilidad de las predicciones ya ejecutadas, sin atribuir otra inferencia ni una mejora de calidad al modelo. El ensayo sigue usando PostgreSQL desechable y cero escrituras operativas o publicaciones.

Evidencia de esta pasada: `verification/crossing-result.json`, contratos/unitarias en `crossing-tests.log` (29 casos), unitarias finales en `crossing-unit-final.log` (19 casos, con repeticiones; no sumar corridas), typecheck y lint de los archivos cambiados, más `crossing-rehearsal.log`. No se volvió a inferir Laya: se verificaron claves y entradas de las predicciones existentes.

### Ampliación del estudio: rock y nuevas perspectivas

La versión `crv-development-readings-0.3.0` incorpora Caribe Caribe, Tierra de Nadie y La Frontera desde fichas ya capturadas. Son tres excepciones explícitas de una sola página: seis reseñas adicionales, sin simular el requisito de varias páginas. El total examinado es de cinco discos de cuatro artistas, 28 reseñas y veinte anotaciones; el inventario completo tiene 42 publicaciones y 148 capturas, con 1.010 reseñas válidas. Las ocho publicaciones originales reservadas están fijadas en `study-reserve.json`; ampliar u ordenar el corpus no mueve esa reserva. La selección rechaza cualquier cruce con ella, también si cambia la barra final de la URL.

`study-releases.json` sustituye los IDs elegidos por ramas especiales en el código. `study-identity.ts` comprueba URL, huellas, encabezados, artista e identidad aceptada del catálogo. Los tres vínculos nuevos añaden cotejo ordenado de repertorios: 12/13, 11/11 y 10/10 títulos/posiciones respectivamente. Solo se normalizan mayúsculas, espacios y composición Unicode; diferencias de puntuación o acentos no se declaran alias. Se conserva el título de la fuente y el del catálogo, las pistas no alineadas y la edición desconocida. No se crean discos, pistas o artistas.

El paquete regenerado contiene veinte cruces de cuatro procedencias, cinco análisis por álbum y nueve comparaciones. Conserva bailable frente a género dance/actividad, críticas de una apertura frente al álbum completo, opiniones mixtas de una sola cuenta y dos referencias externas del mismo párrafo. Jumbo mantiene identidad pendiente; el aspecto de parecido con cada referencia no se hereda de una frase cercana sobre guitarra. Post-punk, new wave y rock alternativo añaden tres propuestas descriptivas documentadas: el mapa tiene 26 de 282 categorías con descripción, cinco editoriales y 21 propuestas; faltan 256.

Laya ejecutó veinte interpretaciones con el mismo checkpoint/SDK y preguntas tipadas documentados. No son entrenamiento ni una evaluación de calidad musical. El ensayo actualizado produjo siete jobs, veinte unidades/casos y veinte interpretaciones; repetir creó cero registros adicionales, con cero publicaciones y cero escrituras en la base operativa. Evidencia: `verification/diversity-result.json`, 24 pruebas unitarias, typecheck, lint de los archivos cambiados y los logs de inferencia/ensayo. La revisión independiente, otros niveles/épocas/tradiciones, las decisiones semánticas y los demás recursos siguen pendientes.

### Matriz ejecutable de consultas con evidencia por condición — corte 0.1.0

`docs/unified-search/stage2/query-matrix.json` fija 34 planes escritos para desarrollo y sus expectativas: veinte necesidades anotadas y catorce combinaciones/contraejemplos. `npm run search:queries:study` valida el esquema y la cobertura, examina las veinte anotaciones en **cada** consulta, compara estados/IDs de soporte contra expectativas explícitas y genera `reports/unified-search-stage2/query-matrix.json` con huellas de las tres entradas. Las frases permitidas/prohibidas son criterios humanos de revisión; el comando verifica estados e IDs, no su comprensión semántica automática. No modifica el catálogo ni la base de datos.

`evidence-query.ts` mantiene AND entre grupos y OR dentro del grupo nombrado, separa requisitos/preferencias/exclusiones y exige identidad, versión, tramo y condición de escucha coincidentes. Una descripción de una pista no satisface otra, un tramo no acredita el álbum entero y la versión desconocida no funciona como comodín. La negación requiere cobertura completa y versión documentada; el silencio queda desconocido. Las preferencias pendientes no se convierten en requisitos y las cláusulas sin resolver impiden declarar la consulta resuelta. Comparaciones necesitan referencia y aspecto explícitos. Tags, notas y definiciones generales añaden cero testigos; agrado/desagrado no decide si el autor describió un rasgo.

La ejecución produce 16 resultados con soporte atribuido, quince sin resolver, dos búsquedas de ficha y uno contradicho por evidencia. K01 hipotético no aporta soporte: la consulta de desarrollo largo se sostiene únicamente en K02, que lo critica. La técnica «casi bitcrushed» de W02 queda ambigua en el plan; se separa el requisito de construcción de ruido que la cita breve no demuestra. El nombre compuesto de la propuesta anterior no prueba ambas propiedades. Las referencias a Boards of Canada/DEVO siguen sin aspecto suficiente y Jumbo sin identidad resuelta. Las ocho publicaciones reservadas permanecen cerradas.

Son planes escritos, identificados por `planOrigin=authored_development_plan`. El valor contractual `intention.engine=legacy` no acredita ejecutar un parser. La salida declara `parserExecuted=false`, `publicSearchExecuted=false`, `modelEvaluated=false`, `liveIdentityChecked=false` y `publicationAuthorized=false`. Las 56 consultas heredadas y las 133 humanas continúan preservadas; no se informa haberlas resuelto con este subconjunto. La matriz no valida ranking, publicación, vigencia actual de identidades ni calidad de Laya, y no sustituye la revisión musical independiente. E2-09 sigue parcial.

Verificación: `verification/query-matrix-result.json`, 34 expectativas del artefacto, pruebas unitarias de combinaciones y regresión, typecheck backend y lint de los tres archivos TypeScript de esta pasada. No hay cambios de interfaz en esta ampliación.

### Revisión semántica y correcciones del estudio — corte 0.4.0

`semantic-review.json` contiene una disposición explícita por cada uno de los 64 conceptos y las 22 familias originales: ocho reutilizaciones, 49 precisiones, 24 propuestas de atributo y cinco propuestas de relación. Cada entrada conserva definición y sinónimos originales y añade ámbito, falsos amigos, reglas de contexto por expresión, motivación y criterio específico. 150 expresiones necesitan contexto; no se borran para simular ausencia de ambigüedad. Las relaciones de comprensión lingüística, familiaridad cultural, longitud percibida, familiarización con escuchas y parecido no se confunden con una dimensión sonora de la obra.

`npm run search:semantics:study` materializa el vocabulario revisado sin acceso a la base. `search:knowledge inventory` utiliza el mismo módulo y ya no reemplaza estas disposiciones por textos genéricos. Se verifican cobertura exacta, fuentes fijadas por SHA-256, sinónimos completos, correspondencia entre consulta y concepto, todos los hallazgos motivadores por familia, referencias de contraste existentes y conservación de `perceived-energy-v1`. El panel de Conocimiento presenta criterio, ámbito, falsos amigos, expresiones ambiguas, motivaciones y autor de revisión con las mismas protecciones de acceso y proyección.

La revisión semántica corrigió el estudio, sin abrir las ocho obras reservadas. K01 conserva una intención imaginada por el reseñista y estado hipotético; K02 pasa a experiencia de longitud excesiva. Ya no se agrupan como testimonios de desarrollo compositivo. W02 conserva sampling lo-fi con contexto textual que nombra Terminal; «almost bitcrushed» sigue sin acreditar técnica exacta. W06 registra separadamente la construcción ruidosa explícitamente atribuida a esa pista. W02 y W06 proceden de una sola cuenta/cadena. `second-reading.json` registra el seguimiento del mismo analista y no lo presenta como independiente.

El corte actual tiene 21 anotaciones cruzadas y 36 planes, cada uno evaluado contra todas las unidades: diecisiete con soporte atribuido, dieciséis sin resolver, dos localizaciones y uno con evidencia en contra. La técnica exacta pendiente permanece en el plan; no bloquea registrar por separado lo-fi y desarrollo ruidoso. No se ejecutó un parser libre, búsqueda pública ni ranking. Las frases permitidas/prohibidas siguen siendo criterios de revisión humana, no un examen automático de comprensión lingüística.

La ampliación a 21 unidades reveló un límite real de lote del script de estudio. Ahora se procesan bloques de hasta veinte y se valida cada respuesta por clave, entrada y metadatos. Se reutilizaron diecisiete predicciones con entrada/checkpoint/SDK/preguntas idénticos y se ejecutaron cuatro nuevas. Repetir ejecutó cero inferencias y reutilizó 21; el artefacto declara el origen de cada reutilización. Las pruebas incluyen 25 tareas con lotes 20+5, respuestas desordenadas y rechazo de claves, huellas o versiones incorrectas. El ensayo PostgreSQL actualizado importa en lotes acotados y produce siete jobs/21 unidades/21 interpretaciones/21 casos, sin duplicados ni publicaciones y con cero escrituras operativas.

`verification/semantic-review-audit.json` acredita **E2-06**, cuyo criterio admite reutilizar, precisar y proponer sin activación automática. Las 86 disposiciones son analíticas de Codex; no son aprobaciones editoriales de Brian ni de asignaciones musicales. Los 42 hallazgos, sus estados, citas, 56 consultas del piloto y 133 casos humanos permanecen iguales a los originales. El resto de E2 conserva sus pendientes, especialmente cobertura de 256 categorías, correspondencias con decisión humana, diversidad, recursos y revisión musical independiente. No se declara completa la etapa.

Verificación de esta pasada: `verification/semantic-result.json`; 40 unitarias y 14 contratos, 36 expectativas del artefacto, typecheck backend, build web con typecheck y lint de los archivos de esta pasada. Navegador 1440/390 en `browser-semantics/report.json`: revisión semántica, filtros, paginación, formulario, error/reintento, sin errores JS ni desbordamiento. La prueba de regresión usa casos sintéticos y PostgreSQL desechable; no acredita calidad musical del modelo.

### Ampliación del mapa descriptivo — corte 0.5.0

El libro añade 32 propuestas específicas: blues, blues rock, funk, soul, R&B, jazz, jazz fusión, jazz funk, acid jazz, jazz rap, hip-hop, boom bap, trip-hop, rock, hard rock, heavy metal, punk rock, rock progresivo, rock psicodélico, garage rock, grunge, post-rock, shoegaze, indie rock, pop, pop rock, folk rock, reggae, ska, reggaetón, salsa y bossa nova. El mapa tiene **58 de 282 categorías descritas**: las cinco descripciones editoriales conservadas y 53 propuestas. Faltan 224. Solo cuatro perfiles documentan los seis aspectos; los demás muestran expresamente los que aún carecen de sustento. No se sustituye un hueco de producción por una afirmación genérica ni se cuenta contenido de letras como entrega vocal.

`genre-source-captures.json` fija 32 capturas de las fuentes consultadas, con URL solicitada/final/canónica, título, fecha UTC de captura, bytes, SHA-256 y secciones. Las 21 referencias anteriores sin snapshot se declaran aparte; no se presentan como capturadas o verificadas hoy. El libro fija la huella de ese manifiesto. `readGenreKnowledge` valida el manifiesto, las capturas, sus títulos/URLs/secciones y su correspondencia con las referencias del libro antes de regenerar conocimiento. No acepta una página bloqueada como artículo, capturas modificadas ni enlaces simbólicos que apunten fuera del archivo de investigación. Todo se verifica offline; el panel interactivo sigue leyendo el artefacto derivado y no descarga páginas.

Las fuentes son entradas enciclopédicas consultadas individualmente y conservadas para trazabilidad. Los perfiles son síntesis analíticas propuestas, no corroboración independiente ni mediciones de frecuencia. Cada rasgo conserva fuente, grado definitorio/frecuente/variable y límite. R&B e indie rock explicitan cambios de significado; el metal histórico no impone técnicas extremas a todas sus ramas. La descripción de un género no acredita voz, instrumentos, técnica, emoción, energía, uso o ausencia de un rasgo en una grabación.

`npm run search:genres:audit` genera `verification/genre-source-audit.json` sin consultar ni escribir la base: verifica fuentes, versión/definición/rasgos del mapa derivado, preservación de descripciones editoriales y ausencia de autorización de asignaciones. Registra cobertura y lista las categorías y aspectos pendientes. Los snapshots se conservan bajo `data/research/unified-search-genres-2026-10-17`; la API administrativa no expone esas rutas ni el HTML.

Verificación: `verification/genre-expansion-result.json`, 17 unitarias de integridad/identidad/alcance de fuentes y regresión del cruce, typecheck backend, lint de los archivos de esta pasada, regeneración del inventario/estudio y conservación de las 86 disposiciones y 36 expectativas de consultas. Navegador 1440/390 con bossa nova y sus fuentes, filtros, paginación y flujos anteriores: `browser-genre-expansion/report.json`. No se ejecutó otra inferencia Laya: las 21 entradas se conservan. No hubo escrituras operativas, publicaciones, despliegue o migraciones. E2-01 y el objetivo completo siguen pendientes.


### Tradiciones regionales y categorías funcionales — corte 0.6.0

Este corte añade 32 propuestas: gaita, gaita de furro, fulía, tamunangue, merengue venezolano, aguinaldo, tonada, calipso, bachata, galerón, vals venezolano, onda nueva, bolero, merengue, cumbia, tango, vallenato, samba, son, cha-cha-cha, mambo, guaracha, guaguancó, descarga, timba, soca, banda sonora, bandas sonoras, instrumental, spoken word, música infantil y música navideña. El mapa pasa a **90 de 282 categorías descritas**: cinco textos editoriales conservados y 85 propuestas documentadas. Quedan 192 categorías sin descripción. Cuatro perfiles cubren los seis aspectos; los demás mantienen los aspectos pendientes explícitos. Estas cifras sustituyen las del corte 0.5.0 para el estado actual, sin alterar su evidencia histórica.

Las categorías distinguen estilo, tradición regional, agrupación regional, función, característica musical y práctica interpretativa. Cada tipo distinto de estilo requiere explicar los límites de su perfil. Una categoría funcional o agrupación regional puede documentarse sin inventar instrumentos, ritmo o producción comunes. El panel muestra sus fuentes aunque no tenga rasgos sonoros. Instrumental no determina el tipo de publicación; banda sonora no convierte un video en disco. No se modifican jerarquías, alias ni asignaciones del catálogo.

El manifiesto 0.2.0 verifica **66 capturas**, incluidas cuatro páginas institucionales de UNESCO: cantos de trabajo del llano colombo-venezolano, joropo venezolano, merengue dominicano y bolero. Las 21 referencias heredadas sin snapshot siguen identificadas aparte. El lector institucional exige selector de artículo explícito y contenido legible, además de las comprobaciones de huella, título, URL, ruta y secciones. Cuando la fecha procede del archivo inicial conservado, se declara `initial_snapshot_file_mtime`; no se inventa una fecha de publicación o actualización documental.

El contraste de identidad conserva una consulta de solo lectura de 14 categorías y sus alias en `verification/regional-catalog-meanings.json`. Calipso queda acotado a El Callao, galerón a la acepción oriental, y los merengues venezolano, dominicano y vallenato no se funden por su nombre. La documentación de joropo añade el marco regional de UNESCO sin generalizar los rasgos llaneros previos. `regional-source-review.json` conserva las exclusiones: la página española de galerón no acredita la acepción requerida, dos rutas devolvieron 404 y una fuente ministerial no pudo capturarse. Ninguna se cuenta como apoyo utilizado.

Verificación: `verification/regional-result.json`, 19 unitarias en tres archivos, siete contratos con PostgreSQL desechable, 36 planes de consultas, conservación de las 86 disposiciones semánticas, auditoría reproducible de fuentes, typecheck backend/web, build web y lint acotado. `browser-regional/report.json` comprueba escritorio 1440 y móvil 390; se inspeccionaron las capturas de banda sonora y tonada, sus límites y fuentes, sin errores JavaScript ni desbordamiento. La regresión usa corpus real con IDs de revisión sintéticos; no acredita operación editorial real ni revisión musical independiente. No se ejecutó otra inferencia Laya ni hubo escrituras en la base operativa, publicaciones o despliegue. E2-01 sigue parcial y la etapa 2 continúa abierta.


### Rock, punk y tradiciones jamaicanas — corte 0.7.0

Se incorporan 21 propuestas: rock and roll, rockabilly, surf rock, glam rock, rock sureño, soft rock, jangle pop, pop punk, post-hardcore, hardcore punk, crust punk, anarcopunk, street punk, psychobilly, ska punk, rocksteady, roots reggae, dancehall, ragga, disco y country. El mapa tiene **111 de 282 categorías descritas**: cinco textos editoriales preservados y 106 propuestas. Faltan 171 descripciones. Cinco perfiles documentan los seis aspectos; los huecos restantes siguen explícitos. Rockabilly incorpora forma, entrega vocal y procedimientos de eco documentados; las estructuras de surf instrumental no se heredan a su vertiente vocal.

Las 21 páginas utilizadas se leyeron individualmente y se conservaron en el manifiesto, que ahora verifica 87 capturas, cuatro institucionales, además de 21 referencias heredadas sin snapshot. Las síntesis mantienen los límites entre escena y sonido: vestuario glam no acredita timbre, anarcopunk no implica baja fidelidad, religión histórica del roots no describe la fe de cada intérprete y baile no autoriza una recomendación de actividad. Se conservan variaciones de tempo, voces y producción sin inferirlas para grabaciones individuales.

`rock-source-review.json` registra dos descargas sin artículo utilizable, Power pop y Post-grunge, que no se incorporaron. Oi! conserva la captura de investigación fuera del manifiesto utilizado: la lectura revisada aporta historia de la escena, pero no un perfil sonoro suficiente para completar su propuesta. No se presentan estos casos como descripciones realizadas.

La auditoría ahora contrasta también ámbito histórico/geográfico, estado, analista, aspectos pendientes y recuentos del mapa contra el libro. Conserva sus tres entradas exactas en `reports/unified-search-stage2/cuts/<versión>` y rechaza que una versión existente cambie de contenido. El corte 0.6.0 se reconstruyó con coincidencia exacta de las tres huellas registradas originalmente; el 0.7.0 se guarda directamente. Las fuentes HTML compartidas mantienen sus nombres por hash. `cuts/README.md` explica la conservación y sus límites.

Verificación en `verification/rock-result.json`: 13 pruebas de fuentes/perfiles y tres de conservación de cortes, typecheck backend, lint acotado, auditoría de fuentes repetida con éxito, 36 expectativas de consultas y 86 disposiciones semánticas conservadas. El estudio mantiene cinco álbumes, 28 reseñas, 21 anotaciones y ocho obras reservadas; sus huellas de entrada no cambian. No hubo cambios de interfaz, nueva inferencia Laya, publicaciones, despliegue ni escrituras operativas. No se repitieron los contratos PostgreSQL ni la revisión visual de la pasada regional: se conservan como evidencia de su propio corte, sin atribuirles una ejecución nueva. La etapa sigue abierta.


### Metal y cruces — corte 0.8.0

El libro añade 23 propuestas: power metal, power metal sinfónico, groove metal, nu metal, metal alternativo, metal progresivo, metal sinfónico, black metal sinfónico, metal gótico, folk metal, sludge metal, stoner rock, stoner metal, drone metal, death metal melódico, death metal técnico, deathcore, metalcore, goregrind, deathgrind, crossover thrash, djent y post-metal. El mapa tiene **134 de 282 categorías descritas**: cinco textos editoriales preservados y 129 propuestas. Quedan 148 descripciones pendientes. Cinco perfiles documentan los seis aspectos; los demás conservan huecos explícitos.

Se incorporan 20 fuentes capturadas y leídas individualmente. El manifiesto verifica 107 snapshots, cuatro institucionales, y conserva aparte 21 referencias heredadas sin snapshot. Las dos variantes stoner usan una misma fuente, que trata sus nombres conjuntamente; esto no acredita una frontera sonora exclusiva ni autoriza fusionar las categorías CRV. La variante black sinfónica está documentada en una sección expresa y la rama power sinfónica en la introducción de su fuente; no se obtienen por combinar nombres o heredar atributos.

Se distinguen acabado crudo de metalcore temprano y producción moderna por capas; voces limpias y extremas variables; recursos instrumentales reales y simulaciones mediante teclados; pulso desdibujado y ausencia vocal, que requieren evidencia específica. Djent conserva la discusión sobre su condición de género. El contenido histórico de letras y escenas no acredita ideología, emoción o actividad de una grabación. `metal-source-review.json` registra las descargas de Speed metal, Industrial metal y Grindcore sin artículo utilizable, que no se incorporaron.

El contrato del manifiesto rechaza ahora URL canónica repetida o bytes idénticos bajo distintas fuentes. Una redirección no aumenta el número de documentos utilizados. Se conserva el corte 0.8.0 con sus entradas exactas; las 106 propuestas y 87 capturas del 0.7.0 permanecen idénticas. `verification/metal-input-preservation.json` registra esa comparación.

Verificación: `verification/metal-result.json`, 14 unitarias en una ejecución final aislada, typecheck backend, lint acotado, auditoría de fuentes/corte, 36 expectativas de consultas y 86 disposiciones semánticas conservadas. Dos corridas anteriores coincidieron en un registro de salida; ese archivo se conserva como `metal-unit-tests-interleaved.log` y no se utiliza como prueba de aceptación. No se repitieron pruebas visuales ni contratos PostgreSQL al no cambiar interfaz o rutas operativas. El estudio conserva cinco álbumes, 28 reseñas, 21 anotaciones y la reserva de ocho obras. No hubo nueva inferencia, publicaciones, despliegue o escrituras operativas. La etapa permanece abierta.


### Electrónica, hip-hop y jazz — corte 0.9.0

Se añaden 23 propuestas: electrónica, EBM, aggrotech, futurepop, darkwave, coldwave, ethereal wave, tech house, future house, trance, noise, turntablism, trap, trap latino, drill, gangsta rap, rap metal, rap experimental, nu jazz, jazz latino, jazz afrocubano, smooth jazz y big band. El mapa alcanza **157 de 282 categorías descritas**: cinco textos editoriales conservados y 152 propuestas. Quedan 125 descripciones pendientes. Seis perfiles documentan los seis aspectos; EBM añade un perfil completo con cada rasgo atribuido a su fuente. El resto mantiene sus aspectos pendientes explícitos.

El contrato y el panel incorporan tres tipos propuestos: familia de estilos, categoría temática y formación musical. Estas distinciones no reclasifican el catálogo. Una familia o categoría temática puede documentarse sin inventar un sonido uniforme, siempre con límites y fuentes; una formación requiere características documentadas. Big band diferencia formación y repertorio de un estilo concreto. Gangsta rap conserva la delimitación temática sin convertir temas de letras en técnica vocal, instrumentación o biografía. Turntablism queda como práctica interpretativa. Electrónica no se reduce a baile y la clave afrocubana no se hereda a todo jazz latino.

Las 23 fuentes nuevas se leyeron y archivaron; el manifiesto verifica 130 capturas, cuatro institucionales, y mantiene 21 referencias heredadas sin snapshot. Las redirecciones de Aggrotech a Electro-industrial y de Experimental hip-hop a Alternative hip-hop se utilizan por sus secciones específicas, sin presumir equivalencia entre todos sus contenidos. Industrial music sigue sin incorporarse porque la descarga no proporcionó un artículo utilizable. `electronic-source-review.json` registra esas decisiones.

Se conserva el corte 0.9.0 con sus tres entradas exactas. Las 129 propuestas y 107 capturas del 0.8.0 permanecen intactas. La comprobación inicial rechazó los paréntesis del nombre de archivo de Cold wave; se conservó una copia de los mismos bytes bajo un nombre válido y se actualizó la huella del manifiesto, sin relajar el contrato de rutas.

`verification/electronic-result.json` registra 15 unitarias, siete contratos con PostgreSQL desechable, typecheck backend, build web con typecheck y lint acotado. La auditoría conserva las fuentes y el corte; las regresiones mantienen 36 planes de consultas, 86 disposiciones semánticas y las 21 anotaciones sin otra inferencia. `browser-electronic/report.json` comprueba escritorio 1440 y móvil 390 con Big band y Gangsta rap, sus tipos/límites/fuentes, filtros, paginación y flujos editoriales simulados, sin errores JavaScript ni desbordamiento. Se inspeccionaron las cuatro capturas de esos perfiles. No hubo escrituras operativas, publicaciones o despliegue. La etapa continúa abierta.

### Idiomas de publicación — adaptador parcial R06

`npm run search:languages:study` conserva el campo `Language`/`Languages` de las cinco fichas de desarrollo en `reports/unified-search-stage2/release-languages.json`. Kill Sound Before Sound Kills You indica English; Esto no es un show, Caribe Caribe y La frontera indican Spanish; Tierra de nadie indica Spanish, English. Son atribuciones de las fichas de publicación, sin comprobar la cobertura por pista o una edición concreta. No acreditan traducciones, comprensión del oyente ni ausencia de voz.

El adaptador separado `src/search/rym-release-language.ts` reutiliza la validación de huella, URL canónica, encabezados y vínculo documental, sin modificar las anotaciones de reseñas ni sus versiones de extracción. El comando revalida las identidades contra el catálogo con consultas SELECT y conserva las huellas HTML/JSON, literal, localizador y fecha original sin inventar huso horario. Solo normaliza English/Spanish a en/es en este corte; otros valores permanecen sin resolver. Campos ausentes o vacíos son desconocidos; Instrumental no se convierte en idioma. Campos duplicados o estructuras ambiguas detienen la extracción. Se excluyen texto de reseñas y descriptores del campo de idiomas.

El inventario comprueba las entradas por huella y vuelve a extraer los campos antes de presentar R06 como extracción parcial. `resource-uses.json` conserva expresamente la falta de cobertura completa, condiciones por unidad y consulta pública. Esta vía todavía no alimenta la cola de decisiones ni los filtros públicos. Las ocho obras de reserva siguen cerradas; no hubo nueva inferencia Laya, publicaciones, despliegue ni escrituras operativas. `verification/language-result.json` y sus registros detallan la verificación y conservación del estudio anterior. La etapa permanece abierta.


### Tradiciones académicas y categorías transversales — corte 0.10.0

Se añaden trece propuestas: música clásica, música antigua, música de cámara, música sacra, ópera, nacionalismo musical, electroacústica, avant-garde, experimental, folk, folk celta, new age y música cristiana contemporánea. El mapa alcanza **170 de 282 categorías descritas**: cinco descripciones editoriales conservadas y 165 propuestas. Quedan 112 descripciones y los aspectos no documentados permanecen explícitos. Hay 143 capturas verificadas y 21 referencias heredadas sin snapshot. El corte conserva las 152 propuestas y 130 capturas anteriores sin cambios, además de anotaciones, inferencias Laya y reserva con sus huellas anteriores.

Se distinguen repertorio histórico, familia estilística, conjunto, práctica, contenido y función religiosa. Cámara no acredita relajación; nacionalidad no acredita nacionalismo; new age no acredita una actividad de escucha; tema cristiano no prueba función litúrgica. La categoría ópera no permite crear un disco por la sola existencia de un video. Música coral permanece pendiente: la descarga de Choir no contenía artículo utilizable. `academic-source-review.json` conserva esa exclusión.

Se corrigieron dos defectos de evaluación: `study-crossing.ts` informaba incondicionalmente que el contexto no había cambiado la interpretación, sin disponer de lecturas ciegas antes/después. Los 21 cruces regenerados ahora conservan `interpretationChangedAfterContext: null` y `contextComparisonStatus: not_evaluated`. Esto registra falta de evaluación, sin inventar acuerdo ni desacuerdo. `knowledge-evaluation.ts` rechaza IDs de segunda lectura ajenos a la muestra para impedir que inflen precisión y normaliza espacios, mayúsculas y Unicode al comprobar si es el mismo analista. Diferentes nombres siguen sin acreditar independencia.

`verification/academic-result.json` registra 18 pruebas de perfiles/fuentes/cortes y 17 de conocimiento/cruce, typecheck backend y lint de los cuatro archivos modificados. El estudio conserva cinco álbumes, 28 reseñas y 21 anotaciones; las regresiones mantienen 36 planes de consulta y 86 disposiciones semánticas. La primera auditoría se adelantó a la regeneración del mapa y falló por versión; su log se conserva, se excluye de aceptación y se repitió correctamente después. El corte 0.10.0 conserva las entradas exactas verificadas. No hubo cambios de interfaz o rutas, nueva inferencia, publicaciones, despliegue o escrituras operativas; no se atribuyen pruebas visuales o PostgreSQL nuevas a este corte. La etapa 2 sigue abierta, incluida la evaluación musical independiente.


### Rock, pop y punk — corte 0.11.0

Se añaden otras trece propuestas: art rock, pop psicodélico, space rock, rock electrónico, rock instrumental, rock gótico, deathrock, doo-wop, easy listening, beat, folk punk, horror punk y hardcore melódico. El mapa alcanza **183 de 282 categorías descritas**: cinco textos editoriales preservados y 178 propuestas. Quedan 99 descripciones y los aspectos ausentes continúan explícitos. El manifiesto verifica 156 snapshots; sus 21 referencias históricas sin captura permanecen diferenciadas. Se conservan sin cambios las 165 propuestas y 143 snapshots del corte 0.10.0.

Art rock y easy listening conservan su amplitud; instrumental no significa necesariamente ausencia vocal absoluta. Las influencias vocales, rítmicas y de producción no se trasladan a obras sin evidencia propia. Historia de escena y estética visual tampoco acreditan sonido, ideología o experiencia personal.

`pop-source-review.json` registra las exclusiones: siete descargas sin artículo legible (Art pop, Power pop, Post-grunge, Industrial music, Industrial metal, Grindcore y Speed metal), AOR como desambiguación insuficiente, Oi! sin perfil sonoro suficiente en la lectura utilizada y Twist como fuente de baile, sin convertir movimientos del cuerpo en atributos musicales. No se cuentan como géneros documentados.

La evidencia del corte está en `verification/pop-result.json`, `verification/pop-input-preservation.json` y `cuts/0.11.0/inputs.json`. No se modifican interfaz, rutas o autoridades editoriales. Se conserva la muestra de cinco álbumes y sus 21 anotaciones, las inferencias Laya y las ocho obras reservadas; no se abre la prueba final ni se acredita independencia musical. La etapa sigue en curso.


### Sincronización reanudable del estudio con la cola existente

`npm run search:knowledge -- sync-study --dry-run` prepara el corte sin encolar. `sync-study` sincroniza hasta diez lotes por invocación. Si devuelve `nextCursor`, se pasa su JSON literal como `--cursor '<JSON>'`; un cursor de otro corte se rechaza antes de escribir. Reiniciar desde cero conserva los jobs existentes. La versión de extracción o de esquema debe cambiar si cambia el contenido de una propuesta sobre los mismos bytes; una colisión no se resuelve sobrescribiendo evidencia.

`src/search/knowledge-sync.ts` conecta las anotaciones de desarrollo R04 y el manifiesto con `search_knowledge_jobs`. Antes de encolar cualquier lote verifica todas las afirmaciones, huellas, citas, autores, fechas, localizadores, notas individuales y por pista, fuentes y vínculos vigentes con IDs de álbum/pista. Las identidades se consultan en una transacción de solo lectura con snapshot coherente y límites de sentencia/bloqueo; los archivos de identidad y planes de importación también quedan fijados por huella. La reserva se comprueba antes de abrir su HTML. Archivos fuera del proyecto o del archivo de capturas, symlinks ajenos, estructuras ambiguas y cambios durante la preparación detienen el corte.

La identidad de fuente usa publicación y página, sin incluir hash o versión del estudio. Una captura cambiada conserva esa identidad y obtiene otra clave idempotente; reprocesar con otra versión no se confunde con una fuente nueva. El encolado utiliza la transacción y clave única de la cola existente, con timeout de sentencia de cinco segundos y de bloqueo de 500 ms. Dos sincronizaciones concurrentes no crean jobs efectivos duplicados. Se mantienen los límites de extracción y las decisiones editoriales previas. No se añade tabla, cron, timer, capturador o modelo paralelo.

La preparación está acotada a veinte segundos, archivos de hasta veinte MiB y 128 MiB de lecturas controladas; se limita a 5.000 afirmaciones/capturas y a veinte jobs por llamada de la función. Un corte mayor debe dividirse. No se solicitan inferencias GPU durante la sincronización. El tablero Alimentación distingue **Fuente nueva**, **Captura cambiada** y **Nueva extracción de la misma captura**, tomando como referencia el lote anterior de la misma fuente, sin revelar rutas, cuentas o entradas privadas.

Este adaptador utiliza anotaciones ya redactadas y verificadas: no inventa afirmaciones a partir de capturas sin anotar. Todavía faltan adaptadores para los demás recursos, tratamiento completo de nuevas capturas sin anotación/identidad resuelta y ampliación musical del corpus. La etapa sigue abierta; no se convierten el ensayo, los indicadores del tablero o la idempotencia en aprobación musical.

Verificación en `verification/sync-result.json`: 26 unitarias, 16 contratos sobre PostgreSQL desechable, typecheck backend, build web con typecheck y lint acotado. El ensayo de cadena v2 usa el adaptador real: siete jobs, 21 afirmaciones, 21 interpretaciones Laya ya existentes y 21 casos; repetir el corte no añade jobs, unidades o inferencias. La prueba de bloqueo de encolado comprueba timeout, rollback y reintento sobre el mismo corte. `browser-sync/report.json` verifica 1440/390, los tres indicadores, navegación al caso, formularios simulados, errores/reintento y ausencia de desbordamiento. Se conservan el mapa, las anotaciones, el modelo y la reserva; no hubo migraciones/escrituras operativas, publicaciones o despliegue.

Se conservaron dos fallos iniciales fuera de aceptación: una aserción de privacidad usaba una frase musical genérica que ahora también aparece en una descripción legítima; se reemplazó por un canario exclusivo de la reseña privada. La prueba visual buscaba una etiqueta exacta dentro de una celda que también contenía el ID y fuente; se corrigió su localizador sin ocultar contenido ni relajar la comprobación de los tres indicadores.


### Revisión por recurso y campo del anexo A — revisión 0.2.0

`docs/unified-search/stage2/resource-field-review.json` dispone explícitamente los 44 recursos y 99 grupos de campos: ocho reutilizaciones existentes, ocho extracciones parciales, cuatro antecedentes de desarrollo, tres propuestas analíticas, 74 diferimientos y dos exclusiones de campos de R16. Cada grupo conserva términos de origen, alcance, razón, tarea y referencias cuando acredita uso. Es una revisión analítica de aprovechamiento/diferimiento; ninguna fila autoriza publicar datos musicales ni presenta disponibilidad como integración.

Se contrastan IDs, nombres, campos y criterios de las 44 filas contra el anexo A original y el registro de recursos. Los literales técnicos del anexo no pueden quedar sin disposición. Registro, plan e informe de recursos se fijan por huella, junto a 32 archivos de evidencia. Se distingue extracción desde HTML de la mera presencia de campos JSON; las notas individuales, de pista, comunitarias y de discografía no se mezclan. Título de reseña y utilidad permanecen diferidos porque el extractor no tiene esos campos. La integración específica de decisiones emocionales históricas con nuevos adaptadores de tags sigue diferida; conservar sus reglas no se presenta como consumir esa tabla. Las 133 consultas humanas se conservan separadas de las 56 del piloto y de los 36 planes ejecutados. Las fuentes sin adaptador reciben motivos por objeto, edición, semántica o procedencia, con tareas concretas.

`npm run search:resources:audit` valida las fuentes y conserva un corte inmutable en `reports/unified-search-stage2/resource-cuts/<revisión>/`: documento, manifiesto y bytes exactos de todos los inputs/pruebas por hash, incluidos código y artefactos. Repetir no duplica ni sobrescribe; cambiar bytes de una revisión existente exige otra revisión. Se conserva el primer corte 0.1.0 y el 0.2.0, que incorpora expresamente el criterio de las 133 consultas. Los snapshots son archivo documental, no una segunda base de decisiones musicales.

El inventario genera `resource-uses.json` v2 con disposición por campo y resumen compatible. El endpoint administrador verifica las huellas antes de ofrecer el detalle, proyecta solo etiquetas, estados, alcance, razones, tareas y cantidad de referencias y mantiene las rutas y términos privados fuera de la respuesta. Un documento ausente se distingue de una revisión existente con evidencia obsoleta o faltante: esta última se rechaza, sin mostrarla como verificada. El tablero conserva sus otras lecturas y marca el detalle pendiente de revalidación, sin revelar el error o la ruta de captura.

Alimentación conserva su tabla y abre el recurso seleccionado en una fila de ancho completo, con medida de lectura adaptada al móvil. El detalle recibe foco, el botón anuncia expansión y el cierre devuelve el foco al botón de origen. Se mantiene el scroll horizontal de la tabla sin restringir la explicación a su última columna. La tabla densa conserva su tamaño de texto; el detalle usa el cuerpo de 15 px. La prueba visual comprueba teclado, foco, los estados de R03/R16/R39, contraste, medida, controles de 44 px y ausencia de desbordamiento, además de las funciones previas del panel.

`verification/resource-field-result.json` y `verification/resource-field-input-preservation.json` registran pruebas, contratos, typechecks, build, lint, lecturas de navegador y conservación. La revisión por campo satisface la salida documental E2-08 de uso o diferimiento motivado por fila, sin dar por integrados sus 74 grupos diferidos. E2-01/02/03/04/05/07/09/10/11 conservan sus pendientes y la etapa 2 sigue abierta. No se aplicaron migraciones, clasificaciones, publicaciones o despliegues operativos.

### Relectura explícita del piloto: Ladies W.C.

El corte `crv-development-readings-0.5.0` conserva idénticas las 21 anotaciones de las cinco obras nuevas y añade 14 unidades de Ladies W.C. **Es una relectura del piloto, no una sexta obra nueva ni una evaluación independiente.** El balance es cinco obras nuevas (28 reseñas) y una relectura (nueve reseñas), seis álbumes de cinco artistas, 37 reseñas leídas y 35 anotaciones. Dos obras nuevas y la relectura tienen dos páginas útiles; tres obras nuevas conservan su estrato de excepción de una página. Las ocho publicaciones reservadas permanecen excluidas del diseño.

La protección del inventario rechazó la selección inicial de Ladies W.C. como suplemento nuevo: ya estaba en el corpus base y en el piloto. Se corrigió el rol explícitamente, se usaron las dos páginas locales y se leyó también su novena reseña. La inaccesibilidad de una consulta web actual no invalida las capturas locales existentes. Esa novena cuenta rectifica una crítica inicial porque había confundido el álbum con otro; la afirmación corregida no satisface un filtro vocal. No se inventa fecha de edición o revisión del texto.

La identidad reutiliza álbum 234, artista 142 y diez pistas existentes. Un título aceptado, los encabezados y la secuencia completa A1–B5 cotejada con 1–10 documentan el vínculo. Se conservan las etiquetas del vinilo y se excluyen listas de ratings dentro de reseñas del repertorio canónico. Numeraciones mixtas, lados saltados y títulos contradictorios requieren revisión. No se identificó edición; la diferencia 1968 en ficha/1969 en una reseña queda pendiente. No se crearon entidades ni se usó un video como prueba suficiente de edición musical.

Las tres menciones explícitas de guitarra fuzz se analizan como recurrencia provisional de descripciones atribuidas, sin acreditar independencia personal ni consenso. Una cuarta cuenta describe canciones fuzzy sin identificar instrumento: se conserva en otro aspecto. Armónica elogiada en algunas canciones y armónica considerada excesiva en una pista mantienen sus ámbitos y apreciaciones. La voz inconsistente, repetición, duración deseada y efectos entre canciones tienen unidades distintas; la nota global no decide su verdad.

La cuenta que respalda a otro reseñista desconocido sobre pistas cortas conserva `third_party`, referencia no resuelta y cadena dependiente. `analyzePattern` mantiene los testigos pero excluye citas, duplicados, revisiones, reseñas conjuntas y terceros no resueltos del umbral de recurrencia. El evaluador de consultas muestra esas dependencias en la evidencia atribuida. No se identifica al tercero por parecido de opinión.

El cruce conserva una versión de lectura por captura y cada anotación anterior conserva su versión de estudio. Ampliar el corte no obliga a reinterpretar entradas iguales. Laya multilingüe ejecutó 14 inferencias nuevas y reutilizó las 21 anteriores con igualdad exacta de entrada y metadatos; sus probabilidades no son adjudicación musical. La matriz 0.3.0 ejecuta 53 planes authored contra 35 unidades, incluyendo conjunción guitarra/voz, rectificación y rechazo de herencia entre álbum, pista y segmento. Son planes tipados de desarrollo, sin parser libre o ranking público evaluados. El análisis incluye quince comparaciones y alternativas.

La revisión por campo 0.3.0 conserva los 44 recursos/99 grupos y archivos inmutables anteriores. Actualiza la cobertura acotada de seis fichas, distinguiendo el piloto. El inventario puede regenerar sus artefactos con evidencia de revisión obsoleta: devuelve `needs_review`, oculta el detalle y mantiene R16 excluido. Tras revalidar vuelve a `verified`; una prueba obsoleta nunca se presenta como verificada. Esto evita un ciclo de dependencia entre regenerar artefactos y verificar sus huellas.

`verification/ladies-wc-result.json` registra 64 unitarias, 26 contratos con PostgreSQL desechable, typecheck y lint, planes, inferencias y ensayo de nueve jobs/35 unidades/35 interpretaciones sin duplicación. Conserva la comparación exacta con `study-cuts/development-0.4.0`. No se realizaron escrituras/migraciones en la base operativa, asignaciones automáticas, publicaciones o despliegues. La etapa sigue abierta: faltan otras obras nuevas, cobertura descriptiva de géneros, recursos/ediciones y evaluación musical independiente.

### Cobertura de estilos y categorías — mapa 0.12.0

Se incorporan catorce propuestas: art pop, power pop, post-grunge, industrial, metal industrial, grindcore, speed metal, rock acústico, rock experimental, rock latino, death and roll, white metal, noisecore y heavy rock. El mapa conserva las 178 propuestas y 156 snapshots anteriores como valores idénticos; los 282 IDs, nombres y cinco descripciones editoriales tampoco cambian. La cobertura pasa a 197 categorías descritas (192 propuestas y cinco textos editoriales), con 85 todavía sin descripción. Siete perfiles tienen documentados los seis aspectos; los huecos restantes siguen visibles.

Se distinguen los paraguas estilísticos, los estilos y las categorías de otra naturaleza. White metal se documenta como categoría temática, sin inventar un sonido común o inferir creencia personal. Rock acústico se trata como enfoque instrumental: la fuente describe música acústica general y su aplicación a una obra de rock requiere evidencia específica. Heavy rock conserva la relación terminológica documentada con hard rock sin fusionar IDs o asignaciones humanas. Rapidez de speed metal o grindcore no determina niveles de energía de CRV; rock latino no se equipara a cualquier rock de América Latina o cantado en español.

AOR permanece sin resolver: la sigla tiene usos distintos y la página de adult-oriented rock es una desambiguación. La redirección de symphonic rock a progressive rock no se cuenta como otra autoridad ni se usa como definición suficiente del ID rock sinfónico. Las capturas de escena Oi! y del baile twist tampoco se convierten en perfiles musicales no documentados. `cross-style-source-review.json` conserva estas decisiones y los límites de cada propuesta.

El lector temporal de captura inicialmente seleccionaba la primera caja `.mw-parser-output`, que en varias páginas era una ficha sin párrafos. Se corrigió para seleccionar el artículo con más párrafos, verificando contenido, título y URL; no se modificó el contenido de las fuentes. Trece snapshots nuevos se incorporan al manifiesto: 169 capturas verificadas en total, cuatro institucionales y 21 referencias históricas todavía sin snapshot. La auditoría conserva el corte inmutable `cuts/0.12.0`; las descripciones propuestas no son validación musical de obras.

La revisión documental de recursos 0.4.0 vuelve a fijar el mapa por huella y conserva sus 44 recursos/99 grupos. Solo se refrescan mapa y proyección de recursos: no se regenera el manifiesto de reseñas ni se cambia la entrada de Laya. Las entradas del ensayo anterior siguen vigentes y las unidades/modelo del corte de estudio 0.5.0 se conservan. Las pruebas de API y archivo ahora cotejan la revisión vigente del documento y generan una revisión distinta para probar inmutabilidad, evitando anclar ese comportamiento a un número de revisión histórico.

`verification/cross-style-result.json` registra 26 pruebas unitarias, diez contratos en PostgreSQL desechable, lint y navegador 1440/390. El navegador usa el mapa real con respuestas API simuladas y comprueba las categorías de white metal/rock acústico, fuentes, cobertura, filtros, paginación y ausencia de desbordamiento, además de la regresión del panel de recursos. La integridad de snapshots y los checks verdes no sustituyen evaluación musical independiente. No se modificó código de producción ni se realizaron inferencias, escrituras operativas, asignaciones, publicaciones o despliegues. La etapa sigue abierta.

### Mapa 0.13.0, segunda lectura independiente y estudio 0.6.0 (Claude)

**Mapa 0.13.0.** Se agregan 53 propuestas redactadas por Claude sobre 39 capturas nuevas de Wikipedia en español e inglés: joropo y sus golpes, golpe tocuyano, polo y joropo oriental, vals andino, bambuco, tambor afrovenezolano y sangueo, raptor house, tecnomerengue, flamenco, nueva canción y nueva trova, balada, pop latino, salsa romántica, metal extremo y sus vertientes de black y death, música coral y cantautor, entre otras. La cobertura sube a 250 de 282 categorías (245 propuestas y cinco textos editoriales). Las 32 que faltan aparecen en `stage2/completion-source-review.json`, cada una con su motivo y su próxima tarea. Entre ellas: AOR, neoclásica (con dos acepciones en el catálogo), guasa, malagueña, motivo guaiquerí y fusión latina. También se descartaron capturas de acepciones ajenas al catálogo (Gabán como prenda, Guasa como pueblo de Huesca, la jota española, la gaita de fole) y redirecciones como dark metal → gothic metal; nada de eso se usó como fuente. Las 192 propuestas anteriores no cambian. El corte inmutable queda en `cuts/0.13.0` y la revisión de recursos pasa a 0.6.0.

**Segunda lectura (E2-03/05/07).** Claude revisó las 35 anotaciones del corte de estudio 0.5.0 en dos pasos:
- una primera pasada a ciegas, solo con la cita, el idioma y la obra;
- una comparación campo por campo con las anotaciones de Codex, resolviendo cada desacuerdo con la reseña completa en la captura fijada por huella.

Resultados:
- errores de alcance: 0;
- generalizaciones sin soporte: 0;
- precisión de soporte: 34 de 35 (0,971).

Se proponen tres rectificaciones, sin aplicarlas: la valoración de E2-L09 debería ser mixta, no un rechazo, y a E2-C03 y E2-C04 les falta registrar la condición «At its peaks». La lectura ciega de Claude también se equivocó dos veces: en E2-W05 la frase era un sample, no una letra, y en E2-C04 había marcado un duplicado que no lo era. Ambos errores quedan registrados.

Los tres umbrales propuestos se cumplen, pero esto no es una evaluación humana ni los aprueba. `src/search/independent-review.ts` recalcula los acuerdos en vez de fiarse de los declarados y rechaza citas cambiadas o anotaciones sin revisar. Tanto esta revisión como la semántica de Codex quedan fijadas al corte inmutable `study-cuts/development-0.5.0`, para que la ampliación no extienda sus decisiones en silencio.

**Estudio 0.6.0 (E2-03/04/05/09/10).** Se suman dos obras nuevas, usando solo reseñas preseleccionadas por el protocolo de muestreo:
- *Pateando piedras* de Los Prisioneros (synth-pop/new wave chileno de 1986, reseñas en español e inglés). Identidad por claim aceptado con la URL RYM exacta.
- *Mutant* de Arca (electrónica experimental venezolana de 2015). Identidad por título aceptado más repertorio.

Suman 31 anotaciones de Claude, con la autoría registrada por lectura; las 35 previas no cambian ni un byte. Contrastes nuevos:
- ausencias declaradas por pista sin cobertura (sin teclados, sin instrumentos acústicos), que no satisfacen exclusiones;
- «sin palabras» contradicho por «texto escaso en español»;
- duración percibida en desacuerdo;
- dos comparaciones con The Cure y una estructural con Depeche Mode;
- valoraciones opuestas sobre una misma oscuridad;
- lo bailable como inferencia de estilo y no como actividad;
- una recomendación de auriculares y textos reproducidos de un blog externo (dependencia `quotes`);
- un gusto con alcance de artista, no de álbum.

El estudio admite ahora un aspecto declarado en las comparaciones. Totales: 8 obras, 108 reseñas, 66 anotaciones, 66 cruces y 7 patrones. La matriz pasa a 85 planes con 66 necesidades, entre ellos combinados con O, exclusión, preferencia y condición de escucha, y sus expectativas se revisaron una por una. Laya local reutilizó 35 predicciones e infirió 31. Ensayo en PostgreSQL desechable: 19 jobs, 66 unidades y 66 interpretaciones, y repetir el lote no crea nada. El corte queda en `study-cuts/development-0.6.0`.

`verification/completion-result.json` registra:
- 108 unitarias y 16 contratos;
- el navegador a 1440 y 390 (`browser-completion/`).

No hubo escrituras ni migraciones en la base operativa, ni asignaciones, publicaciones o despliegues.

### Decisiones de Brian y espacio de revisión humana (2026-10-17)

Brian tomó tres decisiones:

- **Umbrales.** Los aprobó tal cual: 0 errores de alcance, 0 generalizaciones sin soporte y precisión ≥ 0,95. Quedan en `independent-review-claude.json` con `status: approved_by_brian`.
- **Rectificaciones.** Se aplicaron las tres de la revisión independiente, en las lecturas 0.7.0.
- **Revisión humana.** Hará él mismo la evaluación y la adjudicación de las 44 correspondencias, desde curaduría.

El espacio queda en tres piezas:

- La migración `0088_search_human_review` crea dos tablas en `ingest`: `search_human_evaluations` y `search_mapping_adjudications`.
- `src/search/human-review.ts` y las rutas bajo `/search/administration/...` aceptan solo administradores.
- Dos páginas en curaduría:
  - **Evaluar lecturas** (`/curaduria/buscador-evaluacion`). Primero se registra una lectura ciega de la cita: objeto, tipo, estado, valoración y alcance. Solo después se revela la anotación del estudio y se pide el juicio. La lectura ciega no se reescribe. Si cambian la cita o la versión del estudio, la evaluación queda obsoleta en lugar de arrastrarse. Las métricas se comparan con los umbrales aprobados.
  - **Correspondencias RYM** (`/curaduria/buscador-correspondencias`). Cada término se aprueba, se corrige con relación y género activo, o se rechaza. Una propuesta pendiente no se aprueba. La decisión no cambia géneros de discos ni artistas.

Verificación:

- contrato `test/contract/search-human-review.test.ts` en PostgreSQL desechable;
- `tsc` de la raíz y de la web;
- navegador con una API simulada que ejecuta la lógica real.

Con la autorización de Brian del 2026-10-17 se aplicó solo 0088, con su registro en `schema_migrations`; 0086 y 0087 siguen pendientes. Además se reinició `crv-api` con systemctl y se desplegó la web. En vivo hay 44 términos con 0 decididos y 66 citas; todos los destinos propuestos son géneros activos.

### Mapas 0.14.0 y 0.15.0 (Claude)

El mapa suma cuatro propuestas:

- **death-metal-old-school**: Death metal > Old school death metal, captura nueva.
- **blackened-crust**: Crust punk > Instrumentation y Black metal > Blackened crust, captura ya verificada.
- **punk-metal**: Punk rock subgenres > Punk metal, captura nueva. Se describe en su acepción amplia y no hereda rasgos del crossover thrash.
- **power-metal-progresivo**: Power metal > Musical characteristics, American style y European style, captura ya verificada.

La cobertura queda en 254 de 282 categorías, con 210 snapshots.

Las otras 28 siguen en `completion-source-review.json` 0.2.0 con su motivo actualizado. Se descartaron redirecciones (latin funk, instrumental metal, technical metal, melodic metal, melodic rock) y páginas sin perfil musical (Oi!, twist).

Tres pendientes esperan una decisión de Brian:

- AOR: elegir entre la acepción radial y la estilística.
- Neoclásica: separar la acepción académica de la del metal.
- Death metal progresivo: Wikipedia lo usa como sinónimo de death metal técnico, que CRV ya describe aparte.

Evidencia y verificación:

- corte `cuts/0.14.0`;
- revisión de recursos 0.8.0, con la huella del mapa actualizada;

El 0.15.0 añade **oi** a partir de es:Oi! (Introducción e Historia). Recoge su linaje: punk, ska y pub rock, con influencia mod, glam, NWOBHM y de los himnos de fútbol. Sus límites impiden inferir ideología o emoción. La cobertura sube a 255 de 282, con 211 snapshots, y quedan 27 pendientes (`completion-source-review.json` 0.3.0).

Folclor fusión también espera una decisión de Brian. es:Fusión_latinoamericana la define como folclore con rock, jazz o música culta, pero en CRV la llevan por asignación editorial Grupo Madera, Maracaibo 15 e Ignacio Figueredo, que toca arpa tradicional.

Verificación del 0.15.0:

- corte `cuts/0.15.0`;
- revisión de recursos 0.9.0;
- 108 unitarias en verde.

### Mapa 0.16.0: acepciones decididas por Brian (2026-10-17)

- **AOR**: adult-oriented rock como estilo, equivalente al arena rock. La desambiguación en:Adult-oriented_rock y en:Arena_rock describen producción elaborada, estribillos de himno, power ballads, efectos de guitarra y teclados. Quedan fuera el formato radial y el uso como sinónimo de soft rock.
- **Neoclásica**: solo metal neoclásico, a partir de en:Neoclassical_metal. Las fichas con la acepción académica, como Modesta Bor, requieren revisión editorial; no se reasignó nada.
- **Death metal progresivo**: sigue distinto del técnico y pendiente de una fuente propia.
- **Folclor fusión**: significa folclore venezolano renovado, sin exigir rock ni jazz, y sigue pendiente de una fuente que lo acredite.

`completion-source-review.json` 0.4.0 registra estas decisiones en `decisionsByBrian`. También deja anotado el conflicto de fuentes de **rock-melodico**: es:Rock_melódico lo lleva a soft rock y la desambiguación de AOR lo asocia al arena rock.

Cobertura: 257 de 282 categorías, con 214 snapshots y 25 pendientes. Evidencia: corte `cuts/0.16.0`, revisión de recursos 0.10.0 y 108 unitarias en verde.

### Cadena de conocimiento en la base operativa (2026-10-17)

Con la autorización de Brian se aplicaron 0086 y 0087, solo en `ingest`, y la cadena corrió sobre datos reales:

- **sync-study**: lotes de 10 con cursor; la primera pasada crea 19 jobs y la repetición crea 0 (19 reutilizados).
- **work**: 21 tramos hasta quedar inactivo, con 66 unidades y 66 casos abiertos en la cola de revisión.
- **Interpretaciones de Laya**: se importaron las 66 con la huella de entrada comprobada; repetir no inserta ninguna.
- **Estado**: 66 extraídas, 66 interpretadas, 66 pendientes de decisión, 0 publicadas y 0 fallidas.
- **Privacidad**: la ruta pública solo devuelve lo publicado (hoy nada) y la de administración responde 401 sin sesión.

E2-10 y E2-11 quedan completas; el detalle está en `verification/operational-feed-result.json`. Las fuentes diferidas del anexo A entrarán por esta misma cadena cuando se activen.

### Relaciones de parecido explicables: R28 (2026-10-17)

`npm run search:similarity` convierte los 14.988 pares «similar» de Aqustico en propuestas explicables, en `reports/unified-search-stage2/similarity-relations.json` (código en `src/search/similarity-relations.ts`).

**Regla de identidad.** Solo cuentan los orígenes probados en el plan Aqustico: nombre exacto más disco en común, o alta creada desde la propia ficha. Son 159 orígenes. Los 11.968 pares que parten de orígenes sin prueba no se usan.

**Resultado:**

- 3.018 relaciones, de las cuales 901 tienen los dos extremos en CRV; los 158 artistas existen en la base.
- 2.117 destinos sin ficha probada quedan como referencia externa y no generan altas.
- 2.039 relaciones son recíprocas.

**Cómo se explica cada relación.** Lleva su posición en la lista de la fuente, la dirección y la reciprocidad. El aspecto es siempre desconocido y la explicación dice expresamente que la fuente no acredita sonido, voz, instrumentos, parentesco ni nacionalidad.

**En la búsqueda.** «Parecido a X» respalda candidatos solo cuando no se pide aspecto; «parecido a X en las guitarras» devuelve `unsupported_aspect`.

**R14 (Last.fm)** sigue diferido: `ingest.lastfm_artist_verifications` está vacía, así que ningún origen tiene identidad verificada.

La revisión de recursos pasa a 0.11.0, con R28 «similarity_pairs» como propuesto. E2-09 queda completa: el segmentador libre corresponde a la etapa 3 y la ordenación a la 4.

### Ediciones del estudio y búsqueda en Venciclopedia (2026-10-17)

**Ediciones.** Ninguna de las 8 obras tiene más de una edición en CRV: seis no tienen ninguna registrada y dos tienen una. Las reseñas de RYM corresponden a la página de la publicación, así que `version=null` es lo correcto y no queda atribución de edición por decidir (`verification/edition-identity-result.json`).

**Venciclopedia.** No tiene entradas ni menciones de los géneros regionales pendientes. Queda registrado en `completion-source-review.json` → `searchedWithoutResult`. Esas 25 categorías necesitan fuentes impresas o de prensa local.

### Correspondencias RYM → CRV adjudicadas (2026-10-18)

Brian encargó cerrarlas: «Corrige las correspondencias con lo que recomienda chatgpt y con lo que tu recomiendes por sobre todo segun el catalogo». Las 44 decisiones están en `ingest.search_mapping_adjudications`, firmadas «Claude (encargo de Brian, 2026-10-18)» y con su motivo en la nota. La exportación está en `verification/mapping-adjudication-result.json`.

**Regla.** Si la taxonomía CRV ya ubica el término como alias de un género, esa ubicación manda; las sugerencias de ChatGPT y las mías solo completan los casos sin alias. CRV no tiene `acid-rock`, `vaporwave` ni un campo de técnicas, así que esas alternativas de ChatGPT no se pueden usar.

**Resultado: 29 aprobadas, 14 corregidas y 1 rechazada.**

- **Pasan a «Más específico»** porque la taxonomía ya las pone bajo su género: Acid Rock (rock psicodélico), Epic Collage y Plunderphonics (electroacústica), Chopped and Screwed (hip-hop), Vapornoise (noise), Hauntology (electrónica), Glitch Pop (electropop), Ambient Pop (dream pop), Post-Industrial (industrial), Hi-NRG y Alternative Dance (dance) y Lounge (easy listening).
- **Pasan a «Equivalente»** por alias exacto: Latin Electronic → latin-electronic-fusion y Canción melódica → balada.
- **Rechazada:** Field Recording, porque es un tipo de material y no un estilo. El término RYM se conserva sin destino.
- **Se aprueban como «Coincide en parte»** aunque sean alias: Hypnagogic Pop (chillwave) y Adult Contemporary (pop, que es un formato de radio).

Ninguna decisión cambia géneros asignados ni amplía búsquedas. E2-02 queda completa, y Brian puede cambiar cualquier decisión en Curaduría → «Correspondencias RYM».

### Mapa 0.17.0: 25 categorías fuera del mapa por decisión de Brian (2026-10-18)

Brian autorizó excluir del mapa descriptivo las 25 categorías que no tienen fuente («Te doy mi permiso»). El libro `genre-descriptions.json` incorpora `exclusions` con slug, motivo, autor y fecha. El mapa derivado las marca como `excluded_by_decision`, y el panel Conocimiento las muestra como «Fuera del mapa» con su motivo. La cobertura queda en 282 activas: 257 descritas, 25 excluidas y 0 pendientes. Solo 7 perfiles documentan los seis aspectos; esa cifra se mantiene visible.

La exclusión solo afecta al mapa descriptivo. Las 25 siguen activas en la taxonomía y conservan sus asignaciones, sin rasgos inventados. Si aparece una fuente, se describen en un corte nuevo. Una exclusión no puede coincidir con una descripción, y un slug ausente de la taxonomía detiene el generador. El motivo de cada una está en `completion-source-review.json` 0.5.0. El corte inmutable es `cuts/0.17.0`; la auditoría, `verification/genre-source-audit.json`. E2-01 queda completa.

Revisión de recursos 0.12.0 (2026-10-18): el rediseño de administración eliminó `AdminNavigation.tsx`. La entrada «Buscador y descubrimiento» está ahora en `OperatorSettings.tsx`, y la evidencia de E2-08 apunta a ese archivo. Los bytes antiguos siguen archivados en `resource-cuts/0.11.0`. El pin de `genre-map.json` corresponde al mapa 0.17.0, y el corte inmutable es `resource-cuts/0.12.0`.

### Anexo A: R45 AOTY y R46 fanzines (2026-10-25)

A pedido de Brian («hazlo», sobre la propuesta de registrar AOTY y los fanzines como procedencias nuevas), el anexo A suma la sección A.7 con dos filas posteriores al informe:

- **R45 · AOTY, reseñas y notas:** 9.942 reseñas de usuario con texto, de 4.080 cuentas y 486 álbumes (cerca del 75 % de Arca), 299 extractos de crítica de 51 medios, notas sueltas e histogramas.
- **R46 · Fanzines de punkenvenezuela (OCR):** 805 páginas de 71 documentos, 3,6 M de caracteres en español y 1.661 menciones fuertes.

`resources.json` y la revisión por campo pasan a 46 recursos. La revisión 0.13.0 tiene 107 grupos de campos y los ocho grupos nuevos quedan diferidos, con motivo y tarea:

- AOTY no tiene cruce álbum–publicación aprobado.
- Las fechas de AOTY son relativas y su escala va de 0 a 100.
- Los extractos de crítica no son el texto completo.
- El OCR de calidad baja y las menciones por nombre requieren revisión.

Registrar las dos fuentes no las integra, no aprueba nada musicalmente y no las suma a RYM como testigos independientes. Las cifras vienen de `reports/reviews-rym-aoty-inventario-2026-10-24`, que también lista las páginas de reseñas RYM inválidas para una posible recaptura.

En el mismo corte 0.13.0 se vuelven a fijar seis evidencias de código que cambiaron después de 0.12.1 por trabajo ajeno al buscador:

- `track-contexts.ts`, `knowledge-publication.ts`, `recommendations.ts` y `suggestions.ts` leen ahora las vistas `ingest.catalog_*` en lugar de `public.*`.
- `audiovisuals.ts` y su prueba de contrato exigen que el audiovisual sea reproducible para mostrarlo y aceptan canales ajenos confirmados.

Se compararon contra los bytes archivados en `resource-cuts/0.12.1` y ninguno cambia las disposiciones.

### Evaluación de las 66 lecturas y tramo AOTY + fanzines (2026-10-25)

**Cambio de criterio por instrucción de Brian.** Brian delegó la evaluación («Resuélvelo tú, confío en tu juicio», aclarando que incluía lo puesto en el artefacto de lectura). Es la instrucción explícita que el punto 4 de pendientes admite para sustituir la evaluación humana independiente. Las decisiones quedan en `ingest.search_human_evaluations` con el evaluador «Claude (encargo de Brian, 2026-10-25)», igual que las 44 correspondencias del 2026-10-18.

- **Analista y evaluador.** El analista de las 66 lecturas fue otro (Codex, salvo las rectificaciones ya aprobadas), así que el evaluador no juzga su propio trabajo.
- **No fue una lectura ciega.** La primera pasada no es ciega: Claude había visto las anotaciones al preparar el artefacto. Se registra igual, para conservar el formato, y no se presenta como ciega.
- **Resultado de las 66:**
  - 65 anotaciones respaldadas y 1 con otro error. En E2-W01, `production.sources` mezcla una fuente con estilos; correspondería `style.mixture`.
  - 0 errores de alcance, 0 generalizaciones y precisión de 0,985.
  - **Cumple los umbrales aprobados.**
- **Carga a la base.** `scripts/search-human-evaluation-import.ts` (`npm run search:human:import`) carga lo exportado del artefacto o de un directorio JSON. Reusa `saveBlindReading`/`saveVerdict`, rechaza cambios de cita o de versión y no reescribe una lectura ya guardada.

**Tramo de ampliación R45/R46** (`crv-extension-readings-0.1.0`), por decisión de Brian del 2026-10-25 («incluye a AOTY y los fanzines al estudio»):

- **Selección.** La hizo Claude, con 24 citas verificadas contra su captura (`scripts/unified-search-extension-select.py`).
  - **12 de AOTY:** Arca limitada a 3. Se excluyeron Kid606 y weed420, que ya están en el estudio, y los discos con fichas duplicadas en CRV.
  - **12 de fanzines:** 11 bandas entre 1985 y 1997, con OCR de calidad 0,9 o mayor. El objeto es el artista.
- **Anotación.** La primera lectura es de DeepSeek flash (`scripts/unified-search-extension-deepseek.py`), así que analista y evaluador son distintos. Hubo un reintento documentado porque devolvió un `type` fuera del contrato.
- **Datos.** `docs/unified-search/stage2/extension-readings.json` produce `reports/unified-search-stage2/extension-annotations.json` (`scripts/unified-search-extension-study.ts`). El contrato de anotación admite ahora R45 y R46, y la lectura ciega admite «artista» como objeto.
- **Resultado.** 21 de 24 respaldadas, con precisión de 0,875:
  - Error de alcance en E2-F10: aplica a toda la trayectoria lo que la cita dice del comienzo.
  - Otros errores en E2-F01 (mezcla de estilos donde hay crítica de un concierto) y E2-F11 (comparación donde hay una etiqueta irónica).
  - **El tramo no cumple los umbrales.** Con los 90 juntos: 1 error de alcance y precisión de 0,956.
- **Rectificaciones.** Las tres quedan decididas pero no aplicadas, para que la medición siga correspondiendo a lo evaluado. Se aplicarán en 0.2.0 y se volverán a evaluar antes de que el tramo alimente a Laya, la matriz de consultas o el cruce de cuatro fuentes; hoy no alimenta a ninguno.
- **Revisión por campo.** No cambia: el uso en el estudio no integra AOTY ni los fanzines al buscador.

Revisión de recursos 0.13.1 (2026-10-25): se vuelve a fijar la huella de `src/search/knowledge-contracts.ts`, que ahora admite R45 y R46 como procedencias de una anotación. No cambian disposiciones, recursos (46) ni grupos de campos (107). El corte inmutable es `resource-cuts/0.13.1`.

**Tramo 0.2.0 (2026-10-25, «Haz lo que está pendiente»):**
- **Rectificaciones aplicadas.** Las tres se aplicaron, y solo E2-F01, E2-F10 y E2-F11 cambian su `study` a `crv-extension-readings-0.2.0`. Las otras 21 conservan su evaluación de 0.1.0.
- **Importador.** Ahora detecta lecturas obsoletas por cita o versión y las vuelve a registrar.
- **Nueva evaluación.** Las tres quedan respaldadas, y las 90 juntas tienen precisión de 0,989, 0 errores de alcance y 0 generalizaciones: **cumplen los umbrales**.
- **Límite.** Esas tres rectificaciones las propuso el mismo evaluador que las vuelve a juzgar. La medición independiente de la primera lectura de DeepSeek (0,875) se conserva en `previousEvaluation`.

### Cierre de la etapa 2 (2026-10-25)

Brian aceptó la etapa como cerrada: «Acepto esta etapa como cerrada y continuamos con la etapa 3». Lo hizo conociendo los límites de la evaluación delegada: la lectura no fue ciega y el evaluador fue Claude por encargo suyo, no una persona independiente. Los once requisitos (E2-01 a E2-11) quedan completos en `reports/unified-search-stage2/acceptance.json`. `acceptance-in-progress.json` se conserva como historial.

La etapa 3 solo puede usar anotaciones que superaron este protocolo y debe conservar su estudio, analista y evaluador para separar los conjuntos.
