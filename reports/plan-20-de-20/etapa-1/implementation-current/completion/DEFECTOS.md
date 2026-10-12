# Registro técnico de defectos de la etapa 1

Responsable de estas correcciones: Codex. Esta relación registra reproducciones y comprobaciones automáticas; no atribuye revisión editorial ni sesiones humanas. La puerta integral final se registra en `quality-r4/quality.json`.

| Defecto o regresión | Corrección | Comprobación |
| --- | --- | --- |
| El contrato de acciones omitía `editorialInputs` y la política dejaba decisiones editoriales como autocorrección | Contrato actualizado; retirar fichas sin vínculos y corregir cronología exige decisión y motivo | `curation-fixes`, `curation-structural`, unitarias de reglas y acciones |
| Fusiones y retiros podían dejar identidades externas o perder su inversa desde el historial general | Migración 0058, diario de identidades e inversas verificadas | `external-identity-lifecycle`, `journal-undo-concurrency`, `legacy-undo` |
| Una fecha parcial podía terminar representada por un día inventado; comparaciones antiguas asumían fecha exacta | Parser, migración 0061 y adaptación de API, fusiones, verificador y formularios | `stage1-catalog-model`, contratos de personas y prueba de navegador |
| El catálogo carecía de relaciones explícitas entre persona/proyecto y obra/edición/soporte | Migración 0062, API con motivo, formularios y controles diferidos de pertenencia | `stage1-catalog-model`; recorrido real de identidad y obra/edición |
| Captura histórica y lectura posterior podían confundirse; no existía inventario común de afirmaciones y citas | Migraciones 0059/0060 e integración transaccional de verificaciones; historia desconocida se conserva como tal | `fact-inventory`, `entity-verification`; lote histórico repetido en la copia restaurada |
| Citas con acentos o emoji fallaban al aplicar offsets de caracteres sobre SQL_ASCII | Offsets nuevos en bytes UTF-8; coordenadas antiguas conservan unidad explícita | Contratos de inventario ejecutados en UTF8 y SQL_ASCII |
| Doctor trataba los tres controles diferidos aprobados como drift del core | Lista de las tres definiciones exactas; otras modificaciones siguen siendo errores | `core-catalog-drift`, `core-and-schema`, CLI y doctor de la restauración |
| Un respaldo bajo escrituras concurrentes podía tener conteos de una versión y dump de otra | Conteos y dump comparten una instantánea PostgreSQL exportada | Restauración de 97 tablas/20.838.173 filas y 7.679 capturas; `staging/migration-check-final.json` |
| La prueba de navegador buscaba «Relación» con nombre exacto aunque el campo requerido se llama «Relación *» | Selector corregido sin modificar el requisito del formulario | Recorrido compilado con PostgreSQL real; `browser-final/` |

Las rondas fallidas se conservan. El fallo de rendimiento de `quality-r2` ocurrió durante la restauración; no se usa como aprobado ni se cambió su umbral. `quality-r3` detectó cambios de fuente durante la corrección del navegador y terminó sin acreditar la versión final. La ejecución final debe aprobar todos los controles sobre una única huella.
