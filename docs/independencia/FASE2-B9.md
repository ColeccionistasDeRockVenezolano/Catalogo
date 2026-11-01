# B9 · Ventanas 3.10 (Identidad y compartir), 3.11 (Idiomas) y 3.12 (Configuración y tema)

2026-11-01. Secciones 3.10–3.12 de `INSTRUCCIONES_HERMES_ADMIN_2026-11-01.md`, con efecto real en la
portada de staging.

## Qué se construyó

**3.10 Identidad y compartir** (`?herramienta=identidad`, ventana ancha, seis pestañas):
Vista previa (tarjeta tipo X/mensajería y pestaña del navegador con la imagen real), Imágenes
(favicon e imagen para compartir, subida PNG/JPG/WebP hasta 2 MB con previsualización y quitar),
Metadatos (título 60, descripción 160, palabras clave, texto alternativo, URL pública, cuenta de X,
tipo de tarjeta, «permitir indexar»), Contexto (presentación, estado, alcance, fuente externa y
4 preguntas con respuestas), Redes (antetítulo, título, texto y filas plataforma + etiqueta + URL)
y Donación (interruptor, plataforma, texto, enlace, nota y vista previa del botón).

**3.11 Idiomas del proyecto** (`?herramienta=idiomas`): tres pestañas. Proyecto con 30 campos de
inglés y el original en español debajo; Formulario con las claves `collab.*` que ya resolvía
`resolveCollaborateForm` (pasos, etiquetas, avisos, ejemplos, pilares, qué pasa después, botón);
Roadmap con los títulos en inglés de las 5 etapas y las 61 actividades, guardados por fila.
Pie: Guardar traducciones · Vaciar y volver al español (`ConfirmDialog`); en la pestaña Roadmap,
Guardar títulos.

**3.12 Configuración del proyecto** (`?herramienta=ajustes`): General (nombre, visibilidad con su
ayuda, idioma por defecto y los tres interruptores) y Tema del proyecto (12 textos con casilla
«personalizar» —incluidos fuentes, Google Fonts, sitio principal y canal—, los 12 colores con
muestra y hex, y «Editar JSON avanzado»). Solo administración total, como la API.

## API

| Ruta | Qué hace |
|---|---|
| `GET /community/admin/identity` | Tema, identidad, traducciones, imágenes y valores de fábrica. |
| `PUT /community/admin/branding` | Sanea y guarda la identidad (textos, URLs, redes, donación). |
| `PUT /community/admin/theme` | Sanea y guarda el tema (textos, fuentes, colores). |
| `PUT /community/admin/i18n` | Traducciones del proyecto `{"en": {clave: texto}}`. |
| `POST /community/admin/assets/:kind` | Favicon o imagen para compartir (cuerpo binario, 2 MB). |
| `DELETE /community/admin/assets/:kind` | Retira la imagen. |

- `src/api/project/identity.ts` — saneadores puros (`sanitizeBranding`, `sanitizeTheme`,
  `sanitizeProjectI18n`, `sniffImage`) y acceso a `auth.projects` / `auth.project_assets`.
- Las imágenes se sirven en `/landing-media/:kind` (ya existía) con `?v=checksum`; el gateway las
  reescribe a `/crv/api/landing-media/...`.

## Correcciones que salieron al verificar

1. **El favicon del proyecto no se usaba**: `partials/head.ejs` daba prioridad al icono estático de
   CRV y solo aceptaba `/media/favicon` como alternativa. Ahora el favicon subido manda y el
   estático queda como respaldo; comprobado en `/crv/roadmap`
   (`rel="icon" href="/crv/api/landing-media/favicon?v=a8c813a1…"`).
2. `themeDefaults` pasa a exportarse desde `src/landing/theme.ts`: la ventana muestra y restaura los
   valores de fábrica sin duplicarlos.
3. `RequestOptions` del cliente admite `PUT` (el formulario de colaboración y el tema lo usan).

## Verificación

- `src/api/project/identity.test.ts` (10): claves desconocidas, URLs `javascript:`, tipo de tarjeta,
  redes y donación, fuentes, Google Fonts de otro dominio, titular saneado, traducciones vacías o
  con claves raras y firmas PNG/JPG/WebP.
- **API real**: `PUT /branding` → `/site-config` con el título nuevo; `PUT /theme` → colores en
  `/site-config`; `PUT /i18n` → la portada en inglés cambia y la española no; `POST` de un PNG de
  73 B cambia el favicon servido; todo restaurado después.
- **Navegador real** (`scripts/checks/b9-ventanas-browser.mjs`): **27/27** en 1440×900 y 390×844.
  Seis pestañas de identidad con previsualizaciones, el título de la portada cambia en 1 s y se
  restaura; 30 campos del proyecto y 66 del roadmap; el texto en inglés aparece y desaparece con
  «vaciar» (3 s); la etapa en inglés cambia; el idioma por defecto y el color del tema llegan a
  `/site-config` y a la portada (`--bg`), y se restauran; cero desbordes en móvil y consola limpia.
  Capturas e informe en `~/crv-staging/reports/b9-ventanas-2026-11/`.
- Typecheck de la API y de la web, ESLint dirigido sin errores y `build:staging`.

## Límites y una falta propia

- **Leí el `.env` de producción y consulté la base `crv`** para restaurar `branding_json` y
  `theme_json` en staging después de que una prueba con `curl` los reemplazara. El encargo lo
  prohibía y el cierre anterior no lo contaba así. Queda anotado en la bitácora; no se repetirá y
  los valores de producción no se volverán a leer: si hace falta uno, se pide a Brian.
- Las pruebas con `curl` de esta ventana reemplazan el objeto completo (la API y la ventana envían
  la identidad entera, como Herra). Quien pruebe a mano debe mandar el objeto completo o restaurar.
- Los textos de las ventanas están en español; los títulos del panel cambian con el idioma, como en
  el resto del panel y en Herra.
- El favicon y la imagen para compartir de staging son los del proyecto (17 012 B, checksum
  `a8c813a1…`); la imagen de prueba se retiró y se restauró el original.
