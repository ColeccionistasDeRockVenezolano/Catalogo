# Fase 2B · Guion de la ventana (NO EJECUTADA · NO LISTA PARA AUTORIZAR)

**Estado (2026-11-02):** el ensayo se hizo con la **forma de producción** y la base
`crv_staging`: worktree limpio por SHA, `npm ci`, build `dist` y `dist-public`, API propia,
portada en la raíz y panel privado en `:3131`. Pasó lo que se podía probar antes. **La ventana
sigue sin autorizar** por las puertas de §10 y por la migración 0125.

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
- El guion **se detiene** si `faltan` no está vacío. No se ejecuta ninguna migración contra
  producción desde este trabajo.

---

## 8. Métricas después del cambio (decisión de Brian)

Hoy Herra registra las vistas de página en `auth.traffic_daily`; tras el cambio no verá ninguna.
CRV no escribe (`CRV_TRAFFIC_ENABLED=false`). El contador de la portada (`auth.project_visits`) sí
funciona. Opciones:

- **(a) recomendada:** encender el tráfico de CRV en la ventana: en `api.env`
  `CRV_TRAFFIC_ENABLED=true` y `CRV_TRAFFIC_TOKEN=<secreto>`; en `gateway.env`
  `CRV_TRAFFIC_REPORT=1` y el mismo token. Es configuración, no código; 3.7 vuelve a tener tráfico
  de página. Verificar con una visita real (país y clasificación) y que Herra deja de escribir.
- **(b)** dejar 3.7 con el histórico de Herra y sin tráfico nuevo de página hasta la Fase 4.

No se enciende nada en producción en este trabajo.

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
| G7 | Migración 0125 aplicada en producción | **pendiente, Brian** |
| G8 | Panel privado `:3131` | **decidido (a)** y probado |
| G9 | Enlaces de cuenta ocultos | **decidido** y probado |
| G10 | Cloudflare, fecha y autorización expresa | **Brian** |

G7 es la única puerta nueva que puede obligar a cambiar el orden: si 0125 no está aplicada, la 2B
funciona pero pierde la auditoría de candidaturas y activaciones.

---

## 11. Paridad con la portada viva

Foto local de la portada viva (solo GET; sin POST al contador de Herra), servida en `:3146` y
comparada contra `:3141` (staging raíz) y `:3150` (forma de producción). El servidor de la foto se
mantuvo entre pasos y se apagó al terminar.

| Página | `:3141` (frases vivo/raíz, solo vivo/raíz) | `:3150` |
|---|---|---|
| `/` | 54/52 · 7/5 | 54/51 · 12/9 |
| `/colaborar` | 19/18 · 2/1 | 19/21 · 5/7 |
| `/login` | 2/2 · 0/0 | 2/2 · 0/0 |

Las diferencias son los bloques dinámicos de visitas, la radio en curso y los contadores de
Herra; `/login` coincide exacto. La foto es de Herra antes del cambio: no se compara CRV consigo
mismo.

---

## 12. La ventana (00:00-00:30 de Caracas) — borrador

> **No ejecutar sin G1-G10 cerradas y autorización expresa.** A medianoche cambia el día de
> `America/Caracas` y nadie cuenta dos veces la misma visita (F2-2).

**Paso 0 · Preflight.** `git status`, `shared-storage.py status`, `ss` de `3140/8083/3131`,
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

| Comando / pieza | Estado | Evidencia |
|---|---|---|
| `npm run typecheck` (API) | **probado** | verde |
| `npm --prefix web run typecheck` | probado | verde |
| `vitest` de login (`auth.test.ts`) | probado | 12/14; 2 fallos **preexistentes** (`request.operator` nombre vs usuario y `admin_required` vs `forbidden_role`, de commits aa562976/53c350f7, ajenos a este trabajo) |
| `vitest` de guarda y roles | probado | 7/7 + 3/3 |
| `build:staging` | probado | verde (9,2 s; 6 estáticos copiados) |
| `fase2b-whitelist.mjs --base :3150` | probado | 72/72 |
| `GET /api/radio/now` por el proxy | probado | 200 |
| Candidatura real con `Host`/`Origin`/CF | probado | 200, `source_addr` correcta |
| Login con cookie Secure `/` | probado | cabecera + Chromium |
| Cambio de estado de tarea asignada | probado | 200, `in_progress` |
| Visita con país y deduplicación | probado | `ve` +2, filas revertidas |
| Panel `:3131` aceptar/invitar | probado | login, cookie Secure, aceptar, invitar |
| Enlaces ocultos ES/EN 1440/390 | probado | 0 `href` en portada; `/crv` los conserva |
| `CRV_BACKGROUND_JOBS=false` | probado | log + 0 escaneos |
| Respaldo/restauración | probado | 395 480 B, conteos iguales |
| `community-tokens.ts` | probado | listar, emitir, validar, guardas 2/3 |
| Paridad contra foto | probado | §11 |
| 0124 sin aplicar (transacción) | probado | CHECK bloquea curator/community |
| 0125 up/down (transacción) | probado | INSERT public pasa; down aborta con filas |
| `migraciones-2b.sql` | probado | staging: faltan {0125}, sobran {0124} |
| `fase2b-vuelta-atras.mjs` | probado | 3 487 / 545 ms (proxy local) |
| Cloudflare, túnel, `Host` reescrito | **no se puede probar antes** | requiere la ventana; Brian |
| Migración 0125 en producción | **no se puede probar antes** | requiere autorización |
| Respaldo de `crv` real | **no se puede probar antes** | prohibido conectar a producción |
| Métricas 3.7 tras el cambio | **no se puede probar antes** | decisión de Brian |

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
