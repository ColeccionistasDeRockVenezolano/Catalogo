#!/usr/bin/env bash
# CRV · Instala y arranca el staging aislado (fases 1-3).
#
#   scripts/staging-setup.sh            # crea si falta y arranca
#   scripts/staging-setup.sh --refresh  # recrea la base desde producción
#
# No toca producción: otra base (crv_staging), otros puertos (8082/3130),
# otro build (dist-staging) y ninguna regla de túnel.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="$HOME/apps/crv-staging"
ENV_FILE="$ENV_DIR/staging.env"
UNIT_DIR="$HOME/.config/systemd/user"
REFRESH=0
[ "${1:-}" = "--refresh" ] && REFRESH=1

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '· %s\n' "$*"; }

[ -f "$ROOT/.env" ] || die "falta $ROOT/.env"
command -v docker >/dev/null || die "docker no está disponible"
docker inspect crv-postgres >/dev/null 2>&1 || die "el contenedor crv-postgres no está en marcha"

PROD_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2-)"
[ -n "$PROD_URL" ] || die "DATABASE_URL vacío en .env"

DB_URL="$(python3 - "$PROD_URL" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit
raw = sys.argv[1].strip().strip('"').strip("'")
u = urlsplit(raw)
if not u.scheme or not u.netloc:
    raise SystemExit("DATABASE_URL inválida")
# Conserva usuario:contraseña tal cual y cambia solo el puerto y la base.
netloc = u.netloc
if u.port:
    netloc = netloc[: -(len(str(u.port)) + 1)]
port = 5435
print(urlunsplit((u.scheme, f"{netloc}:{port}", "/crv_staging", u.query, u.fragment)))
PY
)"

mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"
umask 077
{
  printf 'DATABASE_URL="%s"\n' "$DB_URL"
  printf 'HOST=127.0.0.1\n'
  printf 'PORT=8082\n'
  printf 'NODE_ENV=development\n'
  printf 'CRV_AUTH_BACKEND=postgres\n'
  printf 'CRV_SESSION_COOKIE_PATH=/\n'
  printf 'CRV_SESSION_TTL_HOURS=12\n'
  printf 'CRV_ALLOWED_ORIGINS=http://127.0.0.1:3130,http://localhost:3130\n'
  printf 'CRV_YT_INTAKE_ENABLED=false\n'
  printf 'CRV_YT_INTAKE_AUTO=false\n'
  printf 'CRV_DISCOVERY_ENABLED=false\n'
  printf 'GENRES_EXTERNAL_ENABLED=false\n'
  printf 'GENRES_PROJECTION_ENABLED=false\n'
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
log "entorno de staging en $ENV_FILE (base crv_staging)"

if [ "$REFRESH" = "1" ]; then
  "$ROOT/scripts/staging-db.sh" refresh
elif "$ROOT/scripts/staging-db.sh" check | grep -q "no existe"; then
  "$ROOT/scripts/staging-db.sh" create
else
  log "crv_staging ya existe (usa --refresh para recrearla)"
  "$ROOT/scripts/staging-db.sh" check
fi

log "compilando SPA de staging (dist-staging)"
( cd "$ROOT/web" && npm run build:staging )

log "instalando unidades systemd de usuario"
mkdir -p "$UNIT_DIR"
install -m 644 "$ROOT/ops/staging/crv-api-staging.service" "$UNIT_DIR/crv-api-staging.service"
install -m 644 "$ROOT/ops/staging/crv-web-staging.service" "$UNIT_DIR/crv-web-staging.service"
systemctl --user daemon-reload
systemctl --user enable crv-api-staging.service crv-web-staging.service >/dev/null
systemctl --user restart crv-api-staging.service
log "esperando la API de staging en :8082"
ok=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:8082/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  systemctl --user status crv-api-staging.service --no-pager -n 20 || true
  journalctl --user -u crv-api-staging.service -n 40 --no-pager || true
  die "la API de staging no respondió en 60 s"
fi

systemctl --user restart crv-web-staging.service
log "esperando la web de staging en :3130"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:3130/crv/ >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ "$ok" = "1" ] || { journalctl --user -u crv-web-staging.service -n 40 --no-pager || true; die "la web de staging no respondió en 30 s"; }

echo
echo "Staging listo (aislado, solo 127.0.0.1):"
echo "  API  http://127.0.0.1:8082/health"
echo "  Web  http://127.0.0.1:3130/crv/"
echo "  Base crv_staging"
