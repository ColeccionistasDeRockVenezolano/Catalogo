# Descubrimiento editorial — fase 1

La principal obtiene exclusivamente artistas curados de `GET /discovery/search-suggestions`. La búsqueda, el autocompletado por nombre/alias, los géneros y las barras especializadas mantienen sus contratos. No se consultan proveedores externos al escribir ni al pedir ejemplos. No hay analítica, puntajes, rankings ni tendencias en esta fase.

## Datos y decisiones

`0052_discovery` añade únicamente tres tablas en `ingest`, representadas en `src/db/schema/discovery.ts`:

- `discovery_labels`: vocabulario, definición y criterio editorial.
- `artist_discovery_labels`: decisiones independientes N:M con evidencia existente, estado, actor, fecha y motivo.
- `artist_search_suggestions`: decisión de exposición, evidencia, grupo, prioridad y ventana `[valid_from, valid_until)`; el final puede quedar abierto.

Los estados son `proposed`, `approved`, `rejected`, `withdrawn`. Nada se aprueba por defecto. Aprobaciones requieren FK a `ingest.claim_evidence`; el importador comprueba el claim, su artista, estado, URL y extracto. El revisor debe verificar que el contenido respalda el vínculo venezolano y el criterio concreto. La existencia de una URL o el país por defecto no prueban esos hechos. El país de un proyecto, la nacionalidad de una persona y su participación musical son datos distintos.

Se conserva un registro independiente por clave de lote y decisión. Cambiar esa decisión registra antes/después en el diario existente, con el run del operador. Las tres tablas son `strict`: un cambio posterior impide deshacer una decisión anterior hasta deshacer el posterior.

## Curaduría inicial

`ops/discovery/initial-2026-10-10.json` contiene los 23 candidatos cotejados por ID y nombre canónico, sin altas ni fusiones. `ops/discovery/review-2026-10-10.json` conserva aliases revisados, referencia al claim/evidencia, extracto y motivo. La revisión aprobó 15 proyectos con extractos documentales disponibles y dejó 8 pendientes de contraste adicional: Lasso, Arca, Mau y Ricky, Danny Ocean, Elena Rose, Joaquina, Yorghaki y Alleh. Pendiente significa falta de comprobación suficiente para este lote, no una afirmación negativa de nacionalidad o elegibilidad.

Las colecciones usan criterios comprobables: trayectoria anterior a 1990, rock/fusión desde los noventa, proyectos iniciados desde 2000 y experimental/electrónica. «Desde 2000» no afirma actividad vigente ni popularidad. Las etiquetas coexisten: La Vida Bohème, Los Mesoneros y Viniloversus reciben dos; su grupo de exposición sigue siendo una decisión independiente. Las referencias del JSON corresponden a esta base y deben cotejarse al usar otra instalación.

Vista previa (transacción revertida, no persiste datos ni run):

```bash
npm run discovery:import -- ops/discovery/initial-2026-10-10.json
```

Aplicación, después de revisar el reporte sin conflictos:

```bash
npm run discovery:import -- ops/discovery/initial-2026-10-10.json --apply
```

El reporte separa aprobados, pendientes, rechazados/retirados y conflictos. Un conflicto en modo aplicación aborta todo el lote. Repetir un lote conserva filas, evidencias y fechas si no cambió su contenido; registra un nuevo run operativo sin cambios editoriales. No resuelve aliases, no sigue redirecciones silenciosamente, no crea artistas y no fusiona entidades. Un ID ausente, un nombre canónico cambiado, evidencia ajena, marcadores o IDs duplicados requieren revisar el JSON.

Para retirar: cambiar `state` a `withdrawn`, actualizar `reason` y el revisor, previsualizar y aplicar. Para reaprobar o resolver decisiones contradictorias: revisar **todas** las decisiones de ese artista; la lectura bloquea una aprobación cuando existe otra propuesta, rechazo o retiro. Una importación que omite una fila no la retira: usar explícitamente `withdrawn`. Las ventanas inválidas se rechazan en Zod y PostgreSQL.

## Fusiones y reversibilidad

`transferDiscoveryDecisions` se ejecuta antes del movimiento genérico de FKs de artistas. Reapunta todas las filas sin descartar aprobaciones, etiquetas ni evidencia por colisiones. No existe unicidad por nombre ni por par artista/etiqueta que obligue a perder decisiones. La lectura deduplica por ID; estados contradictorios de exposición bloquean la sugerencia hasta revisión explícita. Las etiquetas contradictorias se conservan como decisiones independientes y no se consolidan automáticamente.

El diario restaura decisiones y evidencia al deshacer/rehacer retiros, importaciones y fusiones. Utilizar los controles existentes de Historial/Deshacer o el mecanismo de runs del operador. Tras una fusión, actualizar conscientemente los IDs y nombres canónicos del lote para nuevas revisiones; el importador se negará a reatribuir una clave a otra identidad.

## Endpoint y actualización

Respuesta: `enabled`, `intervalMs`, `refreshMs`, `fallback`, `groupPolicy`, y `suggestions` con `id`, `name`, `group`, `priority`, `validUntil`. Solo devuelve artistas existentes, aprobados y dentro de su ventana, con evidencia vinculada a su ID cuyo claim no esté rechazado ni reemplazado. La principal usa los nombres actuales, nunca un alias como segunda identidad.

Caché de servidor y HTTP: **cero segundos**, `Cache-Control: no-store`. Cada lectura refleja cambios aunque provengan de SQL u otro proceso; no requiere invalidaciones locales que se puedan perder. La interfaz renueva cada 10 segundos, con una concesión máxima de 15 segundos y timeout de 8 segundos. Un error elimina los ejemplos guardados. El vencimiento temporal se comprueba también en el cliente cada segundo. Al volver de una pestaña oculta y ante `crv-data-changed`, invalida y consulta de nuevo. No reutiliza una selección indefinidamente.

Cada vuelta visita todos los IDs elegibles una vez, intercalando turnos por grupo. `CRV_DISCOVERY_GROUP_POLICY` permite repetir grupos para adelantar más de sus proyectos en los primeros turnos; los grupos adicionales conservan su turno. La prioridad editorial pondera el orden dentro del grupo, sin excluir artistas ni indicar popularidad. Renovar una respuesta mantiene la posición salvo retirada; cambiar el nombre actualiza el texto sin alterar la consulta.

## Interfaz y activación

```dotenv
CRV_DISCOVERY_ENABLED=false
CRV_DISCOVERY_INTERVAL_MS=5000
CRV_DISCOVERY_GROUP_POLICY=historicos,alternativo,contemporaneos,experimental
```

La bandera de backend controla la principal sin un segundo build. El valor predeterminado para nuevas instalaciones es apagado. Activación controlada: desplegar primero el backend compatible, aplicar `0052` y el lote verificado, desplegar el frontend y establecer `CRV_DISCOVERY_ENABLED=true` en el entorno del backend, reiniciando ese servicio. Mantener los prefijos existentes: el cliente usa `VITE_API_BASE_URL` o el gateway del mismo origen.

Activada en esta instalación el 2026-10-10 por instrucción del usuario: `.env` contiene `CRV_DISCOVERY_ENABLED=true`, se publicó `web/dist-public` y se reiniciaron `crv-api.service` y `crv-web.service`. El gateway `http://127.0.0.1:3120/crv/` devuelve los 15 artistas aprobados. Verificación sobre los servicios reales en escritorio y móvil: sugerencia visible, aceptación y foco, sin desbordamiento ni errores; rotación y pausa comprobadas en escritorio. Evidencia: `reports/discovery-2026-10-10/activation.json` y `docs/ui-qa/discovery/activated-*.png`. Copia del frontend previo en `/mnt/datos/backups/crv/discovery-activation-2026-10-10/dist-public-before`.

Antes de migrar una base real: respaldo completo legible y pruebas en PostgreSQL desechable. En esta instalación se aplicó después de esas comprobaciones. Respaldo previo: `/mnt/datos/backups/crv/discovery-2026-10-10/pre-0052.dump`, con índice y `SHA256SUMS`. El esquema `public` resultó idéntico antes y después.

La principal muestra «Busca artistas, bandas, álbumes o canciones» si la bandera está apagada, la lista está vacía, caduca la caché o hay error. No muestrea páginas de artistas/personas/discos/organizaciones para obtener ejemplos; conserva una consulta de facetas para el autocompletado de géneros.

Rotación configurable (3–60 segundos), pausa al escribir o con pestaña oculta y respeto a movimiento reducido. «Usar» es un botón accesible al teclado y al toque; Tab acepta con el campo vacío. Escape omite y permite continuar con Tab; Shift+Tab conserva la navegación hacia atrás. «Pausar/Reanudar» y «Omitir» tienen controles explícitos. La sugerencia está disponible al árbol accesible con `aria-live="off"`, sin anunciar cada cambio ni alterar el foco por renovaciones. Aceptar devuelve el foco al campo para editar.

Primera reversión funcional: `CRV_DISCOVERY_ENABLED=false` y reinicio del backend; búsqueda y fallback continúan, datos editoriales intactos. El frontend elimina la lista al recibir la configuración, como máximo al expirar su concesión.

Rollback de esquema específico, solo tras respaldo, con bandera apagada y fuera de operación normal:

```bash
docker exec -i crv-postgres psql -X -v ON_ERROR_STOP=1 -U crv -d crv < migrations/0052_discovery.down.sql
```

`migrations/0052_discovery.down.sql` retira únicamente las tres tablas y sus registros de configuración del diario. El SQL específico retira también su registro en `ingest.schema_migrations` dentro de la misma transacción. No usar `npm run db:migrate down`, que revierte todo el proyecto. El rollback específico borra decisiones editoriales; la bandera es la vía normal de reversión.

## Verificación

```bash
npm run typecheck
npm --prefix web run typecheck
npm --prefix web run build
npm run test -- test/contract/discovery.test.ts web/tests/unit/discovery.test.ts web/tests/unit/catalog-search-examples.test.ts
# Con frontend local de prueba en 5187:
node web/tests/visual/discovery-qa.mjs
```

El contrato usa PostgreSQL 16 desechable: migración repetible, rollback específico y comparación completa de `public`, backend antes de migrar, importación idempotente/preview, identidad/evidencia/ventanas, estados, aliases, renombre, retiro, colisión de fusiones y deshacer/rehacer con evidencias. Las unitarias verifican turnos y cobertura por ID, prioridad, bandera y continuidad de las barras especializadas. El QA de navegador usa fixtures del endpoint sobre los componentes reales, escritorio y móvil: rotación, foco, teclado, toque, pausa, movimiento reducido, visibilidad, retiradas, renombre, error, bandera y ausencia de muestreo masivo. Capturas y resultados: `docs/ui-qa/discovery/`.

El detector de diseño señaló tres patrones existentes fuera de este cambio (fuente Inter y dos bordes laterales de otras superficies); se conserva el diseño del proyecto.

## Backlog

Fase 2 implementada por instrucción posterior del usuario: [métricas propias y prototipo interno](DISCOVERY_PHASE_2.md), con bandera independiente apagada por defecto. La fase 1 original no instrumentó interacciones aisladas. La etapa 2 exige exposición previa, retención y controles de tráfico antes de interpretar interacción; no publica tendencias ni integra estadísticas externas.

Fase 3 implementada por instrucción posterior del usuario: [contextos musicales por canción](DISCOVERY_PHASE_3.md), con ontología limitada, propuestas separadas de decisiones, energía documentada y evaluación por pista de edición.

Fase 4: intención tipada para Laya/Jev, recuperación de obras existentes con restricciones, diversidad y explicaciones documentales; abstención por cobertura insuficiente y evaluación humana. Sin embeddings, entrenamiento ni jobs de IA anticipados.

Informe de salida y limitaciones verificadas: `reports/discovery-2026-10-10/ACCEPTANCE.md`. La suite ampliada conserva dos fallos previos, reproducidos también sin `0052`: cinco FKs auxiliares anteriores sin índice y una expectativa desactualizada de búsqueda por artista. Los contratos nuevos, el diario y las fusiones API están aprobados.
