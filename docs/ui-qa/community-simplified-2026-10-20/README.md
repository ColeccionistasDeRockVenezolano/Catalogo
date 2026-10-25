# Comunidad: simplificación a tres páginas

Se reúnen las siete páginas iniciales en Términos de uso, Política de
privacidad y Ayuda y comunidad. El pie muestra esos tres enlaces en una sola
lista, junto con los canales externos existentes.

La guía Impeccable orientó la reducción de opciones y la lectura progresiva:
el índice queda visible en escritorio y plegado en móvil; las preguntas y
los criterios editoriales usan desplegables nativos. Los textos legales
permanecen visibles. La tipografía, los colores y la selección de pestañas
siguen los tokens de CRV.

`node tests/visual/community-pages-qa.mjs` pasó: tres rutas, diez casos de
redirección con anclas, pie único, navegación por teclado, apertura de
preguntas mediante URL, cierre del índice móvil y ausencia de errores JS
y desbordamientos en 320, 390, 768, 1280 y 1440 px. El detector de interfaz
no registró hallazgos.

`npm run build` pasó TypeScript y Vite. Se mantiene la advertencia de Vite
sobre el tamaño del paquete principal; no impide generar la aplicación.

Las capturas muestran términos y ayuda completos en escritorio, ayuda en
móvil, apertura directa de una pregunta, aviso de menores y pie móvil.
Se inspeccionaron las siete imágenes en una ronda visual. No se detectaron
defectos materiales en esas capturas.

Las pruebas son de navegación y presentación; no son una revisión jurídica.
Consulta [las decisiones de contenido](../../COMMUNITY_POLICIES.md).
