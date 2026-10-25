# QA: tiempos y reproducción de las pistas CRV

Se corrigió la lectura pública de marcas guardadas por video y la sincronización de capítulos con pistas musicales existentes. La consulta oficial de YouTube comprobó 657 referencias, con 655 respuestas y dos videos ausentes; se actualizaron trece descripciones/títulos cambiados. El inventario individual está en [el informe](../../../reports/youtube-track-playback-2026-10-15.md).

Resultado: 64 tiempos recuperados en seis discos (Candy66, Telegrama, Mermelada Bunch, Franco De Vita, Ilan Chester y Gasolina). La reparación añadió 29 asociaciones por título/alias exacto; las otras 35 ya existían. No se crearon canciones ni se trasladaron marcas entre videos. El cero y los CD/lados con video propio tienen cobertura de contrato. La marca de más de doce horas de «Shing A Ling Rub A Dub» quedó en revisión y no se presenta como salto reproducible, tampoco en Audiovisuales.

Las 97 pistas restantes sin marca identificable corresponden a títulos no presentes en esa descripción o a otro CD, versión o repetición sin capítulo propio. No se dedujeron tiempos de sus duraciones.

## Comprobaciones

- 71 pruebas de unidad y contrato: selección del video, marcas existentes sin campo histórico, cero, repeticiones, segundo CD, cambio de principal, video bloqueado, hidratación de conciertos, alias exactos, idempotencia y conservación de las pistas. Suite API de lectura y pipeline aprobadas.
- Contrato de Audiovisuales: 4 pruebas adicionales, incluyendo omisión de un capítulo fuera de la duración y conservación de los válidos.
- Build público de frontend y comprobación TypeScript focalizada de backend, script y contrato aprobados.
- ESLint de los archivos afectados aprobado.
- Chromium con datos reales del catálogo: cada uno de los 64 botones recuperados en escritorio 1440×1000 y móvil 390×844. Se verificaron 128 órdenes de seek/play, el video de destino, un solo iframe, ausencia de overflow horizontal y ausencia de errores de página.
- La API de reproducción se simuló; el informe no certifica reproducción externa regional ni ausencia de anuncios. El código de las pruebas está en `web/tests/visual/youtube-track-playback-qa.mjs`; [resultado](browser-qa.json).
- API y web publicadas en la instancia local, salud del gateway comprobada y análisis completo de curaduría ejecutado con las reglas publicadas.

No se cambió la composición visual: el tiempo recuperado habilita los controles existentes del listado de pistas. Fuente técnica y reglas: [YOUTUBE_TRACK_PLAYBACK.md](../../YOUTUBE_TRACK_PLAYBACK.md).
