# Evaluación integral de fichas y curaduría de CRV

Fecha: 8 de octubre de 2026. Evaluación del estado documentado y del código disponible en el workspace, con consulta de la ficha pública del artista 58.

**Puntaje global: 16/20.** El promedio ponderado de la matriz es 16,13/20, redondeado para evitar una precisión artificial. Es una valoración de madurez del sistema: no es el porcentaje de datos correctos del catálogo ni el puntaje documental de Caramelos de Cianuro.

La mayor fortaleza es que el sistema conserva evidencia, distingue investigación de escritura y hace revisables las correcciones. Su principal limitación es que la calidad documental, la cobertura, la coherencia estructural y la completitud todavía no forman una política editorial unificada. Hay controles técnicos buenos que pueden ejecutar decisiones editorialmente equivocadas.

## Alcance y método

Se leyeron las 679 líneas de [la descripción del sistema](SISTEMA_FICHAS_Y_CURADURIA_PARA_ANALISIS_IA.md), incluidos sus anexos; la [revisión v3 de Caramelos](decisions/2026-10-07-caramelos-verificacion-v3.md) y sus [743 unidades en CSV](decisions/2026-10-07-caramelos-verificacion-v3.csv). Se contrastaron módulos de verificación, comparación, búsqueda web, acciones, autocorrección, métricas, permisos, modelo, interfaz, CI y recuperación.

Se consultó la [ficha pública](https://mini-server.tail5815b0.ts.net/crv/artistas/58) y su API de lectura. Se abrió con Playwright en escritorio de 1440 px y móvil de 390 px. La vista inicial cargó sin errores de JavaScript y el ancho del documento coincidió con los 390 px del dispositivo. Esto no equivale a una auditoría completa de accesibilidad o de todos los flujos privados.

Se ejecutaron **111 pruebas unitarias, todas satisfactorias, en ocho archivos**: `auth`, `entity-verification`, `entity-comparison`, `curation-actions`, `curation-scan-failures`, `curation-metrics`, `curation-structural-actions` y `bulk-policy`. Los registros de errores de conexión en las pruebas de fallos de análisis son simulaciones deliberadas. No se ejecutaron contratos, restauraciones, pruebas de carga ni investigación con IA de pago. No se hizo un censo de la base ni se modificaron fichas.

Las conclusiones se distinguen así: **comprobado** para comportamiento observado en datos, código o pruebas; **riesgo editorial** para una consecuencia posible de una regla comprobada; **propuesta** para capacidades futuras; **pendiente de medir** para rendimiento o funcionamiento que esta revisión no comprobó.

## Matriz de evaluación

Escala: 1–5 insuficiente; 6–10 básico; 11–14 funcional con límites relevantes; 15–17 sólido con mejoras importantes; 18–19 muy maduro; 20 exigiría validación amplia y sostenida de la operación y de los resultados editoriales. Los pesos son una decisión de esta evaluación, dando prioridad a identidad, evidencia y correcciones.

| Área | Peso | Nota /20 | Evaluación |
|---|---:|---:|---|
| Arquitectura y separación de responsabilidades | 8 % | 18 | API, CLI y motores compartidos; separación de catálogo, ingesta y medios; IA subordinada a validación. |
| Modelo musical y representación temporal | 10 % | 15 | Buenas entidades y relaciones; falta una separación explícita entre grupo de lanzamientos, edición, soporte, grabación y contenido audiovisual. |
| Fichas, navegación y experiencia de uso | 7 % | 16 | Navegación útil, relaciones y estados recuperables; faltan señales editoriales visibles por dato y herramientas para explorar discografías grandes. |
| Procedencia, evidencia y trazabilidad | 10 % | 18 | Claims, crudos, citas, hashes y auditoría; hay que distinguir mejor captura original, lectura de archivo y comprobación reciente. |
| Detección y seguimiento de problemas | 10 % | 17 | 48 detectores, análisis local/global, huellas estables y decisiones persistentes; la ausencia de hallazgos no acredita completitud. |
| Correcciones, lotes y reversibilidad | 9 % | 18 | Vista previa firmada, precondiciones, historial e inversas; algunas soluciones sugeridas necesitan evidencia editorial adicional. |
| Autocorrección | 6 % | 15 | Lista blanca, topes, apagado inicial y reversión; nivel 0 mezcla limpieza inequívoca con retirada o vaciado que requieren contexto. |
| Identidades, duplicados, división y comparación | 8 % | 16 | Contexto relacional y decisiones de separación; políticas documentales y normalización difieren entre motores. |
| Verificación externa e IA | 9 % | 16 | Citas comprobadas, lotes, checkpoints y exclusiones explícitas; respaldo literal no equivale por sí solo a verdad histórica. |
| Puntajes, métricas y comunicación de calidad | 7 % | 13 | Fórmula documentada; el titular puede confundirse con fiabilidad global y la precisión operacional no mide errores omitidos. |
| Géneros y clasificación editorial | 4 % | 16 | Taxonomía y procedencia; falta hacer visible la provisionalidad y representar cambios por época o disco. |
| Seguridad y permisos | 4 % | 16 | Protección del servidor, sesiones, CSRF y limitación de acceso; las pruebas seleccionadas no certifican toda la seguridad. |
| Pruebas, despliegue y recuperación | 3 % | 16 | CI, contratos y respaldos de base más crudo; falta acreditar periódicamente recuperación completa y cobertura de medios adicionales. |
| Coste, rendimiento y escalabilidad | 3 % | 14 | Caché, concurrencia acotada e investigación reanudable; faltan mediciones de coste útil y carga real del conjunto. |
| Colaboración editorial e interoperabilidad | 2 % | 12 | Operador y decisiones registrados; no se acreditó un flujo completo de asignación, segunda revisión y registro común de identificadores externos. |

No se descontaron puntos por carecer de funciones que ya existen: historial, comparación, reversión, procedencia, taxonomía, métricas, pruebas y backups están implementados o documentados.

## Qué demuestra la ficha de Caramelos de Cianuro

El informe v3 documenta **96,4 % de coincidencia ponderada sobre 566 unidades contrastadas**. Procesar las 743 unidades no significa verificarlas todas.

| Indicador | Resultado | Interpretación |
|---|---:|---|
| Unidades procesadas | 743 | Se evaluó el conjunto del informe. |
| Unidades que participan en el puntaje | 566 | Hay coincidencia o discrepancia documental admisible. |
| Unidades excluidas | 177 | 157 sin verificar, 19 faltantes y un indicador de inventario. |
| Contrastadas / procesadas | 76,2 % | Cobertura bruta de ese informe, sin ponderación por área. |
| Contrastadas / unidades con valor, sin indicador | 78,3 % | 566 / 723; denominador diferente que debe explicarse si se muestra. |
| Discrepancias documentadas | 17 | Necesitan tratamiento editorial aunque el promedio sea alto. |

No conviene multiplicar 96,4 % por cobertura para fabricar un índice de verdad: mezclará dos dimensiones y seguirá ocultando severidad, independencia y edición.

El CSV permite ver lo que el total oculta:

| Área | Unidades | Contrastadas | Coincidencia dentro de las contrastadas |
|---|---:|---:|---:|
| Identidad | 1 | 1 | 100 % |
| Integrantes | 28 | 14 | 89,29 % |
| Discografía | 99 | 51 | 93,63 % |
| Pistas y orden | 595 | 487 | 95,59 % |
| Redes y enlaces | 7 | 3 | 100 % |
| Géneros | 4 | 3 | 100 % |
| Cronología y estado | 2 | 1 | 100 % |
| Biografía | 6 | 6 | 100 % |
| Inventario de discos faltantes | 1 | 0 | No participa |

**Comprobado en la ficha publicada:** hay 33 entradas de discografía y siete integrantes. Los siete tienen `fromYear=null`, `toYear=null` e `isCurrent=false`; la interfaz muestra estado Desconocido y años activos 1991–?. La biografía afirma actividad hasta la fecha actual. Esto revela una diferencia entre texto narrativo y relaciones estructuradas, no demuestra quién integra hoy la banda.

También aparecen `2 Lados B` y `2LadosB`, ambos de 2011, con tipos diferentes; y tres entradas relacionadas con `Flor De Fuego`. Son casos de investigación de duplicado o edición. No se puede decidir una fusión únicamente por el título.

Electrónica aparece como género en la ficha pública, mientras el informe v3 lo deja sin verificar. Sin verificar no significa falso, pero conviene mostrar que la asignación y su respaldo documental son decisiones diferentes.

**Comprobado en el informe v3:** las 17 discrepancias se concentran en el manejo de DVD/CD y un crédito de producción importado como pista. La [fuente de Flor de Fuego](https://sincopa.com/rock_pop/cdinfo_rock/caramelos_8flordefuego_dvd.htm) presenta por separado CD, DVD y créditos. Antes de corregir se debe revalidar cada dato y la edición correspondiente; el informe documentó problemas y no aplicó cambios.

**Concentración de evidencia:** 456 de las 566 unidades contrastadas citan al menos una URL de Sincopa; 296 citan únicamente ese dominio. Son 80,6 % y 52,3 %, respectivamente. Los recuentos deduplican dominios dentro de cada unidad; no son porcentajes de fuentes independientes ni de veracidad. El CSV contiene 55 URLs distintas entre las unidades contrastadas; las 108 referencias conservadas del expediente incluyen otras páginas. Si un valor provino de Sincopa, volver a coincidir con Sincopa mide fidelidad de extracción, pero no añade por sí solo corroboración independiente.

## Qué falta y qué debe corregirse primero

### 1. Separar las dimensiones de calidad — prioridad alta

**Evidencia:** `src/verification/types.ts` excluye faltantes, no verificados, indicadores y problemas internos del porcentaje; `evaluate.ts` redistribuye pesos. La interfaz conserva el encabezado Fiabilidad de la ficha aunque el anillo diga Respaldo documental.

**Efecto:** una ficha con una sola afirmación comprobada puede alcanzar 100 %; quitar del denominador un dato difícil cambia la comparación entre informes. Un error central de identidad puede diluirse entre coincidencias secundarias.

**Propuesta:** titular Coincidencia documental e incorporar, en el mismo bloque, cobertura por área, discrepancias por gravedad, campos obligatorios pendientes, corroboración independiente y vigencia. Identidad, artista del lanzamiento y edición necesitan alertas capaces de impedir declarar una ficha lista aunque el promedio sea alto. Distinguir porcentaje calculado de estado editorial: pendiente, investigada, corregida, revisada y apta para el uso definido.

**Comprobación:** casos con 1 de 100 valores contrastado, discrepancia de identidad, solo fragmentos y cero datos contrastados; todos deben mostrar contexto suficiente. Definir un conjunto común de unidades para comparar puntuaciones históricas. Cambiar de reglas debe iniciar otra serie o reevaluar la anterior.

### 2. Separar edición y soporte — prioridad alta

**Evidencia:** `core.ts` tiene discos, formatos y pistas con `discNumber`, pero no un soporte explícito con identidad y tipo de contenido. La muestra contiene los errores de CD/DVD y varias entradas relacionadas por edición.

**Efecto:** el título y el número de disco cargan información que debería estar estructurada; se pueden fusionar ediciones diferentes o tratar capítulos y documentales como canciones.

**Propuesta gradual:** agrupar lanzamientos relacionados; identificar cada edición; crear soportes CD/DVD/LP/digital con sus posiciones; diferenciar canción, capítulo, entrevista, documental, videoclip y extra. Posteriormente separar obra, grabación y pista de una edición cuando los usos lo requieran. Una canción no debe crear automáticamente un sencillo independiente.

La distinción entre grupo de lanzamientos, edición y soporte tiene un precedente claro en [Release Group](https://musicbrainz.org/doc/Release_Group) y [Release](https://musicbrainz.org/doc/Release) de MusicBrainz. Sirve como referencia conceptual; CRV puede adaptarla a sus necesidades y contenido audiovisual.

**Comprobación:** cargar una edición estándar, una CD/DVD y una reedición de otro año; deben conservar relación, contenido y diferencias sin multiplicar álbumes en un recuento de grupos. Probar caras A/B, discos múltiples y extras audiovisuales.

### 3. Revisar la seguridad editorial de las acciones — prioridad alta

**Comprobado:** en `src/curation/actions/structural.ts`, `retirar_huerfana` y `vaciar_anio` son nivel 0. El primero comprueba relaciones del catálogo; el segundo vacía un año detectado como imposible. `fijar_anio_formacion` propone el año del disco más antiguo y `renumerar_consecutivo` elimina huecos. El detector de años considera anómalo un año posterior al actual más uno.

**Riesgos editoriales:**

- Una persona documentada pero todavía sin créditos no es necesariamente descartable. Sus claims, biografía y valor histórico importan aunque tenga cero relaciones.
- Un lanzamiento anunciado a futuro no equivale a un año corrupto.
- El primer disco documentado establece un límite temporal; no demuestra el año exacto de formación.
- Una lista 1, 2, 4 puede señalar una pista 3 faltante. Renumerar 4 a 3 oculta la pérdida.

**Propuesta:** reservar autocorrección para transformaciones cuyo significado esté garantizado. Retirar debe exigir revisión editorial o un estado de cuarentena con motivo; vaciar años debe distinguir error de planificación o incertidumbre. Ofrecer investigar año, recuperar pista, corregir edición o justificar numeración. La reversibilidad debe mantenerse, pero no sustituye la evidencia previa.

**Comprobación:** casos de ficha histórica huérfana con evidencia, disco anunciado, banda formada antes del primer álbum y pista ausente. El sistema debe preservar los datos mientras solicita una decisión contextual. No se afirma que estas acciones estén activadas automáticamente en producción.

### 4. Hacer explícitas calidad, independencia y vigencia de fuentes — prioridad alta

**Evidencia:** en el verificador, `sourceStrength` asigna respaldo completo a una página leída; existe `corroborationStrength`, pero no se publica como indicador independiente. El comparador usa otra heurística de dominios y citas distintas. Una coincidencia con la fuente original no se etiqueta como tal en el porcentaje.

**Propuesta:** registrar autoridad para el campo concreto, fuente original o derivada, independencia del dato importado, fecha del acontecimiento, fecha de publicación y fecha de observación. Un libreto puede servir para créditos; una web actual del artista, para integrantes actuales; dos plataformas de una misma entrega del distribuidor no son corroboraciones independientes. Conservar versiones y divergencias, sin decidir por mayoría de dominios.

**Comprobación:** fuente original contra su extracción, dos sitios que copian una biografía, dos entregas del mismo distribuidor y fuente oficial que cambió recientemente. Deben producir distintas señales de corroboración y vigencia, aunque coincidan literalmente.

### 5. Corregir el fechado del rescate desde archivos — prioridad alta

**Comprobado en código:** `WebSearchBroker.page` puede recuperar una página cruda guardada cuando falla la descarga. `storedPage` devuelve bytes y tipo de contenido, pero no la fecha original; después la caché y `fetchedAt` reciben la fecha actual. Esto puede presentar contenido histórico con una fecha de lectura aparentemente reciente. No se comprobó cuántos informes reales están afectados ni si afectó al ejemplo.

**Propuesta:** conservar `capturedAt` de la página original, `readAt` del archivo, `lastCheckedAt` del intento actual y un origen de recuperación archivo/caché/red. Si la captura original no se conoce, declararlo. No renovar la vigencia del contenido por releer sus bytes.

**Comprobación:** simular descarga 403 y una página archivada en otra fecha; el informe debe conservar ambas fechas y señalar que no hubo recaptura exitosa.

### 6. Llevar la verificación a tareas de curaduría — prioridad alta

**Evidencia:** la investigación y sus sugerencias permanecen separadas del catálogo. Es una protección correcta; el documento no acredita un puente general de todas las discrepancias individuales a planes tipados de corrección.

**Propuesta:** convertir cada discrepancia aceptada en caso con ficha, campo o relación, edición, fuentes, valor actual, propuesta, gravedad, responsable, dependencias y criterio de cierre. Reutilizar las vistas previas y motores de escritura existentes. Agrupar por causa: las 17 discrepancias de la muestra pueden derivar de un número mucho menor de problemas de segmentación y soporte.

**Comprobación:** informe → caso → propuesta → vista previa → aplicación → contraste posterior. Cada corrección debe conservar el vínculo con la evidencia y respetar cambios posteriores. Un informe sin verificar debe generar investigación, no sobrescritura.

### 7. Completar cronologías, campos y organizaciones — prioridad media-alta

**Evidencia:** varios campos almacenables carecen de edición genérica; las organizaciones no participan en `VerificationKind` ni en el comparador general; la muestra tiene períodos de integrantes faltantes.

**Propuesta:** inventariar por campo almacenamiento, lectura, edición, detector y verificación. Priorizar estado del artista, períodos de miembros, datos de edición y organizaciones. Diferenciar actual, anterior y desconocido en membresías; usar precisión de fecha, rangos y fechas aproximadas. Fechar las afirmaciones variables: activa a fecha X. Separar fecha de grabación y publicación para no tratar automáticamente una reedición póstuma como trayectoria imposible.

**Comprobación:** bandas con pausas y reingresos, persona con un rol distinto por etapa, reedición póstuma, sello con cambio de nombre y fecha solo conocida por año. Las restricciones deben señalar incertidumbre sin inventar precisión.

### 8. Calibrar detectores y comparación con muestras independientes — prioridad media-alta

**Evidencia:** hay corpus y pruebas; la precisión operacional depende de correcciones e ignorados registrados. No incluye todos los errores que los detectores no encuentran. Los porcentajes de verificación y correspondencia responden preguntas diferentes.

**Propuesta:** mantener una muestra reservada, estratificada por tipo, época, región, cantidad de evidencia y complejidad. Medir por separado precisión y sensibilidad de detección, corrección editorial de las acciones y decisiones same/related/distinct/inconclusive. Revisar desacuerdos entre curadores y la dependencia respecto a nombres. Compartir normalizadores adecuados sin obligar a que ambas puntuaciones signifiquen lo mismo.

**Comprobación:** medir antes/después sobre casos que no sirvieron para ajustar las reglas. Informar falsos positivos, falsos negativos, fusiones incorrectas, divisiones incorrectas y casos inconclusos. Una ausencia documental no puede contarse como separación demostrada.

### 9. Priorizar impacto y trabajo colaborativo — prioridad media

**Propuesta:** ordenar por gravedad, relaciones afectadas, valor de preservación, evidencia disponible y esfuerzo estimado. Reservar capacidad para artistas poco documentados; priorizar solo por popularidad aumenta el sesgo del archivo. Añadir asignación, estados editoriales, desacuerdo y segunda revisión para fusiones o divisiones complejas. El estado de un hallazgo técnico y el de un expediente editorial deben poder relacionarse sin confundirse.

**Comprobación:** dos curadores trabajando sobre el mismo caso; múltiples hallazgos del mismo error de extracción; un caso importante con poca presencia web. Debe existir una ruta clara hasta una decisión documentada, incluido inconcluso o fuera de alcance.

### 10. Medir coste útil y comprobar recuperación completa — prioridad media

**Evidencia:** el caso requirió 97 solicitudes de IA y 108 referencias conservadas; esos números no permiten deducir coste monetario o tiempo. Hay caché, tokens registrados, checkpoints, CI y procedimientos de backup y restauración.

**Propuesta:** medir tiempo, tokens, lecturas nuevas y coste por dato contrastado y por corrección aceptada. Investigar solo unidades afectadas y dependencias pertinentes. Mantener rutas rápidas deterministas para URLs, números y títulos; reservar razonamiento para identidad y ambigüedad. Probar periódicamente restauración del catálogo, crudos, imágenes localizadas, archivos conservados e informes; medir tiempo de recuperación y pérdida de cambios tolerable.

**Comprobación:** campaña representativa con presupuesto explícito; repetir después de un cambio pequeño; medir reutilización y datos nuevos contrastados. Recuperar en un entorno desechable y comprobar enlaces y evidencias, además de conteos. La evaluación no sostiene que hoy falten todos esos recursos en los respaldos: hay que revisar la cobertura completa y demostrarla.

### 11. Añadir preservación e intercambio de metadatos — prioridad media

**Propuesta:** aprovechar formatos, calidad y estado de archivo ya existentes para llevar inventario de ejemplares y archivos: checksum, características técnicas, origen, custodia, condición, digitalización y permiso de uso conocido. Crear un registro común de identificadores externos por entidad y por edición, conservando coincidencias propuestas y aceptadas. Mantener las relaciones ya existentes con plataformas.

**Comprobación:** dos archivos del mismo contenido con codificación diferente, dos ediciones con portadas diferentes y un identificador externo que apunta a un homónimo. Un identificador debe facilitar investigación, sin convertirse en autorización automática de fusión.

## Usos adicionales para resolver problemas de curaduría

Estas son extensiones o productos apoyados en capacidades existentes; no se presentan como funciones ya implementadas.

| Problema | Uso posible | Datos o capacidades reutilizables | Resultado y comprobación |
|---|---|---|---|
| Muchos errores vienen de una misma importación | Auditoría de extractores por fuente, página y versión | Claims, crudos, detectores, fechas y auditoría | Identificar causas comunes; corregir parser y comprobar que reingestar no reproduzca el error. |
| Lotes nuevos degradan la base | Evaluación previa a incorporar cambios | Snapshot, detectores, conflictos y vistas previas | Comparación antes/después con bloqueo de problemas críticos; admitir datos incompletos como pendientes. |
| Discografías incompletas | Plan de investigación por artista y edición | Inventarios documentados, suggestions y relaciones | Lista de lanzamientos candidatos con prueba; diferenciar canción, sencillo y reedición. |
| Personas y bandas mezcladas | Expedientes de identidad | Trayectorias, períodos, créditos, comparador y decisiones distintas | Separación o vínculo documentado; no fusionar por similitud de nombre. |
| Falta historia de la escena | Cronologías y mapas de bandas, músicos, sellos y estudios | Membresías, linaje, créditos, organizaciones y origen | Explorar circulación histórica; mostrar incertidumbre temporal y no inventar influencia musical. |
| Archivos raros se pierden | Lista de rescate y digitalización | Estado de archivo, formatos, medios y procedencia | Priorizar ejemplares, contenidos y fuentes en riesgo; verificar integridad y custodia. |
| Radio o playlists repiten lo más conocido | Programación explicable por escena, época y vínculos | Géneros, medios, relaciones, catálogo y exportaciones | Propuestas con razones; comprobar identidad, disponibilidad y datos antes de publicar. |
| El público conoce datos que el catálogo no tiene | Contribuciones de músicos y coleccionistas | Claims, revisión y escritura auditada | Aportes con evidencia en una bandeja editorial; identidad del colaborador no reemplaza la prueba. |
| Es difícil preparar artículos o exposiciones | Dossiers temáticos citables | Datos canónicos, crudos, citas y fechas | Exportaciones con hechos, disputas y límites; actualización cuando cambia el catálogo. |
| No se sabe dónde está sesgado el archivo | Mapa de cobertura | Campos faltantes, unidades no verificadas, regiones y décadas | Identificar áreas subrepresentadas y planear campañas sin equiparar poca web con poca relevancia. |
| Las correcciones se repiten | Biblioteca de casos editoriales | Resoluciones, causas, antes/después e inversas | Reutilizar criterio y convertir casos revisados en pruebas; separar entrenamiento de evaluación. |
| Datos externos no coinciden | Conciliación de catálogos | Aliases, identificadores, comparaciones y ediciones | Diferencias explicables y exportación interoperable; conservar variantes legítimas. |

La primera extensión que construiría es el **puente entre informe y caso editorial**, unido a la **detección de causas comunes de ingesta**. Aprovecha casi toda la infraestructura existente y convierte investigación costosa en mejoras duraderas.

## Orden de ejecución recomendado

1. **Aclarar calidad y revisar decisiones peligrosas:** cambiar el titular del porcentaje, mostrar cobertura y gravedad; revisar retirada de huérfanas, años y renumeración; corregir el fechado de páginas archivadas. Son cambios acotados con impacto inmediato.
2. **Cerrar el caso Caramelos como piloto:** revalidar las 17 discrepancias por edición; planificar soporte CD/DVD y transferencia del crédito; completar períodos cuando haya evidencia, conservando sus disputas; investigar los pares similares y distinguir etiquetas provisionales. Registrar antes/después y corregir la ingesta si la causa es reproducible.
3. **Conectar informes a curaduría:** casos, responsables, dependencias, acciones tipadas y comprobación posterior. Medir cuántas discrepancias aceptadas terminan en correcciones adecuadas.
4. **Fortalecer el modelo por necesidad real:** grupos de lanzamientos, ediciones y soportes; estados y fechas inciertas; verificación de organizaciones; controles de campos prioritarios.
5. **Ampliar después de medir:** campañas representativas, costes y recuperación; contribuciones, mapas históricos, preservación y productos de difusión.

Para subir a **18/20**, exigiría ver funcionando los tres primeros puntos, una representación consistente de ediciones/soportes y resultados satisfactorios sobre una muestra independiente de identidades y correcciones. Para **19–20/20**, además haría falta demostrar continuidad operativa, preservación completa y calidad sostenida en casos difíciles y poco documentados. No basta con aumentar el número de detectores o el porcentaje documental.

## Referencias de implementación

- Alcance, capacidades e inventarios: [documento base](SISTEMA_FICHAS_Y_CURADURIA_PARA_ANALISIS_IA.md).
- Ejemplo y evidencia por unidad: [revisión v3](decisions/2026-10-07-caramelos-verificacion-v3.md), [CSV](decisions/2026-10-07-caramelos-verificacion-v3.csv).
- Elegibilidad, pesos y evaluación: [types.ts](../src/verification/types.ts), [evaluate.ts](../src/verification/evaluate.ts), [snapshot.ts](../src/verification/snapshot.ts).
- Prueba documental y fuentes: [proof.ts](../src/verification/proof.ts), [web-search.ts](../src/ambiguity/web-search.ts).
- Correspondencia e identidad: [comparison.ts](../src/verification/comparison.ts).
- Acciones y lotes: [structural.ts](../src/curation/actions/structural.ts), [batches.ts](../src/curation/actions/batches.ts), [autofix.ts](../src/curation/autofix.ts).
- Modelo y métricas: [core.ts](../src/db/schema/core.ts), [metrics.ts](../src/curation/metrics.ts).
- Presentación: [EntityVerification.tsx](../web/src/components/EntityVerification.tsx), [ArtistDetailPage.tsx](../web/src/pages/ArtistDetailPage.tsx).
- Permisos y operación: [auth.ts](../src/api/auth.ts), [CI](../.github/workflows/ci.yml), [guía de recuperación](DATABASE_BACKUP_RESTORE.md), [configuración de pruebas](../vitest.config.ts).
