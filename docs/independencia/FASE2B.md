# Fase 2B · Guion de la ventana (NO EJECUTADA · NO LISTA PARA AUTORIZAR)

**Estado (2026-11-02, revisión de Claude):** el ensayo con la **forma de producción** y la base
`crv_staging` se repitió sobre `03298f7b` y pasó. **La ventana sigue sin autorizar:** faltan las
puertas de §10, la comparación en inglés con la portada viva y la autorización expresa de Brian. La
versión anterior habría quitado la radio de la portada; ver §1.1.

**Referencia de paridad:** Herra **1.1.39** — **pendiente de confirmar por Brian**. No se compara
contra 1.1.34.

**Qué publica la 2B:** `coleccionistasderockvenezolano.com` sirve desde CRV la portada (roadmap),
`/colaborar`, `/login`, `/registro` y `/activar`, con visitas, candidaturas y tareas escritas por
CRV. El catálogo NO se publica: fuera de la lista blanca, 404. La radio sigue en Herra hasta la
Fase 3.

**Decisiones de Brian aplicadas:** panel privado en `127.0.0.1:3131` contra `:8083` (solo local,
nunca Funnel/Cloudflare); sin merge en la 2B (worktree por SHA); en modo portada se ocultan «Mi
cuenta» y «Gestionar proyecto»; el acierto de login descuenta un intento del cupo de IP y se añade
un techo de usuarios distintos fallados.

---

## 1. Lo que cambió respecto de la versión anterior

| Antes | Ahora |
|---|---|
| `crv-landing.service` inexistente | Tres plantillas versionadas en `ops/produccion/` (API `:8083`, portada `:3140`, panel `:3131`) |
| Entorno de staging (`:8082`, `dist-staging`) | Entornos de producción separados y guarda `CRV_DEPLOYMENT` |
| `:8080` con comunidad apagada | API propia `crv-api-landing` con `CRV_COMMUNITY_ENABLED=true` |
| Origen del dominio mal diagnosticado | Se mantiene `CRV_ALLOWED_ORIGINS`; con `Host` y `Origin` del dominio el login da 401, no 403 |
| `/curaduria` para reemitir tokens | `scripts/community-tokens.ts`, probado en staging |
| Consulta de tokens sin `auth.` y con `now()` | `auth.*` y comparación TEXT UTC |
| Respaldo con `pg_dump` del host y usuario `postgres` | `docker exec … -U crv` en `/mnt/datos/backups/crv`, probado con restauración |
| Paridad del dominio consigo mismo | Foto local de la portada viva antes del cambio; comparación contra `:3141` y `:3150` |
| Producción desde el árbol compartido | Worktree fijo por SHA, con sus enlaces de datos |
| Enlaces `/cuenta` y `/curaduria` 404 | Ocultos en modo portada (ES/EN, 1440/390) |
| Trabajos de fondo duplicados en la API del dominio | `CRV_BACKGROUND_JOBS=false`, inventariado y probado |
| Auditoría pública sin fila | Migración **0125** (nueva) + bloqueo de roles sin 0124 |

---

### 1.1 Lo que corrigió la revisión de Claude

| Fallo | Consecuencia | Corrección y prueba |
|---|---|---|
| `CRV_RADIO_ENABLED=false` en la API del dominio | La portada perdía la tarjeta y el enlace «Radio»; §11 lo daba por «dinámico» | Radio encendida en `crv-api-landing` (sus rutas no emiten ni escriben; lo público sigue en Herra). `2b-flujos-dominio.mts`: tarjeta, enlace y video de Herra, ES y EN |
| La tarjeta se calculaba con el motor de CRV | El motor diverge de Herra desde las 17:00 (ver §1.2) | `src/landing/radio-card.ts`: la primera imagen sale de `CRV_RADIO_LIVE_URL`; el motor propio queda de respaldo |
| Portada: paradas de 2 a 5 s en caché fría | Si la API pasaba de 5 s, el gateway servía la copia estática del build, con otra canción y datos viejos | Sin calentar el índice de búsqueda: 25 ms en seis medidas con 30 s de intervalo. Si falla, se sirve la última copia buena |
| Métricas opción (a) | El registrador no arrancaba con `CRV_BACKGROUND_JOBS=false`: nada se escribía | Registrador independiente; visita en `traffic_daily` con país `ve` y categoría `human` |
| Guarda incompleta | Arrancaba con trabajos encendidos o sin radio | Aborta en ambos casos, y si falta el build o `CRV_RADIO_PROXY_URL` |
| Sin comando para 0125 | No se sabía aplicarla y registrarla | §7, ensayado en `crv_staging` |
| Etiquetas de `/colaborar` en otro orden | «Diseño UI/UX» antes de «Diseño gráfico» | Orden por idioma; paridad ES sin esa diferencia |

### 1.2 La sombra de la radio falla desde las 17:00 (Fase 3)

`crv-radio-sombra` pasó 45 veces sin divergencias y desde **2026-11-01 20:00 UTC (17:00 en esta
máquina)** diverge en todas: 34 de 34 a las 22:30. Mismo catálogo (`1579a744db26b801`). El motor de
CRV va por delante de Herra: 5,4 s al empezar y unos 65-70 s cinco horas después, y sigue creciendo.
No coincide con el cambio a 1.1.39 (18:55). **Causa sin determinar.** No afecta a la emisión de la 2B,
que sigue en Herra, pero la Fase 3 no puede dar por buena la sombra hasta explicarlo: su plazo de 7 a
14 días debe contarse desde que vuelva a estar limpia.

---

## 2. Fallos comprobados y su corrección

### A · Respaldo con usuario equivocado

`docker exec -u postgres … pg_dump -U postgres` falla con `role "postgres" does not exist`. El
usuario es **`crv`** (como `docker-compose.yml` y `scripts/db-backup.sh`). Corregido en §6 y
probado contra `crv_staging`: dump de 395 480 B, restauración en base desechable y conteos iguales.

### B · La API del dominio arrancaría trabajos de fondo contra `crv`

`src/api/server.ts` arranca `startCurationWatcher`, `startEntityResolutionRetention`,
`startHomeChannelRefresh` y `startBotVerification`; `routes/search.ts` añade su retención. El
vigilante analiza el catálogo y la retención ER compacta filas: con `:8080` serían dos escritores.
Corregido con `CRV_BACKGROUND_JOBS=false` (por defecto `true`, no cambia `:8080`). En el ensayo la
API registró «trabajos de fondo desactivados» y **no** creó `ingest.curation_scans` (0 filas desde
las 00:29). Inventario de temporizadores en §5.

### C · F4 estaba mal diagnosticado

Con `Host` y `Origin` del dominio, `:3141` responde **401** en login y **400** en candidatura vacía
(regla del mismo host). El 403 aparece solo con `Host` local. Se mantiene `CRV_ALLOWED_ORIGINS`
porque el preflight CORS de la API sí lo necesita, y se corrige la comprobación de la ventana:
`POST /api/auth/login` con `Origin` del dominio → 401. Si el túnel reescribiera `Host`, el
`x-forwarded-host` dejaría de coincidir y el origen del dominio seguiría permitido por la lista
blanca; **no se puede leer la configuración de Cloudflare**: queda como comprobación de Brian antes
de la ventana.

### D · Migraciones

`0124_community_roles` está en `migrations/pending` y no se aplica a producción hasta la Fase 4;
staging sí la tiene. El SHA usa `curator`/`community` en `AccountRole`, `roleCanAccess`,
`setAdminRole` y los fixtures. Ensayo sin 0124 en transacción con `ROLLBACK`: el CHECK viejo
bloquea ambos roles; `setAdminRole` ahora responde **409 `role_unavailable`** antes de tocar la
base. Además, el ensayo destapó que **`auth.audit_log` no admite `actor_type='public'`**: las
candidaturas y activaciones no se auditaban (error 23514 silencioso en el log). Se añade
**0125_audit_public_actor** y se prueba en transacción: el INSERT público pasa y el `down` aborta
si hay filas públicas. **Producción necesita 0125 antes de la ventana**; el preflight de §6 lo
comprueba con `ops/produccion/migraciones-2b.sql`.

### E · Métricas sin dueño

Herra escribe `auth.traffic_daily` desde sus vistas de página (`herra-1.1.39/dist/routes/public.js`
→ `services/traffic.service.js`). Tras el cambio, Herra ya no ve las páginas del dominio y CRV
tiene `CRV_TRAFFIC_ENABLED=false`: **nadie registraría el tráfico de página** para 3.7. El contador
de la portada (`auth.project_visits`) sigue funcionando porque es otra tabla. Opciones en §8;
decisión de Brian, no se enciende nada en producción.

### F · Cifras y puertas

La vuelta atrás se remide: **3 487 ms** el cambio y **545 ms** la vuelta, con un proxy local; **no**
miden Cloudflare. G1-G7 ya no son «trabajo de ventana»: el ensayo de este documento las cubre
(§9); las que dependen de producción siguen marcadas «no se puede probar antes».

### G · Auditoría pública (hallazgo del ensayo)

`auth.audit_log_actor_type_check` solo admitía `admin` y `user`; `recordAudit` inserta `public`
con `actor_id 0`. Cada candidatura/activación dejaba un error en el log y ninguna fila. Corregido
con 0125. Sin 0125 en producción, las escrituras siguen funcionando pero **no se auditan**.

### H · Enlaces de cuenta en la portada

`header.ejs` pinta `/account` y `/admin`; el gateway los reescribe a `/cuenta` y
`/curaduria/roadmap`, que la lista blanca da 404. En modo portada (`mode=landing`) se ocultan.
Verificado en ES/EN y 1440/390: la portada no contiene esos `href`; el catálogo `/crv` sí los
conserva. Los colaboradores **no podrán cambiar su contraseña desde el dominio** hasta tener una
página propia; pueden hacerlo en el catálogo del Funnel o pedírselo a un administrador.

---

## 3. Topología objetivo

```
Internet → Cloudflare (túnel cloudflared-herra-crv) → 127.0.0.1:3140  crv-landing
                                                       ├─ /api/* permitido → 127.0.0.1:8083  crv-api-landing
                                                       │                                     (base crv, comunidad on)
                                                       └─ /api/radio/*     → 127.0.0.1:3020  Herra (radio)
Panel    → 127.0.0.1:3131  crv-web-admin (/crv) → 127.0.0.1:8083  (solo local/SSH, nunca Funnel)
Funnel   → 127.0.0.1:3120  crv-web (/crv) → 127.0.0.1:8080  crv-api (catálogo, sin cambios)
```

Puertos libres comprobados: `3140`, `8083`, `3131`. `:8080` y `:3120` no se tocan. La API nueva
comparte la base `crv` y lee el `.env` de producción por `CRV_ENV_FILE`; no se copia ni se imprime.

---

## 4. Artefactos versionados (nada instalado)

`ops/produccion/` contiene:

- `crv-api-landing.service` — API `:8083`, `CRV_BACKGROUND_JOBS=false`, lee el `.env` por
  `CRV_ENV_FILE` (ruta con espacios, entre comillas en `Environment=`).
- `crv-landing.service` — portada `:3140`, `CRV_WEB_DIST=dist` (base `/`).
- `crv-web-admin.service` — panel `:3131`, `CRV_WEB_DIST=dist-public` (base `/crv/`).
- `crv-api-landing.env.example`, `crv-landing.env.example`, `crv-web-admin.env.example`.
- `migraciones-2b.sql` — comparación de solo lectura con las 124 migraciones que espera el SHA.
- `README.md` — `__SHA__`, secretos, guarda y acceso al panel.

La guarda `CRV_DEPLOYMENT` (`src/config/deployment.ts` + `web/server.mjs`) aborta en producción si
la API apunta a una base con «staging», escucha en `:8080`/`:8082`, le falta `CRV_VISITS_SECRET`
(≥32), o si un gateway apunta a `:8080`/`:8082` o sirve `dist-staging`. `rehearsal` lo admite de
forma explícita; sin la variable se conserva el comportamiento histórico. 7 pruebas en vitest.

**Árbol de release:** `git worktree add --detach /mnt/datos/crv-release/<SHA> <SHA>`; `npm ci`;
`npm --prefix web ci`; `npm --prefix web run build` (`dist`) y `build:public` (`dist-public`).
El worktree **necesita** los enlaces ignorados que el árbol compartido tiene:
`data/raw`, `data/research`, `reports` y `web/public/media` al almacén de 1 TB. Sin `data/research`
la API no arranca (`venezuelan-music-sources.json`). El worktree de ensayo se borró al terminar.

**Reemisión de tokens:** `scripts/community-tokens.ts` (`--list`, `--reissue-invite`,
`--reissue-activation <id>`, `--base`, `--expect-db`) exige `CRV_ENV_FILE` explícito y comprueba
`current_database()` antes de escribir. Probado en staging: lista, emisión, `GET
/community/activate/:token` y `GET /community/invite/:token` válidos, guardas con salida 2 (sin
env) y 3 (base distinta). Tokens y usuarios de prueba borrados.

---

## 5. Trabajos de fondo: inventario

| Fuente | Qué escribe | Con `CRV_BACKGROUND_JOBS=false` |
|---|---|---|
| `startCurationWatcher` | `ingest.curation_scans`, hallazgos | no arranca |
| `startEntityResolutionRetention` | compacta `ingest.entity_resolution_decisions` | no arranca |
| `startHomeChannelRefresh` | refresco YouTube/caché | no arranca |
| `startBotVerification` | listas de IPs, verificación | no arranca |
| `startTrafficRecorder` | `auth.traffic_daily`/`traffic_visitors` | no arranca (además `CRV_TRAFFIC_ENABLED=false`) |
| `routes/search.ts` flush/retención | analítica de búsqueda | timers no creados |
| `auth.ts` barrido de sesiones/intentos | memoria del proceso | sigue (no escribe base) |
| `search-misses.ts` | volcado de búsquedas fallidas | solo se crea si hay una búsqueda; la lista blanca no sirve `/search` |
| Escaneos por escritura de catálogo | `runCurationScan` | no alcanzables: el gateway 404 a `/catalog*` y `/curation*` |

Evidencia del ensayo: log `trabajos de fondo desactivados (CRV_BACKGROUND_JOBS=false)` y
`SELECT count(*) FROM ingest.curation_scans WHERE started_at > '2026-11-02 00:29:00'` → **0**.

---

## 6. Respaldo de `auth` (corregido y probado)

```bash
umask 077
install -d -m 700 /mnt/datos/backups/crv
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker exec crv-postgres pg_dump -U crv -Fc -n auth crv \
  > "/mnt/datos/backups/crv/auth-2B-$TS.dump"
docker exec -i crv-postgres pg_restore -l < "/mnt/datos/backups/crv/auth-2B-$TS.dump" | head
sha256sum "/mnt/datos/backups/crv/auth-2B-$TS.dump" | tee "/mnt/datos/backups/crv/auth-2B-$TS.dump.sha256"
```

- **Usuario `crv`** (no `postgres`); socket local del contenedor, **sin contraseña en argv**.
- Destino **`/mnt/datos/backups/crv`** (ext4, donde ya viven los respaldos), no el NTFS de `/mnt/1tb`.
- Archivo `0600` por `umask 077`.
- Ensayo real: `crv-postgres-staging`, base `crv_staging`, **395 480 B**. Restaurado en
  `crv_2b_restore_test`: hay que crear antes `CREATE SCHEMA auth` y
  `CREATE EXTENSION citext WITH SCHEMA auth` (pg_dump de un esquema no lleva la extensión de la
  base). El `CREATE SCHEMA auth` del dump produce un único error benigno «schema already exists»;
  las 27 tablas se restauran y los conteos coinciden (users 5, admins 3, people 5, tasks 61,
  categories 5, applications 1, project_visits 53, activation_tokens 1, registration_tokens 13,
  projects 1, project_assets 2). Después se borró la base y la copia de ensayo.

En la ventana: respaldo antes de tocar nada; si el archivo no abre, no se sigue.

---

## 7. Migraciones: 0124, 0125 y la consulta de Brian

- **0124** (roles curator/community): en `migrations/pending`, **no** se aplica a producción en la
  2B. Staging la tiene. Sin ella, `setAdminRole` bloquea curator/community con 409; el CHECK viejo
  los rechaza (probado con `ROLLBACK`).
- **0125** (auditoría pública): **nueva y necesaria**. Sin ella, candidaturas y activaciones no se
  auditan (error 23514 en el log; la petición responde 200). Probada en transacción: el INSERT
  `public` pasa; el `down` aborta si hay filas públicas.
- **Consulta de solo lectura** para Brian: `ops/produccion/migraciones-2b.sql`. En staging da
  `esperadas 124 · aplicadas 124 · coinciden 123 · faltan {0125_audit_public_actor} · sobran
  {0124_community_roles}`. En producción debe dar `faltan {}` (aplica 0125 antes de la ventana) y
  `sobran` solo puede traer 0124 si alguien la aplicó por error.
- **Aplicar 0125 (solo esta, registrada y sin clave en el comando),** desde el worktree del SHA, ensayado
  en `crv_staging`:

  ```bash
  { echo "SET lock_timeout='5s';"; cat migrations/0125_audit_public_actor.up.sql
    echo "INSERT INTO ingest.schema_migrations(version) VALUES ('0125_audit_public_actor');"; } \
    | docker exec -i crv-postgres psql -X -q -v ON_ERROR_STOP=1 --single-transaction -U crv -d crv
  ```

  Herra solo inserta en `audit_log` y su `schema.sql` no reimpone el CHECK en una tabla existente (leído,
  sin tocar Herra). Staging ya la tiene: da `faltan {}` y `sobran {0124_community_roles}`.
- El guion **se detiene** si `faltan` no está vacío. No se ejecuta ninguna migración contra
  producción desde este trabajo.

---

## 8. Métricas después del cambio (decisión de Brian)

Hoy Herra registra las vistas de página en `auth.traffic_daily`; tras el cambio solo verá la radio.

- **(a) recomendada y ensayada:** `CRV_TRAFFIC_ENABLED=true` y `CRV_TRAFFIC_TOKEN=<secreto>` en
  `api.env`, y `CRV_TRAFFIC_REPORT=1` con el mismo token en `gateway.env`. Registró la visita con país
  y categoría aun con los trabajos apagados.
- **(b)** dejar 3.7 con el histórico de Herra, sin vistas nuevas, hasta la Fase 4.

No probado: que Herra deje de sumar páginas tras el cambio real; se comprueba en la ventana.

---

## 9. El ensayo con forma de producción (base `crv_staging`)

Worktree `54fd004b`, puertos API `:8093`, portada `:3150`, panel `:3131`/`:3151`, `dist` y
`dist-public` propios, `CRV_DEPLOYMENT=rehearsal`, `CRV_BACKGROUND_JOBS=false`, base `crv_staging`.
Todo se apagó y el worktree se borró.

| Prueba | Resultado |
|---|---|
| Lista blanca completa | **72/72** en `:3150` |
| `GET /api/radio/now` por el proxy | **200** (Herra), sin POST a `/listener` ni `/unavailable` |
| Candidatura real con `Host`/`Origin`/`CF-Connecting-IP` del dominio | **200**, `source_addr=203.0.113.7` |
| Login de colaborador con cookie Secure en `/` | **200**; `crv_session; Path=/; HttpOnly; SameSite=Strict; Secure`; `/auth/me` 200 |
| Cambio de estado de una tarea asignada | **200**, `in_progress`; tarea y asignación borradas |
| Visita con país | 3 POST, 2 IPs: `ve` +2 y una sola fila por IP/día; contadores revertidos |
| Origen del dominio en login | **401**, no 403 |
| Panel privado `:3131` en Chromium | login, cookie Secure en `http://127.0.0.1`, aceptar candidatura e invitar: **todo OK** |
| Enlaces de cuenta | portada ES/EN 1440/390 **sin** `/cuenta` ni `/curaduria`; `/crv` los conserva |
| Trabajos de fondo | log de apagado y **0** escaneos nuevos |
| `:8080`, Funnel y dominio | `200/404/200/200` como antes; servicios de producción activos, sin reinicios |

**La cookie Secure funciona en `http://127.0.0.1`** (Chromium la guarda y la envía), así que el
panel privado no necesita debilitar la API ni montar TLS local; Brian entra por la máquina o por
`ssh -L 3131:127.0.0.1:3131`.

---

## 10. Puertas antes de autorizar

| # | Puerta | Estado |
|---|---|---|
| G1 | Unidades y entornos de `ops/produccion/` revisados | contenido listo, **no instalado** |
| G2 | `api.env`, `gateway.env`, `admin.env` con secretos propios y `.env` legible por systemd | **Brian** |
| G3 | Worktree del SHA con `dist` y `dist-public` | probado en `54fd004b`; fijar SHA al autorizar |
| G4 | Respaldo probado y restauración comparada | **probado** (§6) |
| G5 | Guion de tokens probado | **probado** (§4) |
| G6 | Paridad contra foto de Herra | **probada** (§11) |
| G7 | Migración 0125 aplicada en producción (§7) | **pendiente, Brian** |
| G11 | Decisión de métricas (§8), paridad EN (§11) y confirmar Herra 1.1.39 | **pendiente, Brian** |
| G8 | Panel privado `:3131` | **decidido (a)** y probado |
| G9 | Enlaces de cuenta ocultos | **decidido** y probado |
| G10 | Cloudflare, fecha y autorización expresa | **Brian** |

G7 es la única puerta nueva que puede obligar a cambiar el orden: si 0125 no está aplicada, la 2B
funciona pero pierde la auditoría de candidaturas y activaciones.

---

## 11. Paridad con la portada viva

Comparación palabra a palabra en navegador, `:3150` frente al dominio, con `show_login=0` puesto de
forma temporal en staging para igualar la portada viva (staging tiene 1; se restauró).

| Diferencia en ES | Clase |
|---|---|
| Contadores de visitas, países, «Colaboradores 5/6», fecha de «Última actualización» | Dato de staging o dinámico |
| Posición de «Lanzamiento y consolidación del canal de YouTube» | Dato de staging: se confirma contra la foto en la ventana |
| «Buscando la emisión…» frente a «El vivo sigue en marcha» | Dinámico: YouTube estaba bloqueado en la prueba |
| `/login` | Sin diferencias |

**Pendiente:** no se comparó el inglés con la portada viva: el dominio devuelve ES a `?lang=en` y la
automatización no pudo activar su selector. CRV sí se probó en EN (`fase2b-ensayo` 34/34). Lo revisa
Brian o se compara en la ventana contra una foto tomada a mano.

---

## 12. La ventana (00:00-00:30 de Caracas) — borrador

> **No ejecutar sin G1-G10 cerradas y autorización expresa.** A medianoche cambia el día de
> `America/Caracas` y nadie cuenta dos veces la misma visita (F2-2).

**Paso 0 · Preflight.** Comprobar que `SELECT enabled FROM auth.project_features WHERE feature = 'radio'` da 1 (sin ello no hay tarjeta); `git status`, `shared-storage.py status`, `ss` de `3140/8083/3131`,
`curl` a dominio/Herra/`:8080`, y la consulta `migraciones-2b.sql` con `faltan` vacío.

**Paso 1 · Congelar el `/admin` de Herra** (Brian).

**Paso 2 · Respaldo** de §6; anotar ruta, tamaño y `sha256`.

**Paso 3 · Arrancar** `crv-api-landing` y `crv-landing` (y `crv-web-admin`). Verificar
`/health` (`{"ok":true,"database":true}`), `/roadmap` 200 en `:3140`, whitelist 72/72, y el POST
de login con `Origin` del dominio → 401.

**Paso 4 · Foto de Herra** para la paridad (GET) antes de Cloudflare; guardar el PID del servidor
de la foto.

**Paso 5 · Cloudflare** (Brian): hostname `coleccionistasderockvenezolano.com` de
`http://127.0.0.1:3020` a `http://127.0.0.1:3140`. Anotar la regla anterior literal. No se toca DNS
ni el certificado.

**Paso 6 · Verificación pública:** whitelist contra el dominio, `GET /api/radio/now`, paridad
contra la foto, navegador real 1440/390 ES/EN, una candidatura de prueba (marcada), login de un
colaborador, segunda carga sin sumar visita, 404 de cada ruta prohibida, país de la visita.

**Paso 7 · Tokens:** `scripts/community-tokens.ts` con la lista de §13; guardar las URLs.

**Paso 8 · Cierre:** apagar el servidor de la foto, anotar hora, regla anterior de Cloudflare,
resultados y pendientes; dejar las unidades habilitadas y Herra intacto.

---

## 13. Vuelta atrás

Disparadores: ruta del catálogo alcanzable, 5xx sostenidos, candidaturas/logins que fallan,
contador que no suma, portada distinta de la foto.

Acción: devolver el hostname a `http://127.0.0.1:3020` (Brian) y
`systemctl --user disable --now crv-landing crv-api-landing crv-web-admin`.

Cifras del ensayo: **3 487 ms** el cambio y **545 ms** la vuelta, con un proxy local desechable en
`:3145`. **No miden Cloudflare** ni el apagado de unidades; solo el gesto de cambiar el destino.

Qué pasa con lo escrito por CRV si se vuelve atrás:

| Dato | Al volver a Herra |
|---|---|
| `auth.people`, `auth.users` (clave scrypt), `applications`, `tasks`, `task_assignees` | Se conservan; Herra lee el mismo esquema |
| `auth.project_visits`/`project_visit_stats` | Se conservan; el contador puede mezclar el día del corte |
| `auth.audit_log` | Se conserva; incluye filas `public` que Herra no genera |
| `activation_tokens`/`registration_tokens` de CRV (SHA-256) | **No valen en Herra**: reemitir desde Herra |
| `auth.sessions` de CRV | Pueden no servir en Herra (cookie/host distinto): los colaboradores vuelven a entrar |
| `traffic_daily` | CRV no escribió (interruptor apagado); Herra retoma sus vistas |
| `auth.projects` y assets | Sin cambios en la ventana |

Quién administra: durante la ventana, nadie (Herra congelado y panel aún no publicado). Después,
Brian/operador por el panel privado `:3131` contra `:8083`; Herra sigue congelado hasta la vuelta
atrás o la Fase 3. Si el panel falla, se vuelve atrás.

---

## 14. Observación (72 h)

`journalctl --user -u crv-landing -u crv-api-landing -u crv-web-admin`; 5xx y 404 inesperados;
candidaturas y su estado; visitas por país y una por IP/día; logins; radio de Herra; catálogo del
Funnel sin cambios. Cierre: 72 h sin incidentes y sin rutas del catálogo alcanzables.

---

## 15. Solo Brian

1. **Tokens pendientes de Herra** — consulta exacta, **no ejecutada**:
   ```sql
   SELECT id, user_id, created_at, expires_at, used_at, revoked_at
     FROM auth.activation_tokens
    WHERE used_at IS NULL AND revoked_at IS NULL
      AND expires_at > to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')
    ORDER BY expires_at;
   SELECT id, created_at, expires_at, revoked_at, use_count
     FROM auth.registration_tokens
    WHERE revoked_at IS NULL
      AND expires_at > to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')
    ORDER BY expires_at;
   ```
2. **Respaldo previo**: autorizar el `pg_dump` de §6 (conecta a `crv`) y confirmar que abre.
3. **Secretos**: crear `~/apps/crv-landing/api.env` (§4.4) con `CRV_VISITS_SECRET` y
   `CRV_CHAT_SECRET` propios; confirmar que el `.env` de producción es legible por systemd y que
   `DATABASE_URL` apunta a `crv`, no a `crv_staging`.
4. **Migración 0125**: aplicarla antes de la ventana (o autorizar que se aplique) y volver a correr
   `migraciones-2b.sql` hasta `faltan {}`.
5. **Cloudflare**: cambiar el destino del hostname y anotar la regla anterior.
6. **Fecha y hora** (00:00-00:30 de Caracas) y aviso a administradores.
7. **Acceso al panel**: por la máquina o `ssh -L 3131:127.0.0.1:3131 mini-server`; la cookie Secure
   funciona en `http://127.0.0.1`.
8. **Cuenta de colaborador** para la prueba de login real, o autorización para usar una existente.
9. **Decisión de métricas** (§8) y **autorización expresa** de la 2B.

---

## 16. Revisión del guion: qué está probado

SHA del código ensayado: **`03298f7b`**. Lo posterior solo cambia documentación. Worktree limpio,
`npm ci`, `dist` y `dist-public`, API `:8093`, portada `:3150`, panel `:3131`, base `crv_staging`.

| Comando / pieza | Estado | Evidencia |
|---|---|---|
| Typecheck API y web, ESLint dirigido, `build:staging` | probado | verde |
| vitest de login, guarda, roles y portada | probado | 43/43 |
| Lista blanca | probado | 72/72 en `:3150` y `:3141` |
| Flujos con Host/Origin/CF del dominio | probado | `2b-flujos-dominio.mts`, 19/19: radio ES/EN, candidatura y activación con fila `public`, IP real, cookie Secure en `/`, tarea, visita con país, métricas |
| Navegador ES/EN/móvil | probado | `fase2b-ensayo.mjs` 34/34, sin POST a la radio |
| Panel `:3131` | probado | login, cookie, aceptar, invitar |
| Enlaces ocultos | probado | 4 vistas de portada sin enlaces; `/crv` los conserva |
| Tokens | probado | listar y emitir; rechaza otra base y falta de `CRV_ENV_FILE` |
| Respaldo y restauración | probado sobre `4146fd4a` | mismo método; 396 679 B, 27 tablas, conteos iguales. El código posterior no toca el respaldo |
| Guarda real | probado sobre `4146fd4a` | la API aborta contra `crv_staging`; el gateway arranca con `production` y aborta sin radio o sin build |
| 0125 con el comando de §7 | probado | staging, `faltan {}` |
| `fase2b-vuelta-atras.mjs` | probado | 26 ms y 25 ms en la última medida (proxy local; varía de una a otra y **no mide Cloudflare**) |
| Reproducción real de la radio | **no probado** | los POST y YouTube se bloquearon para no alterar la emisión de Herra; se verifica en la ventana |
| Paridad EN con la portada viva | **no probado** | §11 |
| Cloudflare, túnel, `Host` reescrito | no se puede probar antes | Brian |
| 0125, `project_features` y respaldo en `crv` | no se puede probar antes | requieren autorización |
| Métricas con el cambio real | no se puede probar antes | §8 |

---

## 17. Lo que NO hace este documento

No ejecuta la ventana, no toca producción, Herra, Cloudflare ni el Funnel, no instala unidades, no
lee el `.env` de producción, no se conecta a `crv` y no aplica migraciones. El ensayo `:3141` sigue
siendo solo de staging; el de `:3150/:3131` usó `crv_staging`.

---

## Anexo · Evidencia cruda

```
$ systemctl --user list-unit-files 'crv-*' | grep landing
crv-landing-staging.service   enabled   enabled        # no hay crv-landing.service de producción

$ curl -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/roadmap
404
$ curl -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health
200

$ curl -X POST -H 'Origin: https://coleccionistasderockvenezolano.com' \
    -H 'content-type: application/json' -d '{"username":"nadie","password":"nada"}' \
    http://127.0.0.1:3141/api/auth/login
403 {"error":{"code":"untrusted_origin"}}
# con Host y Origin del dominio → 401

$ docker exec crv-postgres-staging pg_dump -U crv -Fc -n auth crv_staging > …dump
395480 bytes
$ docker exec crv-postgres-staging psql -U crv -d crv_2b_restore_test -Atc "select count(*) from auth.users"
5  # y el resto de conteos iguales

$ node scripts/checks/fase2b-vuelta-atras.mjs
{"origenInicial":"A","trasCambio":"B","msCambio":3487,"msVuelta":545}

$ node scripts/checks/fase2b-whitelist.mjs --base http://127.0.0.1:3150
{"comprobaciones":72,"ok":72,"fallos":0}

$ git log --oneline master..HEAD | wc -l
38   # antes de los commits de este trabajo; el SHA de la ventana se fija al autorizar

$ systemctl --user cat crv-api.service | grep WorkingDirectory
WorkingDirectory=/home/brian/apps/Coleccionistas De Rock Venezolano
```
