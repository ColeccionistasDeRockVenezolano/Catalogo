# Puerta temporal del dominio

**Decisión de Brian, 2026-11-02.** Herra se reemplaza antes de publicar el catálogo. Por eso el
dominio necesita un recorrido propio para el equipo: temporal, artificial y sin ningún camino al
catálogo. **Cuando se publique el catálogo, esto se retira con los pasos de abajo.**

Estado: construido y probado solo en staging. La publicación sigue dependiendo de la autorización de
la ventana ([FASE2B.md](FASE2B.md)).

## Qué sirve el dominio

| Dirección | Quién | Qué es |
|---|---|---|
| `/`, `/roadmap` | Todos | Portada. Con sesión, la cabecera añade Hola, Herramientas, Administrar proyecto, Mi perfil y Cerrar sesión |
| `/colaborar` | Sin cuenta | Formulario de candidatura, que llega al panel |
| `/login` | Sin sesión | Una sola entrada para colaboradores y administración. Con sesión, manda a la portada |
| `/registro`, `/activar` | Con enlace | Alta por invitación y activación tras aceptar una candidatura |
| `/account` | Con sesión | «Mi perfil», copia 1:1 de Herra 1.1.39. Sin sesión, manda a `/login` |
| `/admin` | Administración y comunidad | El panel. Sin permiso, manda a `/login` |
| `/register`, `/admin/login` | Enlaces antiguos | Redirigen a `/registro` y `/login`, conservando el token |
| `/lang/es`, `/lang/en` | Todos | Guardan el idioma en la cookie `herra-crv_lang`, la misma de Herra, y vuelven a `next`, solo dentro del sitio. `?lang=` también lo guarda |

La radio (`/api/radio/now`, `listener`, `unavailable`, `diagnostic`) la atiende Herra o CRV según
`CRV_RADIO_SOURCE`; ver [FASE3.md](FASE3.md) §8. `/radio-embed` es del catálogo y en la portada da 404.

Todo lo demás responde 404: `/cuenta`, `/curaduria`, fichas, buscador y cualquier API fuera de
la lista blanca. La única barrera es la lista blanca de `web/server.mjs`, porque la API que hay detrás
también sabe servir el catálogo. Por eso `scripts/checks/fase2b-whitelist.mjs` debe pasar antes y
después de cada cambio en la portada.

Diferencia deliberada con Herra: «Kanban» no aparece en Herramientas. En Herra 1.1.39 ese enlace da 404.

## Qué es temporal y qué se queda

Todo lo temporal lleva la marca `TEMPORAL-PORTADA`: `grep -rn TEMPORAL-PORTADA src web scripts`.

| Pieza | Al publicar el catálogo |
|---|---|
| `src/landing/views/account.ejs`, `web/public/landing/account.js` | Eliminar; manda `/cuenta` |
| `accountLocals` y la página `account` en `src/landing/render.ts`, `src/landing/data.ts`, `src/api/routes/landing.ts` | Eliminar |
| `POST /account/save` en `src/api/routes/account.ts` | Eliminar; `/cuenta` usa `PATCH /account/profile` y `POST /account/password` |
| Portada con `CRV_WEB_MODE=landing`: lista blanca, `adminDocPath`, `LANDING_LEGACY`, `/lang/*` y su cookie en `web/server.mjs` | Eliminar el modo; el dominio sirve el catálogo. Dejar `/lang/*` como redirección si el catálogo no lo atiende |
| `ops/produccion/crv-landing.*`, `crv-api-landing.*` | Archivar y apagar |
| `src/landing/views/{user-login,collaborate,register,activate}.ejs` y sus guiones | Eliminar y quitar la interceptación del gateway. El catálogo ya tiene `CollaboratePage`, `ActivatePage`, `RegisterInvitePage` y el acceso en `/cuenta`; hay que comprobarlos, porque hoy el gateway no los deja servir |
| Panel `admin.ejs`, `admin.js`, `src/api/routes/admin-panel.ts` | **Se queda** en `/curaduria/roadmap`; solo se quita su dirección `/admin` |

No hay datos que migrar: perfil, cuentas, candidaturas y roadmap viven en `auth.*`, las mismas filas
que usa el catálogo.

## Pasos de retirada

1. Crear la etiqueta `archivo/puerta-temporal` en Git, para poder consultar lo retirado.
2. Pasar `/colaborar`, `/registro` y `/activar` a las páginas React y `/login` a `/cuenta`, conservando los tokens. Las invitaciones y activaciones vigentes deben seguir funcionando.
3. Eliminar las piezas de la tabla.
4. Dejar redirecciones permanentes `/account` → `/cuenta` y `/admin` → `/curaduria/roadmap`. Los marcadores y los correos antiguos siguen circulando.
5. Quitar `scripts/checks/fase2b-whitelist.mjs` y la sección «Puerta temporal» de `AGENTS.md`, y marcar este documento como cerrado.
6. Comprobar en un entorno real el recorrido: entrar, perfil, panel, candidatura, activación y salir.

## Riesgos mientras exista

- **Más superficie pública.** Con esto `/admin` y sus rutas quedan en el dominio. Herra ya lo expone hoy, pero pasa a ser código de CRV, con su sesión, CSRF y límites.
- **Dos «Mi perfil».** `/account` para la portada y `/cuenta` para el catálogo. Escriben en las mismas filas; un cambio de campos hay que hacerlo en ambos.
- **Copia congelada.** Las plantillas son de Herra 1.1.39 y no reciben sus cambios posteriores.

## Una persona, una clave

Quien tiene cuenta de colaborador y administración vinculada (`auth.admins.user_id`) tiene una sola clave,
como en Herra (`syncAdminPasswordForUser`). Cambiarla en «Mi perfil» o en «Mi clave», restablecerla desde el
panel o activar la cuenta escribe la misma credencial en las dos filas y cierra las demás sesiones. Esto se
queda al retirar la puerta. Prueba: `node scripts/checks/clave-unica.mjs`, solo contra staging.

- **Quien ya tenga dos claves distintas** sigue entrando con cualquiera hasta que la cambie una vez; cualquiera
  de las dos vale como clave actual. Las claves no se pueden unificar sin conocerlas.
- **El superadministrador queda fuera:** restablecer a un colaborador de un proyecto no cambia la clave de quien
  gobierna toda la instancia. Hoy ninguno está vinculado en staging.
- **Mientras Herra siga activa:** cambiar la clave en su puerta de administración toca solo esa fila
  (`updateAdminPassword` no sincroniza hacia el colaborador) y las puede volver a separar.
- **`community` no gestiona cuentas de administradores** en ninguna ruta: su clave también abre la administración.

## Aviso de lanzamiento (2026-11-04)

- `GET /api/roadmap/launch` consulta solo si la cookie de este navegador corresponde a una inscripción guardada. `POST` recibe nombre, tipo, correo y, opcionalmente, teléfono/redes; fija Origen = Roadmap y recibe `utm_campaign` de la URL. Exige origen confiable y limita intentos por IP.
- El modal de `/` y `/roadmap` aparece en cada entrada hasta enviar correctamente. Cerrar no equivale a inscribirse. Cookie HttpOnly de un año y marcador local recuerdan el envío; no almacena datos personales en el navegador.
- `auth.launch_contacts` conserva las inscripciones y la cola hacia la hoja Contactos (`gid=0`). Correo único; reintentos cada minuto con espera creciente y comprobación de correos antes de repetir un append ambiguo. Columnas verificadas y escritura RAW.
- Estáticos `landing/launch-modal.css` y `landing/launch-modal.js`; plantilla `partials/launch-modal.ejs`. Al publicar el catálogo, trasladar el modal al inicio React y conservar tabla/API y la cola. Configuración: `CRV_LAUNCH_SHEET_CREDENTIALS`, `CRV_LAUNCH_SHEET_ID`.

## Procedencia y campañas (2026-11-04)

- `POST /api/traffic/event`: aviso público limitado por IP y origen, solo para páginas de la portada y clics de colaborar/radio. No permite registrar candidaturas; estas las confirma el servidor.
- `/api/community/admin/panel/metrics/links` (GET/POST) y `/:id` (PATCH): mapa de enlaces privado, con sesión; crear/archivar requiere administración total y CSRF.
- Estáticos `landing/acquisition.js`, `landing/acquisition-panel.js` y `landing/acquisition.css`. El primero se carga en páginas públicas; los otros solo en el panel.
- Al publicar el catálogo, conservar el módulo de atribución y adaptar sus páginas permitidas; no abrir rutas del catálogo a través de esta puerta.
- Operación, semántica y retención: `docs/TRAFFIC_ATTRIBUTION.md`.

### API de portada aislada (seguridad, 2026-11-04)

La instancia del dominio usa `CRV_API_MODE=landing`: registra comunidad, cuentas,
roadmap (incluido el lanzamiento), radio y health. No registra rutas ni
trabajadores del catálogo. La lista blanca del gateway sigue siendo obligatoria.
Para retirar la puerta y publicar el catálogo hay que usar una API de catálogo
con su configuración y permisos correspondientes; la cuenta SQL limitada de la
portada tiene lectura del catálogo, pero solo escribe comunidad y sesiones.
Ver `docs/SECURITY_AUDIT_2026-11-04.md` antes de cambiar de modo o de credenciales.

## La Rockola flotante (2026-11-05)

TEMPORAL-PORTADA: `/` y `/roadmap` integran el chat en el lugar del contador.
No se sirve `/chat` ni la SPA del catálogo. El cliente independiente reutiliza
`useChat`, sesión, WebSocket, tienda y reloj editorial. El contador conserva
su API, cifras y países reales, sin datos del HTML de demostración.

Rutas permitidas: `/api/chat/{challenge,session,profile,rooms,effects,wallet,inventory,equip,daily-cover}`,
`/api/chat/rooms/:slug/messages`, `/api/chat/effects/:code/buy`,
`/api/chat/messages/:id/report` y upgrade `/api/chat/ws`. No se abre `/api/chat/admin/*`.
`GET /api/daily-cycle` reenvía exclusivamente al reloj del servidor del catálogo
(:8080), porque la API limitada de portada no registra ese reloj; ninguna otra
ruta se reenvía a ese proceso. Recursos: `/landing/rockola.js` y `rockola.css`.

Build: `node web/scripts/build-rockola.mjs`. Al retirar la puerta, quitar la
inyección del gateway y decidir si se conserva el cliente flotante en el catálogo.

### Fidelidad de La Rockola a la maqueta

El cliente se renderiza dentro de Shadow DOM para que el CSS de la portada
no altere las medidas, iconos, texto ni controles del HTML entregado por Brian.
El contador original se conserva oculto como fuente actualizada de cifras y
países; el widget reproduce el carrusel continuo y las tres categorías de la
maqueta con esos datos. Las ventanas superpuestas de conectados, nombre y
tienda permanecen dentro del chat, con foco atrapado, Escape y cierre exterior.
La tienda reutiliza compras, inventario y equipamiento reales en diseño compacto.
Los estilos se incluyen dentro del bundle; `rockola.css` solo oculta el contador
original. No se añade ninguna ruta pública ni acceso al catálogo.

### Correcciones del chat flotante (2026-11-05)

Los modales se muestran sobre la ventana completa, fuera del panel del chat:
la tienda usa un espacio amplio en escritorio y se adapta al móvil. El cliente
incluye los estilos de nombres, Nox y filtros SVG, texturas incrustadas y los
escenarios compartidos de partículas/materiales dentro del Shadow DOM.
Las listas de países que caben completas no se duplican ni se desplazan;
solo las listas que desbordan usan una copia visual para el bucle continuo.
No se añaden rutas ni se cambia la puerta del catálogo.
