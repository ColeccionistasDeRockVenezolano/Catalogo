# Verificación de la etapa 1 · 10 de octubre de 2026

**Resultado: implementación parcial; la etapa 1 no está cerrada.** Se
contrastó el código con el plan y se reprodujeron dos defectos que las pruebas
existentes no cubren. Durante esta auditoría se modificaron informes y se
preservaron reproducciones; no se corrigió todavía el código del producto.

Versión examinada: `2857dfeb6a8064ef7a200a6852f9245265487ef2`.
Huella de entradas del control de calidad:
`f4c3a529f0c4962209663a274221850942be79d80900344c7645f6e815251641`.
Entorno local: Node `v24.21.0`; CI declara Node 22. La comprobación local no
demuestra una ejecución aprobada en GitHub Actions ni que API/bundle publicados
correspondan a esta versión.
Se comprobó que existen las referencias `v7` declaradas por el workflow:
[checkout](https://github.com/actions/checkout/releases/tag/v7),
[setup-node](https://github.com/actions/setup-node/releases/tag/v7) y
[upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7).
Esto verifica disponibilidad de esas referencias; no sustituye ejecutar CI.

## Defectos reproducidos

### V1 · Deshacer desde el historial conserva una asociación externa incorrecta

Se crearon dos artistas en PostgreSQL desechable y una identidad externa
asociada al segundo. Se ejecutó `mergeInto` mediante `withOperatorRun` y luego
`undoRun`, que es la entrada usada por el historial. El artista eliminado
vuelve, pero la identidad continúa asociada al primero.

Resultado registrado: `method=journal`, propietario original `2`, propietario
tras deshacer `1`, `conserved=false`. La aserción de conservación falla.

`src/merge/run-undo.ts:142` selecciona el diario si el run tiene entradas;
la tabla `ingest.genre_external_identities` no está registrada en él.
Las rutas reales llaman a `undoRun` en `src/api/routes/changes.ts:143` y
`src/api/routes/merge-runs.ts:49`.
La restauración añadida a `undoMergeRun` queda fuera de ese recorrido.
`test/contract/external-identity-lifecycle.test.ts` llama a la inversa específica
directamente, por lo que sus resultados verdes no prueban el historial.

Evidencia: [registro](verification-current/undo-history.log),
[aserción fallida al ejecutar la copia guardada](verification-current/undo-history-repro.log) y
[reproducción](verification-current/repro/undo-history.mts).
Responsable técnico: backend; paquete E1-03; severidad P1 por atribución
incorrecta de identidad. Pendiente de corrección.

Cierre requerido: registrar y revertir las identidades en el recorrido real,
incluyendo operaciones históricas anteriores al nuevo registro, y probar
fusión/retiro → historial → deshacer, conflictos posteriores y conservación
de todas las filas y decisiones. Añadir solo un disparador para operaciones
futuras no resuelve automáticamente los runs ya existentes.

### V2 · Releer un archivo sustituye su fecha de captura original

Se simuló un HTTP 403 y un registro de `raw_pages` cuya captura era
`2001-05-06T00:00:00Z`. El broker real leyó el HTML archivado y devolvió
`2026-10-10T19:06:27.756Z` como `fetchedAt`. La reproducción usa un archivo
temporal y adaptadores de base/red controlados; no escribe en la base real.

`src/ambiguity/web-search.ts:198` consulta ruta y tipo sin recuperar la fecha;
la respuesta de `page` en la línea 193 usa la hora actual. `WebPage` tampoco
declara un método de adquisición separado.

Evidencia: [registro](verification-current/capture-date.log),
[aserción fallida al repetir la reproducción](verification-current/capture-date-repro.log) y
[reproducción](verification-current/repro/capture-date.mts).
Responsable técnico: backend; paquete E1-05; severidad P1 por procedencia
incorrecta. Pendiente de corrección.

Cierre requerido: persistir captura, método y relectura por separado; conservar
la fecha original en archivo/caché/informes, tratar como desconocida una fecha
no recuperable y probar red, copia archivada y relecturas posteriores.

Desde la raíz del proyecto, las reproducciones se ejecutan con:

```sh
./scripts/with-node22.sh ./node_modules/.bin/tsx reports/plan-20-de-20/etapa-1/verification-current/repro/undo-history.mts
./scripts/with-node22.sh ./node_modules/.bin/tsx reports/plan-20-de-20/etapa-1/verification-current/repro/capture-date.mts
```

Ambas contienen una aserción que debe fallar en la versión examinada. La
primera necesita Docker y destruye únicamente su propia base desechable.

## Requisitos todavía ausentes

- **E1-04:** el campo de nacimiento rechaza `1973` y `1973-05`, aceptando
  solo `1973-05-06`. No está implementado el modelo compatible de precisión,
  períodos y obra/edición/soporte, ni su migración/reversión/reaplicación.
  Evidencia: [validación actual](verification-current/partial-dates.log).
- **E1-05:** existe la política editorial común y la lista blanca, pero falta
  el inventario persistente exigido de hechos y evidencias con entidad, campo
  o relación, valor, edición/período, fuente, fragmento, captura, método y estado.
- **E1-01:** los cuatro nombres configurados no son el corpus etiquetado de
  40 fichas, 300 hechos, 100 negativos, 100 imágenes y 120 documentos. La
  línea base con ocho participantes no se realizó. El usuario indicó «solo
  yo»: se mantiene pendiente sin inventar participantes ni resultados.
- La aceptación humana de casos críticos y la comprobación completa de
  accesibilidad permanecen pendientes. El detector mecánico de Impeccable
  no encontró patrones en el componente examinado;
  [salida](verification-current/dialog-detector.json). Esto no prueba UX ni
  accesibilidad manual.

## Comprobaciones favorables y límites

- Tipos y lint aprobados; unitarias backend **741/741**, web **49/49** en la
  ejecución actual. La secuencia completa y la huella después de cada paso
  se registran en [quality.json](verification-current/quality.json).
- Contratos completos: **480 aprobados / 481**, 67 archivos aprobados y uno
  fallido, duración 773,88 s. El único fallo de la suite es E9.5. Las dos
  reproducciones adicionales V1/V2 también fallan, pero están fuera de esos
  481 contratos; no se suman como si fueran pruebas incluidas en la suite.
- Builds backend y web aprobados. Navegador sobre la SPA compilada y API
  real, con PostgreSQL aislado: login, roles, CSRF, edición persistida y cero
  errores de JavaScript aprobados. Esta prueba no cubre todo el recorrido
  editorial ni las operaciones estructurales de conservación.
  Evidencia: [controles adicionales](verification-current/additional-quality.json)
  y [navegador](verification-current/browser.log).
- Cobertura aprobada con los umbrales existentes: sentencias/líneas **35,14 %**,
  ramas **82,23 %**, funciones **47,45 %**; 741/741 unitarias aprobadas también
  con instrumentación. El umbral de sentencias/líneas es 35 %, por lo que
  tiene poco margen. Evidencia: [cobertura](verification-current/coverage.log).
- Diálogo editorial: inspección visual acotada en **1440 y 390 px**, con el
  componente y CSS reales y respuestas API controladas. Se comprobó que año
  y fundamento llegan a la nueva vista previa, que aplicar queda deshabilitado
  mientras hay cambios sin previsualizar y que vuelve a habilitarse al revisar
  la nueva vista previa con motivo. Cero errores JavaScript y sin overflow del
  documento; en móvil la tabla exige desplazamiento horizontal para revisar
  todos los campos y el antes/después. No se aplicó una corrección real desde
  este diálogo, ni se verificaron 320/768 px, zoom, contraste o teclado completo.
  Evidencia: [resultado](verification-current/dialog-browser.json),
  [escritorio](verification-current/dialog-1440.png),
  [móvil](verification-current/dialog-390.png) y
  [script reproducible](verification-current/repro/dialog-browser.mjs).
- Doctor de la base real: **VERDE con un aviso**, sin errores activos en sus
  controles actuales. Declara 3.155 límites históricos de claims, 12.695
  auditorías sin run original y 1.479 cambios recientes sin run. No significa
  que el historial pueda deshacerlos ni que cubra la tabla omitida de V1.
  Evidencia: [doctor](verification-current/doctor.log).
- Las **12/12 tablas canónicas** conservan conteos y huellas tanto después
  de la reconciliación como en una nueva lectura consistente de la base real;
  los cuatro artistas conservan sus identificadores. Esta comparación no
  cubre por sí sola todo el estado auxiliar de esos artistas.
  Evidencia: [comparación](verification-current/catalog-conservation.json).
- El respaldo postreconciliación `crv-20261010T170148Z` pasa SHA-256 de sus
  cuatro archivos: [registro](verification-current/backup-sha256.log).
  Se revisó la restauración realizada por el operador: 97 tablas,
  20.834.774 filas, 7.679 raw pages, cero archivos faltantes o hashes distintos
  y doctor verde con un aviso. [Registro de restauración existente](restore-check-crv-20261010T170148Z.log).
  La auditoría actual no repitió esa restauración completa.

El contrato de rendimiento `curation-incremental` falló en la ejecución
actual: **6.100 ms**, requisito **<5.000 ms**, sobre **117.946 filas**;
el dirigido midió 189 ms y cumple su límite <1.000 ms. La prueba no fue
omitida ni se cambió su umbral. Responsable: backend/QA, E1-02, severidad P2.
La suite terminó y la puerta global de calidad **no pasa**, con huella de
código intacta. Los builds, navegador y cobertura **aprobaron** por separado
en la misma versión; su aprobación no convierte este resultado en verde.
La lectura final de todos los archivos incluidos en la huella confirmó que
siguen iguales. [Resumen de resultados](verification-current/verification-summary.json).
El registro de pendientes está en
[defects.json](verification-current/defects.json).
Pasar pruebas existentes no invalida los dos defectos reproducidos ni completa
los entregables ausentes.
