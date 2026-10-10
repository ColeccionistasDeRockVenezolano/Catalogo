# Descubrimiento — fichas de fuentes candidatas

Revisión documental: **2026-10-10**. Uso examinado: observaciones de descubrimiento, no permisos del subsistema de géneros. **Ninguna fuente externa se integra en etapa 2.** Estos registros distinguen disponibilidad documental de autorización efectiva de CRV; no certifican permisos de una cuenta ni convierten comunidades en una muestra de Venezuela.

## MusicBrainz

| Campo | Evaluación |
| --- | --- |
| Qué mide / población | Metadatos y relaciones aportados por editores del catálogo; ratings/tags suplementarios. No mide escuchas nacionales. |
| Unidad / período | Entidad MBID y metadatos al consultar; los votos no son oyentes ni un período de escucha. |
| Licencia | Datos centrales CC0; suplementarios CC BY-NC-SA 3.0, con opciones comerciales distintas. Revisar categoría exacta del campo antes de reutilizar. |
| Acceso / cuotas | API REST, User-Agent identificable; máximo una petición por segundo. Uso comercial del servicio requiere revisar planes. |
| Caché / retención | No se activa caché nueva. Definir campos, licencia y TTL específico antes del lote; no hay una duración universal aprobada para CRV. |
| Riesgos | Identidad por nombre, cobertura editorial desigual, ratings confundidos con popularidad y áreas confundidas con nacionalidad. |
| Actualización / próxima revisión | Lote local por MBID verificado, nunca en el buscador; revisar cambios/documentación antes de adoptar un campo. |
| Decisión | Útil para identidad; descartado como medición directa de tendencia de escucha. |

Fuentes: [licencias de datos](https://musicbrainz.org/doc/About/Data_License), [API e identificación/límites](https://musicbrainz.org/doc/MusicBrainz_API).

## ListenBrainz

| Campo | Evaluación |
| --- | --- |
| Qué mide / población | Escuchas enviadas por su comunidad y estadísticas de usuario/sitio; cobertura de participantes, sin representatividad venezolana demostrada. |
| Unidad / período | `listen_count` por artista/registro y rango indicado por endpoint; conservar start/end y fecha de cálculo del proveedor. |
| Licencia | La presentación oficial señala CC0 para escuchas/texto; la página de términos requiere JS y su cuerpo no pudo verificarse mediante la lectura estática. No se concede autorización de CRV por esta ficha. |
| Acceso / cuotas | HTTPS, User-Agent de contacto; documentación exige máximo una petición/segundo y obedecer cabeceras X-RateLimit; 429 implica esperar. Token según endpoint. |
| Caché / retención | No hay datos nuevos almacenados. Definir TTL de agregado sin importar historiales personales; revisar términos completos antes de integrar. |
| Riesgos | Sesgo de comunidad/importaciones, MBID faltante, duplicados y demora entre escucha y agregación. |
| Actualización / próxima revisión | Candidato a lote de agregados por período, con idempotencia y backoff; verificar calendario real de cálculo y términos con navegador antes de habilitar. |
| Decisión | Candidato pendiente de contraste de términos, cobertura por artistas CRV y campos agregados; sin integración. |

Fuentes: [API y límites](https://listenbrainz.readthedocs.io/en/latest/users/api/index.html), [estadísticas](https://listenbrainz.readthedocs.io/en/latest/users/api/statistics.html), [intervalos de actualización](https://listenbrainz.readthedocs.io/en/latest/general/data-update-intervals.html), [términos oficiales](https://listenbrainz.org/terms-of-service/). La afirmación CC0 también figura en el resultado indexado del sitio oficial; no sustituye la comprobación pendiente del documento completo.

## Last.fm

| Campo | Evaluación |
| --- | --- |
| Qué mide / población | Scrobbles/oyentes de su comunidad y metadatos; no población total de Venezuela. |
| Unidad / período | Playcounts/listeners por artista según endpoint; `artist.getInfo` no aporta por sí solo dos ventanas nacionales comparables. |
| Licencia / acceso | API key y condiciones de servicio. El proveedor pide contacto previo para uso comercial o académico/investigación; atribución y publicación tienen condiciones específicas. |
| Caché / retención | No aprobada para este nuevo uso. Revisar conservación del campo y permisos de publicación antes de almacenar observaciones. |
| Cuotas | Límites impuestos discrecionalmente por Last.fm; no se presupone un número fijo de llamadas permitido a CRV. |
| Riesgos | Sesgo de scrobbling, homónimos, acumulados interpretados como crecimiento y permisos no comprobados. |
| Actualización / próxima revisión | Lote eventual solo con uso acordado, endpoint y período precisos, backoff y referencia temporal; renovar revisión antes de integrarlo. |
| Decisión | Pendiente; no se contactó al proveedor ni se usó una key. |

Fuentes: [condiciones de API](https://www.last.fm/api/tos), [artist.getInfo](https://www.last.fm/api/show/artist.getInfo).

## YouTube Data API

| Campo | Evaluación |
| --- | --- |
| Qué mide / población | Estadísticas de videos/canales de YouTube; views de una pieza no equivalen a interés en toda una banda ni a oyentes venezolanos. |
| Unidad / período | Contadores por recurso y momento de observación. La estadística pública no describe necesariamente país ni ventana nacional de escucha. |
| Licencia / acceso | Credenciales del proyecto y políticas de YouTube. Las reglas generales restringen métricas derivadas; existen permisos adicionales para desarrolladores auditados que los soliciten explícitamente. No se comprobaron tales permisos para CRV. |
| Caché / retención | Estadísticas no autorizadas no pueden conservarse más de 30 días según políticas generales; otros campos tienen reglas de refresco/borrado. No se extiende el uso actual de videos a tendencia. |
| Cuotas | Revisar cuota efectiva en consola; overview distingue presupuestos de búsqueda/subida y unidades de otros métodos. No se presume cuota concreta del proyecto CRV. |
| Riesgos | Derivaciones restringidas, derechos, sesgo por video/canal, conservación histórica y recurso eliminado. |
| Actualización / próxima revisión | Ningún actualizador estadístico nuevo; revisar permiso concreto y políticas vigentes antes de proponer cualquier lote. |
| Decisión | Sin score ni tendencia derivada de estadísticas de YouTube en esta etapa. |

Fuentes: [políticas, apartados III.E y III.L](https://developers.google.com/youtube/terms/developer-policies), [overview y cuotas](https://developers.google.com/youtube/v3/getting-started).

## Spotify Web API

| Campo | Evaluación |
| --- | --- |
| Qué mide / población | Metadatos del catálogo y campos disponibles según modo/permisos. No se dispone de muestra de Venezuela verificada para CRV. |
| Unidad / período | IDs Spotify y campos de respuesta; no atribuir ventana nacional a un valor del proveedor. |
| Licencia / acceso | Developer Policy restringe análisis y nuevas métricas derivadas. La guía de Development Mode de febrero de 2026 elimina popularity/followers de artistas; no asumir acceso por figurar en una referencia genérica. |
| Caché / retención | Sin caché estadística nueva. Debe revisarse el uso específico, almacenamiento de contenido y borrado de datos de usuario antes de adoptarlo. |
| Cuotas | Ventana móvil de 30 segundos, límite según modo y 429/Retry-After; revisar además cambios de cuotas de julio de 2026 y autorización efectiva del dashboard. |
| Riesgos | Cambios de acceso, campos ausentes y análisis no permitido. Permisos de reproducción/metadatos no autorizan estadísticas nuevas. |
| Actualización / próxima revisión | No se implementa lote; cotejar modo real, contrato y campo antes de considerar integración. |
| Decisión | Sin popularidad, audio features ni recomendaciones nuevas en esta etapa. |

Fuentes: [Developer Policy](https://developer.spotify.com/policy), [guía de migración 2026](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits), [cambio de cuotas de julio](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates).

## CRV

| Campo | Evaluación |
| --- | --- |
| Qué mide / población | Impresiones e interacciones atribuibles con sugerencias aprobadas de artistas en el buscador principal. Tráfico lector de CRV tras exclusiones. |
| Unidad / período | Cadena deduplicada por sesión efímera/artista/bloque de 30 min; días y ventanas UTC. No personas únicas. |
| Fuente / acceso | Instrumentación propia versión 1; endpoint público estrictamente validado, prototipo administrativo. |
| Caché / retención | Eventos 30 días completos más día actual; agregados/jobs 180 días; referencias de identidad musical conservadas. Sin caché HTTP de tickets/prototipo. |
| Cuotas | 120 eventos/IP/minuto y 10.000/proceso/minuto; proxy compartido puede subcontar. |
| Riesgos | Sesiones nuevas al recargar, bots sofisticados, bloqueo de analítica, cambios editoriales, exposición y dependencia entre observaciones. |
| Última verificación / actualización | 2026-10-10, tests PostgreSQL y navegador. Lote horario local idempotente, retención, backoff y trazabilidad. |
| Decisión | Implementado como prototipo interno, sin publicación de ranking. |

Metodología y operación: [DISCOVERY_PHASE_2.md](DISCOVERY_PHASE_2.md). Ninguna ficha habilita un proveedor en código; un uso futuro deberá completar los permisos pendientes y revisarse sobre condiciones vigentes.
