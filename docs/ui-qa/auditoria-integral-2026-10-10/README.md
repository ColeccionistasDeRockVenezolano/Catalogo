# Evidencia de auditoría integral · 10 de octubre de 2026

[Informe completo](../../EVALUACION_INTEGRAL_SISTEMA_2026-10-10.md) · [Galería de capturas y puntajes](index.html)

La evaluación incluye Jeremías (6912), Apache (1681), La Banana Voladora (1212) y Caramelos de Cianuro (58), fichas de persona/disco/organización, búsqueda y listados, curaduría, IA, imágenes, duplicados, correcciones, autocorrección e historial.

## Método

Frontend publicado: `http://127.0.0.1:3120/crv/`. Lecturas públicas sobre API publicada. Administración con sesión simulada y rutas actuales de Fastify mediante `app.inject`; datos reales con `default_transaction_read_only=on`. Recuperación de trabajos al arrancar suprimida únicamente en el proceso de auditoría. POST/PATCH/DELETE bloqueados en el navegador. Ninguna ficha modificada; ninguna nueva llamada de IA pagada. Pruebas de escrituras en PostgreSQL desechable.

No es un estudio con usuarios humanos, una certificación completa de accesibilidad ni una prueba de carga/penetración. Algunas capturas iniciales preceden a la finalización de consultas; la pasada adicional esperó la carga del contenido y aporta las mediciones pertinentes. El workspace tenía cambios previos y concurrentes, conservados.

## Archivos

- `browser-evidence.json`: 66 registros de la pasada inicial; escritorio y móvil, visitante y administrador simulado, DOM, imágenes, errores, controles y axe.
- `supplemental-evidence.json`: 25 registros adicionales y 14 interacciones; los otros artistas, teclado, plan 11, ruta de pista, búsqueda y 320 px.
- `focused-browser-evidence.json`: organización válida, error 500/reintento controlado, recurso fallido seleccionable, portada en cola de fotos y estado interno de descubrimiento.
- `data-evidence.json`: consultas SELECT al catálogo, informes, propuestas, imágenes y esquema. La transacción de consulta fue de solo lectura.
- `context-evidence.json`: presupuesto de contexto, pendientes que pierden citas y dos pruebas sintéticas de relevancia documental insuficiente.
- `context-and-data-supplement.json`: tres peticiones focalizadas de Jeremías, nacimiento estructurado, estado actual de La Banana y tabla de autocorrección.
- `scores.json`: 29 puntuaciones expertas del 1 al 20; media 11,93, redondeada a 12; recorrido de enriquecimiento 8/20.
- `*.png`: 93 capturas, incluidas las focalizadas. Los nombres indican rol, ruta y ancho.
- `*.log`: resultados y extractos de pruebas. `contract.log` contiene los ocho fallos de la primera pasada; `recheck.log` documenta 14 pruebas focalizadas aprobadas, incluidos dos de esos fallos. No se presenta la suite completa como aprobada.
- `design-detector.json`: tres advertencias heurísticas revisadas como decisiones de diseño intencionales.
- `axe-4.10.3.min.js`: distribución de axe-core 4.10.3 obtenida de CDNJS; conserva su aviso de licencia. Se guarda la versión usada para reproducir la auditoría.

## Reproducción de navegador

Desde la raíz del repositorio, con dependencias instaladas, Chromium de Playwright disponible, PostgreSQL real accesible por `.env` y la web publicada en el puerto 3120:

```bash
./scripts/with-node22.sh ./node_modules/.bin/tsx web/tests/visual/full-system-audit.ts
```

La pasada inicial sobrescribe `browser-evidence.json` y sus capturas. Para la pasada adicional:

```bash
CRV_AUDIT_BROWSER_SCRIPT="$PWD/docs/ui-qa/auditoria-integral-2026-10-10/supplemental-browser.mjs" ./scripts/with-node22.sh ./node_modules/.bin/tsx web/tests/visual/full-system-audit.ts
```

Para las interacciones focalizadas:

```bash
CRV_AUDIT_BROWSER_SCRIPT="$PWD/docs/ui-qa/auditoria-integral-2026-10-10/focused-browser.mjs" ./scripts/with-node22.sh ./node_modules/.bin/tsx web/tests/visual/full-system-audit.ts
```

Para repetir la preparación focalizada del contexto y consultar los datos auxiliares sin llamar a IA:

```bash
./scripts/with-node22.sh ./node_modules/.bin/tsx docs/ui-qa/auditoria-integral-2026-10-10/context-and-data-supplement.mjs
```

El harness realiza lecturas costosas como la carga del índice de búsqueda y resúmenes de curaduría. Sus protecciones deben revisarse si cambian las tareas de recuperación o las escrituras al arrancar la API; PostgreSQL rechaza las escrituras restantes. Se genera un bearer aleatorio solo para el proceso aislado, que no se imprime ni se instala en la API publicada.

Para repetir la consulta de datos, que abre una transacción de solo lectura:

```bash
./scripts/with-node22.sh node docs/ui-qa/auditoria-integral-2026-10-10/data-audit.mjs
```

Para repetir los cuatro contextos generales y las dos pruebas sintéticas del control documental:

```bash
./scripts/with-node22.sh ./node_modules/.bin/tsx docs/ui-qa/auditoria-integral-2026-10-10/context-audit.mts
```

## Interpretación de los resultados

Primera pasada: unitarias backend 718/719; web 42/42; contratos 438/446. Repetición focalizada 14/14. Tipos backend inicialmente fallaron y finalmente aprobaron; tipos/build web aprobaron. Lint final 27 errores. `doctor` detecta problemas de cobertura de auditoría e identidades externas, además de cambios sin run.

No se infiere la verdad de un hecho de la cantidad de fuentes, de un puntaje documental alto o del éxito de una transacción. Los datos sintéticos de la prueba de respaldo insuficiente nunca se importaron al catálogo real. Los informes antiguos de Apache, La Banana y Caramelos no usan las reglas vigentes del informe de Jeremías.
