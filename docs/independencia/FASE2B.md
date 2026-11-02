# Fase 2B · Guion de la ventana (NO EJECUTADA · NO LISTA PARA AUTORIZAR)

**Estado (2026-11-02, revisión de Claude):** el ensayo con la **forma de producción** y la base
`crv_staging` se repitió sobre `dd46cecd`, ya con `/account` y `/admin` en la portada, y pasó (§16). **La ventana se ejecutó el 2026-11-02** (§12). La
versión anterior habría quitado la radio de la portada; ver §1.1.

**Referencia de paridad:** Herra **1.1.39**, congelada por decisión de Brian (2026-11-01). No se compara
contra 1.1.34.

**Qué publica la 2B:** `coleccionistasderockvenezolano.com` sirve desde CRV la portada (roadmap),
`/colaborar`, `/login`, `/registro` y `/activar`, con visitas, candidaturas y tareas escritas por
CRV. El catálogo NO se publica: fuera de la lista blanca, 404. La radio sigue en Herra hasta la
Fase 3.

**Cambio de alcance (Brian, 2026-11-02):** la portada también lleva `/account` («Mi perfil» 1:1) y
`/admin` (el panel), con el recorrido de Herra completo y sin camino al catálogo. Sustituye lo de
abajo sobre ocultar «Mi cuenta» y «Gestionar proyecto» y sobre el panel solo local. Es temporal y su
retirada está en [PUERTA-TEMPORAL.md](PUERTA-TEMPORAL.md).

**Decisiones anteriores de Brian, salvo lo que cambia el párrafo de arriba:** panel privado en `127.0.0.1:3131` contra `:8083` (solo local,
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

### 1.2 La sombra de la radio: causa encontrada (Fase 3)

`crv-radio-sombra` pasó 45 veces sin divergencias y diverge desde **2026-11-01 20:00 UTC**. **No es un
fallo del motor.** Por orden de Brian, producción pasó `everyPieces` de 5 a 3, con época
`2026-09-07T19:09:18.774Z` para no cortar la canción. `crv_staging` conserva 5 y la época
`2026-09-07T23:16:33.912Z`, y la sombra lee su configuración de staging. Cada cuña de más en Herra suma
5,4 s (1,4 s de cuña + 4 s de cruce), de ahí el desfase creciente.

Comprobado sin leer la base de producción: con 3 y esa época, el motor de CRV iguala todos los campos de
`/api/radio/now` y acierta el `startsAt` de las **41 de 41** divergencias registradas. El código de
`radio.service.js` es idéntico de 1.1.36 a 1.1.39. Staging se corrigió el 2026-11-01 con esos valores y la sombra avisa si la cuña vuelve a
diferir. El plazo de 7 a 14 días de la Fase 3 se cuenta desde esa corrección.

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
de la portada (`auth.project_visits`) sigue funcionando porque es otra tabla. Brian eligió la opción
(a) de §8; se enciende en la ventana, no antes.

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
*Superado el 2026-11-02:* ahora van a `/account` y `/admin`, que sí existen en la portada.
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
- El guion **se detiene** si `faltan` no está vacío. 0125 se aplicó en `crv` el 2026-11-01 con
  autorización de Brian; ninguna otra migración se ejecuta contra producción desde este trabajo.

---

## 8. Métricas después del cambio (decidido: opción a)

Hoy Herra registra las vistas de página en `auth.traffic_daily`; tras el cambio solo verá la radio.

- **(a) elegida por Brian (2026-11-01) y ensayada:** `CRV_TRAFFIC_ENABLED=true` y `CRV_TRAFFIC_TOKEN=<secreto>` en
  `api.env`, y `CRV_TRAFFIC_REPORT=1` con el mismo token en `gateway.env`. Registró la visita con país
  y categoría aun con los trabajos apagados.
- **(b) descartada:** dejar 3.7 con el histórico de Herra, sin vistas nuevas, hasta la Fase 4.

No probado: que Herra deje de sumar páginas tras el cambio real; se comprueba en la ventana.

---

## 9. El ensayo con forma de producción (base `crv_staging`)

La repetición vigente, sobre `dd46cecd` y con el panel en el dominio, está en §16. Esta tabla es la
primera pasada y conserva el panel privado `:3131`, ya sustituido.

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
| G2 | `api.env`, `gateway.env` con secretos propios y `.env` legible por systemd | **hecha 2026-11-02** en `~/apps/crv-landing/` (0600). `admin.env` no hace falta: no se instala `crv-web-admin` |
| G3 | Worktree del SHA con `dist` | probado en `810fa51a`; fijar SHA al autorizar. `dist-public` solo hace falta si se quiere conservar `crv-web-admin` |
| G4 | Respaldo probado y restauración comparada | **probado** (§6) |
| G5 | Guion de tokens probado | **probado** (§4) |
| G6 | Paridad contra foto de Herra | **probada** (§11) |
| G7 | Migración 0125 aplicada en producción (§7) | **superada:** aplicada 2026-11-01 y confirmada 2026-11-02 con `migraciones-2b.sql`: 124 esperadas, 124 aplicadas, 124 coinciden, `faltan {}`, `sobran {}` |
| G11 | Métricas (a) y Herra 1.1.39 **decididas**; paridad EN (§11) | **superada 2026-11-02** (§11). `/activar` y `/register` iguales al dominio. `/account` y `/admin` no se abrieron en el dominio por pedir sesión: textos idénticos a Herra 1.1.39 y plantillas que solo cambian rutas y permisos |
| G8 | Panel | **superada por la decisión del 2026-11-02:** `/admin` en el dominio; `crv-web-admin` `:3131` queda opcional. Probado (§16) |
| G9 | Enlaces de cuenta | **superada por la misma decisión:** la cabecera ofrece Mi perfil y Administrar proyecto. Probado (§16) |
| G10 | Cloudflare, fecha y autorización expresa | **hecha 2026-11-02**, §12 |

Sin 0125, la 2B funcionaría pero perdería la auditoría de candidaturas y activaciones; ya está aplicada.

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

**Inglés, 2026-11-02** (`reports/paridad-en-2026-11-02` y `-b`). El dominio cambia de idioma con `GET /lang/en`, que deja la cookie `herra-crv_lang`. Comparados `/`, `/colaborar` y `/login` en 1440 y 390, con los POST bloqueados para no contar visitas. Para la última pasada, staging se igualó a producción (`collaborate_json` nulo, `show_login=0`, `heroSubPublic` en inglés) y se restauró (md5 igual).

| Diferencia en EN | Clase |
|---|---|
| El idioma no se conservaba: `/lang/en` 404, cookie ignorada, enlaces que volvían al español | **Corregido en `36b534d8`.** Whitelist 93/93; clic en el selector y navegación conservan el idioma |
| Texto de la portada, `/colaborar` y `/login` | **Sin diferencias**, salvo los datos de abajo |
| Contadores, países, «Last updated», `ONLINE` | Dato de staging o dinámico |
| La radio no arrancaba sola: el dominio carga el reproductor al abrir; CRV esperaba a «Join live» | **Corregido en `408faf06` por decisión de Brian:** el mismo `public-loader.js` del dominio |

La radio en `127.0.0.1` acaba en `error`, pero eso es el origen de la prueba: con el origen del dominio simulado (nada sale hacia él) llega a `live` y el reproductor de YouTube responde 200, con `no-referrer` y sin él. Es navegador sin sonido: el audio real sigue sin probarse.

`/activar` y `/register` con token inválido: sin diferencias (`/registro` es dirección nueva de CRV; en el dominio da 404). `/account` y `/admin` piden sesión y no se abrieron en el dominio: `i18n.js` es idéntico al de Herra 1.1.39 y sus plantillas solo cambian rutas y permisos.

---

## 12. La ventana (00:00-00:30 de Caracas) — borrador

> **No ejecutar sin G1-G10 cerradas y autorización expresa.** A medianoche cambia el día de
> `America/Caracas` y nadie cuenta dos veces la misma visita (F2-2).

**Paso 0 · Preflight.** Comprobar que `SELECT enabled FROM auth.project_features WHERE feature = 'radio'` da 1 (sin ello no hay tarjeta); `git status`, `shared-storage.py status`, `ss` de `3140/8083/3131`,
`curl` a dominio/Herra/`:8080`, y la consulta `migraciones-2b.sql` con `faltan` vacío.

**Paso 1 · Congelar el `/admin` de Herra** (Brian).

**Paso 2 · Respaldo** de §6; anotar ruta, tamaño y `sha256`.

**Paso 3 · Arrancar** `crv-api-landing` y `crv-landing` (`crv-web-admin` solo si se decide conservarlo). Verificar
`/health` (`{"ok":true,"database":true}`), `/roadmap` 200 en `:3140`, whitelist 80/80, y el POST
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

### Ventana ejecutada el 2026-11-02, 08:47 de Caracas

Por orden de Brian («Haz G11, G2 y G10 ya»), de día y no a medianoche: quien ya había entrado ese día puede contar dos veces.

- **Cloudflare**, túnel `herra-crv`: `coleccionistasderockvenezolano.com` pasó de `http://127.0.0.1:3020` a `http://127.0.0.1:3140`. `www` sigue en `:3020`: Herra la redirige con 308 al dominio, así que **necesita a Herra encendido** hasta la Fase 3.
- **Código:** `crv-api-landing` en `810fa51a`; `crv-landing` en `775457e7` desde la corrección del cierre de sesión (`17d1fc0a` en la ventana). Unidades habilitadas; `crv-web-admin` no se instaló.
- **Respaldo:** `/mnt/datos/backups/crv/auth-2B-20261102T124020Z.dump`. **Foto:** `reports/ventana-2b-foto-herra-2026-11-02`.
- **Cierre de sesión roto tras la ventana.** Brian no podía cerrar sesión: por el túnel, un POST sin cuerpo llega como `chunked` y sin content-type, y la API respondía 415. El ensayo no lo vio porque el navegador contra localhost manda `content-length: 0` y porque no probaba el cierre de sesión. Corregido en el gateway (`775457e7`, reinicio de 194 ms). Prueba: `scripts/checks/gateway-sin-cuerpo.mjs`, solo contra staging. Los otros POST sin cuerpo del panel tenían el mismo riesgo; los registros solo muestran 415 en el cierre de sesión.
- **Defectos que el ensayo no podía ver,** porque bloqueaba los POST de la radio y corría fuera del dominio. Corregidos en caliente en `17d1fc0a`: cuña en 404, oyentes y avisos de veto en 403 por el CSRF de Herra, y analítica de Cloudflare bloqueada por la CSP.
- **Verificado desde fuera:** whitelist 96/96, texto igual a la foto en ES y EN, navegador 1440 y 390 con radio en `live`, cuña 200 y oyentes 200, 12 rutas prohibidas en 404, catálogo del Funnel 200, sin 5xx en los registros.
- **Pendiente con Brian:** login real, sonido real, contador de visitas, tokens de §15, candidatura de prueba. **Observación de 72 h** (§14) hasta el 2026-11-05.

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
Brian/operador por `/admin` del dominio contra `:8083`; Herra sigue congelado hasta la vuelta
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
4. **Migración 0125**: aplicada y confirmada el 2026-11-02 (`faltan {}`, `sobran {}`). Repetir `migraciones-2b.sql` en el preflight.
5. **Cloudflare**: cambiar el destino del hostname y anotar la regla anterior.
6. **Fecha y hora** (00:00-00:30 de Caracas) y aviso a administradores.
7. **Acceso al panel**: por `/admin` del dominio, con la cuenta de administración de siempre.
8. **Cuenta de colaborador** para la prueba de login real, o autorización para usar una existente.
9. **Autorización expresa** de la 2B.

---

## 16. Revisión del guion: qué está probado

SHA del código ensayado: **`810fa51a`** (2026-11-02). Lo posterior solo cambia documentación.
Worktree limpio, `npm ci`, `dist`, API `:8093`, portada `:3150` con `/account` y `/admin`, base
`crv_staging`, `CRV_DEPLOYMENT=rehearsal`, trabajos de fondo apagados.

**Repetición sobre `810fa51a`** (idioma conservado y radio al abrir): whitelist **93/93**, `fase2b-ensayo` **34/34**, `2b-flujos-dominio` sin fallos, panel **50/50**, `e2e-flujos` **46/46**, `clave-unica` **31/31**, vuelta atrás 41 ms y 9 ms (proxy local; **no mide Cloudflare**). Radio con el origen del dominio simulado: al abrir carga el reproductor, y al activar el sonido queda en `live`, sin audio real.

**Repetición anterior, sobre `dd46cecd`:**

| Prueba | Resultado |
|---|---|
| `fase2b-whitelist.mjs --base :3150` | **80/80** |
| `fase2b-ensayo.mjs --base :3150` | **34/34**, sin POST a la radio |
| `2b-flujos-dominio.mts`, ahora administrando por `/admin` del dominio | **19/19** |
| `panel-herra-browser.mjs` con `CRV_PANEL_BASE=:3150` | **50/50**: 12 herramientas, etapas y actividades, arrastre con ratón, teclado y dedo emulado, 390 px, candidatura por clics hasta login, `community`, inglés; staging restaurado |
| `e2e-flujos.mts` (API de staging `:8082`) | **46/46**: candidatura, invitación, tarea, revocación y matriz de roles |
| `clave-unica.mjs` (API de staging `:8082`) | **31/31** |
| `fase2b-vuelta-atras.mjs` | 1.758 ms y 8 ms (proxy local; **no mide Cloudflare**) |

La API tarda unos segundos en abrir el puerto: durante ese intervalo el gateway da 502 en sus rutas de API
(el primer intento del ensayo cayó ahí). La ventana debe esperar a `/health` antes de cambiar el túnel,
como dice su paso de verificación.

**Pasada anterior (`03298f7b`), con panel privado y lo que sigue sin repetirse:**

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
| `project_features` y respaldo en `crv` | no se puede probar antes | requieren autorización |
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

## Panel del roadmap: plantilla de Herra (2026-11-02)

Por pedido de Brian, `/curaduria/roadmap` deja de ser la versión React con la piel
del catálogo y pasa a ser el documento de Herra 1.1.39: `src/landing/views/admin.ejs`,
`web/public/landing/admin.js` y `metrics.js`, con su arrastre (ratón, táctil y
teclado) y sus 87 ventanas. Los datos salen de `auth.*` mediante
`src/landing/admin-panel.ts`; la API es `src/api/routes/admin-panel.ts`, bajo
`/community/admin/panel/`, protegida por el guardián de sesión, rol y CSRF.
Copias del motor en `src/landing/herra/`. El gateway lo sirve sin caché y manda a
`/login` a quien no tenga sesión; la portada de la raíz (`:3140`) no lo publica.
React salta al documento salvo en desarrollo. `CurationRoadmapPage` y sus ventanas
quedan sin uso hasta decidir si se borran.

Ensayado solo en staging. Falta el arrastre con un dedo real en un móvil. Desde el
cambio del 2026-11-02 también se publica en `/admin` del dominio.

**La demora de 1 a 7 s ya tiene causa** (2026-11-02): una pestaña abierta en `/crv/curaduria` pedía
cada 60 s `/persons/duplicate-candidates?limit=1` solo para su contador, y ese cálculo en memoria
bloquea el bucle de eventos de la API de 1,7 a 2,7 s; mientras tanto esperan todas las demás
peticiones, `/health` incluido (hasta 949 ms medidos). Se corrigió con `/persons/duplicate-candidates/count`
(4-16 ms; commit `20da3ca9`). La API del dominio no recibe esa ruta. Una pestaña abierta con el código
anterior sigue sondeando hasta recargarla.

**Fallo que las pruebas anteriores no veían** (commit `b2fe3c8e`): `request()` del panel declaraba JSON
sin cuerpo, de modo que borrar, aprobar, rechazar, crear enlaces, activar y revocar daban 400 con
«[object Object]». Ahora la aceptación es `scripts/checks/panel-herra-browser.mjs`. Los guiones
`b6`-`b10`, `c5`, `p7`, `e2e-roles-ui`, `admin-parity-capture`, `b7-touch-check` y `2b-panel-rehearsal`
apuntan al panel React retirado y **ya no prueban el panel**.

No probado: el efecto en la portada de Formulario, Identidad, Idiomas y tema guardados.
`default_lang` se guarda (incluido `system`), pero el gateway no lo aplica a la
elección inicial de idioma: sin `?lang=en` sirve español.
