# Audiovisuales de artista · aplicación local del sistema

Fecha: 2026-10-15. Alcance: extensión de la ficha de artista existente.

La implementación conserva la dirección «El Archivo en Operación» de `DESIGN.md` y el contexto de consulta y conservación de `PRODUCT.md`. Esta nota documenta su aplicación local. No establece una identidad nueva ni modifica el sistema global, sus tokens o su sidecar.

## Implementación observada

- `web/src/pages/ArtistDetailPage.tsx` incorpora «Audiovisuales», con conteo, inmediatamente después de «Discografía», dentro del componente de pestañas existente.
- `web/src/components/ArtistAudiovisuals.tsx` presenta las piezas como una lista plana. Tipo y año preceden al título; las acciones de reproducción y el enlace externo permanecen junto al contenido. El filtro usa botones compartidos con conteos y `aria-pressed`; aparece cuando hay más de un tipo registrado.
- `web/src/styles/audiovisuals.css` dispone miniatura y texto en dos columnas en escritorio: arte entre 180 y 280px, separación de 24px y contenido flexible. Hasta 600px pasa a una columna, con separación de 16px. Las miniaturas conservan proporción 16:9 y esquinas de 8px; las filas se separan por bordes discretos y 24px de espacio vertical.
- «Capítulos y canciones» y «Descripción y créditos» usan detalles desplegables nativos. Las marcas de tiempo reproducen el audiovisual desde el segundo registrado; no representan altas de pistas musicales.
- La reproducción usa `useVideoPlayer` y `VideoSlot`, con propietario por artista, dentro del reproductor global existente. No incorpora iframes por fila. Si hay capítulos, estos forman la secuencia del audiovisual; en su ausencia, la secuencia reúne los audiovisuales reproducibles.

## Relación con el sistema existente

La paleta usa las variables compartidas `--red`, `--red-soft`, `--border`, `--text`, `--text-muted` y `--surface-2`. El rojo señala selección y respuesta de reproducción; el resto de la lista conserva la superficie oscura del catálogo. Las filas no añaden sombras permanentes ni contenedores anidados, en coherencia con «The Flat-at-Rest Rule».

La tipografía hereda la interfaz existente. Los títulos de pieza usan 18px, los metadatos 13px y las descripciones 14px con ancho máximo de 72ch; duraciones y conteos usan cifras tabulares. Los textos largos admiten corte dentro de su columna, aplicando «The Viewport Never Expands Rule». La organización por filas y detalles mantiene la densidad interior y el aire entre piezas descritos por «The Density Inside, Air Between Rule».

Los filtros, acciones, resúmenes y capítulos conservan objetivos mínimos de 44px. Las miniaturas tienen nombre accesible en el botón y arte decorativo; los enlaces externos incluyen el título de la pieza. La única transición local cambia el color del control de reproducción durante 150ms y se desactiva con `prefers-reduced-motion`.

Los estados distinguen «Sin audiovisuales registrados», «Sin video disponible», «Video bloqueado», «Video no disponible» y «Disponibilidad sin verificar». Una obra no reproducible conserva título, metadatos, descripción y enlace cuando existen. Los capítulos interactivos se presentan únicamente cuando la pieza es reproducible. Esta separación conserva evidencia sin atribuir disponibilidad confirmada a un video no verificado.

## Evidencia y límites de verificación

Se inspeccionaron el código de los tres archivos de la extensión, los tokens compartidos, `DESIGN.md`, `PRODUCT.md` y las capturas:

- `.impeccable/review/desktop-audiovisuales.png` (1440 × 1000): lista horizontal, filtros con conteos y detalles subordinados.
- `.impeccable/review/mobile-audiovisuales.png` (390 × 844): miniatura sobre el texto, controles con espacio táctil y navegación móvil heredada.

El informe existente `.impeccable/review/audiovisuales-qa.json` registra filtros, salto de capítulo a 246 segundos, reproductor compartido, pestañas por teclado, ausencia de overflow y de errores de página en ambos tamaños. También registra estados vacíos/no verificados, migración y conservación de la excepción de Gasolina. La API del reproductor se simuló en esa prueba: sus resultados verifican la interacción de la interfaz, no la disponibilidad real de YouTube. Esta pasada documental no ejecutó pruebas nuevas ni modificó datos.

La revisión independiente comunicada por el agente principal concluyó `ship`, sin correcciones requeridas para esta extensión local.

No se canonizan como reglas generales la proporción de las miniaturas, el breakpoint de 600px, la composición de estas filas ni sus tamaños particulares: son decisiones locales de esta superficie, no cambios autorizados del sistema de diseño.
