# Staging CRV — entorno aislado para las fases 1-3

Este directorio contiene las unidades systemd de usuario y la plantilla de
entorno del staging. El staging **no** se publica: escucha solo en 127.0.0.1 y
nunca se añade a Tailscale Funnel ni a Cloudflare.

| Pieza | Producción | Staging |
|---|---|---|
| PostgreSQL | `crv-postgres` :5433 | `crv-postgres-staging` :5435 (pgdata en `/mnt/datos/crv-staging/pgdata`) |
| Base de datos | `crv` | `crv_staging` (clon parcial) |
| API | :8080 | :8082 |
| Web `/crv` | :3120 | :3130 |
| Build de la SPA | `web/dist-public` | `web/dist-staging` |
| Chat | :8081 | deshabilitado (proxy a :8099) |
| Variables | `.env` del repo | `~/apps/crv-staging/staging.env` |

## Instalación

```bash
cd "/home/brian/apps/Coleccionistas De Rock Venezolano"
scripts/staging-setup.sh            # crea base, build, unidades y arranca
scripts/staging-setup.sh --refresh  # recrea la base desde producción
```

El script:

1. Crea `~/apps/crv-staging/` (0700) y `staging.env` a partir del
   `DATABASE_URL` real, cambiando la base a `crv_staging`.
2. Clona la base con `scripts/staging-db.sh create|refresh`.
3. Compila la SPA en `web/dist-staging` con `npm run build:staging`.
4. Instala `crv-api-staging.service` y `crv-web-staging.service` en
   `~/.config/systemd/user/`, recarga systemd y las arranca.
5. Verifica `:8082/health` y `:3130/crv/`.

## Verificación

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8082/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3130/crv/
ss -ltnp | grep -E ':(8082|3130)\b'
scripts/staging-db.sh check
```

## Reglas

- `CRV_ENV_FILE` apunta a `staging.env`: la API no lee el `.env` de producción.
- `CRV_WEB_DIST=dist-staging`: compilar staging no toca `dist-public`, que es
  lo que sirve el funnel.
- Las claves de YouTube, DeepSeek y descubrimiento van vacías o desactivadas:
  el staging no gasta cuota ni créditos.
- `auth.sessions` y `auth.herra_sessions` se truncan al clonar.
- No se instala ningún túnel ni regla de Funnel para :3130 ni :8082.

## Limitaciones del clon parcial

El modo por defecto omite el DATO de 12 tablas históricas de `ingest`
(19,4 GB: journal, claims, ER, IA, evidencias). Consecuencias:

- Esas tablas quedan vacías pero con su esquema.
- 21 constraints FK que dependen de ellas no se recrean; las tablas hijas
  conservan referencias huérfanas. No afecta a las pruebas de interfaz de las
  fases 1-3.
- Si hace falta el histórico completo: `scripts/staging-db.sh refresh --full`
  (20 GB; lento si el disco está ocupado).

