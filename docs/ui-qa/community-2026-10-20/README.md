# Comunidad y políticas de CRV

Verificación local del 20 de octubre de 2026.

## Resultado

- `npm run build`: correcto, incluidos TypeScript y Vite. Vite informa su
  advertencia sobre el tamaño del paquete principal; no impide compilar.
- `node tests/visual/community-pages-qa.mjs`: correcto. Siete rutas públicas,
  pie único en las páginas de comunidad, Home, Efemérides y Radio, enlaces,
  títulos, anclas directas y navegación. Sin errores JavaScript ni
  desbordamientos horizontales en 320, 390, 768, 1280 y 1440 px.
- Detector de interfaz sobre CommunityPage, SiteFooter y community.css:
  sin hallazgos.
- Revisión visual independiente de las seis capturas y el código:
  `ship`, sin hallazgos materiales dentro de ese alcance. Como mejora
  opcional se identificó la posibilidad de plegar el índice largo de FAQ
  en móvil. La revisión no constituye un dictamen legal.

## Capturas

- `desktop-terms.png`: términos completos e integración del pie global.
- `desktop-faq.png`: preguntas frecuentes y su índice.
- `desktop-minors.png`: acceso directo a la advertencia sobre menores.
- `mobile-copyright.png`: derechos de autor completos a 390 px.
- `mobile-minors.png`: ancla de contenido sensible a 390 px.
- `mobile-footer.png`: enlaces legales y aviso del pie a 390 px.

Las capturas completas pueden mostrar la barra inferior móvil en la posición
de captura de pantalla; la barra es fija en la interfaz. El texto puede
desplazarse por encima de ella y el pie reserva espacio inferior.

La implementación conserva el sistema visual existente: Anton para el título,
Inter para lectura, tokens compartidos de color y separadores discretos.
El índice se sitúa a la izquierda en escritorio y precede al texto en móvil.
No se cambia el sistema de diseño global.

Consulta [las decisiones y referencias de contenido](../../COMMUNITY_POLICIES.md).
