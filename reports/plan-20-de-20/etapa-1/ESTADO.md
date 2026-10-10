# Etapa 1 · Estado de cierre (2026-10-10)

Trabajo de la sesión codex (cuota agotada a las 12:00) terminado y verificado por
el operador. Paquetes E1-01…E1-05 del
[contrato de ejecución](../../docs/PLAN_CINCO_ETAPAS_20_DE_20_EJECUCION_2026-10-10.md).

| Paquete | Estado | Evidencia |
| --- | --- | --- |
| E1-01 Línea base y corpus | Hecho | `baseline/` (huellas de las 12 tablas canónicas + 4 artistas + migraciones), `docs/plan-20-de-20/stage1-cases.json`. La muestra de usuarios queda pendiente por contrato (sin participantes reales). |
| E1-02 Regresiones y CI | Hecho | 27 errores de lint corregidos (lint ✓), expectativas de búsqueda/taxonomía reconciliadas, CI con unitarias web + smoke de navegador (login, roles, CSRF, edición persistida). Unit 741/741. |
| E1-03 Integridad | Hecho | 0055 (índices FK) · 0057 + `scripts/reconcile-integrity.ts` · reconciliación run 18977 · doctor de 3 ✗ a VERDE con 1 aviso. Informe: [reconciliacion.md](reconciliacion.md). |
| E1-04 Precisión de fechas y obra/edición/soporte | **Pendiente** | No implementado (esta sesión no lo empezó). Medición: 677 personas con nacimiento (14 en 1-ene), `album_formats`=744, `media_format` en 1.064/15.607 discos. |
| E1-05 Hechos/evidencias y política | Hecho | Política editorial v1 (`src/curation/editorial-policy.ts`) con lista blanca de autocorrección desatendida y motivo obligatorio; pruebas `test/unit/editorial-policy.test.ts`; cobertura de acciones recalibrada con motivo (72,4 %/87,0 %). |

## Fallos de conservación corregidos en esta etapa

- Fusiones trasladaban géneros pero dejaban identidades externas apuntando a
  fichas eliminadas → traslado + reversión (`test/contract/external-identity-lifecycle.test.ts`).
- «Deshacer retiro» omitía géneros, identidades externas e historial y cambiaba
  claims a «aplicados» → restauración completa sin pisar decisiones posteriores.
- Retiro automático de fichas sin vínculos y autocorrección de fechas pasaron a
  nivel ≥1/2 con motivo (E1-05) — el plan lo exige.
- `pg_dump`/`pg_restore` cambian la grafía deparsed de un CHECK `IN (...)` → el
  catálogo del doctor ahora normaliza ambas grafías (`test/unit/core-catalog-drift.test.ts`).

## Verificación dorada

`db:restore-check` del respaldo post-reconciliación `crv-20261010T170148Z`:
**RESTORE VERIFICADO** — 97 tablas / 20.834.774 filas idénticas, 7.679
`raw_pages` (0 sin archivo, 0 con hash distinto) y doctor contra la copia en
**VERDE con 1 aviso** (huella exacta del core: el falso drift del restore
quedó resuelto). Registro completo:
[restore-check-crv-20261010T170148Z.log](restore-check-crv-20261010T170148Z.log).

Suites: `typecheck` ✓ · `lint` ✓ · `build` ✓ · unit **741/741** · contratos
completos **68 archivos / 481 pruebas → 480 ✓** y el único fallo es E9.5
(medición de rendimiento bajo carga, ver abajo; pasa aislado y su umbral no se
tocó). El contrato E4 `curation-fixes` quedó verde tras esperar el campo
`editorialInputs` que la política añadió a la API.

## Pendiente declarado (no oculto)

- **E1-04**: precisión de fechas parciales (año/mes/día/aprox./intervalo) y
  separación obra/edición/soporte; requiere decisión de modelo (idealmente capa
  auxiliar, sin tocar el core) — 3–5 jornadas según el plan.
- **E9.5 (rendimiento)**: el contrato «con el doble del catálogo real: completo
  < 5 s · dirigido < 1 s» **pasa aislado** y falla solo bajo la carga de la
  suite completa — quedó caracterizado como variabilidad de entorno, igual que
  en la [evaluación integral](../../docs/EVALUACION_INTEGRAL_SISTEMA_2026-10-10.md:290)
  («4.835 ms aislado vs 5.449 ms concurrente → no es caída funcional»); el
  cierre de Curaduría ya lo declaró «cumple, sin holgura»
  ([CIERRE_20_DE_20](../../docs/curation/CIERRE_20_DE_20.md:38)).
  Medido 2026-10-10 (117.946 filas): aislado régimen **4.633–4.757 ms** (foto
  482–557 · léxico 722–755 · detectores 2.560–2.653 · guardar 748–849) y
  dirigido 120–121 ms; dentro de la suite 5.447 ms (detectores 3.077 · guardar
  979). No se tocó el umbral. Decisión abierta para CI: dejarlo como está o
  hacer la medición robusta (mejor de dos pasadas tibias) si genera ruido rojo.
- Expectativa E4 corregida: `/curation/findings/:id/actions` ahora declara
  `editorialInputs` (política E1-05); el contrato `curation-fixes` lo esperaba
  sin ese campo (12/12 tras la corrección).
- Muestra de usuarios de la línea base (8 participantes) — por contrato, sin
  sesiones inventadas.
