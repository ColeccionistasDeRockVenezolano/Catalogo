# Contrato de ejecución y aceptación del plan de cinco etapas

Versión 2 · 10 de octubre de 2026 · Documento complementario del [plan principal](PLAN_CINCO_ETAPAS_20_DE_20_2026-10-10.md).

Este contrato vuelve ejecutables las cinco etapas. [Backlog estructurado](plan-20-de-20/backlog.json) y [matriz estructurada de aceptación](plan-20-de-20/acceptance.json). Las tareas están en estado **planificado**; los umbrales son requisitos de aceptación, no resultados alcanzados. La entrega actual modifica documentación y planificación, no fichas ni código de producto.

La [validación de consistencia](plan-20-de-20/planning-validation.json) comprueba cinco etapas, 25 paquetes, dependencias sin ciclos, 29 dimensiones, 13 métricas, 20 criterios de preparación, enlaces y concordancia entre documento/JSON. Se reproduce desde la raíz con `./scripts/with-node22.sh node docs/plan-20-de-20/validate-plan.mjs`. Esta comprobación valida el plan; los resultados del software permanecen pendientes.

## 1. Alcance cerrado y dependencias de ejecución

**Incluido:** todas las capacidades publicadas inventariadas en la auditoría y los requisitos del usuario: creación/edición/retiro, relaciones/créditos, alias, géneros, búsqueda, comparación, identidad, fusión/división/conversión, investigación de artista/persona/álbum/sello, fuentes y contenido adicional, portadas/retratos, tracklists, fechas parciales, propuestas, curaduría, historial/deshacer, medios, enlaces/YouTube/streaming existentes, descubrimiento existente, permisos, UX, operación y restauración.

**Ampliaciones fuera del cierre:** apps nativas, red social, recomendaciones musicales nuevas, ranking público de tendencias, nuevos proveedores por conveniencia y extracción universal de cualquier web. Los proveedores y tipos de documento necesarios para demostrar el corpus sí están incluidos. Una fuente bloqueada se registra y se conserva el trabajo parcial; no se evade una barrera ni se declara leído contenido que no se pudo obtener.

La investigación amplía los hallazgos pertinentes aunque no aparezcan en la petición del usuario. El alcance del producto limita funciones nuevas; no limita conservar los hechos encontrados ni proponer mejoras de las fichas relacionadas.

Al iniciar E1-01, registrar el código/bundle/API efectivos, los cambios del workspace y los servicios disponibles. Los conteos y fallos del 10 de octubre son una línea base histórica que se vuelve a medir. Trabajar en cambios aislados que preserven modificaciones ajenas; no resetear el workspace compartido. Preparar una copia de base y medios para pruebas de escritura. Tener cuenta de prueba auténtica y conexión al proveedor antes del piloto real. Los participantes y la revisión editorial se programan desde E1-01.

Cada decisión técnica se registra con problema, alternativa elegida, impacto y prueba. Una modificación del core necesita migración y compatibilidad explícitas. Un cambio que afecte criterios o corpus versiona el protocolo y obliga a volver a aceptar; no cambia retroactivamente una medición fallida.

## 2. Responsabilidades y revisión

| Rol | Responsabilidad | Verifica |
|---|---|---|
| B: implementación backend | Modelo, APIs, IA, jobs, integridad y pruebas de su cambio | Q; C en atribución, evidencia y conservación |
| F: implementación frontend/UX | Flujos, componentes, navegación y estados | Q; participantes para comprensión y tareas |
| C: curaduría editorial | Ground truth, identidad, edición, calidad de imagen y dudas | Segunda revisión de los casos críticos/discutidos |
| O: operación | Backups, entorno, despliegue, restauración, métricas y respuesta | Q mediante ensayos reproducibles |
| Q: aceptación | Corpus reservado, pruebas de release, defectos y expediente | C en exactitud; implementación reproduce los fallos |

Una persona puede cubrir varias funciones de implementación. El cierre documental crítico necesita revisión editorial; la aceptación final necesita un revisor que no haya implementado el cambio evaluado. Registrar nombres y disponibilidad al abrir cada paquete. Si esa revisión o los participantes no están disponibles, el estado es **validación pendiente**, sin declarar 20/20. No se presupone un equipo ya contratado ni se inventan participantes.

Quien implementa entrega evidencia; Q evalúa. Los desacuerdos editoriales mantienen el hecho como duda y documentan el motivo. El revisor no acepta pérdida de información o identidad errónea por una mejora del promedio.

## 3. Paquetes, dependencias y esfuerzo

Una jornada equivale a seis horas de trabajo concentrado. Las cifras son rangos iniciales de esfuerzo humano equivalente, agregados entre funciones; no son mediciones ni una promesa del tiempo que tardará un agente. Incluyen comprobaciones del paquete. Presupuesto de esfuerzo base: **64–112 jornadas**; reserva del 30 % para integración y correcciones: **84–146 jornadas**, aproximadamente 500–875 horas. La ventana de observación agrega 30 días calendario, con su atención operativa incluida en E5-05.

E1-01/E1-02 calibran las estimaciones con trabajo terminado. Registrar esfuerzo real y recalcular lo pendiente, sin bajar los criterios de calidad. Construir el calendario con capacidad efectiva B/F/C/O/Q y disponibilidad de participantes. Si una sola persona hace todo, respetar las dependencias y las horas de cada función; no sumar disponibilidad ficticia.

| Etapa | Esfuerzo base | Entrega principal |
|---|---:|---|
| 1 | 12–22 jornadas | Base y modelo confiables |
| 2 | 15–24 jornadas | Investigación recuperable y completa |
| 3 | 13–23 jornadas | Propuestas respaldadas y medios correctos |
| 4 | 11–20 jornadas | Recorrido claro validado con personas |
| 5 | 13–23 jornadas | Release operable y aceptación sostenida |

Las dependencias del backlog determinan cuándo puede comenzar cada paquete. Se pueden preparar tareas independientes, pero la etapa posterior no se declara cerrada antes de los criterios de la anterior. Cada fila incluye trabajo, salida, responsable y dependencia; el JSON añade áreas de código y prueba concreta.

### Etapa 1

| ID | Trabajo y salida | Responsable / revisión | Depende de | Jornadas |
|---|---|---|---|---:|
| E1-01 | Congelar versión, preservar workspace, copiar base/medios, preparar corpus y línea base de uso | B/O · Q/C | Inicio | 3–5 |
| E1-02 | Resolver regresiones; CI bloqueante con backend, web y navegador | B/F · Q | E1-01 | 2–4 |
| E1-03 | Reconciliar procedencia, referencias e índices; declarar límites históricos | B · Q/C | E1-01, E1-02 | 2–4 |
| E1-04 | Migrar precisión de fechas y obra/edición/soporte sin perder datos | B · Q/C | E1-01, E1-02 | 3–5 |
| E1-05 | Contrato persistente de hechos/evidencias y política coherente de acciones | B/C · Q | E1-02, E1-04 | 2–4 |

### Etapa 2

| ID | Trabajo y salida | Responsable / revisión | Depende de | Jornadas |
|---|---|---|---|---:|
| E2-01 | Lotes, contexto por hallazgo, checkpoints e idempotencia | B · Q | E1-05 | 4–6 |
| E2-02 | HTML/renderizado/PDF/OCR y cobertura de lectura por fuente | B · Q/C | E1-05, E2-01 | 3–5 |
| E2-03 | Identidad, agrupación, edición/período y citas preservadas | B/C · Q | E2-01, E2-02, E1-04 | 3–5 |
| E2-04 | Extraer/reutilizar todos los ámbitos y dar destino a cada hecho | B/C · Q | E2-03 | 3–5 |
| E2-05 | Versionar/reprocesar informes; progreso, presupuesto y pausa/reanudación | B/F · Q | E2-04 | 2–3 |

### Etapa 3

| ID | Trabajo y salida | Responsable / revisión | Depende de | Jornadas |
|---|---|---|---|---:|
| E3-01 | Evidencia por campo/relación y decisión editorial visible | B/C · Q | E1-05, E2-04 | 3–5 |
| E3-02 | Operaciones dependientes, sin duplicados y vacíos explicados | B · Q/C | E2-05, E3-01 | 3–5 |
| E3-03 | Clasificar medios, medir calidad natural y agrupar variantes | B/C · Q | E2-04, E1-04 | 3–5 |
| E3-04 | Integrar cola por ficha, varias alternativas y aplicación auditada | B/F · Q/C | E3-02, E3-03 | 2–4 |
| E3-05 | Verificar ciclos completos, concurrencia y deshacer | B/F · Q/C | E3-04, E1-03 | 2–4 |

### Etapa 4

| ID | Trabajo y salida | Responsable / revisión | Depende de | Jornadas |
|---|---|---|---|---:|
| E4-01 | Jerarquía/guion y primera ronda de UX, problemas priorizados | F/C · Q | E3-05, E1-01 | 2–3 |
| E4-02 | Investigar y completar, propuestas agrupadas y continuidad | F/B · Q/C | E4-01 | 3–5 |
| E4-03 | Búsqueda completa, pista a álbum y operaciones existentes accesibles | F/B · Q | E4-02 | 2–4 |
| E4-04 | Móvil, accesibilidad y error/recuperación | F · Q | E4-03 | 2–4 |
| E4-05 | Segunda ronda con participantes nuevos y cierre de defectos de UX | F/C · Q | E4-04 | 2–4 |

### Etapa 5

| ID | Trabajo y salida | Responsable / revisión | Depende de | Jornadas |
|---|---|---|---|---:|
| E5-01 | Backup completo, restauración, release atómico y reversión | O/B · Q | E3-05, E1-01 | 3–5 |
| E5-02 | Sesiones y leases; dos procesos, reinicios y fallos | B/O · Q | E2-05, E3-05 | 3–5 |
| E5-03 | Rendimiento/costos/alertas y descubrimiento on/off | B/O · Q | E5-01, E5-02 | 2–4 |
| E5-04 | Aceptación de release, modelo/fuentes/auth reales y matriz de 29 dimensiones | Q/C · B/F/O | E4-05, E5-03 | 3–5 |
| E5-05 | Observación, actividad mínima, incidentes y evaluación final | O/Q · C | E5-04 | 2–4, distribuidas en observación |

Ruta obligatoria del resultado principal: E1-04/E1-05 → E2-01…E2-05 → E3-01/E3-02/E3-04/E3-05 → E4 → E5-04/E5-05. Los cuatro casos se prueban al final de cada etapa, no solo al final del proyecto.

## 4. Presupuesto de IA, infraestructura y disponibilidad

No se contratarán servicios ni se gastará presupuesto al preparar este plan. La implementación reutilizará el stack y los proveedores existentes donde cumplan los requisitos. Instalar o configurar lectores/OCR no presupone una suscripción externa.

Presupuesto inicial propuesto del piloto real: **hasta 1.200 llamadas y 20 millones de tokens totales**, incluyendo fallos y reintentos, con un máximo financiero configurable obligatorio. Valorarlo al iniciar E1-01 con tarifas oficiales del modelo/proveedor elegido y su moneda. Fórmula: tokens de entrada × tarifa de entrada + tokens de salida × tarifa de salida + lectura/OCR/almacenamiento facturables. Contar caché de acuerdo con la facturación del proveedor. Techo monetario inicial del piloto: 20 millones de tokens × la mayor tarifa por token aplicable del proveedor elegido, más costos externos por solicitud/documento si existen, y 10 % de reserva. E1-01 captura la tarifa oficial, calcula ese techo y lo registra en configuración antes de ejecutar; nuevas suscripciones tienen presupuesto inicial cero y quedan fuera salvo necesidad justificada del corpus. Registrar costos estimados y reales por ejecución; no inventar precios actuales.

Límites iniciales propuestos por investigación: 250 llamadas y 4 millones de tokens; ambas suman al presupuesto global. Inicialmente una ejecución de IA activa, ampliable a dos tras validar concurrencia/cuotas. Se reutilizan capturas y caché, se agrupan hechos y se procesan dependencias antes de crear nuevas llamadas. Alcanzar un límite pausa con resultados conservados y continuación disponible. Una prueba que necesitaba terminar y se pausa por presupuesto **no pasa** como completa; revisar algoritmo o presupuesto antes de repetir. Ningún límite descarta silenciosamente hechos.

Medir espacio real de PostgreSQL, medios y fuentes antes de duplicar/restaurar. Planificar capacidad libre suficiente para origen, staging, copia de recuperación y temporales; contabilizar crecimiento durante el piloto. Validar compatibilidad y memoria de OCR/renderizado con un documento real antes de procesar un lote. Pausar nuevas adquisiciones ante falta de espacio preservando lo obtenido.

Recursos humanos mínimos funcionales: implementación, curador para ground truth, revisor de aceptación y participantes del estudio. Nombrar disponibilidad antes de comprometer fechas; su ausencia bloquea la validación pertinente, no justifica simular su aprobación.

## 5. Corpus y protocolo de medición

Congelar `corpus-v1` antes de optimizar. Contendrá al menos **40 fichas, 300 hechos positivos, 100 casos negativos, 100 imágenes y 120 documentos**. Los documentos incluyen un mínimo de 60 HTML/estructurados, 20 renderizados, 20 PDF y 20 imágenes escaneadas/OCR. Si una fuente real necesita otro formato esencial, agregarlo versionando el corpus.

Distribución: 24 fichas de desarrollo, incluidos los cuatro casos conocidos, y 16 reservadas. Distribuir 180/120 hechos positivos, 60/40 negativos y 60/40 imágenes entre desarrollo/reserva. Estratificar por entidades, ámbitos y formatos; no poner todos los casos difíciles en desarrollo. Los 16 reservados incluyen como mínimo persona, artista, álbum y organización/sello, fechas parciales, homónimos y ediciones diferentes. Q custodia los resultados esperados de la reserva.

Los positivos deben ser pertinentes y documentados; los negativos incluyen identidad, edición, cronología, enlaces no oficiales, imagen incorrecta y cita insuficiente. Incluir documentos con instrucciones ajenas a la investigación y URLs inseguras: se tratan como contenido no confiable y no autorizan cambios, lectura de secretos o peticiones internas. Etiquetar sujeto, valor, campo, edición/período, cita, posición del fragmento, calidad/uso de imagen y destino esperado. Dos revisiones de los críticos/discutidos; un desacuerdo conserva incertidumbre y no se usa para fingir una verdad objetiva.

Ejecutar tres veces la reserva sobre la misma versión, con nuevas ejecuciones del modelo y estados iniciales reproducibles. Cada repetición debe pasar sus objetivos; no elegir únicamente la mejor. Las capturas congeladas sirven para medir extracción de forma reproducible. El piloto de fuentes en vivo informa accesibilidad, cambios y rendimiento por separado; preservar su copia y no alterar el denominador de una ejecución ya realizada.

### Métricas y denominadores

| ID | Indicador | Cálculo y objetivo |
|---|---|---|
| M01 | Conservación de evidencia | Citas pertinentes preservadas / citas pertinentes de entrada =100 %. Comparar IDs/contenido antes/después de contexto y reanudación. |
| M02 | Hechos con destino | Hechos pertinentes extraídos con fuente/estado/destino / total pertinente extraído =100 %. Es trazabilidad, no recall. |
| M03 | Recuperación documental | Hechos positivos recuperados correctamente / positivos etiquetados ≥95 %, en cada repetición; hechos críticos 100 %. Publicar resultados por ámbito y formato. |
| M04 | Precisión factual | Hechos emitidos correctamente atribuidos y respaldados / total emitido como documentado ≥98 %. Cero error crítico de identidad/edición/cronología, cero hecho sin respaldo presentado como comprobado. |
| M05 | Negativos de evidencia | Cero aplicaciones automáticas/documentadas de los 100 casos negativos. Una decisión editorial explícita se registra aparte y nunca convierte el hecho en comprobado. |
| M06 | Imágenes | Entidad/edición correcta 100 % de las propuestas verificadas; clasificación de uso ≥95 % del corpus; variantes óptimas disponibles 100 % de sus grupos; cero recurso fallido seleccionable como verificado. |
| M07 | Plan coherente | 100 % de planes: resumen compatible con operaciones/dudas; vacíos explicados; operaciones viables o bloqueo explícito. |
| M08 | Aplicar y deshacer | 100 % de escenarios obligatorios conserva/restaura campos, relaciones, claims y medios previstos; cambios posteriores protegidos; repetición no duplica. |
| M09 | Tareas sin ayuda | Éxitos sin intervención / tareas intentadas. Segunda ronda: ≥44/48 global y ≥22/24 en cada cohorte; acciones críticas correctas 8/8. |
| M10 | Navegación | Mediana de cambios de módulo en guion fijo reducido≥50 % respecto a línea base; registrar antes/después, sin confundir menos pantallas con menos decisiones editoriales. |
| M11 | Rendimiento | Búsqueda/lectura ordinaria p95 <1 s y p99 <2,5 s en API; errores inesperados<0,1 %. Análisis dirigido <1 s y completo <15 s en catálogo vigente. |
| M12 | Recuperación | Cero hechos/citas/decisiones perdidos en interrupciones probadas; un único resultado editorial por operación; jobs de otro proceso no invalidados. |
| M13 | Integridad | Cero referencias invalidas nuevas; cero mutación editorial nueva sin run y procedencia; incidencias heredadas reconciliadas o limitaciones verificables explícitas. |

No se excluyen errores, abandonos, casos difíciles o hechos omitidos después de ver el resultado. Una fuente inaccesible se contabiliza como inaccesible en vivo y conserva los hechos pendientes; para recall reproducible se usa el documento capturado accesible. Si el denominador es cero, se informa **no evaluado**, y se prepara una muestra; nunca 100 % por ausencia de casos.

### Protocolo de UX

Primera muestra: ocho participantes, cuatro nuevos y cuatro curadores. Medir línea base en E1-01; esa muestra puede participar en la ronda formativa de E4-01, cuyo aprendizaje no se confundirá con validación final. Segunda ronda: ocho personas distintas, cuatro por cohorte, en E4-05.

Seis tareas por participante: encontrar/crear ficha; iniciar investigación e interpretar avance; revisar hecho/cita/duda; elegir una imagen pertinente; aplicar una propuesta comprobada; comprobar y deshacer. Moderador observa sin orientar; toda ayuda se registra y la tarea deja de contar como éxito sin ayuda. Registrar abandono, acción equivocada, confusión, navegación, tiempo y comentarios, con IDs de participante sin datos personales innecesarios.

Aplicación y deshacer son críticos y deben ejecutarse correctamente por los ocho participantes. Una aceptación accidental o confusión respaldado/pendiente bloquea cierre de UX aunque el total supere 44/48. Corregir y validar con personas nuevas si el cambio alteró el recorrido. Reportar resultados por cohorte; 16 participantes aportan evidencia de problemas y tareas, no garantía estadística de toda la población.

### Protocolo de rendimiento y fallos

Registrar equipo, versiones, volumen actual y caché. Carga propuesta: diez sesiones lectoras concurrentes, diez solicitudes/segundo durante 15 minutos, cien fichas/consultas diversas, 20 % de lecturas frías. Probar también dos administradores, un análisis completo y una investigación; las llamadas del proveedor se miden aparte del tiempo interno.

Separar latencia de API, carga visible de web y espera externa. El objetivo web del recorrido principal es interacción disponible <3 s bajo la red/CPU de ensayo documentadas. Probar 2× el volumen vigente para estabilidad/crecimiento sin atribuirle el tamaño de una fixture histórica. Excluir endpoints de trabajos largos del SLO de lectura ordinaria, pero exigir inicio/estado rápidos y progreso recuperable.

Inyectar caída de API/base/red/proveedor, cuota agotada, descarga truncada, falta de espacio, reinicio, lease expirado, dos procesos y edición concurrente. Cada caso produce un estado coherente, diagnóstico y recuperación; no una pantalla que declara terminado un trabajo incompleto.

## 6. Matriz de aceptación de las 29 dimensiones

Cada gate tiene resultado, evidencia y verificador. Valores posibles: **pendiente, pasa, falla, no evaluado**. Ninguno empieza en pasa. Todos deben pasar en el release final; una excepción importante bloquea el 20/20. Las limitaciones documentales legítimas tienen pruebas de incertidumbre correcta y forman parte de una aceptación exitosa.

| Gate | Dimensión | Evidencia de aceptación exigida | Paquete principal / verificador |
|---|---|---|---|
| G01 | Modelo | Fechas parciales y CD/DVD/ediciones preservados; migrar/revertir/reaplicar | E1-04 · Q/C |
| G02 | CRUD | Todos los tipos, edición compatible, retiro con dependencias y alta desde investigación; M08 | E3-05/E4-03 · Q |
| G03 | Búsqueda | Cuatro casos, alias/acentos, filtros, resultados completos y pista a álbum; M11 | E1-02/E4-03 · Q |
| G04 | Relaciones/créditos | Sujeto/período correctos y conservación de vínculos; negativos de atribución | E2-03/E3-05 · Q/C |
| G05 | Fusiones/divisiones/conversiones | Identidad/edición respaldada, preview vigente, aliases/referencias preservados; M08 | E1-04/E3-05 · Q/C |
| G06 | Géneros | Artista/obra/edición diferenciados, taxonomía y roles explícitos, fuente conservada | E2-04/E3-05 · Q/C |
| G07 | Lectura de fuentes | Cobertura real, timestamps originales, 4 formatos; M01/M03/M04 | E2-02/E2-04 · Q/C |
| G08 | Verificación/comparación | Artista/persona/álbum/sello; puntaje/cobertura/dudas separados, versiones claras | E2-03/E2-05 · Q/C |
| G09 | Información adicional | Cruce y destino de todos los hechos pertinentes; M01/M02/M03 | E2-04/E4-02 · Q/C |
| G10 | Propuestas IA | Jeremías y Caramelos resueltos; dependencias y planes coherentes; M07/M08 | E3-02 · Q/C |
| G11 | Validación documental | Evidencia por campo/relación, negativos y editorialidad visible; M04/M05 | E3-01 · Q/C |
| G12 | Extracción de imágenes | Varias alternativas útiles por ficha, fuentes y acceso a curaduría; M02/M06 | E3-03/E3-04 · Q/C |
| G13 | Calidad/clasificación | Resolución natural, uso/identidad y mejores variantes; fallidas controladas; M06 | E3-03/E3-04 · Q/C |
| G14 | Detectores/categorías | Corpus vigente revisado, positivos conservados, precisión≥95 % por detector con muestra ysin atribución crítica errónea | E1-05/E3-05 · Q/C |
| G15 | Autocorrección | Lista blanca demostrable, límites, fallo/reversión y ninguna inferencia histórica automática | E1-05/E3-05 · Q/C |
| G16 | Historial/deshacer | Antes/después y fuente accesibles, límites históricos explícitos; M08/M13 | E3-05/E4-03 · Q/C |
| G17 | Interfaz pública | Listados/fichas/enlaces/medios funcionales, legibles y con cargas/ausencias claras | E4-03/E4-04 · Q |
| G18 | UX/carga cognitiva | Resultados por cohorte, tareas y navegación; M09/M10 | E4-05 · Q/participantes |
| G19 | Móvil | 320/390/768/1440 px, contenido largo, zoom y sin overflow del documento | E4-04/E4-05 · Q |
| G20 | Accesibilidad | Recorrido de teclado/lector/foco, contraste y reflow; criterios AA aplicables sin fallos conocidos | E4-04/E4-05 · Q |
| G21 | Rendimiento | Benchmark del tamaño actual, escenarios 2× y concurrencia; M11 | E5-03 · Q/O |
| G22 | Errores/recuperación | Escenarios de fallo, progreso parcial, reanudación y resultados idempotentes; M12 | E5-02 · Q/O |
| G23 | Permisos/autenticación | Sesiones reales, reader/admin, CSRF, expiración/reinicio, límites de login y entradas, URLs/redirects seguros y restricción de escrituras | E5-02 · Q |
| G24 | Pruebas/regresiones | CI de release aprobada, negativos y navegador reales, ninguna prueba omitida para cerrar | E1-02/E5-04 · Q |
| G25 | Despliegue/respaldo | Restauración de base/raw/medios y publicación/reversión sin pérdida | E5-01 · Q/O |
| G26 | Procedencia/integridad | doctor y reconciliación verificables; M13 | E1-03/E5-04 · Q/C |
| G27 | Observabilidad | Métricas de extracción/reutilización/presupuesto y alertas ensayadas; no denominadores vacíos | E2-05/E5-03 · Q/O |
| G28 | Descubrimiento | Sugerencias/editorialidad correctas; métrica on/off, retención y prototipo identificado | E5-03 · Q/C |
| G29 | Documentación/operación | Runbook ejecutado por revisor, versiones y capacidades declaradas, expediente completo | E5-01/E5-05 · Q/O |

Para G14 ampliar la muestra por detector accionable hasta al menos 20 positivos y 20 negativos reales/representativos; revisar con C su etiqueta. Precisión = verdaderos positivos / (verdaderos positivos + falsos positivos). Medir también verdaderos positivos recuperados / positivos etiquetados y exigir que se conserven los críticos y las regresiones positivas existentes. La precisión sola no basta: no perder positivos críticos y recordar decisiones previas. Un detector sin muestra suficiente queda no evaluado y no entra en autocorrección. Los detectores informativos se comprueban por significado y visibilidad, sin fingir que ofrecen una corrección automática.

## 7. Riesgos, reversión y escalamiento

| Riesgo concreto | Prevención y comprobación | Respuesta / responsable |
|---|---|---|
| Cambio de workspace/bundle/migración durante trabajo | Baseline de versión y diff propio por paquete | Reconciliar contra versión actual; invalidar evidencia de código anterior · B/O/Q |
| Datos históricos sin procedencia recuperable | Comparar claims/diario/redirecciones y copias disponibles | Registrar limitación sin fabricar fuente; si hay corrupción activa, bloquear y reparar · B/C |
| Modelo omite/inventa o cambia resultado | Evidencia por campo, corpus reservado, tres repeticiones | Capturar salida fallida; corregir validación/extracción; no publicar ese plan · B/Q/C |
| Sitio bloqueado o documento sin lectura | Lectores escalonados y copia/versionado de fuente | Marcar inaccesible/parcial, conservar pendiente y otras fuentes; no fingir lectura · B |
| Cuota/costo/espacio excedido | Contadores y presupuestos visibles; estimación previa | Pausar conservando checkpoint; ajustar capacidad/algoritmo antes de reanudar · B/O |
| Mezcla de identidad o edición | Identificación previa, período y evidencia relacional | Mantener conflicto y pedir decisión editorial dentro del producto; impedir atribución automática · C/B |
| Migración o aceptación pierde datos | Copia completa, preview, transacción, hashes y ensayo de deshacer | Detener escrituras afectadas; revertir cambio específico con datos posteriores protegidos · B/O |
| No hay participantes o revisor | Programar disponibilidad en E1-01 | Continuar trabajo técnico independiente; mantener validación pendiente · F/Q |
| Expansión de alcance | Inventario incluido, paquetes y matriz de 29 dimensiones | Registrar ampliación separada; incluir solo si necesaria para gates sin bajar los existentes · Q/C/B |

Antes de cambios de esquema o backfill, preparar copia restaurable y ensayo de migración/reversión en staging. Restaurar una base vieja en producción puede eliminar escrituras posteriores: priorizar transacción, corrección compensatoria auditada y rollback de aplicación compatible. Una restauración completa requiere reconciliar datos posteriores, no usarla como deshacer cotidiano. Separar decisiones del curador de la reversión técnica de un release.

Cada defecto tiene severidad, evidencia, paquete, condición de reproducción y prueba de cierre. P0: pérdida/corrupción activa o acceso indebido; P1: identidad/evidencia incorrecta, pérdida de hechos o bloqueo central; P2: capacidad importante, UX/accesibilidad/operación incumplida; P3: mejora menor o ampliación fuera del alcance. P0/P1 detienen publicación afectada; P2 impide cerrar su gate. No reclasificar para obtener el 20/20; Q registra y revisa la justificación.

## 8. Definición de terminado y expediente de release

Un paquete solo se marca **verificado** cuando su entregable está implementado, sus dependencias verificadas, las pruebas significativas aprobadas, la conservación de datos comprobada, la evidencia guardada y el revisor identificado. Estados de trabajo: planificado → en ejecución → implementado → en validación → verificado. Un fallo vuelve a en ejecución; cancelado exige motivo y su gate sigue pendiente.

Evidencia prevista bajo `reports/plan-20-de-20/<release>/`: manifiesto de código/bundle/API/DB/corpus, resultados por gate y ejecución, salidas del modelo con fuentes y consumo, capturas/recorridos, informe de usuarios, benchmarks, restauración/reversión, defectos y observación. La ruta describe entregables futuros; no hay archivos de éxito ficticios creados por este plan. Evitar claves, cookies y datos personales innecesarios en el expediente.

Pruebas existentes a ejecutar en el release candidato: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:contract`, unitarias web, tipos/build web y `npm run doctor` en el entorno de aceptación. Añadir las comprobaciones de extracción/documentación, lotes/citas, operaciones, medios, permisos, UI y fallos definidas por los paquetes. Ejecutar CI y aceptación sobre el mismo código; un cambio posterior invalida al menos los gates afectados y los recorridos integrados.

La aceptación E5-04 usa autenticación auténtica y proveedor/modelo real, además de las fixtures. Escribir/deshacer en staging primero; los ensayos de caída/restauración no se realizan sobre producción activa. La versión publicada debe coincidir con la aceptada y pasar smoke de lectura y tareas autorizadas.

E5-05 exige **30 días y actividad mínima:** 30 investigaciones completadas, 100 decisiones editoriales de aplicar/rechazar y 10 operaciones de deshacer en uso representativo. Las decisiones de QA/sintéticas se informan aparte y no suman a este mínimo. No generar actividad ficticia para cumplirla. Si no se alcanza, prolongar observación. Un P0/P1 reinicia la ventana después de corregir y revalidar; un P2 invalida su gate y requiere prueba dirigida y regresión del recorrido afectado, manteniendo explícita la observación posterior.

El cierre exige 29/29 gates aprobados y revisión independiente con evidencia. Muestra pequeña, pruebas sintéticas o una media alta no sustituyen una dimensión pendiente. Un defecto conocido P0, P1 o P2 dentro del alcance impide el cierre aunque una fila haya pasado antes. El 20/20 corresponde al alcance y a la versión evaluados; cambios futuros necesitan regresión y los incidentes posteriores actualizan la evaluación.

## 9. Checklist de calidad del propio plan:20 criterios

Esta checklist evalúa la preparación del documento; no puntúa software aún sin implementar. Cada punto tiene la evidencia de planificación que lo satisface.

| # | Criterio de plan completo | Evidencia en esta entrega |
|---:|---|---|
|1 | Alcance y ampliaciones delimitados | §1 |
|2 | Todos los requisitos del usuario cubiertos | Plan principal y §1/§6 |
|3 | Baseline verificable y versión publicada diferenciada | E1-01 y §1 |
|4 | Cinco etapas con resultados y salida | Plan principal |
|5 | Trabajo dividido en paquetes ejecutables |25 paquetes de §3/backlog |
|6 | Dependencias y ruta obligatoria | Backlog y §3 |
|7 | Responsables y revisión definidos | §2 y cada paquete |
|8 |29 dimensiones con aceptación individual | G01–G29 |
|9 | Métricas con denominador y límites | M01–M13/§5 |
|10 | Corpus etiquetado, negativos y reserva | §5 |
|11 | Usuarios reales y protocolo de tareas | Dos cohortes, dos rondas y M09/M10 |
|12 | Esfuerzo y recalibración |64–112 jornadas+reserva;§3 |
|13 | Recursos, costo y disponibilidad | §4 |
|14 | Conservación, continuidad e idempotencia | E2/E3/M01/M08/M12 |
|15 | Riesgos y respuesta asignada | §7 |
|16 | Migración, restauración y reversión | E1/E5 y §7 |
|17 | Pruebas de resultados y CI | E1-02, gates y §8 |
|18 | Aceptación independiente | Q/C y E5-04 |
|19 | Operación y uso sostenido | E5-05 yactividad mínima |
|20 | Definición de terminado sin falsos cierres | §8 y estados explícitos |

Cubrir estos 20 criterios vuelve completo el contrato de planificación. Su cumplimiento durante ejecución, la calidad real de implementación y la nota del sistema se comprobarán con los gates; no se heredan de esta checklist.
