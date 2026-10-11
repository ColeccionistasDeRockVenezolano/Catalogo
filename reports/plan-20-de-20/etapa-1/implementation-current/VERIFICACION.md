# Verificación de los cambios actuales · 10 de octubre de 2026

**Informe histórico de la versión `3b17bf5…`.** La
[ronda 6](verification-r6/VERIFICACION.md) contiene la última pasada completa:
796 unitarias backend, 55 web y 504 contratos, con código congelado que
coincide con el workspace al terminar la verificación.
La
[verificación posterior](verification-r3/VERIFICACION.md) registra la corrección
de concurrencia y la pasada técnica completa del candidato `dcccd5c…`.
La [ronda 4](verification-r4/VERIFICACION.md) verifica el inventario 0060 y
distingue la pasada global de los cambios posteriores del workspace.
No ejecutar las reproducciones de concurrencia de este informe sin adaptarlas
a los nuevos bloqueos; usar los contratos indicados en el informe posterior.
Los resultados siguientes se conservan tal como correspondían a esta revisión.

**La etapa 1 continúa incompleta.** Las correcciones de identidad externa y
relectura de fuentes están verificadas en el workspace, pero esta revisión
reprodujo una pérdida de una edición concurrente durante deshacer. Las
migraciones nuevas todavía no están aplicadas a la base publicada.

HEAD de referencia: `2857dfeb6a8064ef7a200a6852f9245265487ef2`, con cambios sin
commit. Huella del código actual:
`3b17bf5af2d72c4bd72f9930a23cd4805476e3448b81ebb4fd913b3a7321424c`.
Node local: `v24.21.0`; CI declara Node 22. No se atribuye una pasada de CI.
La auditoría anterior sigue disponible en [el informe histórico](../VERIFICACION.md).

## Correcciones comprobadas

**Identidades externas.** La migración 0058 registra la tabla en el diario
completo y estricto. El recorrido `undoRun` recupera instantáneas reales de
fusiones y retiros anteriores al registro, sin fabricar entradas históricas.
Las pruebas ejercen historial/API, deshacer, rehacer, decisiones posteriores,
filas descartadas por colisión y conservación de filas completas, señales y
decisiones. Se conserva también la prueba de la inversa específica antigua.

La recuperación histórica requiere que la operación haya guardado esa
instantánea. Una consulta agregada de la base real encontró **12.015**
auditorías `merged_duplicate` y **1.310** retiros registrados, ninguno con
`externalIdentities` en las instantáneas examinadas
([conteos](verification/historical-snapshot-coverage.json)). Esos números no
demuestran que cada operación haya tocado identidades externas. Sí impiden
atribuir a la corrección una restauración demostrada de todo ese historial:
si falta la foto original, esta implementación no la puede reconstruir.

**Captura y relectura.** La migración 0059 separa fecha de captura, fecha de
lectura y método en el caché. La lectura archivada recupera la fecha registrada
en `raw_pages` y verifica el hash de los bytes; la relectura del caché conserva
esa fecha. Los informes, sus citas, la API y el contexto de investigación
transportan los metadatos. Una fecha histórica ambigua no se presenta como
captura verificada. El dato recuperado de `raw_pages` es la adquisición allí
registrada: el sistema antiguo puede haber actualizado `fetched_at` al volver
a descargar bytes idénticos; no se reconstruye una primera adquisición
desconocida.

Pruebas dirigidas: **29/29** en cuatro archivos
([registro](targeted-contract.log)): identidad, diario/API, procedencia y
migrar → revertir → reaplicar. Pruebas adicionales previas: **74/74**
([registro](targeted-unit.log)) y contrato de serialización real de citas en la
API **7/7** ([registro](provenance-api.log)). Estos grupos se solapan con la
suite completa; no se suman como pruebas independientes de aceptación.

La interfaz se comprobó con componentes y CSS reales, datos/API controlados y
navegador en **1440 y 390 px**. Tanto fuentes como comparación distinguen la
captura de 2001 de su lectura en 2026 y muestran las fechas antiguas sin
verificación como tales. Cero errores JavaScript, cero overflow del documento
y ninguna fecha inválida. [Resultado](visual/browser.json),
[escritorio](visual/provenance-1440.png), [móvil](visual/provenance-390.png).
Esta inspección acotada no sustituye accesibilidad completa ni sesiones reales.

## Nuevo fallo reproducido: una edición concurrente puede perderse

**P1 · E1-03 · Backend.** En PostgreSQL desechable se creó una persona y se
cambió su nacionalidad a Venezuela mediante el escritor real. Durante el
deshacer real, inmediatamente después de que el plan leyera su instantánea,
una segunda conexión confirmó una edición a Colombia. Deshacer terminó sin
error y dejó la nacionalidad en `null`: la edición confirmada se perdió.

La reproducción controla el instante de la segunda escritura, no el resultado
de PostgreSQL ni la implementación de deshacer. Se reprodujo primero con SQL
directo y después con **`withOperatorRun` + `updateEntity`**, el escritor de las
ediciones API, en una segunda conexión. Ambos pierden Colombia sin rechazar
deshacer. Es una prueba de los servicios reales sobre PostgreSQL, sin dos
navegadores ni dos solicitudes HTTP.
`currentRows` no bloquea las filas leídas y la actualización de `applyStep`
solo identifica la clave, sin volver a comprobar la foto esperada. El bloqueo
advisory de deshacer serializa otros deshacer, pero no esas otras escrituras.

[Resultado con escritor real](verification/undo-concurrency-writer.json),
[registro](undo-concurrency-writer.log),
[reproducción guardada](repro/undo-concurrency-writer.mts.txt).
Para repetir desde la raíz, copiar el archivo a `/tmp/crv-undo-concurrency.mts`
y ejecutarlo con `./scripts/with-node22.sh ./node_modules/.bin/tsx`.
Usa y destruye únicamente su propio contenedor desechable. La aserción falla
en la versión examinada. Requiere corregir la protección entre comprobar y
aplicar, y verificar una edición concurrente con éxito o rechazo íntegro.

## Conservación y publicación

Una nueva lectura consistente de la base real confirmó **12/12 tablas
canónicas idénticas** al último control, incluidos los identificadores de los
cuatro artistas. [Comparación](verification/catalog-conservation.json).
Esto no demuestra conservación de todo el estado auxiliar.

La última migración real sigue siendo `0057_integrity_reconciliation`.
0058/0059 se probaron en bases desechables. El build de prueba en `web/dist`
no publica el bundle servido desde `web/dist-public`; no se reiniciaron ni
publicaron los servicios durante esta revisión.

## Requisitos pendientes

- E1-01: corpus etiquetado (40 fichas, 300 hechos positivos, 100 negativos,
  100 imágenes, 120 documentos), respaldo de aplicación y línea base de uso.
  Solo el usuario está disponible; no hay ocho sesiones realizadas.
- E1-02: completar la puerta global de calidad sobre esta versión y obtener
  CI aprobada; el fallo de rendimiento de la auditoría anterior no se da por
  resuelto por estas correcciones.
- E1-03: corregir y probar el fallo concurrente descrito arriba; aplicar y
  comprobar el resultado candidato en el entorno que corresponda.
- E1-04: fechas parciales, precisión y períodos; persona/identidad musical y
  obra/edición/soporte con conservación, migración, reversión y reaplicación.
- E1-05: inventario persistente de hechos/evidencias por entidad, campo o
  relación, valor, edición/período, fuente, fragmento, captura, método y estado.
  Los metadatos nuevos del caché y los informes no completan ese inventario.

## Puerta de calidad actual

La primera ejecución aprobó tipos y falló lint por tres referencias a globals
de navegador en la reproducción guardada del informe anterior
([resultado](verification/quality.json), [lint](verification/lint.log)). Se
corrigió únicamente ese script para acceder al documento mediante el elemento
inspeccionado. El fallo queda preservado y no se oculta.

La repetición completa se registra en [quality.json](verification-r2/quality.json).
Tipos, lint, unitarias backend **741/741** y web **52/52** aprobaron.
La suite completa terminó: **487 aprobadas / 488**, **68 archivos aprobados y
uno fallido**, en **785,79 s**. El único fallo de esa suite es E9.5:
**5.942 ms** en régimen sobre **117.946 filas**, límite **<5.000 ms**; dirigido
**152 ms**, límite **<1.000 ms**, aprobado. La puerta global permanece fallida.
La huella después de cada control confirma que el código no cambió durante
la ejecución. Las dos reproducciones de concurrencia están fuera de esas 488
pruebas y fallan; no se presentan como pruebas aprobadas ni se suman al total.

Builds backend/web, navegador con SPA compilada y API real sobre PostgreSQL
aislado, y cobertura aprobaron en la misma huella de código
([controles adicionales](verification-r2/additional-quality.json)). Se ejecutaron
mientras continuaban los contratos, después de que la medición E9.5 ya hubiera
terminado y fallado. No se cambió ni repitió ese resultado de rendimiento.

Cobertura actual: sentencias/líneas **35,11 %**, ramas **82,20 %**, funciones
**47,48 %** ([totales](verification-r2/coverage-totals.json)). Cumple los pisos
vigentes de 35/78/45 %. Resumen trazable de esta revisión:
[verification-summary.json](verification-summary.json).
