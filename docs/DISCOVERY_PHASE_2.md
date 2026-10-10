# Descubrimiento — etapa 2: métricas propias y prototipo interno

Implementación del apartado 6 del plan `CRV_PLAN_DESCUBRIMIENTO_2026-10-10.md`, autorizada por el usuario el 2026-10-10. La instrumentación cubre el flujo de artistas aprobados del buscador principal de la fase 1. Las búsquedas orgánicas, las barras especializadas, las escuchas, las personas y los discos no se presentan como interacciones atribuibles a una sugerencia. Ninguna métrica determina elegibilidad, prioridad ni reconocimiento editorial.

## Eventos y atribución

| Evento | Significado y condición | Cuenta |
| --- | --- | --- |
| `impression` | Al menos 50% del ejemplo dentro del viewport durante 1 segundo continuo, documento visible, sin texto, control montado. `IntersectionObserver` y `visibilitychange` reinician el tiempo si deja de verse. | Una por artista, sesión efímera y bloque UTC de 30 minutos. Descargar/refrescar el endpoint no cuenta. |
| `acceptance` | Tab, botón Usar con teclado o toque, después de una impresión recibida. La búsqueda no espera a la analítica. | Una por impresión. Aceptar antes del segundo visible funciona, pero no se interpreta como interacción medible. |
| `search` | La consulta aceptada produce una respuesta de búsqueda satisfactoria en la SPA. Debe coincidir con el nombre aceptado tras normalizar espacios, tildes y mayúsculas. Editarla rompe la atribución. | Una por aceptación, sin contar cada carácter ni cada petición de búsqueda. No se envía el texto. |
| `visit` | La ficha del mismo artista se cargó correctamente en la misma pestaña después de la búsqueda atribuida, con documento visible. | Una por cadena. Un clic, una ficha errónea u otro artista no cuentan. |

La cadena caduca a los 15 minutos de la impresión. El cliente serializa los envíos para mantener orden incluso con red lenta. Los UUID y la unicidad `(impression_id, kind)` hacen idempotentes las retransmisiones; un bloqueo transaccional evita carreras. La deduplicación usa bloques fijos: dos exposiciones a ambos lados de un límite de bloque pueden contarse. No significa visitante único ni persona única. Recargar o abrir otra pestaña inicia una sesión nueva.

El servidor emite tickets HMAC de 30 segundos exclusivamente para sugerencias elegibles y métricas activadas. Exige al menos un segundo desde su emisión, comprueba nuevamente elegibilidad y firma un recibo de impresión ligado a la sesión efímera. Sin recibo válido ni evento previo no guarda aceptación/búsqueda/visita. La visibilidad es una observación del navegador, no una prueba criptográfica de atención humana; los tickets reducen falsificaciones casuales, sin eliminar bots sofisticados.

## Privacidad, exclusiones y límites

`POST /discovery/metrics/events` es la única escritura pública nueva. Tiene esquema estricto, cuerpo máximo de 4 KiB, origen permitido y comprobación de sesión. Las demás escrituras mantienen autenticación y CSRF. Se excluyen administradores autenticados, cookies de sesión que no se puedan validar, solicitudes con Authorization, origen ausente y agentes declarados bot/crawler/spider/headless/Playwright/Selenium. Las cuentas reader con sesión válida permanecen en el tráfico de lectura. El prototipo solo admite administradores, como otras lecturas de curaduría.

Límites por proceso: 120 eventos por IP/minuto y 10.000 globales/minuto, con mapas acotados. La clave de limitación es HMAC de IP y minuto, con secreto aleatorio de proceso; no se persiste la IP en las tablas de métricas. Detrás del gateway actual, Fastify conserva la IP del proxy: el límite puede ser compartido y subcontar; no se habilita confianza indiscriminada en `X-Forwarded-For`. Un despliegue con varios procesos requiere revisar el presupuesto global antes de ampliarlo.

La SPA guarda un UUID aleatorio solo en memoria; no usa cookies analíticas, almacenamiento local, fingerprint ni identificador de cuenta. En PostgreSQL solo quedan UUID de evento/impresión, sujeto musical, tipo, hora de recepción, HMAC de deduplicación y huella de configuración editorial. No se guardan consulta, referente, agente de usuario, dirección IP ni identidad de cuenta. El recibo contiene una firma de sesión, sin el UUID original. Los logs HTTP generales existentes son independientes y pueden registrar URL de búsqueda/IP como antes; esta fase no cambia su política de logs.

No hay reintentos automáticos del navegador ni cola persistente: errores, bloqueo de peticiones, navegación fuera de la SPA o falta de IntersectionObserver subcuentan. La búsqueda, el foco y la aceptación siguen funcionando. Comparar estas observaciones exige mantener estables cliente, filtros y política de exposición.

## Datos, identidad y reversibilidad

`0053_discovery_metrics` crea cuatro tablas en `ingest`, sin objetos nuevos en `public`:

- `discovery_metric_subjects`: ID histórico de artista y FK canónica nullable. Guarda nombre musical en el momento de comenzar a medir. Sin unicidad en la FK: una fusión conserva ambas cohortes.
- `discovery_metric_events`: eventos crudos con FK al sujeto y claves de deduplicación.
- `discovery_metric_daily`: agregados por día UTC, sujeto y evento, con configuración de exposición y actualización.
- `discovery_metric_jobs`: ejecución, intentos, cierre, resultado y fallo del lote independiente.

Solo el vínculo canónico del sujeto entra en el diario (`no_insert`, `strict`); los eventos y agregados no se copian al diario ni a runs editoriales. Las fusiones existentes descubren la FK real, conservan cohortes y deshacer/rehacer restaura el vínculo. Si la identidad fue fusionada, retirada del catálogo o reúne varios sujetos, el prototipo se abstiene con `identity_changed`; nunca suma silenciosamente tasas ni crea identidades por alias. No se reatribuyen mediciones antiguas al reimportar un lote.

La retención normal guarda los 30 días UTC completos previos más la fracción del día en curso; el lote elimina cadenas enteras por fecha de impresión. Agregados y registro de jobs: 180 días. Las referencias musicales del sujeto son metadatos de catálogo, sin identificadores de sesión, y se conservan para integridad de cohortes/diario. Los respaldos requieren su propia política de caducidad; purgar la base no borra copias anteriores.

## Actualizador independiente

```bash
npm run discovery:metrics -- aggregate
npm run discovery:metrics -- prototype
```

La primera orden reemplaza agregados de los días completos todavía cubiertos por eventos; nunca incrementa contadores al repetir. Una fotografía `REPEATABLE READ` y un advisory lock serializan lotes concurrentes. Se deja un margen de 15 minutos tras medianoche para cerrar atribuciones de la víspera. Todos los eventos se asignan al día UTC de la impresión, incluida una visita después de medianoche. Se purgan datos viejos y se registra estado/filas/fecha/cierre. Conflictos transaccionales y bloqueos se reintentan hasta tres veces con backoff de 250 y 500 ms. No se registran detalles personales en errores. El siguiente lote marca como interrumpido un job que perdió su proceso.

Los archivos `ops/discovery/crv-discovery-metrics.service` y `.timer` definen un lote horario local, persistente tras reinicios, con hasta tres arranques por hora y backoff de 5 minutos ante fallo de proceso/conexión. No están instalados en servicios reales. Usan el workspace indicado y su `.env`; adaptar usuario/rutas a otra instalación. No hay proveedor, cola ni infraestructura externa. La retención depende de ejecutar el lote incluso después de apagar el colector; un timer detenido debe considerarse un fallo operativo de retención.

## Metodología del prototipo

`GET /discovery/metrics/prototype` (administradores) y la segunda orden entregan **Tendencia en CRV**, `internal:true`, `published:false`, fuente, versión `crv-acceptance-rate-beta1-v1`, período UTC `[from, until)`, muestras de ambos períodos, actualización y causas de abstención. Los resultados se ordenan por ID, sin ranking ni puntaje ponderado.

Se comparan los últimos 7 días UTC completos agregados con los 7 inmediatamente anteriores: misma duración y mismos días de la semana. Cada ventana exige 7 días con exposición, al menos 100 impresiones y 20 aceptaciones. Cada una debe contener una única e idéntica huella de exposición: versión del instrumento, grupo, prioridad, intervalo, política de grupos y selección elegible completa con IDs/nombres/grupos/prioridades. Más impresiones por una prioridad editorial mayor no se interpreta por sí solo como más interés. No se publica un resultado si el job dejó de cubrir el último cierre esperado (`stale`).

La métrica exploratoria principal es la proporción de aceptación por exposición, con suavizado Beta(1,1): `p=(aceptaciones+1)/(impresiones+2)`. Se devuelve diferencia `p_actual-p_anterior`, en puntos de proporción, sin dividir por una base cero. La varianza posterior de cada proporción es `p*(1-p)/(impresiones+3)`; el intervalo aproximado del 95% para la diferencia usa `d ± 1.96*sqrt(var_anterior+var_actual)`. `rising`/`falling` solo se muestra si ese intervalo excluye cero; en otro caso, `inconclusive`. Muestra insuficiente, embudo inválido, identidad o exposición cambiada producen `insufficient_data` y dirección null.

Búsqueda/aceptación y visita/búsqueda conservan sus conteos de embudo como contexto revisable; no se convierten en crecimiento de visitantes únicos. Las cifras son observaciones de sesiones, con dependencia residual entre bloques, selección editorial, composición del público, fallos de red y pruebas múltiples sin corrección. El intervalo es una aproximación descriptiva interna, no inferencia causal ni prueba de popularidad en Venezuela. La fórmula ilustrativa del handoff no se implementa. No se crea `CRV Recognition Score`.

La evaluación inicial utiliza fixtures sintéticos explícitos en PostgreSQL desechable: duplicar exposición manteniendo conversión no señala aumento, una diferencia grande con muestra estable sí; bases pequeñas, faltantes y cambios editoriales se abstienen. Los datos sintéticos nunca se importan a la base real. Antes de publicación, revisar muestras reales de 14 días completos, calidad y proporción de exclusiones/pérdidas, estabilidad de exposición, dependencia de sesiones y umbrales con responsables editoriales. Esta entrega termina en el prototipo interno solicitado; la publicación queda sujeta a esa evaluación.

## Fuentes externas

La evaluación documental de MusicBrainz, ListenBrainz, Last.fm, YouTube y Spotify está en [DISCOVERY_PROVIDERS.md](DISCOVERY_PROVIDERS.md). Todas permanecen sin integración ni autorización nueva de uso estadístico. No se reutilizan permisos del subsistema de géneros. Las estadísticas de comunidades externas no equivalen a popularidad total en Venezuela.

## Activación y reversión

Predeterminado: `CRV_DISCOVERY_METRICS_ENABLED=false`. Para activar en una instalación: respaldo legible, validar `0053` en PostgreSQL desechable, aplicar migración, desplegar backend y frontend compatibles, generar un secreto independiente de al menos 32 caracteres y configurar:

```dotenv
CRV_DISCOVERY_METRICS_ENABLED=true
CRV_DISCOVERY_METRICS_SECRET=<secreto generado fuera del repositorio>
```

Instalar el timer horario preparado y comprobar un job completado antes de iniciar captura. El backend falla validación si se activa sin secreto. Rotarlo invalida tickets/recibos y cambia huellas de exposición; el prototipo se abstendrá durante ventanas mixtas. Desactivar la bandera detiene guardado y entrega de tickets; las sugerencias editoriales continúan. Mantener el lote para retención. En esta entrega no se modificaron `.env`, base ni servicios de producción y no se publicaron tendencias.

Rollback específico, con colector/timer detenidos y respaldo, mediante `migrations/0053_discovery_metrics.down.sql`; borra exclusivamente analítica y su configuración de diario/control de migración. No usar rollback completo del proyecto. No requiere retirar `0052`, artistas ni decisiones editoriales.

## Validación reproducible

```bash
npm run typecheck
./scripts/with-node22.sh npm --prefix web run typecheck
./scripts/with-node22.sh npm --prefix web run build
npm test -- test/contract/discovery-metrics.test.ts test/unit/discovery-metrics.test.ts test/contract/discovery.test.ts test/unit/auth.test.ts web/tests/unit/discovery.test.ts web/tests/unit/catalog-search-examples.test.ts
# Servir el build en 5187 con npm --prefix web run preview -- --port 5187;
# la ficha de artista 1 se lee de la API local como fixture:
./scripts/with-node22.sh node web/tests/visual/discovery-metrics-qa.mjs
./scripts/with-node22.sh node web/tests/visual/discovery-qa.mjs
```

Contratos: PostgreSQL 16 desechable, DDL repetible/rollback/huella `public`, descarga sin impresión, firma y origen, dedupe concurrente, orden y sesión, admin/reader, retiro/caducidad, agregación/cierre/retención/lock, prototipo con muestras sintéticas, fusión y diario. Navegador: escritorio y móvil, dwell y pestaña oculta, refresco sin impresiones dobles, aceptación y ficha, tecleo libre, bandera, administración, error sin bloqueo, foco/teclado/toque y diseño sin desbordamiento. Evidencia de navegador: `docs/ui-qa/discovery-metrics/`; aceptación por requisito: `reports/discovery-phase-2-2026-10-10/ACCEPTANCE.md`.
