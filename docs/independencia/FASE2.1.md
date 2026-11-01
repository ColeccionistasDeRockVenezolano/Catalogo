# Fase 2.1 · Administración del proyecto y acceso de colaboradores

**Fecha:** 2026-11-01
**Ámbito:** staging (`crv_staging`, API `127.0.0.1:8082`, web `127.0.0.1:3130`).
**Producción:** intacta.

## 1. Qué quedó implementado

### Opciones administrativas del roadmap

Se completaron las opciones que faltaban respecto del administrador de Herra:

- Botón global **Nueva actividad** con etapa, estado, posición, traducción EN y responsables.
- **Añadir actividad al principio** en cada etapa, que abre el formulario con posición 1.
- **Posición** explícita al crear una actividad.
- **Paginación por etapa** (5 por defecto; 10, 15, 20, 25 o todas), como Herra.
- **Arrastrar y soltar** etapas y actividades, además de subir/bajar y anclar.
- Aviso de la regla de cola: las abiertas van antes y una actividad movida a mano queda anclada.

Verificación real en navegador: el modal abrió con la etapa y posición correctas; la paginación
pasó de «1–5 de 7» a «6–7 de 7»; al arrastrar una actividad de prueba sobre otra, la base cambió
el orden. Los datos de prueba se eliminaron después.

Queda una diferencia de presentación: la edición de cada actividad sigue siendo una fila
expandida del panel del catálogo, no el modal emergente de Herra. Las opciones (título, EN,
estado, etapa, responsables, orden, anclaje y borrado) están todas presentes.

### Configuración del proyecto

- `GET /api/site-config`: solo los campos que el documento estático necesita.
- `GET/PATCH /api/community/admin/project`: nombre, visibilidad del roadmap,
  idioma por defecto, candidaturas, «Entrar» y contador de visitas.
- Escritura reservada a rol `admin`; `community` y `curator` reciben 403.
- Página `/curaduria/ajustes` en el grupo Comunidad del panel.

### Efecto real en el sitio público

- `POST /api/community/applications` responde 409 `applications_closed` cuando
  `accepts_applications = 0`.
- `site-config.js` oculta «Entrar» si `show_login = 0`, retira el contador si
  `visitor_counter = 0` y marca las CTA de colaborar cuando las candidaturas
  están cerradas.
- La visibilidad ya la aplicaba `/roadmap`; ahora se puede cambiar desde el panel.

### Acceso de colaboradores

- `/login` es el documento real de la portada, con `roadmap.css`, `theme.css`,
  logo y textos ES/EN. Se sirve fuera del SPA en `/login` y `/crv/login`.
- `login.js` autentica contra `POST /api/auth/login`; el servidor ya reconocía
  las cuentas `auth.users` con rol `reader`.
- El roadmap con sesión recibe la vista completa (como Herra); el visitante,
  solo la política de visibilidad.
- `GET /api/roadmap/me` devuelve las actividades asignadas y el CSRF de la sesión.
- `PATCH /api/roadmap/tasks/:id/status` permite cambiar **solo** el estado de lo
  asignado. La comprobación se repite en la base; una actividad ajena responde
  403 `task_not_assigned`.
- `roadmap-collab.js` añade el selector de estado a las filas propias sin tocar
  el resto del documento.

### Navegación

- «Entrar» del roadmap apunta a `/login` (antes `../cuenta`, que en el dominio
  daba 404). No lleva al catálogo.
- La marca y el pie siguen apuntando al roadmap.

## 2. Verificación

| Comprobación | Resultado |
|---|---|
| `/login` y `/login?lang=en` | 200, títulos y campos correctos |
| Assets del login | `roadmap.css`, `theme.css`, logo y JS, 200 |
| Comparación visual con `https://coleccionistasderockvenezolano.com/login` | idéntica (misma tarjeta, logo, tipografía y distribución) |
| Login de colaborador real | 200, rol `reader`, redirección a `/crv/roadmap` |
| `/roadmap/me` | 401 anónimo; 200 con colaborador y su actividad |
| Cambio de estado propio | 200; `completed_at` escrito en la base |
| Cambio de estado ajeno | 403 `task_not_assigned` |
| Roadmap con sesión / anónimo | 62 / 27 actividades (prueba); luego 61/27 reales |
| `community` y `curator` en ajustes | 403 |
| Typecheck backend y web | OK |
| Vitest comunidad/roadmap/radio | 18/18 |
| ESLint de los archivos tocados | sin errores |
| `build:staging` | OK |

## 3. Limpieza

- Se eliminaron la etapa y actividades de prueba, el usuario `fase1-collab` y
  los tres fixtures `fase1-*`, junto con sus sesiones.
- Los contadores volvieron a **61 actividades / 27 completadas / 5 etapas** y
  **283 visitas históricas**. Se retiraron las visitas locales de prueba (`zz`).
- `show_login` queda en **1** para que «Entrar» esté visible, como en la portada.

## 4. Limitaciones

- No se portaron aún marca/metadatos (`branding_json`), idiomas del proyecto
  (`i18n_json`), configuración del formulario de colaborar
  (`collaborate_json`), tema (`theme_json`), imágenes (`project_assets`),
  reseteo de visitas ni cambio de contraseña.
- La ficha de persona y el flujo de «pendientes por aprobar» de Herra siguen
  sin edición propia; candidaturas, colaboradores e invitaciones sí están.
- `/registro` sigue siendo la página React de invitación, no un documento 1:1.
- El roadmap estático no muestra un menú de cuenta ni «Salir»; el acceso se
  conserva en la cookie de sesión.
- No se ejecutó `npm run lint` global (excede 300 s); solo ESLint dirigido.

## 5. Archivos principales

- `src/api/project/config.ts`, `src/api/routes/project-config.ts`.
- `src/api/routes/community.ts`, `src/api/routes/roadmap.ts`,
  `src/api/roadmap/store.ts`, `src/api/auth.ts`.
- `web/src/lib/project.ts`, `web/src/pages/CurationProjectPage.tsx`,
  `web/src/pages/CurationLayout.tsx`, `web/src/App.tsx`.
- `web/public/landing/login-es.html`, `login-en.html`, `login.js`,
  `site-config.js`, `roadmap-collab.js`.
- `web/server.mjs`.
