# QA de Audiovisuales · 2026-10-15

Extensión local de las fichas de artistas: nueva pestaña separada de la discografía, con filtros, reproducción compartida, capítulos y descripción/créditos. Se conservaron el diseño, los tokens y las pestañas existentes.

- Inventario final: 51 audiovisuales en 37 perfiles; 4 documentales, 19 conciertos/sesiones, 17 videoclips y 11 shorts.
- Migración comprobada por API: Viniloversus / Tiempo Nos Queda, Zapato3 / Detrás De La Puerta Cangrejo & Kreils / Live Sessions At ViveConCancha y Hana Kobayashi / Smells Like Teen Spirit figuran en Audiovisuales y dejaron la discografía. Gasolina / Blues Criollo permanece como disco con cinco pistas.
- Pruebas de unidad y contrato: 67 casos aprobados; tras afinar el envío a revisión de videos sin tipo, se repitieron los 23 casos afectados y aprobaron.
- Build público y comprobación TypeScript de frontend aprobados. Comprobación TypeScript de src, el script y las pruebas de este cambio aprobada. La comprobación general del repositorio detectó un error previo ajeno a esta tarea en scripts/harvest-social-discogs.mts:229 (exactOptionalPropertyTypes sobre discogsId).
- ESLint de los archivos TypeScript y TSX afectados aprobado.
- Navegador real: Chromium, escritorio 1440×1000 y móvil 390×844. Filtros, flechas de teclado, salto al capítulo de 246 segundos, un único reproductor persistente entre pestañas, sin desbordamiento horizontal ni errores de página.
- Datos de la API local reales. Solo la API de reproducción de YouTube se simuló para verificar las órdenes y evitar anuncios o bloqueos externos: no se certifica reproducción externa real.
- Verificados los estados vacío (Gasolina) y disponibilidad sin verificar (Zapato3); el contrato además cubre video privado y obra sin video.
- Detector Impeccable ejecutado una vez en componente y CSS nuevos: sin hallazgos. Revisor independiente: `disposition: ship` para esta extensión local; sin correcciones materiales.
- Migración 0076 aplicada; API y web reiniciadas; salud del gateway y nuevo inventario comprobados. Análisis completo de curaduría ejecutado después de publicar las reglas.

Las capturas de esta carpeta muestran la sección nueva. Las capturas completas de la ficha (incluido el bloque Spotify preexistente, dependiente de un iframe externo) se conservaron en `.impeccable/review/desktop.png` y `mobile.png` para el revisor. La revisión se limita a esta extensión y no certifica las áreas preexistentes de la ficha.

Inventario y fuentes: [informe](../../../reports/audiovisuales-2026-10-15.md), [reglas](../../AUDIOVISUALS.md).
