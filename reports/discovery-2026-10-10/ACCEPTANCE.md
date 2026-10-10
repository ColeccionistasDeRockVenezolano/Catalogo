# Auditoría de salida — etapa 1

Implementación y curaduría verificadas el 2026-10-10. Activada posteriormente ese mismo día por instrucción del usuario: `CRV_DISCOVERY_ENABLED=true` en `.env`, frontend público actualizado y ambos servicios reiniciados. `activation.json` verifica sobre el gateway real los 15 artistas aprobados y su presentación en escritorio y móvil, sin errores de página; rotación y pausa verificadas en escritorio. El valor predeterminado de nuevas instalaciones continúa apagado para permitir la secuencia controlada descrita en `docs/DISCOVERY_PHASE_1.md`.

| Requisito del plan | Evidencia actual |
| --- | --- |
| 1A: preservar cambios locales, comprobar migraciones y reservar número libre | Se inspeccionó el árbol inicial con numerosos cambios anteriores. La base registraba 51 migraciones, hasta `0051`; se añadió `0052`. No se restablecieron ni descartaron archivos anteriores. |
| 1B: vocabulario, N:M y elegibilidad persistida; FKs e índices | `migrations/0052_discovery.up.sql`, módulo Drizzle y exportación; tres tablas en `ingest`. El contrato de FKs reporta únicamente cinco índices faltantes de tablas anteriores, ninguno de descubrimiento. |
| 1B: estados, actor/fecha/motivo, evidencia existente y ventanas | Zod + CHECKs + FKs a `claim_evidence`; `discovery.test.ts` verifica propuesta/aprobación/rechazo/retiro, evidencia ajena y programación futura/vencida. |
| 1C: cotejo de 23 candidatos, aliases, vínculo y criterio editorial | `ops/discovery/review-2026-10-10.json`, con IDs, aliases, extractos y motivos. 15 aprobados, 8 pendientes; cuatro definiciones editoriales y etiquetas coexistentes. |
| 1C: importador por ID, idempotente, preview y conflictos, sin altas/fusiones | `preview.json`, `applied.json`, `preview-final.json`, `verified.json`. Fixture de IDs ausentes/duplicados, evidencia ajena y nombre cambiado. Reimportación real conserva las filas y fechas. |
| 1D: endpoint local, nombres actuales, aprobación/vigencia/existencia | `verified.json`: HTTP 200 y exactamente los 15 IDs aprobados, nombres actuales, sin duplicados. Contrato verifica renombre y estados excluidos. |
| 1D: caché acotada e invalidación tras cambios | Servidor/HTTP sin caché (`no-store`), lectura actual por consulta. Cliente con concesión de 15 s, renovación cada 10 s, error elimina selección, evento de catálogo/visibilidad revalida. QA prueba retirada, renombre y vencimiento en navegador. |
| 1D: política editorial configurable, diversidad y continuidad de identidad | Cuatro grupos configurables, turnos y permutación ponderada; todos los IDs se visitan una vez por vuelta. Cuatro unitarias de política/deduplicación/cobertura/bandera. |
| 1E: principal, autocompletado y barras especializadas compatibles | Principal usa el endpoint exclusivamente; muestreo por tipo se conserva para barras secundarias. Ocho unitarias previas de ejemplos siguen aprobadas. Contrato `/search` sigue disponible. |
| 1E: intervalo, texto, visibilidad, movimiento reducido y controles accesibles | `docs/ui-qa/discovery/results.json` y capturas escritorio/móvil: rotación, pausa, Tab/Escape/Shift+Tab, Usar por teclado/toque, pestaña oculta y movimiento reducido; no desbordamiento. Texto y foco permanecen tras renovación. |
| 1E: fallback, error, bandera y retirada | QA en ambos tamaños: lista vacía, servicio 503, bandera apagada y ventana vencida muestran el fallback exacto. Buscar sigue funcionando. |
| 1F: integridad y evidencia en fusión, deshacer/rehacer | Contrato con decisiones y evidencias en ambos lados; conserva ambas etiquetas/sugerencias, bloquea el choque, restaura al deshacer/rehacer y deduplica dos aprobaciones por ID. |
| 1F: migración repetible, rollback específico y compatibilidad del core | Contrato PostgreSQL desechable: up repetido, down específico, harness e instalación de nuevo. `public-schema.json`: pg_dump de `public` idéntico en la base real. El contrato general confirma diff vacío y rollback completo en base desechable. |
| 1F: carga sin muestreo masivo | QA comprueba cero peticiones de listas para ejemplos de la principal. Una petición de descubrimiento y una de facetas; sin proveedores externos. |
| Respaldo antes de migrar la base real | Dump completo de 802 MiB en `/mnt/datos/backups/crv/discovery-2026-10-10/`, con índice legible y SHA256SUMS; seguido de migración y lote. |
| Documentación, operación, activación y reversión | `docs/DISCOVERY_PHASE_1.md`; apagado de bandera como primera reversión y down específico separado del rollback global. Fases 2–4 documentadas como backlog. |
| Sin analítica incompleta ni afirmaciones engañosas | No se añadieron eventos, rankings, tendencias o puntajes. Los nombres de las colecciones no afirman actualidad o popularidad. |

## Validación ejecutada

- 7 pruebas de contrato de descubrimiento, 4 unitarias de política y 8 unitarias existentes de ejemplos: aprobadas.
- Typechecks backend/frontend, lint de archivos implementados y build del frontend: aprobados.
- QA de navegador en escritorio y móvil, incluyendo caducidad temporal: aprobado sin errores de página.
- 9 pruebas de diario y 6 de fusiones API existentes: aprobadas.
- Contrato general de migraciones: 6/7 aprobadas; el fallo restante enumera cinco FKs de tablas anteriores sin índices.
- Lectura API: 20/21 aprobadas; la expectativa antigua supone que buscar un artista no devuelve sus discos, aunque el buscador existente sí los encuentra por artista.

Se reprodujeron esos **dos fallos previos usando únicamente migraciones 0001–0051** en otras bases desechables (`preexisting-checks.log`), con 26/28 aprobadas. No se modificó el comportamiento actual de búsqueda para satisfacer una expectativa desactualizada ni se alteraron tablas ajenas a esta fase. Las expectativas del registro de migraciones se actualizaron hasta `0052`; el diff del core y el rollback permanecen aprobados.

El detector de diseño reportó tres avisos en estilos anteriores (Inter y bordes laterales de otras superficies), conservados fuera del alcance. Las fuentes de los ocho candidatos pendientes no se aprobaron por su mera existencia en el catálogo.
