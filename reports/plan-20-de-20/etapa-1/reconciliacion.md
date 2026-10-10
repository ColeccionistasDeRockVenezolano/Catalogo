# Etapa 1 · Informe de reconciliación de integridad (2026-10-10)

Cierre de los cuatro hallazgos del `db:restore-check` de la copia
`crv-20261010T130515Z` (restauración íntegra: 85 tablas / 20.818.060 filas
idénticas, 146.189 archivos de crudo, 0 hash distinto) con la política del plan:
**reconciliar o registrar la limitación histórica explícita — sin inventar
fuentes** (PLAN_CINCO_ETAPAS §Etapa 1, trabajo 3; evidencia E1-03/E1-07).

## 1. Migraciones aplicadas (base de desarrollo `crv-postgres`, 0052 → 0057)

| Versión | Qué hace |
| --- | --- |
| `0053_discovery_metrics` | Métricas de descubrimiento (etapas 2 del plan de descubrimiento; ya validada en PG desechable). |
| `0054_track_contexts` | Contextos musicales por canción (etapa 3; idem). |
| `0055_integrity_fk_indexes` | Índices completos para las 7 FK auxiliares de 0041–0049 que el doctor señalaba. |
| `0056_discovery_recommendations` | Recomendación Laya/Jev (etapa 4; idem). |
| `0057_integrity_reconciliation` | Tabla `ingest.integrity_reconciliations`: registro auditable del mantenimiento y sus límites históricos. |

Antes de migrar: base quieta (último cambio 11:53Z) y respaldo verificado
`crv-20261010T130515Z` con `db:restore-check` completo (RESTORE VERIFICADO;
falló solo el doctor final, que es exactamente la deuda que esta etapa
reconcilia).

**Cierre (verificación dorada):** tras migrar y reconciliar se tomó el respaldo
`crv-20261010T170148Z` y su `db:restore-check` terminó **RESTORE VERIFICADO**
(97 tablas / 20.834.774 filas idénticas al origen · 7.679 `raw_pages`, 0 sin
archivo, 0 con hash distinto · doctor contra la copia: **VERDE CON 1 AVISO**,
con `core.catalog` en huella exacta —el falso drift del restore ya no aparece—).
Registro: [restore-check-crv-20261010T170148Z.log](restore-check-crv-20261010T170148Z.log).

## 2. Reconciliación ejecutada — run 18977 (`maintenance:integrity-reconciliation`)

`tsx scripts/reconcile-integrity.ts` corre primero en rollback; con `--confirm`
aplica dentro de un run trazable. Resultado aplicado:

| Clasificación | Filas | Contenido |
| --- | ---: | --- |
| `maintenance_snapshot` (merge_audit `field='maintenance_snapshot'`) | 830 | Filas canónicas que no tenían auditoría: se guarda su **estado actual** como instantánea de mantenimiento; no reconstruye ni afirma la fuente original. |
| `audit_without_claim` | 3.155 | 2.325 auditorías históricas sin claim + las 830 instantáneas recién creadas. Se conserva su contenido; el estado actual no demuestra la fuente histórica. |
| `audit_without_run` | 12.695 | Correcciones auditadas sin enlace a la ejecución original (masivas del 2026-09-13/14, cierre F2–F5). |
| `identity_redirect` | 10 | Identidades externas de género sobre fichas fusionadas, re-apuntadas a la ficha vigente con `before_state`/`after_state`. |
| `identity_orphan` | 0 | Ninguna quedó sin destino. |
| `journal_without_run` | 1 | Inventario del diario inmutable: 16.127 entradas sin run recuperable (through 11068909); el mantenimiento no las convierte en deshacibles. |

Todos los registros llevan una **limitación textual explícita** (columna
`limitation`). Una segunda corrida es idempotente (0/0/0/0/0/0, probado en
`test/contract/external-identity-lifecycle.test.ts`).

## 3. Doctor antes / después

Antes (misma base, código vigente): ✗ `integrity.fk_indexes` (7 FK sin índice
completo), ✗ `merge_audit.coverage` (830 filas sin auditoría; 2.325 auditorías
sin claim), ✗ `genres.external` (10 identidades sobre fichas inexistentes).

Después: `doctor: VERDE CON 1 AVISO(S)` — el aviso es el histórico registrado,
tal como exige el plan («las limitaciones históricas quedan distinguidas de
corrupción vigente»). Registro: [doctor-after-reconcile.log](doctor-after-reconcile.log).

## 4. Drift del constraint `social_links_platform_ck` (falso positivo del restore)

El «drift» (`sobra 1` en la copia restaurada) no era corrupción: `pg_dump`
volca el CHECK desde su texto deparseado y `pg_restore` lo recrea repartiendo
los casts por elemento —

```
base viva / lista aprobada:  ((ARRAY['instagram'::character varying, …])::text[])
copia restaurada:            (ARRAY[('instagram'::character varying)::text, …])
```

— comprobado el 2026-10-10 con `postgres:16` (DDL real de 0040 + dump custom +
restore en contenedores desechables). Se corrigió en la raíz: `diffCoreCatalog`
normaliza ambas grafías **en los dos lados** (y la membresía en las listas
aprobadas se prueba ya normalizada), de modo que una restauración fiel no
figure como drift sin que un cambio real (valor añadido, otro operador) deje de
delatarse. Pruebas: `test/unit/core-catalog-drift.test.ts` (grafía restaurada,
cambio real, operador distinto) y `test/contract/core-catalog.test.ts`.

## 5. Conservación del core y de los cuatro artistas (criterio de salida)

`scripts/stage1-baseline.ts` captura huellas completas de las 12 tablas
canónicas de `public` (conteo + md5 del multiset de filas JSONB, en una
transacción REPEATABLE READ de solo lectura) y la identidad de los cuatro
artistas del corpus (`docs/plan-20-de-20/stage1-cases.json`).

- Línea base (pre-migración): [baseline/catalog.json](baseline/catalog.json) —
  última migración `0052_discovery`.
- Post-migración + reconciliación:
  [after-migracion/catalog.json](after-migracion/catalog.json) — última
  `0057_integrity_reconciliation`.

Comparación medida: **12/12 tablas con conteo y hash idénticos (0
diferencias)** y los cuatro artistas (Jeremías · Apache · La Banana Voladora ·
Caramelos de Cianuro) con el mismo id y nombre. Las migraciones 0053–0057 solo
tocan `ingest`; el core no cambió.

## 6. Verificaciones

- `npm run typecheck` ✓ · `npm run lint` ✓ (sin errores).
- Contratos dirigidos a los módulos tocados: **33/33 pruebas** en
  `core-and-schema` (0001–0057 en dos pasadas), `doctor`,
  `external-identity-lifecycle` (reconciliación + idempotencia),
  `core-catalog`, `migration-runner` y `curation-structural`. Registro:
  [contracts.log](contracts.log).
- Unitarias: política editorial (E1-06) y cobertura de acciones recalibradas
  con la política explícita (`test/unit/editorial-policy.test.ts`,
  `test/unit/curation-coverage.test.ts`).

Nota: `social_links_platform_ck` sigue **siendo** parte del catálogo aprobado
(0040); lo que cambió es que el doctor ya no confunde su grafía restaurada.
