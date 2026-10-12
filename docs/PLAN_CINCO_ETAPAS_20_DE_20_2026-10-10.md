# Plan de cinco etapas para un 20/20 comprobado

Fecha: 10 de octubre de 2026. Punto de partida: [evaluación integral de 29 dimensiones](EVALUACION_INTEGRAL_SISTEMA_2026-10-10.md), 12/20 general y 8/20 en investigar y completar fichas.

**Versión 3: contrato de ejecución sin mínimo de participantes.** Las cinco etapas se ejecutan mediante 25 paquetes, con dependencias, responsables, estimaciones, presupuesto y aceptación individual de las 29 dimensiones. Leer el [contrato de ejecución y aceptación](PLAN_CINCO_ETAPAS_20_DE_20_EJECUCION_2026-10-10.md), el [backlog estructurado](plan-20-de-20/backlog.json) y la [matriz de aceptación](plan-20-de-20/acceptance.json) junto a este documento.

Este documento define el alcance de las cinco etapas. El [estado de la etapa 1](../reports/plan-20-de-20/etapa-1/ESTADO.md) registra su implementación y evidencia. El cierre global se evalúa sobre la versión publicada y su funcionamiento con usuarios, fuentes, modelos y datos reales. Cada etapa entrega cambios utilizables, pruebas y evidencia de sus criterios de salida. Un bloqueo de una etapa se resuelve antes de declarar su cierre.

| Etapa | Paquetes | Esfuerzo base estimado | Entrega |
|---|---|---:|---|
| 1 | E1-01 a E1-05 | 12–22 jornadas | Base, modelo y controles confiables |
| 2 | E2-01 a E2-05 | 15–24 jornadas | Investigación recuperable y reutilización |
| 3 | E3-01 a E3-05 | 13–23 jornadas | Propuestas respaldadas y medios correctos |
| 4 | E4-01 a E4-05 | 11–20 jornadas | Recorrido claro validado con usuarios |
| 5 | E5-01 a E5-05 | 13–23 jornadas | Operación, aceptación y uso sostenido |

Una jornada equivale a seis horas; son estimaciones iniciales de esfuerzo humano equivalente, no una promesa de duración. Total base: 64–112 jornadas; con reserva del 30 %: 84–146. E1-01/E1-02 recalibran el trabajo pendiente. El contrato fija recursos, presupuesto propuesto de IA, corpus reservado, protocolo de usuarios, riesgos, reversión y evidencia de cierre. Los resultados se acreditan por paquete con sus pruebas y límites.

## Qué significará 20/20

El sistema permitirá encontrar o crear una ficha, investigar sus fuentes, aprovechar información adicional pertinente, proponer cambios respaldados, enviar varias imágenes apropiadas a curaduría, decidir, comprobar y deshacer. Una interrupción podrá recuperarse. Las personas podrán realizar ese recorrido sin conocer los módulos internos.

Cada una de las 29 dimensiones de la auditoría tendrá evidencia técnica o de uso apropiada a su naturaleza. El promedio no compensará un bloqueo del recorrido principal, una operación sin respaldo, pérdida de información o un problema de integridad. Una falta documental legítima se mostrará como incertidumbre; no se inventarán datos para obtener una ficha llena.

El [cierre de curaduría de septiembre](curation/CIERRE_20_DE_20.md) es evidencia histórica de un módulo y una checklist concreta. La aceptación nueva cubrirá también investigación, propuestas, medios, reutilización, UX y operación actuales, con muestras del tamaño vigente.

Se mantendrán límites de recursos por llamada, seguridad y validación. El trabajo se distribuirá por lotes recuperables y acumulará sus resultados. Ninguna información pertinente se descartará por no estar pedida expresamente o por exceder una llamada. Si una fuente resulta inaccesible, un hecho ambiguo o se alcanza un presupuesto de ejecución, quedarán registrados el resultado parcial, el motivo y la continuación disponible.

Los umbrales de este plan son requisitos de aceptación, no resultados ya medidos. Se congelarán antes de validar, con tamaño de muestra, denominadores y exclusiones publicados. No se modificarán para hacer pasar un resultado desfavorable. Las métricas M01–M13 y los gates G01–G29 del contrato operacionalizan los criterios resumidos aquí y resuelven cualquier ambigüedad de medición.

## Etapa 1. Base confiable, modelo compatible y controles de calidad

**Resultado:** poder ampliar el sistema conservando los datos y distinguir errores reales de deuda histórica y pruebas desactualizadas.

### Trabajo

1. Congelar una línea base reproducible: versión de código y bundle, migraciones, dataset de pruebas, conteos, inventario de funcionalidades y los defectos de la auditoría. Preparar el [guion del propietario](plan-20-de-20/recorrido-propietario.md) para comparar el recorrido posterior; no hay muestra mínima de participantes ni se inventan sesiones.
2. Resolver los fallos de pruebas y los 27 errores de lint observados. Reconciliar expectativas de búsqueda, taxonomía y migraciones con una política explícita. Las pruebas deben comprobar resultados y conservación de datos; no se relajarán únicamente para volver a verde.
3. Reparar índices faltantes, identidades externas y redirecciones. Reconciliar las filas sin auditoría, auditorías sin claim y cambios sin run. Cuando una procedencia histórica sea irrecuperable, registrar esa limitación y el estado actual mediante una operación de mantenimiento auditable; no fabricar la fuente original.
4. Definir y migrar un modelo compatible para precisión de nacimiento/fallecimiento y períodos, identidad musical/persona, obra/edición/soporte, géneros por ámbito y sello por edición. Preservar contratos existentes y usar capas auxiliares cuando permita evitar cambios innecesarios en el core. Validar migración, reversión y conservación de valores previos.
5. Establecer un inventario persistente de hechos y evidencias: entidad identificada, campo o relación, valor, edición/período, fuente, fragmento, fecha de captura, método de obtención y estado de procesamiento. Separar captura original de lectura posterior de un archivo.
6. Unificar las políticas del verificador, propuestas y acciones. El disco más antiguo no demuestra formación; un hueco no prueba mala numeración; una ficha sin vínculos no prueba identidad inválida. Reservar autocorrección para transformaciones cuya validez pueda demostrarse.
7. Integrar en CI las unitarias web y un recorrido mínimo de navegador, además de los controles existentes. Probar permisos y autenticación real, incluyendo roles y CSRF.

### Entregables

- Migraciones compatibles, informe de reconciliación, esquema de hechos/evidencias y política editorial única.
- Registro de defectos con prueba de reproducción, responsable técnico, cambio previsto y comprobación de cierre.
- Dataset de aceptación inicial y CI utilizable.

### Criterios de salida

- Tipos, lint, build y pruebas aplicables aprobados en una ejecución reproducible del mismo código.
- Cero referencias externas inválidas; `doctor` sin errores activos de integridad. Las limitaciones históricas quedan distinguidas de corrupción vigente.
- Crear, editar, fusionar, dividir, convertir, retirar y deshacer conservan datos y relaciones en casos representativos.
- Fechas parciales se almacenan sin inventar días. Una edición CD/DVD conserva su identidad y contenido.
- Los cuatro artistas conservan todo su estado previo válido después de la migración.

**Zonas principales:** `src/db`, migraciones, `src/merge`, `src/curation/actions`, `src/api/auth.ts`, schemas, pruebas y CI.

## Etapa 2. Investigación completa, recuperable y reutilizable

**Resultado:** toda información pertinente encontrada queda cruzada con el catálogo y disponible para alimentar fichas y relaciones.

Estado de implementación y comprobaciones: [expediente de la etapa 2](../reports/plan-20-de-20/etapa-2/ESTADO.md). La etapa permanece en ejecución; el expediente distingue capacidades conectadas y criterios aún pendientes.

### Trabajo

1. Sustituir el contexto monolítico por tareas y lotes con dependencias, checkpoints y recuperación. La petición específica carga su hallazgo, sus citas y su vecindad necesaria; la petición amplia recorre los lotes hasta completar el alcance.
2. Implementar adquisición escalonada según la fuente: HTML, datos estructurados, página renderizada cuando haga falta, PDF y OCR de material discográfico. Conservar el documento original y la posición del fragmento que respalda cada extracción. Un error de un sitio no impide conservar lo obtenido de otros.
3. Registrar cada fuente como descubierta, obtenida, leída parcialmente/completamente, fallida o inaccesible, con motivo, contenido capturado y fecha correcta. El informe permite comprobar qué parte se leyó realmente.
4. Resolver la identidad antes de atribuir hechos: homónimos, otros artistas llamados Jeremías, proyectos, colaboraciones, nombres legales y alias. Cruzar pertenencias, país, época, repertorio y edición.
5. Extraer todos los ámbitos solicitados: portadas, retratos, tracklists, créditos, géneros de artista y disco, redes, nacimiento/fallecimiento, sellos, biografía y AKA. Incluir organizaciones/sellos en el recorrido de investigación y comparación; tratar pistas con el contexto de su álbum.
6. Agrupar hechos equivalentes de distintas fuentes sin perder citas, conservar contradicciones y reutilizar la información existente antes de investigar de nuevo. Proponer mejoras adicionales documentadas aunque excedan la instrucción inicial.
7. Dar a cada hecho un destino: ya presente, propuesta, conflicto, pendiente o descartado con motivo verificable. Conservar información útil aún sin campo compatible para incorporarla tras ampliar el modelo.
8. Versionar informes y permitir reprocesar investigaciones anteriores sobre copias preservadas. Mostrar avance, tareas pendientes, consumo y posibilidad de pausar/reanudar o cancelar desde un estado coherente.

### Entregables

- Motor de investigación por tareas, registro de hechos y fuentes y reporte de aprovechamiento.
- Extractores con pruebas sobre documentos representativos y fallos de red.
- Reprocesamiento de los informes de los cuatro artistas con trazabilidad de lo conservado y añadido.

### Criterios de salida

- La petición general de Jeremías y las tres peticiones focalizadas de la auditoría terminan sin exigir dividir manualmente el informe.
- Cero citas eliminadas por recorte de contexto en los pendientes documentados de los cuatro casos.
- El 100 % de los hechos pertinentes **extraídos** tiene estado, fuente y destino. Se mide por separado qué hechos conocidos del corpus el extractor no consiguió recuperar.
- Objetivo de recuperación: al menos 95 % de los hechos pertinentes del corpus de fuentes accesibles; 100 % de sus hechos críticos de identidad, edición y cronología.
- Interrumpir y reanudar no pierde resultados ni genera propuestas o candidatos duplicados.
- Una fuente inaccesible o un presupuesto alcanzado produce un estado parcial claro y recuperable, nunca un falso «completado».

**Zonas principales:** `src/verification`, `src/ambiguity/web-search.ts`, jobs, almacenamiento de informes y el contexto de `src/curation/ai`.

## Etapa 3. Propuestas aplicables y curaduría de imágenes de calidad

**Resultado:** la investigación se convierte en mejoras concretas, con evidencia suficiente y operaciones coherentes.

### Trabajo

1. Validar respaldo por campo, pista, crédito y relación. Una cita del título no valida por sí sola el año, portada, repertorio o integrantes. Identificar sujeto, valor, edición y período en cada prueba documental.
2. Comprobar coherencia entre resumen, operaciones y dudas. Cuando no haya cambios, explicar si el dato existe, falta respaldo, falta un campo o ocurrió un error. Un resumen que promete una operación ausente no puede presentarse como propuesta terminada.
3. Preparar dependencias por etapas: crear una persona, sello, artista o álbum cuando esté documentado, resolver sus referencias y después completar créditos, alias, pistas y vínculos. Deduplicar propuestas respecto al catálogo y otras propuestas activas.
4. Distinguir en la UI operación documentada y decisión editorial. Mostrar evidencia insuficiente antes de aceptar, manteniendo una interacción ágil y registrando el criterio del curador. Revalidar el estado actual antes de aplicar.
5. Tratar las imágenes como recursos asociados a una entidad y uso: retrato, portada, contraportada, cartel, directo, grupo o recurso irrelevante. Comprobar identidad y edición; reunir variantes mediante contenido y similitud visual, con inspección de casos ambiguos.
6. Medir resolución natural, comprobar integridad/descarga, nitidez, encuadre, marcas/texto y adecuación al uso. Preferir originales disponibles y evitar que una miniatura ampliada figure como alta calidad. Mostrar la mejor variante de cada recurso y conservar alternativas útiles.
7. Enviar varias imágenes válidas a curaduría con fuente, uso y calidad. Añadir filtro por ficha, acceso desde artista/disco y explicación de recomendación. Impedir seleccionar como comprobado un recurso que falla; almacenar un recurso estable al aceptar cuando sea posible.
8. Aplicar todo mediante el motor auditado, comprobar efectos posteriores y habilitar deshacer. Los trabajos y la cola de imágenes deben guardar resultados coherentes ante fallos parciales.

### Entregables

- Planificador con evidencia por operación y campo, dependencias y resultados vacíos explicados.
- Canal de medios y galería con clasificación, agrupación y calidad real.
- Pruebas completas de investigar → proponer → decidir → comprobar → deshacer.

### Criterios de salida

- Cero operaciones falsamente documentadas en los casos negativos de aceptación; los dos ejemplos sintéticos de la auditoría detectan respaldo insuficiente.
- El plan de Caramelos sobre un integrante produce una operación documentada o una duda explícita y accionable.
- La portada observada en la cola de retratos de Jeremías se identifica y propone para el álbum correcto.
- Cuando las fuentes aportan varias imágenes pertinentes, todas las alternativas válidas quedan disponibles agrupadas en curaduría; una imagen fallida no aparece como selección verificada.
- El nacimiento disponible de Jeremías llega a su campo de persona mediante una propuesta con cita. Los géneros, sellos, redes y AKA se proponen en su ámbito correcto.
- Tracklists de Apache y Jeremías se proponen por álbum/edición con orden y créditos documentados; lo no resoluble conserva la duda y la fuente.
- Repetir o aceptar dos veces una solicitud no duplica entidades, relaciones o aplicaciones. Deshacer restaura el estado y respeta correcciones posteriores.

**Zonas principales:** `src/curation/ai`, `src/merge/image-candidates.ts`, rutas de candidatos, `CatalogProposalCard`, gestores de ficha y `CurationImagesPage`.

## Etapa 4. Un recorrido claro y UX validada con usuarios

**Resultado:** completar una ficha resulta comprensible en escritorio y móvil, con decisiones y evidencia reunidas en un mismo recorrido.

### Trabajo

1. Ofrecer desde la ficha una entrada principal «Investigar y completar». Presentar el resultado en Datos, Discografía, Imágenes y Dudas; situar las mejoras preparadas antes del historial extenso y el detalle de investigación.
2. Reunir duplicados de hechos/propuestas, agrupar por entidad y mostrar el antes/después junto a las citas. Para cada pendiente indicar el siguiente paso y si bloquea otros cambios. Permitir revisar conjuntos coherentes con previsualización y decisiones explícitas.
3. Reducir opciones simultáneas mediante jerarquía y detalles bajo demanda. Mantener accesibles edición manual, fusión, división, conversión, retiro, alias, géneros, enlaces, créditos, historial y herramientas avanzadas.
4. Separar respaldo documental, cobertura, contradicciones y avance. Mostrar por qué una investigación terminó aunque la ficha tenga dudas. Sustituir bloques masivos de indicadores por un resumen y tareas prioritarias.
5. Resolver navegación de pistas y resultados truncados de búsqueda. Preservar ficha, filtros, avance y selección al volver o cambiar de dispositivo cuando corresponda.
6. Corregir galería móvil, contraste, objetivos táctiles, zoom, lectura con teclado/lector de pantalla, estados vacíos, errores y cargas. Probar también fichas largas, textos y URLs extensas.
7. Hacer recorridos formativo y final con el propietario, único participante disponible. Registrar el aprendizaje previo y seis tareas por recorrido. Por instrucción del propietario, no se exigen ocho personas, cohortes ni participantes nuevos.

### Entregables

- Recorrido implementado y guía breve de tareas.
- Evidencia de escritorio/móvil y accesibilidad automática y manual.
- Informe de sesiones de uso con resultados por tarea, intervenciones necesarias, confusiones, tiempos y problemas encontrados.

### Criterios de salida

- Los participantes pueden encontrar/crear ficha, investigar, revisar evidencia, elegir imagen, decidir una propuesta y deshacer.
- Registrar éxitos y tareas intentadas por el propietario; aplicación y deshacer correctos en todos los intentos evaluados. Sin mínimo de participantes ni cohortes. Cero aceptaciones accidentales o confusión observada entre respaldado y pendiente. Informar números absolutos y muestra, sin convertir una muestra pequeña en certeza estadística.
- Disminuye al menos 50 % el número de decisiones de navegación entre módulos en el recorrido estándar frente a la línea base. La agrupación no debe ocultar decisiones editoriales distintas.
- Ningún bloqueo conocido de teclado, contraste aplicable o reflow en los recorridos centrales. Verificación de anchos 320, 390, 768 y 1440 px, zoom y contenido largo.
- Los cuatro artistas pueden revisarse desde su ficha sin recorrer una cola de cientos de sugerencias sin agrupar.
- Las capacidades administrativas existentes siguen disponibles y sus resultados se contrastan mediante contratos y navegador.

**Zonas principales:** fichas, `AiCurationPage`, cola de verificación, curaduría, búsqueda, modales, historial, componentes compartidos y estilos.

## Etapa 5. Operación robusta y aceptación independiente de toda la versión

**Resultado:** el sistema demostrado en pruebas se publica con continuidad, recuperación y medición suficientes para sostener su calidad.

### Trabajo

1. Respaldar base, fuentes crudas, medios localizados y versión reproducible de aplicación/migraciones. Restaurar en un entorno vacío y comprobar archivos, referencias y navegación, además de conteos. Publicar releases preparados y verificados con cambio atómico y reversión probada.
2. Persistir sesiones de forma compatible con la seguridad y operar trabajos con propietario y expiración de lease. Probar reinicio, caída de base, pérdida de red, cuotas del proveedor, dos procesos y decisiones simultáneas. Cero trabajos de otro proceso invalidados por un arranque.
3. Medir con dataset del tamaño actual y mayor, y con el nivel de concurrencia previsto: navegación, búsqueda, API, análisis completo/dirigido, imágenes y consumo de investigación. Objetivos iniciales: p95 de búsqueda/lectura de ficha menor de 1 s en API; análisis dirigido menor de 1 s; completo menor de 15 s con el catálogo actual. Documentar hardware, carga y caché; ajustar infraestructura o código cuando falten objetivos, no encoger el dataset.
4. Incorporar métricas de fuentes realmente leídas, extracción, reutilización, citas conservadas, cambios útiles, imágenes válidas, pendientes, fallos y costo por investigación. Verificar alertas accionables y retención de datos.
5. Validar descubrimiento y sus métricas en los estados habilitado/deshabilitado. El prototipo interno conserva su condición y limitaciones; su publicación no es requisito de este plan. Si se habilita captura, migración, agregado y retención deben estar operativos.
6. Ejecutar aceptación integral con sesiones auténticas, backend de la versión candidata, navegador, fuentes reales y modelo real con presupuesto definido. Las fixtures controladas complementan esa prueba y permiten repetir fallos; no la sustituyen.
7. Revisar la versión final desde el rol de evaluador, contrastando las 29 dimensiones y volviendo a probar defectos. Conservar hallazgos desfavorables y corregirlos antes de cerrar. Observar durante 30 días de uso representativo, con al menos 30 investigaciones completadas, 100 decisiones editoriales y 10 operaciones de deshacer; si falta actividad, ampliar la ventana. Un incidente crítico/importante reinicia la observación tras corrección y revalidación, conforme al contrato.

### Entregables

- Release candidato, respaldo/restauración y reversión demostrados, panel operativo y runbook.
- Expediente de aceptación con versión, entorno, corpus, fuentes, resultados, sesiones de usuarios y limitaciones.
- Nueva evaluación de las 29 dimensiones, con enlaces a evidencia y registro de incidencias de la ventana de observación.

### Criterios de salida para declarar 20/20

- Cero defectos conocidos críticos o importantes abiertos, incluidas pérdida de datos/citas, identidad incorrecta, cambios sin respaldo comunicado o bloqueo de tareas centrales.
- Tipos, lint, build, unitarias, contratos y recorridos de navegador/accesibilidad aprobados sobre la misma versión; pruebas de autenticación real, concurrencia, migración y recuperación aprobadas.
- Calidad y cobertura documental verificadas sobre corpus etiquetado, junto a resultados de fuentes reales. Incertidumbres legítimas claramente registradas y recuperables.
- Restauración íntegra y deshacer comprobados; permisos respetados; sesiones y trabajos recuperables.
- Objetivos de rendimiento y uso cumplidos con condiciones de medición publicadas.
- Las 29 dimensiones cumplen sus criterios y tienen evidencia; ninguna se eleva mediante un promedio que oculte un fallo importante.
- Ventana de uso representativo sin incidentes de pérdida o atribución indebida, con incidencias menores corregidas y vueltas a comprobar.

**Zonas principales:** servicios de API/jobs, operaciones, backups, despliegue, métricas, descubrimiento, CI y toda la aplicación publicada.

## Corpus y recorridos obligatorios de aceptación

Construir al menos 40 fichas representativas para regresión: los cuatro artistas, personas con fecha parcial y fallecimiento, homónimos, sellos, colaboraciones, alias, biografías contradictorias, discos sin pistas, pistas con huecos, variantes CD/DVD/reedición, imágenes repetidas/fallidas y operaciones concurrentes. Separar 24 fichas de desarrollo y 16 reservadas para aceptación. El protocolo detallado del contrato define distribución, custodia y tres repeticiones del corpus reservado.

Etiquetar manualmente al menos 300 hechos positivos, 100 casos negativos, 100 imágenes y 120 documentos de fuentes. Separar el corpus de desarrollo de la reserva como fija el contrato. Incluir negativos de identidad, fecha, edición y evidencia insuficiente. Esos mínimos no garantizan cobertura de todas las combinaciones: ampliar cuando aparezca un nuevo fallo. El conjunto incluye ejemplos que el sistema debe conservar como dudosos o rechazar con motivo.

| Caso | Comprobación obligatoria |
|---|---|
| Jeremías | Procesar investigación amplia y focalizada; reutilizar nacimiento/persona/artista; proponer pistas y sellos por disco; enviar varias fotos y portadas correctas; aceptar, comprobar y deshacer. |
| Apache | Completar datos documentables de álbumes vacíos; conservar citas; resolver identidad y colaboraciones; clasificar imágenes sin mezclar otros artistas. |
| La Banana Voladora | Conservar fusiones y pistas válidas; no reabrir duplicados decididos; explicar la pista adicional y períodos inciertos con evidencia. |
| Caramelos de Cianuro | Propuesta real o duda explícita del integrante; distinguir CD/DVD y reediciones; preservar géneros, fechas y citas; no fusionar por título parecido. |

## Cobertura de las 29 dimensiones

| Dimensiones de la auditoría | Etapa que entrega la mejora | Cierre |
|---|---|---|
| Modelo, relaciones, fusiones/divisiones, autenticación, procedencia | 1; integración en 3 | 5 |
| Investigación, verificación/comparación, aprovechamiento adicional | 2 | 5 |
| Propuestas, validación documental, extracción/calidad de imágenes | 3, apoyada por 1–2 | 5 |
| Crear/editar, géneros, detectores, autocorrección, historial/deshacer | 1 y 3; interfaz en 4 | 5 |
| Búsqueda, interfaz pública, UX administrativa, móvil y accesibilidad | 4 | 5 |
| Rendimiento, recuperación, pruebas, despliegue/respaldo, métricas, descubrimiento y documentación | Controles desde 1; continuidad en 2–4; operación en 5 | 5 |

Cada etapa se cierra con evidencia de sus propios objetivos. No se asignarán notas intermedias prometidas de 15, 18 o 20 sin volver a evaluar el comportamiento obtenido.
