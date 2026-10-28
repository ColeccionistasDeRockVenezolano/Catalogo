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
| E5 | Rive, voz/vídeo, moderación avanzada, pasarela de pago | Pendiente |

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
| `CRV_CHAT_SECRET` | valor de desarrollo | firma HMAC de la sesión de invitado. **En producción debe ser único**; el servicio lo lee de `~/.config/crv-chat.env` |
| `CRV_CHAT_RATE_LIMIT` | `8` | mensajes por ventana de 10 s y conexión (0 apaga) |
| `CRV_CHAT_GUEST_COINS` | `150` | monedas de bienvenida (el servicio local usa 500 para poder probar la tienda) |

## Modelo de datos (migraciones 0105-0107)

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
  `ambient`).
- `chat.accounts` + `chat.ledger` — saldos y libro mayor de doble entrada con
  `idempotency_key` único. Ningún saldo se mueve sin entrada.

## Protocolo

### WebSocket

`GET /chat/ws?t=<token>&room=general`

Eventos del cliente: `message`, `typing`, `action`, `equip`, `profile`, `ping`.
Eventos del servidor: `snapshot`, `message`, `presence`, `typing`, `wallet`,
`equipped`, `system`, `error`.

- El token va en la query, no en la cookie: una cookie `SameSite=Lax` no se
  envía en un WebSocket entre orígenes distintos (dev: web en 5173, chat en
  8081).
- El servidor valida todo con zod (`src/chat/protocol.ts`), limita a 8
  mensajes/10 s por conexión y cierra las conexiones inactivas a los 90 s.
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
  "version": 1, "triggers": ["always"], "cost": 3, "reducedMotion": "static",
  "layers": [{ "type": "css", "preset": "neon", "colors": ["#2ec4b6", "#b185e3"] }]
}
```

- El renderer (`web/src/components/chat/Effects.tsx`) implementa 25 presets CSS,
  SVG y canvas. Añadir un efecto es añadir una entrada al catálogo o publicarlo
  desde administración; el cliente no cambia.
- **Presupuesto móvil** (`web/src/lib/chatEffects.ts`): se detecta
  `deviceMemory`, `hardwareConcurrency`, `saveData`, `prefers-reduced-motion` y
  el ancho de pantalla. En gama baja solo se pinta la versión estática; en
  media hay 3 animaciones simultáneas; en alta, 8. Un `canvas` global por capa
  de partículas, nunca uno por mensaje.
- **Nada de GIFs.** Los efectos son CSS/SVG/canvas: el chunk completo de la
  página del chat pesa **10,9 KB gzip** (31,6 KB sin comprimir). Para comparar:
  la ingeniería inversa de xat midió 86 KB de WebP animado para un power de
  53×53 px, ~5 MB de JS y 17 efectos marcados como incompatibles con móvil.
- Los efectos propios se inspiran en la mecánica (nombre, marco, entrada,
  mensaje, acción, fondo, ambiente), nunca en los assets ni en los nombres de
  otra plataforma.

### Cómo añadir un efecto

1. Añade la entrada a `EFFECT_CATALOG` (o publícala desde el editor de
   administración con el JSON del manifiesto).
2. Si el preset no existe, impleméntalo en `Effects.tsx` y en `chat.css`.
3. `npm run chat` sincroniza el catálogo al arrancar. El test
   `test/unit/chat-effects.test.ts` falla si el manifiesto no cumple el esquema
   o usa un preset desconocido.

## Monedas

- `coins` se ganan; `credits` se compran. Hoy los créditos solo los acredita un
  administrador (`POST /chat/admin/grant`), y la compra intenta primero coins.
- Toda compra es idempotente: repetir la misma `idempotencyKey` no vuelve a
  cobrar (probado en `test/contract/chat.test.ts`).
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
npx vitest run test/unit/chat-effects.test.ts
npx vitest run test/contract/chat.test.ts --pool=forks --poolOptions.forks.singleFork
```

La suite unitaria completa del repo tiene fallos preexistentes por los informes
versionados que viven ahora en el almacén de 1 TB (vitest intenta transformar
copias de `src/` dentro de `reports/`); no provienen del chat.

## Pendiente (E5)

- Rive para efectos interactivos complejos (runtime ~200 KB, carga diferida;
  el manifiesto ya reserva el campo `type` para añadirlo).
- Voz/vídeo con WebRTC y salas de audio.
- Moderación avanzada (mute/kick/ban por IP y cuenta, reportes, auditoría).
- Partición mensual de `chat.messages` y fan-out con Redis/NATS cuando haya más
  de un proceso de chat.
- Pasarela de pago (Stripe/MercadoPago) sobre el libro mayor existente.
