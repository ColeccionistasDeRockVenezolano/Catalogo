# Producción · Fase 2B (plantillas, NO instaladas)

Estas plantillas son la forma de producción de la Fase 2B. **No se han instalado ni arrancado.**
La ventana no se abre sin autorización expresa de Brian y sin cerrar las puertas de
`docs/independencia/FASE2B.md`.

## Piezas

| Archivo | Qué es | Puerto |
|---|---|---|
| `crv-api-landing.service` | API del dominio (comunidad encendida, trabajos de fondo apagados) | `127.0.0.1:8083` |
| `crv-landing.service` | Gateway de la portada en la raíz, con la lista blanca | `127.0.0.1:3140` |
| `crv-web-admin.service` | **Opcional** desde el 2026-11-02: gateway privado con el catálogo, solo local | `127.0.0.1:3131` |
| `crv-api-landing.env.example` | Entorno de la API (sin secretos reales) | — |
| `crv-landing.env.example` | Entorno del gateway de la portada | — |
| `crv-web-admin.env.example` | Entorno del gateway del panel | — |

`__SHA__` se sustituye por el commit fijado al autorizar. El árbol de release se crea con
`git worktree add --detach /mnt/datos/crv-release/<SHA> <SHA>` y se compila allí:
`npm ci`, `npm --prefix web ci`, `npm --prefix web run build` (`dist`, base `/`) y
`npm --prefix web run build:public` (`dist-public`, base `/crv/`).

## Guarda de arranque

- `CRV_DEPLOYMENT=production` activa la guarda: aborta si la API apunta a una base con «staging»,
  escucha en `:8080`/`:8082`, le falta `CRV_VISITS_SECRET`, o si un gateway apunta a `:8080`/`:8082`
  o sirve `dist-staging`.
- `CRV_DEPLOYMENT=rehearsal` la admite de forma explícita para ensayar contra `crv_staging`; el
  gateway imprime un aviso y la API no aplica las comprobaciones de producción.
- Sin `CRV_DEPLOYMENT` se conserva el comportamiento histórico del catálogo y de staging.

## Secretos

Los `.env` reales viven en `~/apps/crv-landing/` con permisos `0600`, fuera de Git. La API lee el
`.env` de producción por `CRV_ENV_FILE` (no se copia); el gateway solo necesita sus propias
variables. Los ejemplos llevan marcadores, nunca valores reales.

## Acceso al panel

El panel se publica en `/admin` del propio dominio, con sesión, rol y CSRF, por decisión de Brian del
2026-11-02 (`docs/independencia/PUERTA-TEMPORAL.md`). `crv-web-admin` ya no es necesario para administrar.

Si se instala, `:3131` escucha solo en loopback. Brian entra por la máquina o con un túnel SSH
(`ssh -L 3131:127.0.0.1:3131 mini-server`), nunca por Funnel ni Cloudflare.
