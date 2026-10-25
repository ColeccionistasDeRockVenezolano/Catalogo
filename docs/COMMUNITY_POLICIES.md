# Páginas de comunidad y condiciones de CRV

Edición inicial del texto: 20 de octubre de 2026.

Las tres páginas públicas son `/terminos`, `/privacidad` y `/ayuda`.
Los términos reúnen autoría, aportes, uso del sitio y aviso de menores.
Ayuda y comunidad reúne preguntas frecuentes, aportes, reglas y contacto.
Las antiguas rutas `/derechos-de-autor`, `/reglas`, `/preguntas-frecuentes`
y `/apoyar` redirigen a la sección correspondiente, incluidas sus anclas.
React Router respeta
el prefijo de publicación (`/crv/`). El pie compartido se monta en `Layout`,
también durante cargas y errores de las páginas, y sustituye el pie exclusivo
de Home. Conserva los enlaces del blog, Instagram y YouTube. La información
del antiguo diálogo «Sobre el archivo» está en `/ayuda#archivo`.

Los textos se mantienen en `web/src/pages/communityContent.tsx` y su selección
y presentación en `web/src/pages/CommunityPage.tsx`. El registro de
rutas, etiquetas y contacto está en `web/src/lib/communityPages.ts`.
La fecha de edición es fija: no corresponde a una selección diaria.
El pie tiene una sola lista de tres enlaces de ayuda y condiciones, junto con
los canales externos existentes. No duplica una lista legal y otra comunitaria.

## Organización y lectura

Se conservan la tipografía y los tokens de CRV. Las tres pestañas usan el
acento de selección del sitio. Las condiciones y la privacidad permanecen
visibles como texto continuo; las dudas y los criterios editoriales de ayuda
son desplegables nativos accesibles por teclado. Un enlace directo a una
pregunta abre la respuesta antes de desplazarla a la vista.

El índice de secciones permanece a la izquierda en escritorio, con altura
acotada al viewport. En móvil empieza plegado, permitiendo acceder a las
preguntas desde la primera pantalla; elegir una sección lo cierra y lleva al
destino sin taparlo bajo la cabecera.

## Decisiones de contenido

- Finalidad cultural y sin fines de lucro, conforme a la indicación de Brian.
  No se presenta al proyecto como una entidad jurídica registrada ni se inventan
  domicilio, correo, donaciones, publicidad propia o afiliaciones comerciales.
- Obras ajenas: reconocimiento de titularidad y revisión de atribución,
  corrección, restricción o retirada. La finalidad promocional no es una
  autorización general de uso.
- Aportes: licencia no exclusiva para preservación y difusión cultural,
  manteniendo titularidad, crédito y derechos irrenunciables. Antes de publicar
  una colaboración original, el equipo debe comunicar las condiciones y obtener
  aceptación verificable. No se presume permiso por recibir un mensaje privado
  ni por publicar términos nuevos sobre aportes históricos. La web no incorpora
  un registro público ni un flujo de aceptación automática.
- Ideas: permiso para implementar sugerencias voluntarias sin promesa de pago,
  propiedad o exclusividad, preservando reclamos por usos no autorizados.
- Menores: aviso visible en el pie y sección específica en términos. Supervisión
  a cargo de representantes y limitación de responsabilidad en lo permitido por
  ley. No se incorpora un control de edad ni se afirma verificar edades.
- Contacto: perfil de Instagram ya utilizado por CRV. Es un canal externo bajo
  condiciones de Meta; no se publica un correo inventado.

La privacidad refleja consulta pública sin registro, cuentas autorizadas,
cookie de sesión, almacenamiento funcional del navegador, métricas propias,
investigación con herramientas de IA y plataformas externas. Los plazos de
búsqueda se contrastaron con `src/search/observability.ts` y
`src/api/search-misses.ts`; se distingue el tratamiento técnico de IP de su
ausencia en los registros de búsquedas. No se promete que todos los terceros
carezcan de cookies ni que los reproductores sean anónimos.

## Referencias consultadas

Como referencia de organización y temas, sin copiar condiciones de otro sitio:

- https://www.metal-archives.com/content/pp
- https://www.metal-archives.com/content/faq
- https://www.metal-archives.com/content/support
- https://www.metal-archives.com/content/rules
- https://www.metal-archives.com/content/help

Las páginas que devolvieron 403 se consultaron también mediante resultados
indexados y variantes públicas `/content/rules/tab/1` y `/content/help?index=2`.
La información de sus cuentas, géneros admitidos, jurisdicción y afiliaciones
no se trasladó a CRV.

Referencia de principios generales sobre ideas, expresión, permisos,
derechos morales y obras en internet:
https://www.wipo.int/en/web/copyright/faq-copyright

Los textos son una implementación editorial adaptada al proyecto, no un
dictamen sobre la legislación aplicable a todos sus visitantes. Si cambian
el responsable, alojamiento, proveedores, canales de contacto, monetización
o funciones de cuenta, revisar el contenido y su adecuación jurídica.

## Verificación

Desde `web/`, con el servidor de desarrollo disponible:

```sh
npm run build
node tests/visual/community-pages-qa.mjs
```

El script admite `CRV_WEB_URL` (incluido un prefijo `/crv`) y `CRV_QA_OUT`.
No inicia sesión ni escribe en el catálogo. Verifica las rutas, enlaces del
pie, títulos, anclas directas y navegación en varios anchos. Las capturas
se guardan por defecto en `docs/ui-qa/community-simplified-2026-10-20/`.
Las capturas de `community-2026-10-20/` corresponden a la primera propuesta de
siete páginas y se conservan como evidencia de esa iteración anterior.
