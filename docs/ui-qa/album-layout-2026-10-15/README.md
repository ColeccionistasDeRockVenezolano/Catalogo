# Orden de las fichas de álbum

El bloque inicial comparte el mismo orden en todos los álbumes:

- Ficha a la izquierda: portada completa, título, artista, etiquetas, descripción íntegra y datos básicos.
- Columna derecha: plataformas disponibles, reproductor conservado y lista de pistas.
- Debajo de ambas columnas: administración, alias, detalles de edición y series, créditos, versiones, formatos, videos relacionados y fuentes/historial, según los datos y permisos existentes.

En móvil las columnas se apilan en el orden de lectura del documento. No se recorta la descripción ni se introducen todavía el botón de expandir o el visor de imágenes, pendientes de la conversación solicitada.

## Comprobaciones

- Build de producción y TypeScript.
- Prueba de navegador: `./scripts/with-node22.sh node web/tests/visual/album-player-qa.mjs`.
- Escenarios de 1440, 768, 390 y 320 px, más administración a 390 px.
- Reproducción desde una pista, sincronización, pausa/final, errores, navegación con video flotante, teclado y créditos por pista.
- Plataformas sin video: cambio Spotify/Deezer, enlace externo a Bandcamp, descripción completa y detalles de edición conservados.
- Sin plataformas ni video: estados vacíos y pistas sin controles de reproducción ficticios.
- Duración parcial identificada cuando faltan duraciones de pistas.
- Retícula y secciones inferiores en su orden, sin desbordamiento horizontal de página.

Las capturas usan el álbum real «Indeleble» (262), con sus 11 pistas y duración registrada de 40:28. El iframe de YouTube se sustituye por una pantalla de prueba para que anuncios y disponibilidad externa no alteren la comprobación visual. El catálogo no se modifica.

El detector de diseño solo señala la imagen cuyo `src` viene del objeto `mediaImage(...)`: es un falso positivo del análisis estático. La imagen se muestra únicamente cuando existe `coverUrl`, y se verificó su descarga y decodificación en el navegador.

El diseño material del fondo y las cajas de la referencia queda pendiente de conversación: negro mate, grano fino de contraste bajo, cajas carbón con bordes finos y luz interior suave, radios moderados y rojo en selección/reproducción.
