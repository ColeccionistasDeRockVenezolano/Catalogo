# Fase 2B · Guion de la ventana (NO EJECUTADA)

**Estado:** puertas preparadas y ensayadas en local. **La ventana no se ha ejecutado** y no se
ejecuta sin autorización expresa de Brian. Este documento es el guion que se seguirá ese día.

**Referencia de paridad:** Herra **1.1.39**, congelada por decisión de Brian (2026-11-01). No se
compara contra 1.1.34 ni se actualiza Herra antes de la 2B.

**Qué publica la 2B:** `coleccionistasderockvenezolano.com` pasa a servir desde CRV la portada
(roadmap), `/colaborar`, `/login`, `/registro` y `/activar`, con visitas, candidaturas y tareas
escritas por CRV. El catálogo NO se publica: todo lo que no esté en la lista blanca responde 404.
La radio sigue emitiéndose desde Herra hasta que la Fase 3 cumpla.

## 1. Lo que ya está hecho (ensayo en local)

| Pieza | Dónde | Comprobación |
|---|---|---|
| Instancia raíz de staging | `crv-landing-staging.service` → `127.0.0.1:3141` (`CRV_WEB_MODE=landing`, `CRV_PUBLIC_PATH=`, secretos propios en `~/apps/crv-staging/landing.env`) | `systemctl --user is-active crv-landing-staging` → active |
| Lista blanca en el gateway | `web/server.mjs` → `landingWhitelist()` | `node scripts/checks/fase2b-whitelist.mjs` → **72/72** (incluye doble barra, barra invertida, rutas codificadas, mayúsculas y `sitemap-*.xml`) |
| Radio a Herra mientras dure la transición | `CRV_RADIO_PROXY_URL=http://127.0.0.1:3020`; `/api/radio/{now,listener,unavailable}` se reenvían con su prefijo `/api` | `GET :3141/api/radio/now` → 200 con `phase` de Herra |
| Ensayo §5.2.2 (ES, EN, móvil) | `node scripts/checks/fase2b-ensayo.mjs` | **34/34**; los POST a `/api/radio/listener` y `/unavailable` se bloquean en el navegador para no alterar la emisión real |
| Paridad con la portada viva (solo GET) | `node scripts/checks/fase2b-paridad.mjs` | Coinciden los textos y bloques principales; diferencias anotadas abajo |
| Vuelta atrás ensayada | `node scripts/checks/fase2b-vuelta-atras.mjs` (proxy desechable en :3145) | Cambio de destino y vuelta: 10 ms la vuelta; la ida midió 9 s por el primer render del destino nuevo (no por el cambio) |

### Diferencias observadas en la paridad

- **Contadores de visitas**: el dominio (Herra) y la raíz (CRV) leen bases distintas; los números
  no pueden coincidir antes de la ventana.
- **Acceso**: la raíz muestra «Entrar / Acceso del equipo» porque `show_login=1` en el proyecto de
  staging; la portada viva no lo muestra. Es un ajuste del proyecto, no una diferencia de código.
- **Radio**: la canción en curso y los oyentes son los de Herra en ambos casos (misma fuente por
  el proxy), pero el instante de la petición cambia el resultado.
- **`llms.txt` y sitemaps**: ya no están en la lista blanca. En modo portada responden 404, y
  `robots.txt` es propio (sin `/api`, sin `/curaduria` y sin `Sitemap`). El catálogo no se anuncia
  porque no se publica en la 2B.

## 2. Antes de abrir la ventana (puertas de §5.2)

1. Fase 2A cumplida (B0-B4, correcciones del Anexo B): **cumplida**. B4 ya no depende de
   permiso: `crv-api` se reinició solo a las 14:35:28 y 18:35:42 (origen no confirmado en
   ambos) y `crv-web` a las 15:59:20 con permiso de Brian; rutas de la Fase 2 ya en 404).
2. Ensayo completo en :3141 con la lista blanca, ES/EN y móvil: **cumplido**.
3. Paridad de contenido con la portada viva el mismo día: **cumplido con las diferencias anotadas**.
4. Cierre de la Fase 2 (C1-C12 y CP0): **cumplido contra las instrucciones**. Las ventanas
   3.1-3.6 tienen capturas de Herra 1.1.39; las 3.7-3.13 y `/cuenta` se aceptan contra las
   instrucciones por decisión de Brian (ventanas privadas, sin usar credenciales de Herra) y
   quedan pendientes de su revisión final.
5. Tokens pendientes de Herra (invitaciones/activaciones HMAC) listados para reemitir: **pendiente**
   (solo Brian puede darlos; ver §6).
6. Respaldo de `auth` inmediatamente antes: **pendiente de ejecutar en la ventana** (§3, paso 2).
7. Autorización expresa de Brian: **pendiente**.

## 3. La ventana (00:00-00:30 de Caracas) — pasos exactos

> Por qué a medianoche: CRV y Herra usan secretos distintos en la huella diaria de visitas; a las
> 00:00 de `America/Caracas` cambia el día y nadie cuenta dos veces la misma visita (F2-2).

```bash
# 0. Estado de partida y guardarraíles (desde el repo, rama independencia/fases-0-3)
cd "/home/brian/apps/Coleccionistas De Rock Venezolano"
git status --short                      # solo cambios esperados; nada a medias
python3 scripts/shared-storage.py status
curl -s -o /dev/null -w 'dominio:%{http_code}\n' https://coleccionistasderockvenezolano.com/
curl -s -o /dev/null -w 'funnel:%{http_code}\n' https://mini-server.tail5815b0.ts.net/crv/
curl -s -o /dev/null -w 'crv-api-staging:%{http_code}\n' http://127.0.0.1:8082/health

# 1. Congelar el /admin de Herra (aviso a administradores; nadie edita en la ventana).
#    Lo hace Brian desde su cuenta de Herra: no se toca su panel desde aquí.

# 2. Respaldo de auth (esquema + datos) ANTES de tocar nada.
#    Sustituir el destino por el disco de respaldos acordado. NUNCA al repo.
pg_dump --format=custom --schema=auth \
  "postgresql://<usuario>:<clave>@127.0.0.1:5433/crv" \
  > /mnt/1tb/Shared/coleccionistas-rock-venezolano/backups/auth-2B-$(date +%Y%m%dT%H%M).dump

# 3. Instancia raíz con la configuración definitiva (secretos propios, dominio en orígenes).
#    El servicio de ensayo ya está instalado en :3141; en la ventana se instala el de :3140
#    con `ops/staging/crv-landing.env.example` completado (CRV_PUBLIC_PATH=, puerto 3140,
#    CRV_ALLOWED_ORIGINS=https://coleccionistasderockvenezolano.com, CRV_TRUST_CF_HEADERS=true).
systemctl --user enable --now crv-landing.service
curl -s -o /dev/null -w 'landing-local:%{http_code}\n' http://127.0.0.1:3140/roadmap
node scripts/checks/fase2b-whitelist.mjs --base http://127.0.0.1:3140   # 72/72 antes de publicar

# 4. Cloudflare: cambiar el destino del hostname del túnel `cloudflared-herra-crv`
#    de http://127.0.0.1:3020 a http://127.0.0.1:3140 (panel, gestionado por token).
#    ANOTAR LITERALMENTE la regla anterior: hostname → http://127.0.0.1:3020.

# 5. Verificación pública inmediata:
node scripts/checks/fase2b-whitelist.mjs --base https://coleccionistasderockvenezolano.com
node scripts/checks/fase2b-paridad.mjs --vivo https://coleccionistasderockvenezolano.com --raiz https://coleccionistasderockvenezolano.com
curl -s -o /dev/null -w 'radio:%{http_code}\n' https://coleccionistasderockvenezolano.com/api/radio/now

# 6. Reemitir desde /curaduria los tokens pendientes de Herra (enlaces de registro y activación).
```

## 4. Cambio de dueño de tablas (R5, §5.4)

Pasan a CRV en la ventana (ya no las escribe Herra):

`auth.applications`, `application_links`, `application_catalog_terms`, `auth.people`, `auth.users`,
`person_catalog_terms`, `person_links`, `activation_tokens`, `registration_tokens`, `categories`,
`tasks`, `task_assignees`, `project_visits`, `project_visit_stats`, `audit_log`, `auth.projects` y
sus ajustes.

Siguen en Herra: radio (`/api/radio/*`), export de las 04:00, hoja YT Master y
`auth.herra_sessions` (se retira). `traffic_daily`/`traffic_visitors` dejan de crecer por Herra
salvo por la radio; CRV solo escribe ahí si `CRV_TRAFFIC_ENABLED=1` (**apagado por defecto**:
en producción se enciende cuando la 2B cambie el dueño, nunca antes — R5).

`auth.admins.role` no se amplía en producción en la 2B: **no se aplica 0124** hasta comprobar que
Herra tolera los roles nuevos tras una vuelta atrás.

## 5. Vuelta atrás (< 5 min)

- **Disparadores:** cualquier ruta del catálogo alcanzable desde el dominio, 5xx sostenidos,
  candidaturas o logins que fallan, contador que no suma, portada distinta a la de Herra.
- **Acción:** devolver el destino del hostname a `http://127.0.0.1:3020` en Cloudflare. Nada más:
  los datos escritos por CRV son el mismo esquema que lee Herra (scrypt compatible).
- **Tokens:** las invitaciones/activaciones emitidas por CRV (SHA-256) no valen en Herra;
  reemitirlas desde Herra tras la vuelta.
- **Ensayo:** `node scripts/checks/fase2b-vuelta-atras.mjs` (proxy local, 10 ms la vuelta).

## 6. Observación posterior (72 h)

Revisión diaria de: errores 5xx en `crv-landing` y `crv-api`, candidaturas recibidas, visitas por
país (`cf-ipcountry`), logins de colaboradores y 404 de la lista blanca. Al cerrar, anotar el
resultado aquí y en la bitácora. Criterio de cierre: 72 h sin incidentes y sin rutas del catálogo
alcanzables.

## 7. Lo que solo Brian puede dar

1. **Tokens pendientes de Herra** (invitaciones y activaciones vivas) — consulta exacta, **no
   ejecutada**:
   ```sql
   -- En la base de Herra, solo lectura:
   SELECT id, created_at, expires_at, used_at FROM activation_tokens WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now();
   SELECT id, created_at, expires_at, revoked_at FROM registration_tokens WHERE revoked_at IS NULL AND expires_at > now();
   ```
   Con esa lista se decide cuáles reemitir desde `/curaduria` al terminar la ventana.
2. **Respaldo previo de `auth`**: confirmar el destino y que el `pg_dump` del paso 2 terminó bien.
3. **Fecha y hora de la ventana** (00:00-00:30 de Caracas) y aviso a administradores.
4. **Cambio en Cloudflare**: editar el destino del hostname del túnel (o autorizar que se haga).
5. **Autorización expresa** para ejecutar la 2B.

## 8. Lo que NO hace este documento

No ejecuta la ventana, no toca Cloudflare, no reinicia producción y no instala `crv-landing` en
producción. El servicio `crv-landing-staging` de :3141 es de ensayo y vive solo en esta máquina.
