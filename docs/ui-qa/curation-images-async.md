# Curaduría de imágenes y avisos · primera publicación de 2026-10-24

**Registro de la primera versión.** La cola del navegador descrita aquí fue
sustituida por la [cola persistente del servidor](../IMAGE_CURATION_QUEUE.md).
La prueba `image-curation-qa.mjs` ahora usa una API y PostgreSQL desechables y
comprueba cerrar el navegador y volver. La evidencia original de esta primera
publicación permanece intacta.

Publicado en `/crv/curaduria/imagenes` con `scripts/deploy.sh` (solo frontend).

## Cambios comprobados

- Elegir una candidata o conservar las actuales retira las fichas inmediatamente. La cola mantiene hasta tres solicitudes simultáneas, evita decisiones duplicadas y prioriza decisiones sobre mediciones pendientes. Las operaciones de una misma ficha se ejecutan por turno.
- La cola continúa al navegar dentro del catálogo. La actividad distingue operaciones en cola, en proceso, completadas y fallidas. Un fallo recupera la ficha y permite reintentar; un conflicto pide revisar los datos actualizados. Deshacer vuelve a mostrar las candidatas.
- Medir calidad ya no desactiva todas las decisiones. Las mediciones se dividen por ficha y las selecciones siguen disponibles.
- El estado vacío distingue guardados pendientes de una bandeja terminada. La paginación se conserva en la URL; cambiar de pestaña no muestra resultados del tipo anterior. Se conserva el foco al avanzar y se reinicia el estado de una miniatura cuando cambia su URL.
- Los avisos admiten arrastre hacia arriba, abajo, izquierda y derecha, con ratón y con eventos táctiles reales de Chromium. Un gesto corto vuelve al punto de origen. Se mantienen cierre, acción, Escape, pausa y movimiento reducido.
- Cerrar un aviso de cambio ya no absorbe el siguiente aviso de éxito. El botón de cierre permanece accesible sin hover. El límite de tres cierra los avisos sobrantes, sin retener notificaciones invisibles.

La cola vive en esta pestaña del navegador: permite navegar dentro de la aplicación, pero debe terminar antes de cerrar o recargar. La pantalla lo explica y protege la salida con trabajos pendientes. Las descargas y la validación de archivos siguen a cargo de la API existente; cada guardado conserva su historial y Deshacer.

## Verificación

Playwright a 1440 y 390 px:

- `web/tests/visual/image-curation-qa.mjs`: doble clic, límite de concurrencia, decisiones inmediatas, navegación con trabajo pendiente, error y reintento, mediciones, conflicto 409, lote, deshacer, pestañas, desbordamiento y protección de salida.
- `web/tests/visual/toast-feedback-qa.mjs`: cuatro direcciones con ratón y touch/CDP, gesto corto, cierre, acción, Escape, límite, cierre seguido de nuevo éxito, pausa del temporizador y movimiento reducido.
- `web/tests/visual/image-curation-published-qa.mjs`: bundle servido en la URL pública, dos decisiones mientras las respuestas permanecen retenidas, recuperación de error y arrastre a la izquierda. La sesión y **todas las escrituras** están interceptadas en el navegador; ninguna prueba altera el catálogo real.
- `web/tests/visual/image-uploads-qa.mjs`: ocho superficies de subida por tamaño de pantalla; selector, drag/drop, CSRF, guardado, errores, cancelación y reintento. Se actualizaron los selectores a «Guardar cambio», se distingue el formulario de los avisos con rol diálogo y se simula la lectura de versión de caché.

TypeScript del frontend, ESLint de los archivos afectados, comprobación de espacios y build público correctos. Web y API activas; ruta pública y salud responden HTTP 200. La API no se reinició.

La evidencia se capturó primero en SSD y se publicó con verificación SHA-256 en `reports/image-curation-async-2026-10-24/`: capturas anteriores, actividad, avisos, subidas y pantalla publicada; `baseline.json`, `checks.json`, `toast-checks.json` y `published-checks.json` registran los resultados. Las medidas de respuesta de 58 y 65 ms corresponden al entorno local con respuestas simuladas, no a la duración de una descarga real.

Para repetir las pruebas, abrir una campaña nueva con `python3 scripts/staging.py new reports <campaña>`, asignar su ruta SSD a `CRV_QA_OUT`, ejecutar los scripts mediante `scripts/with-node22.sh node` y publicar con `python3 scripts/staging.py publish reports <campaña> --hash`. La prueba de subidas requiere un servidor Vite local en `CRV_WEB_URL`; las dos pruebas nuevas locales lo levantan y cierran automáticamente.
