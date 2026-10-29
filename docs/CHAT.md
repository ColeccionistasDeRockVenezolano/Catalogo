# Chat de la comunidad (CRV)

Chat de «La Rockola» para la comunidad de Coleccionistas de Rock Venezolano:
salas, mensajes en vivo, efectos visuales propios y monedas. Móvil primero.
Este documento es la fuente de verdad de la arquitectura y la operación.

## Estado

| Etapa | Qué entra | Estado |
| --- | --- | --- |
| E0 | Sala, invitados con apodo, mensajes, presencia, historial | Hecho |
| E1 | Catálogo de efectos declarativos, inventario, equipado, tienda | Hecho |
| E2 | Monedas (`coins`/`credits`), libro mayor idempotente, grants | Hecho |
| E3 | Enganche de cuentas CRV (`/chat/claim`) y cambio de apodo | Enganche listo; el registro público no existe aún |
| E4 | Editor de efectos en administración y efectos con datos del catálogo | Hecho |
| Blindaje 1 | Límites, prueba de trabajo, tokens con caducidad, filtro, Laya, detector, moderación | Hecho (2026-10-28) |
| Solidez · etapa 2 | Alquileres, compras idempotentes por actor, historial, WS y retención | Implementada; cierre local 2026-10-28 |
| Apertura · etapa 3 | Motor compartido, coreografías, escenas, stickers, tienda con probador | Implementada; validación local (2026-10-28), sin despliegue web |
| E5 | Rive, voz/vídeo, pasarela de pago | Pendiente |

## Arquitectura

```
navegador
  ├─ SPA Vite/React (/chat) ──HTTP──> crv-chat :8081 (Fastify + WS) ──> PostgreSQL
  └─ WebSocket wss://…/api/chat/ws ──> gateway :3120 ──> crv-chat :8081
```

- **Proceso propio** (`src/chat/server.ts`, `npm run chat`, puerto `CHAT_PORT`,
  por defecto 8081). Medido: con el chat dentro de la API del catálogo, el
  índice de búsqueda ocupaba el pool y un `POST /chat/session` tardaba 3-8 s de
  forma intermitente. Separado responde en 8-25 ms. Reiniciar el chat tampoco
  reinicia las fichas.
- **El gateway de producción** (`web/server.mjs`) enruta `/api/chat/*` y el
  upgrade del WebSocket al proceso de chat; el resto sigue yendo a la API del
  catálogo. El WS se proxya a mano (`server.on("upgrade")`) porque un
  `http-proxy` genérico no estaba disponible.
- **Autenticación**: la del chat es propia (actor invitado con token HMAC),
  pero las rutas `/chat/admin/*` reutilizan la sesión de colaboradores de CRV.
  No hay un segundo sistema de permisos.
- **Un solo pool de PostgreSQL**, compartido con la API. El chat no toca el
  esquema del catálogo salvo lectura de `albums`/`artists` para la portada del
  día.

### Variables de entorno

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `CHAT_PORT` | `8081` | puerto del proceso de chat |
| `CRV_CHAT_SECRET` | valor de desarrollo | firma HMAC de la sesión de invitado. **Con `NODE_ENV=production` el chat no arranca si falta el secreto o conserva el valor de desarrollo**; el servicio lo lee de `~/.config/crv-chat.env` |
| `CRV_CHAT_RATE_LIMIT` | `8` | mensajes por 10 s **por actor** (suman todas sus conexiones); la IP admite el triple |
| `CRV_CHAT_TOKEN_TTL_DAYS` | `30` | caducidad del token de invitado (se renueva al volver) |
| `CRV_CHAT_POW_BITS` | `16` | dificultad de la prueba de trabajo para crear un invitado (0 la apaga) |
| `CRV_CHAT_SESSIONS_PER_IP` | `5` | invitados nuevos por IP cada 10 min |
| `CRV_CHAT_NEW_ACCOUNT_MINUTES` | `10` | minutos en que una cuenta es «nueva»: 3 mensajes/10 s y sin enlaces |
| `CRV_CHAT_AI_MODERATION` | `true` | revisión de odio y amenazas con Laya local |
| `CRV_CHAT_MESSAGE_RETENTION_DAYS` | `90` | retención de mensajes; conserva los que tienen reportes abiertos |
| `CRV_CHAT_GUEST_COINS` | `150` | monedas de bienvenida (el servicio local usa 500 para poder probar la tienda) |

## Modelo de datos (migraciones 0105-0111)

- `chat.actors` — identidad estable: hoy invitado, mañana cuenta CRV.
  `claimed_user_id` es el enganche; `handle` es único y no cambia al renombrar.
- `chat.rooms` — salas con `slug`, tema y descripción. Sembrada `general`
  («La Rockola»).
- `chat.messages` — mensajes con autor, tipo (`chat`, `system`, `action`,
  `sticker`) y `effect_code`. Sin particionar todavía: cuando crezca, partición
  por mes sobre `created_at` (el índice ya es `(room_id, id DESC)`).
- `chat.effects` — catálogo con manifiesto `jsonb`, precios y duración. La
  fuente de verdad en runtime es la base; `src/chat/effects-catalog.ts` la
  siembra al arrancar (`syncEffectCatalog`, idempotente).
- `chat.effect_inventory` — qué tiene cada actor y hasta cuándo.
- `chat.equipped` — una fila por ranura (`name`, `frame`, `background`,
  `ambient`, `name_font`).
- `chat.accounts` + `chat.ledger` — saldos y libro mayor de movimientos por actor,
  con `(actor_id, idempotency_key)` único. Cada movimiento contiene los deltas
  de coins y credits; **no es contabilidad de doble entrada**. Ningún saldo se
  mueve sin asiento y ambos saldos se comprueban contra su suma antes de confirmar.
- `chat.purchases` — recibos por actor y clave, también para adquisiciones gratuitas.
  Conservan efecto y vencimiento para repetir la respuesta sin volver a cobrar.
- `chat.daily_covers` — elección persistida por fecha editorial; una alta o edición
  del catálogo no cambia la portada ya elegida durante ese ciclo.

## Protocolo

### WebSocket

`GET /chat/ws?t=<token>&room=general`

Eventos del cliente: `message`, `typing`, `action`, `equip`, `profile`, `ping`.
Eventos del servidor: `snapshot`, `message`, `presence`, `typing`, `wallet`,
`equipped`, `system`, `error`.

- El token va en la query, no en la cookie: una cookie `SameSite=Lax` no se
  envía en un WebSocket entre orígenes distintos (dev: web en 5173, chat en
  8081).
- El servidor valida todo con zod (`src/chat/protocol.ts`), corta frames de
  más de 8 KB (`CHAT_MAX_PAYLOAD`), exige `Origin` confiable, aplica los
  límites de «Seguridad y moderación» y cierra las conexiones inactivas a los 90 s.
- Eventos de moderación: `deleted`, `muted`, `room` (modo lento) y
  `mod_alert` (solo a moderadores). Cierres: 4401 sin sesión, 4403 baneo,
  expulsión u origen, 4404 sala inexistente, 4429 demasiadas conexiones.
  Ante 4401, el cliente intenta renovar la sesión una vez; otro rechazo detiene
  la conexión y pide recargar. 1013 cierra clientes lentos (más de 256 KiB de
  salida pendiente o 128 eventos esperando al snapshot).
- Presencia en memoria del proceso: quien está conectado y qué lleva puesto.
  Los mensajes y el dinero van a PostgreSQL en cada evento.

### REST

| Método | Ruta | Quién |
| --- | --- | --- |
| POST | `/chat/session` | crea o recupera el invitado (cookie HttpOnly + token) |
| PATCH | `/chat/profile` | cambia el apodo del actor |
| GET | `/chat/rooms/:slug/messages?before&limit` | público |
| GET | `/chat/effects` | catálogo con `owned`/`equipped` |
| POST | `/chat/effects/:code/buy` | compra/alquila con `idempotencyKey` |
| POST | `/chat/equip` | equipa o quita una ranura |
| GET | `/chat/wallet` | saldo |
| GET | `/chat/daily-cover` | portada del día (efecto «Vinilo») |
| POST | `/chat/admin/grant` | administrador: regala coins/credits |
| GET/POST | `/chat/admin/effects` | administrador: catálogo y publicación |

## Efectos

Un efecto es **datos**, no código (`src/chat/effects-catalog.ts`):

```json
{
  "version": 1, "triggers": ["always"], "cost": 4, "reducedMotion": "static",
  "layers": [
    { "type": "sprite", "preset": "vinyl-face", "position": "left" },
    { "type": "css", "preset": "gradient", "colors": ["#1a1a1a", "#f5f5f5", "#e50914"] }
  ]
}
```

Hay **92 efectos**, incluidas 14 fuentes, con capas de texto, sprites, marcos,
partículas, coreografías y escenas:

- **Texto por letra** (`wave`, `rainbow`, `bounce`, `spin3d`, `glitch`,
  `scatter`, `typewriter`, `jitter`, `fire-letters`): el nombre se parte en
  caracteres y cada uno anima con desfase (`--i`). El resto de presets
  (`neon`, `glow`, `gold`, `ice`, `blood`, `plasma`, `gradient`, `pulse`,
  `scratch`, `eq`) se aplican al texto completo.
- **Sprites SVG** propios (12): `vinyl-face`, `cassette-face`, `amp-face`,
  `skull-rocker`, `flame-face`, `guitar`, `hand-rock`, `bat`, `mic`, `drum`,
  `heart-horns`, `ufo-vinyl`. Son SVG de 1-2 KB con partes animadas (ojos que
  parpadean, carretes que giran, llamas que tiemblan). No consumen presupuesto
  porque no son canvas; se pintan también en gama baja (allí sin animación).
- **Marcos** (`frame`, `orbit`, `ring`, `pulse-ring`) alrededor del avatar.
- **Partículas canvas** (`confetti`, `embers`, `stardust`, `crowd`, `sparks`,
  `notes`, `hearts`, `rain`, `fireworks`, `bubbles`) en un único canvas por
  capa.

Referencia de la ingeniería inversa (xat, medida 2026-10-28): sus «powers»
son sprites pixel-art de 30-74 px, 72 fotogramas a 80 ms y 5,78 s en loop, con
35-86 KB de WebP por efecto. Nosotros hacemos lo mismo en SVG de ~1 KB y texto
vectorial, sin copiar ningún asset ni nombre.

La sala `general` trae fondo `escenario` y ambiente `brasas` en su `theme`
(migración 0108): la sala tiene vida aunque nadie lleve un efecto equipado. Si
alguien equipa uno, el suyo manda.

### Efectos de texto tipo React Bits

Cinco efectos inspirados en [reactbits.dev](https://reactbits.dev/c/text-animations)
y reimplementados desde cero (sin `motion` ni `ogl`, con presupuesto de
animación). React Bits es MIT; no se copia código, se replica el efecto.

| React Bits | Preset CRV | Cómo se hace |
|---|---|---|
| Decrypted Text | `decrypted` | Glifos aleatorios que se resuelven letra a letra; ciclo de 1,5 s y 4 s de descanso. |
| Glitch Text | `rb-glitch` | Tres capas (base, roja, cian) con `clip-path` por franjas y desplazamiento. |
| Warp Text | `warp` | Deformación líquida con `feTurbulence` + `feDisplacementMap` animados y aberración cromática. |
| True Focus | `rb-focus` | Palabras que se enfocan en secuencia (blur 4,5 px) con marco de esquinas. |
| Fuzzy Text | `rb-fuzzy` | Grano SVG animado que muerde el borde y vibración de 0,16 s. |

Dos adaptaciones conscientes por el contexto del chat (nombres pequeños y
muchos a la vez): `warp` y `fuzzy` usan filtros SVG compartidos en vez del
WebGL/canvas del original —mismo aspecto, sin un contexto WebGL por nombre— y
`warp` no persigue el puntero: ondula solo. `decrypted` y `foco` no gastan
presupuesto caro y actualizan el texto mediante el reloj compartido; `glitch`, `warp` y `fuzzy`
son CSS puro.

### Fuentes del nombre

Catorce estilos comprables (`kind: name_font`) que ocupan su propia ranura:
se pueden llevar a la vez que un efecto de nombre (fraktur + calavera).
El texto real del actor nunca se guarda transformado: se transforma al pintar,
así que quitar o dejar caducar una fuente no toca mensajes ni identidad.

Dos motores (`src/chat/fonts.ts`):

- **Unicode** (`applyUnicodeFont`): el carácter es el estilo. Math Serif Italic
  (con el hueco de la `h` → ℎ), Math Monospace, Math Script Bold, Math Fraktur
  Bold, Math Double-Struck (ℂℍℕℙℚℝℤ), Coptic Standard y Tai Le Curly.
- **CSS / por letra**: Lower Upper Light (primera minúscula, resto mayúsculas),
  Lilia, Black Panther, Cursiva Script, Versalitas (small-caps), Boxed Black
  (cada letra en su caja) y Letras en Círculo (cada letra en un aro).

Precios de 120 a 400 monedas, alquiler de 30 días, con la misma compra
idempotente y el mismo libro mayor que los efectos. Migración 0109: valor
`name_font` en `chat.effects.kind` y en `chat.equipped.slot`.

La tienda muestra cada fuente con la muestra «La Rockola» y el panel de detalle
la pinta a 22 px antes de comprar.

Presupuesto móvil (`web/src/lib/chatEffects.ts`): se detecta
  `deviceMemory`, `hardwareConcurrency`, `saveData`, `prefers-reduced-motion` y
  el ancho de pantalla. En gama baja solo se pinta la versión estática; en
  media hay 8 unidades de presupuesto; en alta, 16. El probador tiene prioridad
  sobre la sala. Las partículas de nombres y marcos comparten un canvas global;
  el ambiente tiene un canvas por capa, nunca uno por mensaje.
- **Medido** en viewport de 390×844: sala y probador a aproximadamente
  **59–60 fps**, sin tareas largas en las muestras de tres segundos. Es una medición
  de Chromium en este equipo con fixtures, no una garantía para todos los teléfonos.
  Evidencia: `reports/chat-etapa3-2026-10-28/qa.json`.

### Sesiones largas: ventanas de 50 mensajes

`CHAT_MESSAGE_LIMIT` en `web/src/lib/chatSocket.ts` limita la página montada a
50 mensajes. En vivo se retiran los antiguos, desmontando sus efectos y
liberando sus observadores y suscripciones. `MessageRow` usa `React.memo` para
evitar redibujar todos los mensajes al escribir o recibir cambios de presencia.

Al desplazarse hacia atrás se congela la página leída. Los eventos nuevos
actualizan una ventana reciente separada de hasta 50 mensajes y un contador;
no desplazan lo que se está leyendo. «Cargar mensajes anteriores» y «Cargar
mensajes más recientes» consultan páginas de hasta 50, sustituyendo la actual.
«Ir a los últimos mensajes» vuelve al presente sin descargar el historial
completo y descarta respuestas históricas pendientes. Hay como máximo
100 mensajes retenidos por estas dos ventanas; en vivo comparten la misma lista.

No se borra el historial del servidor por este límite. La retención de la base
sigue siendo independiente. Cargar historia, recibir ecos o volver de una pestaña
oculta no reproduce escenas antiguas. Se mantienen el reloj de animación único,
las pausas por visibilidad, los presupuestos por dispositivo y el movimiento reducido.

Verificación con fixtures en 390×844 y 1440×960: tras 250 mensajes nuevos,
la versión anterior montaba 300 mensajes y 1.254 elementos descendientes; la
ventana monta 50 mensajes y 254 elementos. Es una reducción del DOM en esa
muestra, no una medición del ahorro de batería o memoria del dispositivo.
Prueba repetible: `web/tests/visual/chat-window-qa.ts`; evidencia en
`reports/chat-render-window-2026-10-28/`. Los cambios se verificaron localmente;
el build público requiere su publicación habitual.

### Etapa 3 del plan de apertura: movimiento y probador

- `web/src/lib/chatMotion.ts` administra un único rAF. Todos los dibujos y las
  actualizaciones de texto lo comparten; se detiene al ocultar la pestaña o al
  retirarse el último renderer. `IntersectionObserver` pausa el contenido fuera
  de pantalla y reasigna los huecos. Los nombres tienen prioridad sobre los
  marcos y el ambiente; abrir una hoja dedica el presupuesto a esa hoja.
- `Choreography.tsx` implementa murciélago, baquetas, ovni, vinilo rodante,
  guitarra, calavera, rayo y rockerito con WAAPI (`transform`/`opacity`). Cada
  animación se cancela al salir de pantalla; las terminadas se retiran del registro.
  `ParticleStage.tsx` pinta fuego, chispas, nieve y notas desde las letras, además
  de las capas de partículas de los marcos y las ráfagas de mensajes.
- Los marcos nuevos son anillo de fuego, aro eléctrico, vinilo giratorio y
  ecualizador radial. Los fondos conservan sus partículas; la luz del escenario
  varía por opacidad para evitar filtrar toda la pantalla en cada fotograma.
- `Scenes.tsx` reproduce pogo, choque de vinilos, aplausos y telón en una cola
  acotada, de una escena a la vez, durante 1,5–2,5 s. Los eventos `message` nuevos
  y `entry` alimentan la cola; un snapshot o el historial nunca repiten acciones.
  `entry` se emite una sola vez por presencia del actor, no por pestaña, y elige
  su entrada vigente de mayor precio. No se persiste en el historial.
- La bandeja del compositor envía los stickers propios. El servidor comprueba
  tipo y propiedad vigente: `action` solo admite acciones; los mensajes admiten
  efectos de mensaje o stickers. Los stickers se guardan con `kind=sticker`.
- `ShopSheet.tsx` muestra avatar, nombre, mensaje, fondo y ambiente en el probador.
  Tocar prueba sin comprar; «Reproducir» repite acciones, entradas y mensajes.
  Incluye rarezas, filtros Todos/Tuyos/Equipados/Me alcanza, orden de precio,
  precios en monedas y créditos, compra, renovación, fuentes equipables y cuenta
  atrás del alquiler. La propia tarjeta no realiza ninguna compra.
- En gama baja queda arte estático. Movimiento reducido conserva fundidos suaves
  sin partículas, saltos ni giros. Escape cierra las hojas y restaura el foco;
  Tab permanece dentro de la hoja.
- La portada del chat usa `useDailyAsync`, la fecha del proveedor editorial y
  `dailyCycle` en la API; al cambiar el ciclo no conserva la portada anterior.

Pruebas de la etapa 3: `test/contract/chat-stage3.test.ts` usa PostgreSQL y WS
reales en un contenedor propio. `web/tests/visual/chat-stage3-qa.ts` conecta con
un navegador ya abierto mediante `CRV_QA_CDP`; las escrituras del recorrido
visual son fixtures y no envían mensajes a la comunidad. Las capturas se escriben
en SSD (`CRV_QA_OUT`) y se publican con `scripts/staging.py` al cerrar.

La implementación no autoriza desplegar la web: el plan exige el permiso de
Brian para `npm run deploy` y cerrar las etapas anteriores antes de publicar.

### Cómo añadir un efecto

1. Añade la entrada a `EFFECT_CATALOG` (o publícala desde el editor de
   administración con el JSON del manifiesto).
2. Si el preset no existe, impleméntalo en `Effects.tsx` y en `chat.css`.
3. `npm run chat` sincroniza el catálogo al arrancar. El test
   `test/unit/chat-effects.test.ts` falla si el manifiesto no cumple el esquema
   o usa un preset desconocido.

## Seguridad y moderación (blindaje, etapa 1)

Código: `src/chat/guard.ts` (límites), `src/chat/session.ts` (tokens y prueba
de trabajo), `src/chat/moderation/` (filtro, detector, Laya, almacén),
`src/api/routes/chat-moderation.ts` (rutas de administración) y
`web/src/components/chat/Moderation.tsx` (menú y hoja). Migración `0110_chat_safety`.

**Entrada**
- Crear un invitado exige `Origin` confiable, prueba de trabajo
  (`GET /chat/challenge` → el navegador busca un nonce con `CRV_CHAT_POW_BITS`
  bits a cero; desafío firmado, ligado a la IP, 5 min, un solo uso) y cabe en
  el tope de invitados por IP. Sin desafío responde 428 `pow_required`.
- Token `v2.<actor>.<versión>.<caducidad>.<firma>`. Banear sube
  `token_version`: todos los tokens del actor dejan de valer. El formato viejo
  solo sirve para renovar en `POST /chat/session`.
- El navegador manda una huella (32 hex) que se guarda con IP y navegador en
  el actor (`created_*`, `last_*`) y en cada mensaje.
- El gateway reenvía `X-Forwarded-For`; el chat toma la última entrada.

**Límites** (en memoria, por actor y por IP): mensajes, typing, equipar,
apodo, acciones, reportes, compras; 4 conexiones por actor y 12 por IP;
expulsión = 5 min sin volver; modo lento por sala (moderadores exentos);
mismo mensaje en < 15 s o tercera vez en 3 min se rechaza; máximo 8 saltos de línea.

**Filtro** (`text.ts`): quita invisibles, bidi y zalgo; pliega acentos,
l33t, cirílico/griego parecidos, repeticiones y letras separadas. Las
groserías fuertes se tapan; el odio (homófobo, racista/xenófobo —incluido
«veneco»—, capacitista) se bloquea. «Marico», «coño», «güevón» son
coloquiales y pasan. Los apodos no pueden imitar reservados (admin,
moderador, Brian, CRV, Rockola, sistema…; también «ADMlN») ni ser ofensivos.

**Laya** (`ai-review.ts` + `scripts/chat-laya-moderation.py`, gratis y
local): no frena el envío. Cada 5 s puntúa los mensajes nuevos (ataque a un
colectivo, amenaza): ≥ 0,85 / 0,90 se oculta con reporte y aviso; ≥ 0,50 /
0,60 queda visible en revisión. Las interjecciones coloquiales se cambian por
«amigo» antes de puntuar. Umbrales provisionales (muestra de 11 mensajes).

**Detector** (`detector.ts`): puntos que decaen a la mitad cada 10 min
(muchas cuentas por IP o huella, mismo texto desde 3 cuentas, límites
superados, cambios de apodo, cuenta nueva muy activa, palabras bloqueadas,
enlaces de cuenta nueva, repetidos). Al llegar a 100: silencio automático de
15 min, reporte `detector` y aviso a moderadores.

**Moderación** (cuenta administradora de CRV; cada acción deja fila en
`chat.moderation_log` en la misma transacción): borrar/restaurar mensaje,
silenciar, expulsar, banear cuenta (y opcionalmente sus IP 30 días), modo
lento. Cualquiera reporta un mensaje (odio, acoso, spam, groserías, otro);
con 3 reportes de personas distintas se oculta solo. En la sala, el menú «⋮»
de cada mensaje y el escudo de la cabecera (cola de reportes, auditoría, sala).
Los invitados vacíos (sin mensajes, compras ni sanciones) se borran a los 7 días.

| Método | Ruta |
| --- | --- |
| GET | `/chat/challenge` |
| POST | `/chat/messages/:id/report` |
| GET | `/chat/admin/reports?status=open\|all`, `/chat/admin/log` |
| POST | `/chat/admin/reports/:id/resolve`, `/chat/admin/messages/:id/delete\|restore` |
| POST | `/chat/admin/actors/:id/mute\|unmute\|kick\|ban\|unban`, `/chat/admin/ip-bans/remove` |
| POST | `/chat/admin/rooms/:slug/slow-mode` |

## Monedas

- `coins` se ganan; `credits` se compran. Hoy los créditos solo los acredita un
  administrador (`POST /chat/admin/grant`), y la compra intenta primero coins.
- Toda compra es idempotente **por actor**: repetir la misma `idempotencyKey`
  devuelve el recibo original, aunque después el saldo ya no alcance. Reutilizarla
  para otro efecto o movimiento devuelve 409. Dos actores pueden usar la misma clave.
- Los efectos gratuitos generan recibo e inventario sin asientos de cero. Un
  permanente propio no se vuelve a cobrar, incluso con claves nuevas o compras
  simultáneas. Renovar un alquiler suma días al vencimiento vigente (o desde ahora
  si venció), y la respuesta devuelve la fecha efectiva.
- Leer el monedero solo ejecuta SELECT. `auditWallets` compara saldos con el libro
  mayor cada hora y registra discrepancias, sin crear ni corregir dinero.
- Cuando exista pasarela, el cobro solo inserta una entrada de `credits` en el
  libro mayor; la tienda y los precios no cambian.

## Cuentas CRV (futuro)

No hay registro público todavía. El día que exista:

1. La cuenta CRV llama a `POST /chat/claim` con su `userId`.
2. `chat.actors.claimed_user_id` queda ligado y el actor pasa a `kind='member'`.
3. Mensajes, monedas, inventario y efectos se conservan: nada se migra.

## Operación

```bash
npm run chat                     # desarrollo (tsx, puerto 8081)
systemctl --user status crv-chat # servicio local
systemctl --user restart crv-chat
curl -s localhost:8081/health    # {"ok":true,"service":"crv-chat"}
```

- Servicio: `~/.config/systemd/user/crv-chat.service`, secreto en
  `~/.config/crv-chat.env` (permisos 600).
- El gateway (`web/server.mjs`) enruta `/api/chat` y el upgrade WS; sin él el
  chat funciona en local pero no detrás del dominio público.
- Logs: JSON a stdout, igual que la API (`journalctl --user -u crv-chat -f`).

## Pruebas

```bash
npx vitest run --config vitest.chat.config.ts   # unitarias + contratos del chat
# Solo contratos (PostgreSQL aislado, WebSocket y ataque simulado):
npx vitest run --config vitest.chat.config.ts test/contract
```

### Verificación de la etapa 1 (2026-10-28)

Continuación del cierre de Claude: 78 pruebas del chat en verde (14 de
seguridad con WebSocket real), TypeScript de servidor y web, y ESLint de los
archivos del cierre. Ejecución acotada al directorio de pruebas para no
recorrer las copias archivadas en el almacén:

```bash
./scripts/with-node22.sh node_modules/.bin/vitest run --dir test test/unit/chat-safety.test.ts test/unit/chat-effects.test.ts test/unit/chat-fonts.test.ts test/contract/chat-safety.test.ts test/contract/chat.test.ts --pool=forks --poolOptions.forks.singleFork
```

- Corregida la carrera entre pestañas: una cola por actor (máximo 16 eventos)
  serializa los eventos antes de comprobar repetidos y modo lento. Las dos
  regresiones fallan sin la cola y pasan con ella.
- Simulación aislada: 24 altas intentadas, 9 rechazadas; 15 bots intentaron
  300 mensajes, 13 se guardaron y los 15 bots quedaron silenciados.
- Móvil 390×844: entrada con prueba de trabajo, apodo reservado rechazado,
  cambio a un apodo válido, filtro de odio y menú de reportes verificados.
  El formulario espera la aceptación del servidor y muestra su error dentro
  de la hoja; ya no anuncia como válido un apodo rechazado.
- El clasificador asíncrono sigue siendo Laya local, como lo implementó
  Claude; difiere del DeepSeek flash mencionado en el plan original.
- Capturas e informes: `reports/chat-etapa1-cierre-2026-10-28/` (publicados
  desde staging al almacén de 1 TB). Los controles administrativos se probaron
  en el contrato contra PostgreSQL desechable, sin sancionar usuarios reales.
- Servidor local reiniciado para cargar la corrección. Los ajustes web se
  comprobaron en Vite; este cierre no ejecuta el despliegue público.

`chat-safety` (contrato) levanta `buildChatApp` (`src/chat/app.ts`) contra un
contenedor PostgreSQL propio, nunca la base de desarrollo.

La suite unitaria completa del repo tiene fallos preexistentes por los informes
versionados que viven ahora en el almacén de 1 TB (vitest intenta transformar
copias de `src/` dentro de `reports/`); no provienen del chat.

## Cierre de solidez (etapa 2 del plan de apertura)

- `src/chat/slots.ts` define las cinco ranuras para REST, WS, repositorio y
  tienda, incluida `name_font`. El equipado individual y del historial exige
  inventario vigente y efecto habilitado. El barrido de presencia retira los
  alquileres vencidos de las salas conectadas en un máximo aproximado de 30 s.
- Equipar desde la tienda avisa a todas las salas y pestañas del actor. Durante
  el arranque, los eventos de salida esperan al snapshot; cerrar o fallar una
  consulta devuelve el cupo y elimina la presencia. La cola de entrada por actor
  conserva el orden entre pestañas y aplica los límites después del evento anterior.
- «Cargar mensajes anteriores» usa cursor por ID, combina sin duplicados y
  conserva el mensaje visible como ancla aun cuando cambia la agrupación por autor.
  Los errores permiten reintentar. Al llegar mensajes mientras se lee más arriba,
  un botón muestra cuántos son y permite volver al final. Escape cierra las hojas,
  Tab queda dentro y el foco vuelve al control que las abrió.
- La limpieza horaria retira hasta 5.000 mensajes de más de 90 días por pasada
  (configurable), preservando reportes abiertos. No elimina inventarios ni libros
  mayores por retención. Las portadas se fijan por el ciclo de Caracas en la base.
- Migración `0111_chat_solidity`; contratos de compras, saldo, caducidad,
  paginación y portada estable, pruebas del arranque y presión del WS, y recorrido
  en navegador `web/tests/visual/chat-stage2-qa.ts` con fixtures aislados.

Validado el 2026-10-28: 102 pruebas del chat en 9 archivos; TypeScript del
servidor y la web y ESLint de los archivos del cierre sin errores. Recorrido
con fixtures en 390×844 y 1440×960: historial, error y reintento, ancla de lectura,
contador de mensajes nuevos, fuentes, envío, foco y 4401 repetido, sin desborde
horizontal ni errores de JavaScript. Migración aplicada localmente, `crv-chat`
reiniciado y saludable, y auditoría de saldos sin discrepancias. Capturas y
`qa.json` publicados desde SSD al almacén con SHA-256 verificados.

La suite dedicada se ejecuta con:

```bash
LOG_LEVEL=error ./scripts/with-node22.sh node_modules/.bin/vitest run --config vitest.chat.config.ts
```

El recorrido visual usa `CRV_QA_CDP`, `CRV_QA_OUT` y opcionalmente `CRV_QA_URL`.
Las capturas del cierre se publican en `reports/chat-etapa2-cierre-2026-10-28/`.
Este cierre no autoriza el despliegue web público.

## Materiales realistas y seis familias nuevas (2026-10-28)

El catálogo conserva los códigos e inventarios anteriores y añade **18 opciones**:
Chidori, Sello maldito, Karma azul, Entidad de sombras, Rainbow pastel y Sangre
realista, cada una para nombre, marco de avatar y mensaje. Son 110 entradas en
total, incluidas las fuentes. Los nuevos nombres/marcos usan el nivel existente
de 480 monedas/48 créditos y los mensajes 180/18, con alquiler de 30 días.

`RealisticSprite.tsx` sustituye los doce dibujos de objetos y las piezas de las
coreografías/escenas por recortes de un atlas WebP original con materiales y
volumen. También hay fotografías generadas para escenario y garaje y humo
procedural para la entrada y la niebla. Arte, tamaños y prompts completos:
`web/src/assets/chat/README.md`. Las coreografías conservan sus trayectorias;
los objetos son texturas animadas, no modelos 3D articulados.

`MaterialStage.tsx` pinta los materiales de nombres, marcos y mensajes en **un
solo canvas 2D compartido**, sobre el reloj común y sin actualizar React por
fotograma. No crea contextos WebGL por mensaje ni descarga vídeos de efectos.

- Chidori regenera rutas y ramas cada 60–160 ms; las descargas son finas y locales.
- Sello maldito combina humo texturado violeta, contracción y puntas oscuras.
- Karma deforma lenguas de chakra verticales y continuas; no comparte el dibujo
  ni la temporización de los rayos.
- La entidad usa humo negro/carbono y ojos de aparición ocasional, fuera del contenido.
- Rainbow aplica un solo degradado al nombre entero en 6 s, con reflejos,
  destellos y corazones. Es una excepción expresa del brief a la regla de diseño
  que desaconseja texto degradado; el detector solo señala esa advertencia.
- Sangre acumula un menisco, crece, estrecha el cuello, se separa, acelera por
  gravedad y retrae el remanente; cada gota tiene fase y tamaño propios y cambia
  de forma entre ciclos.

El dibujo recorta el interior del avatar y el texto para conservar su lectura y
respeta el recuadro del historial/probador. Un máximo adicional de 6 emisores en
alta o 3 en media limita incluso las excepciones de prioridad del probador.
Resolución máxima de 2,5 millones de píxeles; DPR como máximo 1,5 en alta y 1 en
media. Alta intenta dibujar a 60 Hz, media a 30 Hz. Se reduce a 30 Hz si el
renderizador consume demasiado tiempo o el reloj pierde fluidez sostenidamente.
Son objetivos y límites, no garantías de FPS en teléfonos físicos.

Se mantiene el presupuesto por visibilidad, la pausa con pestaña oculta, el
historial manual de 50 mensajes y la presentación estática legible para calidad
baja/movimiento reducido. El último emisor retirado apaga el lienzo. Los cinco
materiales de humo se almacenan en texturas pequeñas reutilizables. La atmósfera
de niebla usa una capa aparte, a media resolución y hasta 24 Hz, detrás del texto.
Los mensajes reproducen sus materiales durante 6 s y no reactivan el historial.

Validación: suite dedicada del chat, TypeScript de servidor/web, ESLint y build.
`web/tests/visual/chat-materials-qa.ts` prueba las 18 opciones en móvil/escritorio,
píxeles dibujados, degradación y cambio de preferencia, sin compras reales.
Las capturas y medidas con sus límites están en
`reports/chat-realistic-materials-2026-10-28/`. Las muestras con lectura de píxeles
se distinguen de las muestras nuevas sin esa lectura, porque esta puede cambiar
el backend del canvas en Chromium.

Los cambios están verificados localmente. Para publicar la web y cargar el nuevo
catálogo del servicio de chat (sin migraciones nuevas):

```bash
./scripts/with-node22.sh npm run deploy
systemctl --user restart crv-chat
curl --retry 15 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:8081/health
```

## Pendiente (E5)

- Rive para efectos interactivos complejos (runtime ~200 KB, carga diferida;
  el manifiesto ya reserva el campo `type` para añadirlo).
- Voz/vídeo con WebRTC y salas de audio.
- Partición mensual de `chat.messages` y fan-out con Redis/NATS cuando haya más
  de un proceso de chat.
- Pasarela de pago (Stripe/MercadoPago) sobre el libro mayor existente.
