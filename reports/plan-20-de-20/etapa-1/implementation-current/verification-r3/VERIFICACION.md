# Verificación de la versión candidata · 10 de octubre de 2026

**Los cambios del workspace aprobaron la puerta técnica local. La etapa 1
continúa incompleta.** Faltan integración del modelo, evidencias persistentes,
corpus, validación humana y comprobación del resultado publicado.

HEAD: `2857dfeb6a8064ef7a200a6852f9245265487ef2`, con cambios sin commit.
Huella del código:
`dcccd5c3c55e6d92c1924e1b7925761d2dc5cc98fb2562f39837cdbbe4ddbbec`.
La misma huella se mantuvo durante todos los controles de
[quality.json](quality.json). Node local: `v24.21.0`. CI declara Node 22;
esta ejecución local no acredita una pasada de CI.

## Resultados comprobados

| Control | Resultado | Registro |
| --- | --- | --- |
| Tipos y lint | Aprobados | [tipos](typecheck.log), [lint](lint.log) |
| Unitarias backend | 768/768, 79 archivos | [unitarias](unit.log) |
| Unitarias web | 55/55, 9 archivos | [web](web-unit.log) |
| Contratos completos | 491/491, 70 archivos; 627,26 s | [contratos](contract.log) |
| Builds backend y web | Aprobados | [backend](backend-build.log), [web](web-build.log) |
| Navegador con API real | SPA compilada, PostgreSQL desechable, login, roles, CSRF y edición persistida | [navegador](browser.log) |
| Cobertura backend | Aprobada: líneas/sentencias 35,20 %, ramas 82,39 %, funciones 47,79 % | [registro](coverage.log), [totales](coverage-totals.json), [control de versión](additional-quality.json) |

La cobertura comenzó después de finalizar E9.5, mientras continuaban otros
contratos. No sustituye ni altera su medición. Las pruebas dirigidas se solapan
con las suites anteriores y no se suman como aceptación adicional.

**Concurrencia al deshacer.** La aplicación bloquea las filas comprobadas hasta
confirmar su transacción; la vista previa permanece sin bloqueos de filas.
Tres contratos sobre PostgreSQL y escritores reales verifican ambos órdenes:
si la edición confirma primero, deshacer espera y rechaza íntegramente el run;
si deshacer comprueba primero, la edición espera y conserva su valor después.
También se comprueba que consultar la vista previa no espera el bloqueo de una
edición. Los tres aprobaron en la suite completa. Se conservan la
[prueba que falló antes de corregir](concurrency-before.log) y las
[pruebas dirigidas posteriores](concurrency-strengthened.log).

Para repetir este recorrido desde la raíz:

```sh
./scripts/with-node22.sh ./node_modules/.bin/vitest run test/contract/journal-undo-concurrency.test.ts
```

Las reproducciones de concurrencia de la revisión anterior coordinaban al
segundo escritor suponiendo ausencia de bloqueos. No deben ejecutarse sin
adaptación contra la versión corregida: pueden quedar esperando una liberación
que su propio protocolo impide. Sus resultados históricos siguen válidos para
la versión examinada entonces.

**Rendimiento.** E9.5 aprobó dentro de la suite completa, con el mismo catálogo
doble de 117.946 filas y los mismos límites: análisis en régimen **4.609 ms**
(foto 595, vocabulario 700, detectores 2.238, persistencia 1.016), límite
<5.000 ms; dirigido **142 ms**, límite <1.000 ms. La pasada inicial costó
7.483 ms; el contrato mide el análisis en régimen y conserva ambas mediciones.
La revisión anterior había fallado con 5.942 ms; no se reemplaza ese registro.

Las optimizaciones conservan byte por byte el análisis completo de **25.895
hallazgos**, evidencias, estadísticas del léxico y resultados de los detectores:
[comparación y hashes](detector-equivalence.json),
[resultado anterior completo](detector-before.json.gz),
[resultado posterior completo](detector-final.json.gz).
Esta equivalencia técnica no acredita precisión editorial sobre el corpus
reservado del contrato.

**Identidades y procedencia.** Los contratos completos incluyeron el ciclo de
identidades externas con historial/API, deshacer y rehacer, protección de
decisiones posteriores, migración/reversión/reaplicación y separación entre
captura y relectura. La lectura archivada rechazó bytes cuyo hash no coincidía.
La recuperación de identidades históricas continúa dependiendo de instantáneas
reales: los [conteos previos](../verification/historical-snapshot-coverage.json)
no permiten atribuir restauración completa a operaciones que no las guardaron.

**Fechas parciales.** El parser admite año, mes, día, aproximación e intervalos,
valida calendario y evita proyectar un día desconocido a una columna DATE.
Sus 27 pruebas unitarias aprobaron. Las tres pruebas web verificaron formato y
edad desconocida cuando falta precisión. La ficha y su CSS reales se inspeccionaron
en navegador a **1440 y 390 px**, con datos/API controlados: muestra
«mayo de 1973» y «2020», sin día ni edad inventados; cero errores JavaScript y
cero overflow del documento. [Resultado](date-visual/browser.json),
[escritorio](date-visual/date-precision-1440.png),
[móvil](date-visual/date-precision-390.png).
Esta comprobación de presentación no demuestra persistencia mediante la API,
accesibilidad completa ni sesiones con usuarios.

## Conservación y entorno publicado

Una lectura consistente y de solo lectura confirmó **12/12 tablas canónicas
idénticas** y los cuatro artistas intactos respecto al control anterior.
[Comparación](catalog-conservation.json), [instantánea](catalog/catalog.json).
No demuestra conservación de todas las tablas auxiliares.

La base real continúa en `0057_integrity_reconciliation`: **0058/0059 no están
aplicadas**. El doctor del código candidato contra esa base terminó con código
1 por `journal.triggers`: falta el registro completo de
`ingest.genre_external_identities`. Los demás controles no fallaron; conserva
el aviso de límites históricos de claims. [Registro](doctor-live-candidate.log).
El doctor de la versión candidata detecta una preparación pendiente del entorno;
no se atribuye ese resultado a una ejecución del código publicado anterior.

Esta revisión no aplicó migraciones, reinició servicios ni publicó el sitio.
El build web escribió `web/dist`; el servicio publicado usa `web/dist-public`.

## Lo que impide cerrar la etapa

- **E1-01:** falta el corpus etiquetado exigido (40 fichas, 300 positivos,
  100 negativos, 100 imágenes, 120 documentos), el respaldo de aplicación
  completo y la línea base de uso. El archivo de casos actual identifica cuatro
  artistas; no equivale a ese corpus. El script de preservación de aplicación
  todavía excluye, por su selección de rutas/extensiones, `web/server.mjs` y
  recursos públicos fuera de medios. Los respaldos/restauraciones de base y
  medios ya documentados no resuelven esa cobertura de aplicación.
- **E1-02:** hay una pasada técnica local completa sobre la misma versión;
  falta CI aprobada y aceptación de los casos del corpus obligatorio.
- **E1-03:** concurrencia corregida y verificada en el candidato; falta aplicar
  y comprobar el resultado en el entorno correspondiente. Los límites
  históricos declarados no se presentan como fuentes reconstruidas.
- **E1-04:** el parser y la presentación son una base parcial. La API de escritura
  aún exige `AAAA-MM-DD`, el formulario usa `type="date"` y las columnas canónicas
  siguen siendo DATE. El contexto de investigación aún contiene la construcción
  `${limit.year}-01-01`. Faltan integración persistente de precisión/períodos,
  persona/identidad musical, obra/edición/soporte, ámbitos de género y sello por
  edición, con conservación, reversión y reaplicación.
- **E1-05:** falta el inventario persistente de hechos/evidencias por destino,
  valor, edición/período, fuente, fragmento, captura, método y estado. El down de
  0059 elimina los metadatos del caché; su prueba de reversión no demuestra
  conservación de esas evidencias. Se necesita conservación persistente antes
  de acreditar ese requisito.
- **Validación humana:** solo el usuario está disponible. No se atribuyen ocho
  participantes, revisión editorial independiente ni aceptación realizada.

La [revisión anterior](../VERIFICACION.md) conserva los fallos y resultados de
la versión anterior. Este informe actualiza el estado técnico sin declarar
completa la etapa ni la validación humana.
