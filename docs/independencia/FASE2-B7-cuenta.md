# B7 · «Mi perfil» (`/cuenta`) — cierre

2026-11-01. Sección 4 de `INSTRUCCIONES_HERMES_ADMIN_2026-11-01.md`, la última pieza que
faltaba en B7. Las ventanas 3.4–3.6 y el arrastre táctil ya estaban en los commits
`c160559f` y `9d008849`; esto es lo que se añade ahora.

## Qué se construyó

`/cuenta` de Herra (1.1.34, `dist/views/account.ejs`) portada al catálogo como página de
`/cuenta`, con la piel de `web/src/styles/global.css` y sin copiar `admin.css`:

- **Cabecera** con avatar de iniciales, título en Anton 400 y la línea
  «Sesión: {usuario} en {proyecto} · Persona #N · Colaborador #N». Debajo, el aviso
  «Perfil incompleto: Edad · WhatsApp · Experiencia · Categorías · Enlaces» en ámbar, o
  «Perfil completo» en verde.
- **Datos personales** (8 campos): nombre, apellido, fecha de nacimiento con
  «Dato interno: nunca se muestra en público.», WhatsApp, correo, preferencia de contacto,
  ciudad y país.
- **Perfil de colaboración**: biografía, experiencia y conocimientos, disponibilidad y los
  chips de habilidades y áreas de aporte (catálogo del proyecto, archivados excluidos).
- **Mis enlaces**: hasta 10 filas con tipo (catálogo `link_type`), URL, etiqueta y casilla
  «Público» por enlace. La página ofrece siempre dos filas libres (mínimo tres), como Herra.
- **Visibilidad**: perfil privado o público, con la aclaración de que la fecha de nacimiento
  y el WhatsApp nunca se publican y de que los enlaces solo salen si se marcan públicos.
- **Contraseña**: clave actual, nueva y repetición; vacías no tocan nada.
- **Pie fijo** con «← Volver al roadmap» y «Guardar cambios». Al guardar se escribe el perfil
  y, si hay campos de clave, también la clave; el aviso distingue «Perfil guardado.» de
  «Perfil y clave guardados.».
- Un solo botón para todo, como Herra: los enlaces se validan antes de escribir nada.

Los bloques que ya usaba `/cuenta` en el catálogo (cambios de la sesión, Administrar, Ayuda,
Cerrar sesión) se conservan **debajo** del perfil, porque en el móvil esta página es también
la pestaña «Cuenta» y es el único sitio con el cierre de sesión.

## Endpoints (nuevos; antes no había ninguno)

Se revisó `src/api/` completo: existían perfil de persona **administrativo**
(`/community/admin/collaborators/:id`) y cambio de clave de otros
(`/community/admin/collaborators/:id/access-code`), pero **nada de la propia cuenta**. Se crea:

| Ruta | Qué hace |
|---|---|
| `GET /account/profile` | Cuenta de la sesión (colaborador o administrador), persona, términos, enlaces, huecos y catálogo. |
| `PATCH /account/profile` | Datos personales, perfil de colaboración, términos, enlaces y visibilidad. |
| `POST /account/password` | Verifica la clave actual, guarda el hash nuevo y sube `session_version`. |

- `src/api/account/store.ts` — validación pura (`validateProfileFields`, `cleanLinks`,
  `profileGaps`) y acceso a `auth` (users, people, person_links, person_catalog_terms).
- `src/api/routes/account.ts` — las tres rutas; límite de 8 cambios de clave cada 10 minutos
  por cuenta.
- `src/api/community/roles.ts` — `roleCanAccess` deja pasar `/account/*` a **cualquier rol**:
  un colaborador `reader` no tenía permiso para nada privado y su propio perfil no es una
  sección de trabajo. La excepción es solo `/account` (no `/accounts` ni el resto).
- `src/api/auth.ts` — `restampSession`: al cambiar la clave la versión de la cuenta sube y,
  sin reestampar, la sesión que hizo el cambio también quedaba fuera. La decoración actualiza
  la sesión en curso; las demás se invalidan solas en la siguiente petición.

## Pruebas

- `src/api/account/profile.test.ts` (10): nombre obligatorio, normalización de espacios,
  fecha/correo/WhatsApp inválidos, términos duplicados o no enteros, preferencia y visibilidad
  desconocidas, enlaces `javascript:`/`ftp://`/sin esquema, tope de 10 enlaces y orden de los
  huecos del perfil.
- `src/api/community/roles.test.ts` (+1): `/account/*` abierto a los cuatro roles y cerrado
  `/accounts`; `reader` sigue fuera de comunidad y catálogo.
- **API real (staging, curl):** `GET` 200 con persona #N y colaborador #N; `PATCH` con huecos
  a `[]`; enlace inválido 400; nombre vacío 400; sin CSRF 403; clave actual incorrecta 400;
  cambio de clave 200 y **la sesión sigue viva** (`/auth/me` 200) mientras otra sesión de la
  misma cuenta pasa a 401; `reader` lee y escribe su perfil (200) y sigue con 403 en
  `/community/admin/*`.
- **Navegador real** (`scripts/checks/b7-cuenta-browser.mjs`): **51/51** comprobaciones en
  escritorio 1440×900 y móvil 390×844, ES y EN. Comprueba cabecera, avatar, cinco secciones,
  8 campos, nota de dato interno, chips, filas de enlace con visibilidad, pie `sticky`, guardado
  persistente de un campo y su restauración, aviso de perfil incompleto al borrar la fecha y
  su desaparición al restaurarla, cambio de clave a una temporal y vuelta, sesión viva, cero
  desbordes horizontales y consola limpia. Capturas e informe:
  `~/crv-staging/reports/b7-cuenta-2026-11/` (4 PNG de página completa + `informe.json`).
- Typecheck backend y web, ESLint dirigido (sin errores) y `npm --prefix web run build:staging`.

## Diferencias y límites

- Herra muestra el formulario dentro de una tarjeta de acceso; aquí es una página del catálogo
  con la barra lateral y la barra superior del shell, como el resto de `/cuenta`.
- La cabecera de Herra tiene «Hola, {nombre}», Herramientas y «Cerrar sesión»; en CRV eso lo
  cubre el shell (OperatorPill y barra inferior), así que no se duplica.
- Una cuenta **sin persona vinculada** (por ejemplo un administrador suelto) ve el texto
  «Tu cuenta todavía no tiene una persona asociada…» y solo la sección de contraseña, igual
  que la rama `profile === null` de Herra.
- El límite de intentos de acceso de staging cuenta **todos** los intentos contra la IP (20 por
  15 min, aciertos incluidos) y solo perdona el cupo de la cuenta al acertar. Los guiones ya no
  dependen de reiniciar `crv-api-staging`: guardan y reutilizan la sesión y usan una IP de prueba
  distinta por corrida. La explicación completa y la regla propuesta están en la bitácora
  (§«Paso 3 · limitador de acceso»).
- Durante la primera pasada, que se cortó por un fallo del propio guion, la persona de prueba
  quedó con correo y país vacíos; no se reprodujo en dos pasadas limpias ni con una prueba
  específica de «guardar sin vaciar campos», y el formulario conserva lo que devuelve la API.
  Se anota como observación, no como defecto reproducido.
