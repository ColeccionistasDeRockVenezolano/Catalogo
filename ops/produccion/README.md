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

## `crv-api` fijada (en vivo desde 2026-11-02)

Esto **sí** está instalado, a diferencia de las plantillas. La API actual ya no carga el árbol
compartido: arranca desde `/home/brian/apps/crv-release/crv-api-2026-11-02`, commit `09d40b28`, con el
drop-in `~/.config/systemd/user/crv-api.service.d/fijado.conf`. Ese commit es `43ccf32d` más los 4
archivos sin commit que la API tenía cargados (`source-appearances`, `merge/engine`,
`image-candidates`, `album-completion`); no está en ninguna rama, solo en ese worktree. Se fijó sin
cambiar de conducta: `20da3ca9` y `b2fe3c8e` no están.

El árbol lleva enlaces, y por eso `git status` allí sale sucio a propósito:

| Enlace en el árbol | Apunta a | Si falta |
|---|---|---|
| `data` | `data` del árbol compartido | `.catalog-cache-revision` se separa y la API no ve las invalidaciones de caché; no arranca sin `data/research` |
| `.env`, `logs` | los del árbol compartido | El disparo de video nuevo (`nuevo.sh`) se queda sin base |
| `reports`, `tmp-analysis`, `web/public/media` | el almacén de 1 TB | Fallan buscador y medios |
| `scripts/shared-storage.py`, `scripts/staging.py` | los del árbol compartido | Falla la subida de imágenes: exigen ser el checkout de la migración |

- **Reiniciar** `crv-api`, también por accidente, ya no cambia el código.
- `crv-chat`, `crv-web` y los timers siguen en el árbol compartido. El disparo de video nuevo sale del árbol fijado.
- **Publicar API nueva:** repetir el árbol con otro SHA, ensayarlo contra staging en otro puerto, cambiar `WorkingDirectory` y reiniciar. `scripts/deploy.sh --api` se niega mientras esté fijada; sin `--api` funciona igual.
- **Volver atrás:** `rm ~/.config/systemd/user/crv-api.service.d/fijado.conf && systemctl --user daemon-reload && systemctl --user restart crv-api`.

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
