# Etapa 1: implementación y validación

La instrucción del propietario retiró el requisito de ocho participantes. El contrato y la matriz de aceptación están actualizados a la revisión 3. Las pruebas de navegador se registran como pruebas técnicas, sin atribuirlas a usuarios humanos.

La implementación actual integra los cinco paquetes. La validación final y la publicación están en ejecución; los resultados de rondas anteriores no acreditan cambios posteriores.

| Paquete | Implementación actual | Evidencia |
| --- | --- | --- |
| E1-01 Línea base y corpus | Línea base conservada; corpus reproducible de conservación | `implementation-current/completion/before/catalog.json`, `completion/corpus-r2/`: 40 fichas, 565 valores, 100 negativos representativos, 120 documentos con bytes comprobados y 100 asociaciones de imágenes. Partición estratificada de 24 casos de desarrollo y 16 reservados. Las imágenes y los hechos externos no se etiquetan como aprobados editorialmente. |
| E1-02 Regresiones y CI | Puerta local completa y CI existente | `completion/quality/` registra huella del código y resultados de tipos, lint, unitarias, contratos, builds y navegador. La pasada final está en ejecución. |
| E1-03 Integridad | Diario estricto, restauración e inversas concurrentes | 0058 registra identidades externas; contratos de deshacer concurrente y conservación. Respaldo con instantánea PostgreSQL compartida para conteos y dump; restauración aislada y migraciones 0058–0062 en validación. |
| E1-04 Fechas y modelo musical | Implementado en base, API y formulario | 0061 conserva año/mes/día, aproximación e intervalos sin inventar precisión. 0062 separa persona/identidad musical, obra/edición/soporte y géneros por período. Controles de pertenencia de pistas y de reasignación de padres; deshacer y rollback conservan filas. `test/contract/stage1-catalog-model.test.ts`. |
| E1-05 Hechos/evidencias y política | Inventario integrado con verificaciones e historial | 0059 separa captura y relectura; 0060 conserva documento, cita literal, hecho y ámbito. Las evaluaciones de IA quedan pendientes. Conciliación histórica idempotente conserva el claim original y deja desconocida la captura ausente. Política editorial y motivos obligatorios aplicados. |

La validación documental externa del corpus y el recorrido del propietario siguen siendo evaluaciones reales pendientes. Esta implementación no inventa sus resultados ni concede por sí sola el 20/20 de las cinco etapas.

## Evidencia histórica anterior a las correcciones 0058/0059

- Fusiones trasladaban géneros pero dejaban identidades externas apuntando a
  fichas eliminadas → traslado + inversa específica
  (`test/contract/external-identity-lifecycle.test.ts`). La prueba llama a
  `undoMergeRun` directamente: **no cubre el deshacer del historial**, que
  usa `undoRunWithJournal` y no restaura esas identidades.
- La inversa específica de retiro restaura géneros, identidades e historial y
  conserva el estado de los claims. Su cobertura directa tampoco demuestra
  que esas restauraciones ocurran desde el historial general.
- Retiro automático de fichas sin vínculos y autocorrección de fechas pasaron a
  nivel ≥1/2 con motivo (E1-05) — el plan lo exige.
- `pg_dump`/`pg_restore` cambian la grafía deparsed de un CHECK `IN (...)` → el
  catálogo del doctor ahora normaliza ambas grafías (`test/unit/core-catalog-drift.test.ts`).

## Restauración verificada por el operador

`db:restore-check` del respaldo post-reconciliación `crv-20261010T170148Z`:
**RESTORE VERIFICADO** — 97 tablas / 20.834.774 filas idénticas, 7.679
`raw_pages` (0 sin archivo, 0 con hash distinto) y doctor contra la copia en
**VERDE con 1 aviso** (huella exacta del core: el falso drift del restore
quedó resuelto). Registro completo:
[restore-check-crv-20261010T170148Z.log](restore-check-crv-20261010T170148Z.log).

Resultados históricos del operador: `typecheck` ✓ · `lint` ✓ · `build` ✓ · unit **741/741** · contratos
completos **68 archivos / 481 pruebas → 480 ✓** y el único fallo es E9.5
(medición de rendimiento bajo carga, ver abajo; pasa aislado y su umbral no se
tocó). El contrato E4 `curation-fixes` quedó verde tras esperar el campo
`editorialInputs` que la política añadió a la API.

## Pendientes históricos de la ronda 6

Esta lista documenta el estado de esa ronda. La tabla inicial describe la implementación actual.

- Aplicar y comprobar el candidato en el entorno correspondiente; 0058–0060
  siguen pendientes en la base real. La conservación concurrente ya pasó en
  PostgreSQL desechable con escritores reales.
- Integrar las extracciones de hechos y la conciliación histórica. La pasada
  global posterior a los cambios de personas ya aprobó en la ronda 6;
  documentos, fechas y método de captura separados de relectura tienen
  persistencia en el inventario 0060.
- Completar el corpus inicial y la línea base de uso exigidos por E1-01.
- **E1-04**: integrar el parser y la presentación de fechas parciales en el
  modelo persistente, API y formulario; completar persona/identidad musical y
  obra/edición/soporte con migración, reversión y conservación.
- **E9.5 (resultado histórico anterior a las optimizaciones)**: el contrato «con el doble del catálogo real: completo
  < 5 s · dirigido < 1 s» **pasaba aislado** y fallaba bajo la carga de la
  suite completa. **Ese fallo mantuvo pendiente la puerta de calidad**;
  pasar aislado no sustituye la ejecución completa. **La nueva pasada completa
  sí aprobó: 4.609 ms en régimen y 142 ms dirigido sobre 117.946 filas**, sin
  cambiar los umbrales; véase `implementation-current/verification-r3/`.
  Los fallos anteriores se conservan como evidencia histórica. La
  [evaluación integral](../../../docs/EVALUACION_INTEGRAL_SISTEMA_2026-10-10.md)
  también documenta variabilidad («4.835 ms aislado vs 5.449 ms concurrente»); el
  cierre de Curaduría ya lo declaró «cumple, sin holgura»
  ([CIERRE_20_DE_20](../../../docs/curation/CIERRE_20_DE_20.md)).
  Medido 2026-10-10 (117.946 filas): aislado régimen **4.633–4.757 ms** (foto
  482–557 · léxico 722–755 · detectores 2.560–2.653 · guardar 748–849) y
  dirigido 120–121 ms; dentro de la suite 5.447 ms (detectores 3.077 · guardar
  979). No se tocó el umbral. Estos resultados históricos no completaban la
  aceptación; la nueva suite completa acreditó el cumplimiento local.
- Expectativa E4 corregida: `/curation/findings/:id/actions` ahora declara
  `editorialInputs` (política E1-05); el contrato `curation-fixes` lo esperaba
  sin ese campo (12/12 tras la corrección).
- La revisión 3 del contrato retira la muestra obligatoria de ocho personas por instrucción del propietario. Solo él está disponible; no se inventan sesiones.
