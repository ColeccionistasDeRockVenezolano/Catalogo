# Propuestas de curaduría con DeepSeek

La sección **Curaduría → Propuestas con IA** convierte una instrucción sobre una ficha en operaciones editables. También se abre desde **Preparar correcciones con IA** en el informe de fiabilidad de artistas, personas y discos.

## Uso

1. Abre **Revisar cambios sugeridos por IA** desde el informe de fiabilidad, o elige una ficha en **Curaduría → Propuestas con IA**. Desde un hallazgo con un dato encontrado, **Proponer este cambio con IA** limita la tarea a ese dato. Se reutilizan las citas del informe.
2. La IA prepara correcciones concretas: **Añadir género: Rap**, **Cambiar año de formación**, **Combinar las biografías**, **Añadir disco** o **Fusionar duplicados**. Cada propuesta muestra los datos que cambiarán; las biografías presentan el texto nuevo completo.
3. Elige **Sí, aceptar** o **No**. Aceptar valida y aplica exclusivamente ese cambio en una transacción; rechazar registra la decisión y conserva el catálogo. La revisión editorial y la confirmación de una fusión quedan incluidas en esa aceptación específica. No se necesita Guardar y validar ni Implementar el lote.
4. Un cambio que necesita una nueva ficha indica cuál debes aceptar primero. Los cambios independientes se pueden aceptar aunque haya otra propuesta inválida. Si los datos cambiaron después de preparar la propuesta, **Actualizar cambios** muestra el estado actual antes de volver a aceptar.
5. Las fuentes, el motivo y los detalles adicionales quedan en desplegables. **Editar propuesta** permite ajustes opcionales, guardados internamente al aceptar. Un cambio ya decidido se consulta en **Ver todas**; cada aceptación tiene su propio **Deshacer** y registro en el historial.

La IA dispone de operaciones de creación, edición, relaciones, géneros, pistas y fusión. El administrador decide sobre sus propuestas; los contratos de datos, las dependencias y la trazabilidad siguen siendo responsabilidad del servidor. Aceptar, rechazar y deshacer no hacen nuevas consultas a la IA.

Las biografías y descripciones originales completas se conservan en el contexto y en las consultas de fichas. La IA recibe instrucciones para integrar los hechos únicos sin resumir a partir de texto recortado. La propuesta se muestra íntegra para revisar su contenido antes de sustituir el texto.

Las propuestas anteriores y los endpoints de lote se mantienen compatibles. Cuando una propuesta tiene decisiones individuales, el servidor evita volver a implementar sus operaciones como lote.

## Operaciones y significado

| Operación | Comportamiento |
|---|---|
| Crear ficha | Crea artista, persona, organización, disco o pista; las pistas y discos necesitan su ficha principal. No fusiona identidades. |
| Añadir disco completo | Crea sus metadatos documentados, pistas, créditos, alias, formatos y géneros juntos. El sello y los participantes deben existir o estar incluidos en otra operación de creación. |
| Reemplazar campos | Sustituye solo los campos nombrados; omitir un campo lo conserva y `null` lo vacía cuando el esquema lo admite. |
| Añadir alias | Conserva una variante sin sustituir el nombre canónico. |
| Añadir/corregir relación | Opera sobre membresías, pertenencia a organizaciones, créditos de disco/pista o formatos. Valida extremos, tipos de crédito y períodos. |
| Añadir/retirar género | Confirma o rechaza una asignación en artista o disco. Usa la taxonomía existente, respeta decisiones humanas y diferencia principal/secundario. No crea ni elimina términos de la taxonomía. |
| Ordenar pistas | Cambia posiciones de pistas existentes del disco indicado. Verifica colisiones con las pistas no seleccionadas y permite intercambios. No crea ni elimina canciones. |
| Fusionar fichas | Usa el motor de fusión existente para fichas del mismo tipo; conserva relaciones, alias e historial. La ficha principal sobrevive. Bloquea trayectorias incompatibles. No admite fusión de pistas. |
| Retirar ficha/relación | Usa el retiro auditado. Una ficha con dependencias no se elimina en cascada. |

Las referencias `{kind,id}` distinguen IDs de artista, persona, organización, disco y pista. Las referencias `{kind,key}` apuntan a una ficha creada en el mismo lote. El servidor ordena las dependencias y rechaza ciclos, claves repetidas y dependencias desactivadas. El administrador edita datos y selecciones; cambiar el significado de una operación exige preparar otra propuesta con la instrucción correcta.

## Contexto y presupuesto

Se usa **DeepSeek V4.1 Flash**, cuyo identificador oficial de API es `deepseek-flash` ([anuncio oficial](https://www.deepseek.com/en/news/deepseek-v4-1-flash/)). Este flujo selecciona siempre el rol rápido, sin cambiar silenciosamente a Pro. Su modelo configurable es independiente de los otros usos de IA.

El contexto contiene la ficha, relaciones y nombres vinculados, hallazgos abiertos, afirmaciones y evidencia ya guardadas, pendientes del último informe de fiabilidad, taxonomía y contratos de campos con tipos y opciones. Las relaciones entre artistas, redes sociales y enlaces de streaming se consultan como contexto; este flujo no agrega operaciones de escritura para esas tablas. No se envían credenciales ni todo el catálogo.

La pantalla muestra todas las recomendaciones, datos faltantes y discrepancias del informe en una lista con búsqueda, filtro por área y paginación. Una propuesta guardada representa su petición concreta; no sustituye esta lista. «Preparar corrección» envía únicamente el hallazgo elegido y conserva sus citas aunque esté al final de un informe grande. Los faltantes sin valor ofrecen «Investigar y proponer» y no se rellenan por suposición. Si existe un borrador para esa petición, «Ver propuesta» lo recupera sin otra llamada a la IA. El contexto usa el mismo informe o checkpoint más reciente que la ficha; las consultas generales conservan todos los pendientes y reducen primero los datos del catálogo que se pueden volver a consultar.

Una revisión de géneros incluye los demás términos respaldados para la misma ficha por las citas del hallazgo. Cada género faltante recibe su propia propuesta; los ya confirmados se conservan sin operaciones repetidas. La fuente debe documentar el género, pero no tiene que indicar su prioridad: si no la indica, la propuesta usa «secundario» como criterio editorial explícito, sin cambiar el principal. El contexto conserva las asignaciones actuales incluso al reducir las relaciones y aporta coincidencias exactas de las citas con la taxonomía para evitar afirmar que falta un slug existente.

El modelo dispone de consultas acotadas al catálogo, búsqueda web y lectura de páginas mediante el broker existente. Las páginas son datos de referencia: no pueden conceder permisos ni ejecutar instrucciones. Una petición puede consultar hasta cuatro recursos y hasta dos páginas por búsqueda. Con la configuración inicial hay como máximo dos llamadas al modelo, hasta 6000 tokens de salida por llamada y 40000 caracteres de contexto por llamada. Una tarea grande debe dividirse por disco o problema; lo que no pueda resolverse queda pendiente.

El gateway reutiliza respuestas validadas con el mismo contexto y contratos. Las propuestas guardadas se consultan sin IA. Editar, ensayar, implementar y deshacer no hacen llamadas a DeepSeek. La interfaz muestra consultas, uso de caché y tokens reportados por el proveedor; los registros `ingest.ai_runs` conservan las respuestas y consumos, incluidos rechazos de contrato. No es una estimación monetaria.

```dotenv
DEEPSEEK_API_KEY=...
CRV_AI_CURATION_MODEL=deepseek-flash
CRV_AI_CURATION_MAX_TOKENS=6000
CRV_AI_CURATION_MAX_CALLS=2
CRV_AI_CURATION_CONTEXT_CHARS=40000
```

Para investigación nueva se utiliza la configuración existente de SearXNG (`CRV_SEARXNG_URL`, `CRV_SEARXNG_SECRET`) y la caché de búsqueda/páginas. Sin fuentes suficientes, el modelo debe conservar la duda como pendiente. Una cita válida demuestra que se dispone del documento, no garantiza por sí sola que la interpretación sea correcta: sigue siendo necesaria la revisión del administrador.

## Persistencia, autorización y concurrencia

La migración `0049_ai_curation_plans` guarda borradores, evidencia, revisiones, validación, responsable editorial, consumo y resultado, y habilita `curation_plan` en el registro de consumo de IA. Todos los recursos `/curation/ai/*` requieren administrador; las escrituras conservan la autenticación y CSRF del sistema. Los JSON del modelo se validan con contratos estrictos y solo se ejecutan operaciones permitidas. No existe una herramienta de SQL libre.

La vista previa ejecuta el mismo motor en una transacción serializable que se revierte. No deja fichas, claims, runs ni auditorías permanentes; las secuencias pueden avanzar, lo cual es normal en PostgreSQL. La implementación exige la revisión exacta del borrador y una huella del estado afectado y la taxonomía. Cambios posteriores exigen volver a validar. La fila de la propuesta se bloquea durante la aplicación; repetir la petición devuelve el resultado ya aplicado.

Las tareas interrumpidas por un reinicio quedan como fallidas y pueden prepararse otra vez. No se aplica ningún borrador automáticamente después de una interrupción. La revalidación posterior ejecuta detectores de curaduría; no vuelve a investigar en la web ni recalcula un puntaje con DeepSeek.

## Instalación y comprobaciones

Se despliega junto con backend y web. Sigue el procedimiento de respaldo y migración de `docs/OPERATIONS.md`, aplica `npm run db:migrate` y publica la web y la API. La migración crea una tabla auxiliar; no corrige datos del catálogo por sí misma.

Los contratos de `test/contract/ai-curation.test.ts` usan PostgreSQL desechable. Comprueban autorización, borradores sin escrituras, edición sin IA, aplicación idempotente, discos completos, orden y deshacer, huellas obsoletas, rollback y decisiones editoriales. `web/tests/visual/ai-curation-qa.ts` comprueba el editor y su botón a 1366 y 390 píxeles con respuestas simuladas; no modifica el catálogo ni consume IA.
