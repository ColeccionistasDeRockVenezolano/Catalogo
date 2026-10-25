# Carbón y Estudio · 15 de octubre de 2026

Extensión de la apariencia del catálogo. Actual conserva sus tokens y composición; Home sigue recibiendo `data-catalog-theme=current` antes de pintar cada navegación. El único ajuste solicitado en su navegación es texto «Home» en escritorio y solo el icono de casa en teléfono, con nombre accesible «Home».

Carbón conserva negro mate, grano sutil y carmesí. Mejora la separación de superficies, la legibilidad secundaria, los controles circulares de reproducción, la selección persistente de pistas y el foco de teclado. Estudio usa grafito cálido, texto marfil, acentos champán, portadas con esquinas discretas y títulos de ficha en Inter. Ambos mantienen contenido, estructura y comportamiento. Los colores originales de plataformas y los estados de peligro conservan su significado.

Los tres temas aparecen en Configuración → Temas. Elegir una opción no la publica: requiere «Aplicar tema al catálogo». La preferencia sigue siendo global, con lectura pública y escritura exclusiva de administrador con CSRF. La migración 0075 amplía la restricción sin cambiar el tema activo.

Validación:

- Compilación de producción y comprobación TypeScript completa de backend.
- Contrato de API con PostgreSQL desechable: permisos, CSRF, persistencia de Carbón/Estudio/Actual, atribución y rechazo de valores desconocidos.
- QA de navegador a 1440, 768, 390 y 320 px: selección/aplicación, fallo y reintento, nuevos visitantes, acceso administrador y exclusión de Home, navegación accesible, ausencia de desbordamiento.
- Regresión del visor: zoom, rueda, arrastre, ajuste, tamaño real, doble clic, foco contenido/restaurado, errores y pellizco móvil.
- Reproducción simulada en ambos temas, cinco escenarios por tema: 1440, 768, 390, 320 px y administración con movimiento reducido. Comprueba que el hover no elimina la selección y que el control activo alcanza contraste de 4.5:1.
- Detector de diseño sobre archivos editados: sin hallazgos mecánicos.

Revisión independiente de acabado: `ship` para los cinco hallazgos puntuados, todos resueltos (contraste de hover, persistencia de selección, aplicación con mínimo de 44 px, documentación y capturas estabilizadas).

Las capturas `album-carbon-*`, `album-estudio-*`, `temas-*` y `temas-estudio-*` comparan ambas apariencias con datos reales. Los archivos `*-viewport-*` muestran el primer pantallazo. Las capturas esperan fuentes y transiciones; solo ocultan avisos temporales de guardado para comparar la apariencia estable. Los iframes externos se sustituyen por un reproductor vacío de prueba; no verifican reproducción remota. En capturas móviles de página completa, la navegación fija se ve en la posición del viewport capturado.

El trabajo queda local, sin aplicar migraciones ni cambiar la configuración de visitantes en el servidor publicado. Para publicar hacen falta las migraciones pendientes 0074–0075 y el despliegue de API y web.
