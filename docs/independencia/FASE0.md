# Fase 0 — Propiedad, staging y archivo

**Fecha:** 2026-10-31
**Plan:** `PLAN_CRV_INDEPENDIENTE_2026-10-31_v3.md` (Fase 0)
**Estado:** ejecutada. Producción, dominio, roadmap de la raíz y funnel intactos.

---

## 1. Qué se hizo

| # | Entregable | Resultado |
|---|---|---|
| 1 | Mapa de un solo escritor por tabla | §3, verificado contra `auth` real |
| 2 | Matriz de roles | §4, objetivo para la Fase 1 |
| 3 | Arquitectura de `/curaduria` | §5, dos grupos |
| 4 | Staging aislado | §6, clúster PostgreSQL aparte + API :8082 + web :3130 |
| 5 | Archivo de `crv-herra` | §7, tag + tar + SHA-256 |
| 6 | Retención de CRV fuera de Herra | §8, movida y verificada |
| 7 | Mesa de Cotejo archivada | §9, PM2 eliminado, :9444 retirado, panel actualizado |
| 8 | Documentación obsoleta señalada | §10 |

---

## 2. Estado verificado al inicio (2026-10-31)

| Pieza | Puerto | Versión | Datos | Servicio |
|---|---|---|---|---|
| `herra` central | 3010/3011 | 1.1.10 | SQLite `data/roadmap.db` | PM2 `herra` |
| `herra-crv` | 3020/3021 | 1.1.31 (vivo; el plan citaba 1.1.30) | PostgreSQL 5433/`crv` | PM2 `herra-crv` |
| Catálogo API | 8080 | 0.1.0 | PostgreSQL 5433/`crv` | systemd `crv-api` |
| Catálogo web | 3120 | 0.1.0 | `web/dist-public` | systemd `crv-web` |
| Funnel | — | — | `/crv` → :3120 | Tailscale Funnel |
| Dominio | — | — | → `herra-crv` :3020 | Cloudflare `cloudflared-herra-crv` |

Evidencias: `pm2 describe`, `systemctl --user cat crv-api crv-web`,
`docker inspect crv-postgres` (`/home/brian/crv-pgdata`), `curl` al dominio
(200), `/crv` en el dominio (404), funnel `/crv` (200), central
`/coleccionistas-rock-venezolano/` (404).

Tamaño de la base: **20 GB**, de los cuales **19,9 GB son `ingest`**
(`change_journal` 6,4 GB, `entity_resolution_decisions` 5,9 GB, `claims` 2,3 GB).
`auth` son 3 MB; `media` 37 MB; `public` 142 MB; `chat` 760 kB.

---

## 3. Mapa de un solo escritor

Regla: durante la construcción, **Herra escribe lo suyo y el catálogo lee**.
El traspaso de escritura ocurre en el host destino (Fase 4), no aquí.

### 3.1 Esquema `auth` (compartido)

| Tabla | Escribe hoy | Escribe al final | Nota |
|---|---|---|---|
| `auth.projects`, `project_assets`, `project_features`, `instance_settings` | Herra | CRV | Config del proyecto único |
| `auth.admins` | Herra | CRV | 3 filas, rol `admin` |
| `auth.users` | Herra | CRV | 5 aprobados; sin columna `role` |
| `auth.people` | Herra | CRV | 5 filas; identidad de colaborador |
| `auth.applications`, `application_links`, `application_catalog_terms` | Herra | CRV | 1 candidatura |
| `auth.activation_tokens`, `registration_tokens` | Herra | CRV | Altas e invitaciones |
| `auth.categories`, `tasks`, `task_assignees` | Herra | CRV | Roadmap; 61 tareas |
| `auth.catalog_terms`, `person_catalog_terms`, `person_links` | Herra | CRV | Vocabulario de comunidad |
| `auth.audit_log` | Herra | CRV | Se conserva; pasa a escribir CRV |
| `auth.project_visits`, `project_visit_stats`, `traffic_daily`, `traffic_visitors` | Herra | CRV | 53 visitas + métricas |
| `auth.herra_sessions` | Herra | — | Se retira con Herra |
| `auth.sessions` | **CRV** (audiencia `crv`) | CRV | No hay co-escritura |
| `auth.local_accounts` | **CRV** (legado) | CRV | 1 fila; decidir retiro en Fase 1 |
| `auth.import_receipts` | Herra (portabilidad) | — | Se archiva con Herra |

### 3.2 Esquemas propios del catálogo

| Esquema | Escribe | Nota |
|---|---|---|
| `public` | CRV | 142 MB |
| `media` | CRV | 37 MB; videos, álbumes, pistas |
| `ingest` | CRV | 19,9 GB históricos |
| `chat` | CRV (`crv-chat`) | 760 kB |

**Conclusión:** la única escritura compartida real es `auth`, y ya está
partida por tabla/audiencia. No hay que migrar datos, solo cambiar de dueño.

---

## 4. Matriz de roles (objetivo Fase 1)

Roles actuales: 3 administradores (`auth.admins`, rol `admin`), 5 usuarios
aprobados (`auth.users`, `status='approved'`, sin rol) y 1 cuenta local de CRV.

| Rol objetivo | Catálogo | Comunidad | Cuentas | Roadmap/visitas/radio |
|---|---|---|---|---|
| Lector | lectura | lectura | no | no |
| Colaborador | propone claims y comenta | lectura + chat | no | no |
| Curador | edita fichas, medios y claims | lectura | no | no |
| Admin de comunidad | lectura | modera | crea/aprueba/revoca | sí |
| Admin total | todo | todo | todo | todo |

Mapeo inicial: `auth.users` aprobados → colaborador; `auth.admins` → admin
total; cuenta local → admin total hasta migrarla. La aplicación de esta matriz
es la Fase 1 (middleware por área, denegar por defecto, pruebas por rol).

---

## 5. Arquitectura de `/curaduria` (admin único)

Un solo shell con dos grupos en la barra lateral:

**Catálogo** (ya existe): Resumen, Hallazgos, Correcciones, Imágenes, Autofix,
IA, Búsqueda, Duplicados, Historial.

**Comunidad** (nuevo, Fases 1-3):

| Ruta | Función | Origen Herra |
|---|---|---|
| `/curaduria/colaboradores` | alta, edición, aprobación, códigos, invitaciones | `admin.ejs` §usuarios, `users.service.ts`, `invites.service.ts` |
| `/curaduria/candidaturas` | bandeja y aceptación | `applications.service.ts` |
| `/curaduria/roadmap` | tareas, categorías, mover, traducciones | `roadmap.service.ts` |
| `/curaduria/visitas` | contador y métricas | `visits.service.ts`, `metrics.service.ts` |
| `/curaduria/radio` | estado, programación y disponibilidad | `radio.service.ts` |

No se construyó UI en la Fase 0: sería cosmética sin los datos y permisos de
la Fase 1. La estructura queda fijada aquí.

---

## 6. Staging aislado

### 6.1 Diseño

| Pieza | Producción | Staging |
|---|---|---|
| PostgreSQL | `crv-postgres` :5433, pgdata `/home/brian/crv-pgdata` | `crv-postgres-staging` :5435, pgdata `/mnt/datos/crv-staging/pgdata` |
| Base | `crv` | `crv_staging` (clon parcial: esquema completo + datos pequeños) |
| API | :8080, `.env` del repo | :8082, `CRV_ENV_FILE=~/apps/crv-staging/staging.env` |
| Web | :3120, `dist-public` | :3130, `dist-staging` |
| Chat | :8081 | deshabilitado (proxy a :8099) |
| Túnel | Funnel `/crv` | ninguno |

Por qué un clúster aparte: el staging anterior en la misma base chocaba con
las FKs históricas al omitir tablas, y compartir clúster permite locks y
sesiones cruzadas. El clúster en `/mnt/datos` da aislamiento real. El puerto
5434 estaba ocupado por `mercancia-control-postgres-1`; se usa 5435. No se tocó
`crv-staging-e4` (otro staging en uso, ajeno a esta fase).

La copia **completa** (20 GB) se intentó y se descartó en esta sesión: el
volcado avanzaba a ~1 MB/s por contención de disco con producción, lo que
suponía horas. El modo por defecto es **parcial**: esquema completo, datos de
`auth`/`public`/`media`/`chat` y el resto de `ingest`; se omite el DATO de 12
tablas históricas (19,4 GB) y, como consecuencia, **21 constraints FK no se
recrean** (las filas hijas conservan referencias huérfanas). Para las fases
1-3 es suficiente. Si una prueba necesita el histórico, se recarga con
`scripts/staging-db.sh refresh --full`.

Resultado medido: **660 MB**, `users=5`, `admins=3`, `tasks=61`, `albums=649`,
`claims=0`, `sessions=0`.

### 6.2 Archivos

- `scripts/staging-db.sh` — crea/recarga/verifica/elimina el clúster de staging.
- `scripts/staging-setup.sh` — entorno, build, unidades y arranque verificado.
- `ops/staging/crv-api-staging.service`, `ops/staging/crv-web-staging.service`.
- `ops/staging/README.md`.

### 6.3 Cambios de código necesarios

- `src/config/env.ts`: `CRV_ENV_FILE` permite leer un entorno propio; sin la
  variable se conserva el `.env` del repo.
- `web/server.mjs`: `CRV_WEB_DIST` elige el directorio servido (`dist-public`
  por defecto, `dist-staging` en staging). Así compilar staging no altera lo
  que sirve el funnel.
- `web/package.json`: script `build:staging`.
- `.gitignore`: `dist-staging/`.

### 6.4 Reglas

- El staging no se publica: solo 127.0.0.1, sin Funnel ni Cloudflare.
- `auth.sessions` y `auth.herra_sessions` se truncan al clonar.
- `CRV_YT_INTAKE_ENABLED`, `CRV_DISCOVERY_ENABLED` y `GENRES_EXTERNAL_ENABLED`
  en `false`; sin claves de YouTube ni DeepSeek. El staging no gasta cuota.
- Recarga: `scripts/staging-db.sh refresh` (parcial, ~1 min) o
  `refresh --full` (20 GB, lento con el disco ocupado).
- Eliminar: `scripts/staging-db.sh drop --purge` (libera los ~660 MB del clon
  parcial y el pgdata).

---

## 7. Archivo de `crv-herra`

- Tag local: `archive/pre-independencia-2026-10-31` (commit `226bacb`).
- Archivo: `/mnt/datos/backups/crv-herra-archive/crv-herra-2026-10-31.tar.zst` (61 MB).
- SHA-256: `e68503ccfa51278d62d62697fb064660225e0bc562befb7bf576e8ee251126bb`.
- Incluye el árbol de trabajo (18 archivos sin commitear) y `.git`; excluye
  `node_modules`, `data`, `reports`, `tmp-analysis`, medios y builds.
- README con exclusiones y advertencia documental en la misma carpeta.

---

## 8. Retención de CRV fuera de Herra

- Archivo: `herra-antes-retiro-20260929.db.gpg` (342 KB) + `policy.json`.
- Destino: `/mnt/datos/backups/crv/retention-2026-10/`.
- Clave: `/mnt/datos/backups/crv/retention-2026-10-key/herra-retention.key`
  (separada del archivo, 600).
- SHA-256 verificado antes y después:
  `0b02e5133677454bbd490819b774f7c27a75d67c7675c42b060c6e78335dab52`.
- Destrucción prevista: 2027-09-29. Falta copia fuera del servidor (pendiente
  heredado de la etapa 5).
- Los archivos de configuración de Herra (`.env` central, túnel) se quedan en
  `herra-retention`: no son datos de CRV.

### 8.1 Mapa de secretos

| Secreto | Dónde está | Dueño | Acción |
|---|---|---|---|
| Credencial Google Sheets | instancia `herra-crv` (`secrets/service-account-radio-sheet.json`) | compartida con la central | Se queda (decisión 5); rotar y transferir en la entrega |
| Clave del archivo de retención | `/mnt/datos/backups/crv/retention-2026-10-key/` (600) | CRV | Separada del archivo; falta copia fuera del servidor |
| Contraseña de PostgreSQL | `.env` del repo y `staging.env` (600) | CRV | La de staging no se versiona |
| Claves de YouTube/DeepSeek | `.env` del repo | CRV | **No** se copian al staging; el staging no gasta cuota |
| Tokens de túnel | `herra-instances/herra-crv/secrets/` | Herra hasta la entrega | Se transfieren con el dominio |

Nada de esto se versionó ni se imprimió en la sesión.

---

## 9. Mesa de Cotejo archivada

- Cobertura comprobada: la edición de géneros por entidad existe en el
  catálogo (`web/src/components/GenreEditor.tsx` y las fichas). Las **colas por
  lote** de la Mesa (`/api/genres/queue`, `/api/genres/batches`) no tienen
  equivalente exacto en curaduría: quedan documentadas como hueco a portar si
  se usan. El resto de la Mesa era revisión de nombres, cubierta por curaduría.
- Acciones: `pm2 delete crv-cotejo`, `pm2 save`, `tailscale serve --https=9444
  off`; puerto 4310 cerrado; entrada eliminada de
  `panel-servidor/src/registry.ts` (y panel reiniciado) para que el vigilante
  no la resucite.
- El código permanece en el repo. Reversión:
  `pm2 start scripts/with-node22.sh --name crv-cotejo -- node_modules/.bin/tsx src/cotejo/server.ts`
  y volver a añadir la entrada al registry y el serve de :9444 si se desea.

---

## 10. Documentación obsoleta

- `crv-herra/docs/HANDOFF.md` dice SQLite y motor 1.1.8; la realidad es
  PostgreSQL y 1.1.31 (el motor subió de 1.1.30 a 1.1.31 durante la sesión;
  dato vivo: `pm2 describe herra-crv` antes de cada fase). Queda archivado con aviso explícito.
- `panel-servidor/src/registry.ts` actualizado: Herra 1.1.10, retención en la
  ruta nueva, Postgres 20 GB, Mesa de Cotejo retirada.

---

## 11. Verificación de la fase

```bash
# Producción intacta
curl -s -o /dev/null -w '%{http_code}\n' https://coleccionistasderockvenezolano.com/
curl -s -o /dev/null -w '%{http_code}\n' https://coleccionistasderockvenezolano.com/crv   # 404
curl -s -o /dev/null -w '%{http_code}\n' https://mini-server.tail5815b0.ts.net/crv          # 200

# Servicios de producción
pm2 list | grep -E 'herra-crv|cloudflared-herra-crv|panel-servidor'
systemctl --user is-active crv-api crv-web

# Staging
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8082/health   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3130/crv/     # 200
scripts/staging-db.sh check

# Archivos
sha256sum -c /mnt/datos/backups/crv-herra-archive/*.sha256
sha256sum /mnt/datos/backups/crv/retention-2026-10/herra-antes-retiro-20260929.db.gpg

# Mesa de Cotejo
ss -ltn | grep 4310 || echo '4310 cerrado'
tailscale serve status | grep 9444 || echo '9444 retirado'
```

Resultados de la ejecución (2026-10-31, 20:13):

- `:8082/health` → `{"ok":true,"database":true}`; `:3130/crv/` → 200 con
  `<title>CRV · Catálogo`; login inválido por el proxy → 401.
- `crv_staging`: 660 MB, `users=5`, `admins=3`, `tasks=61`, `albums=649`,
  `claims=0`, `sessions=0`.
- `:8082` y `:3130` solo en 127.0.0.1; sin ruta en Tailscale ni Cloudflare.
- `dist-public` conserva su mtime del 30/10: el build de staging no lo tocó.
- Dominio 200 con `#roadmap` y `#radio`; `/crv` en el dominio sigue 404;
  funnel `/crv` 200.
- `herra-crv` sigue online y sirviendo el dominio.

### Limitaciones de la ejecución

- `npm run lint` sobre todo el repo excedió 300 s. Sí pasan `npm run typecheck`, el build de
  staging y `eslint` sobre `src/config/env.ts`.
- Sin commit: el árbol tiene 60 archivos modificados ajenos; estos cambios quedaron en el working
  tree (`.gitignore`, `src/config/env.ts`, `web/package.json`, `web/server.mjs`,
  `docs/independencia/`, `ops/staging/`, `scripts/staging-*.sh`).
- El staging es parcial (§6.1): 12 tablas históricas vacías y 21 constraints FK sin recrear.
- Falta la copia fuera del servidor de la clave de retención (§8).

---

## 12. Qué sigue (Fase 1)

Identidad, colaboradores y candidaturas **en staging, sin activar**:

1. CRV dueño de `auth` con los hashes scrypt existentes; sesiones propias.
2. Rutas y páginas de colaboradores (alta, aprobación, códigos, invitaciones,
   activaciones).
3. Formulario público de candidatura, bandeja y aceptación (persona + cuenta +
   rol).
4. Matriz de roles aplicada con middleware y pruebas por rol.
5. i18n ES/EN de estos módulos y del shell público.

Nada de esto toca producción ni el dominio: se verifica en `:3130` y se activa
en la Fase 4, en el host del operador.
