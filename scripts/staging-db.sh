#!/usr/bin/env bash
# CRV · Base de staging en un clúster PostgreSQL aparte.
#
# Producción: contenedor `crv-postgres`, base `crv` (~20 GB), puerto 5433.
# Staging:    contenedor `crv-postgres-staging`, base `crv_staging`,
#             puerto 5435, pgdata en /mnt/datos/crv-staging/pgdata.
#
# Modos:
#   partial (por defecto) — esquema completo + datos pequeños. Omite el DATO de
#     12 tablas históricas de `ingest` (19,4 GB): journal, claims, ER, IA,
#     evidencias. Es lo que necesitan las fases 1-3 (identidad, comunidad,
#     roadmap, visitas y radio). Las constraints FK que dependen de esas tablas
#     no se recrean (21 avisos), porque las filas hijas quedan huérfanas; el
#     esquema y el resto de datos sí quedan utilizables.
#   full — copia completa (20 GB). Tarda mucho si el disco está ocupado; úsalo
#     solo cuando haga falta el histórico de ingesta.
#
# Uso:
#   scripts/staging-db.sh create [--full]
#   scripts/staging-db.sh refresh [--full]
#   scripts/staging-db.sh check
#   scripts/staging-db.sh drop [--purge]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_CONTAINER="${CRV_PG_CONTAINER:-crv-postgres}"
SRC_DB="${CRV_PG_DATABASE:-crv}"
PGUSER="${CRV_PG_USER:-crv}"
STG_CONTAINER="${CRV_STAGING_CONTAINER:-crv-postgres-staging}"
STG_DB="${CRV_STAGING_DATABASE:-crv_staging}"
STG_PORT="${CRV_STAGING_PORT:-5435}"
STG_PGDATA="${CRV_STAGING_PGDATA:-/mnt/datos/crv-staging/pgdata}"
STG_IMAGE="${CRV_STAGING_IMAGE:-postgres:16-alpine}"
MIN_FREE_GB="${CRV_STAGING_MIN_FREE_GB:-10}"
DUMP_HOST="${CRV_STAGING_DUMP:-/mnt/datos/crv-staging/crv_staging.dump}"

# Tablas de `ingest` cuyo DATO no viaja al staging parcial (suma ~19,4 GB).
EXCLUDED_DATA=(
  ingest.change_journal
  ingest.entity_resolution_decisions
  ingest.claims
  ingest.claim_evidence
  ingest.review_queue
  ingest.ai_runs
  ingest.curation_findings
  ingest.merge_audit
  ingest.evidence_documents
  ingest.research_source_captures
  ingest.person_web_page_cache
  ingest.merge_audit_claims
)

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '· %s\n' "$*"; }

[ "$STG_DB" != "$SRC_DB" ] || die "la base de staging no puede llamarse igual que la de producción"
command -v docker >/dev/null || die "docker no está disponible"
docker inspect "$SRC_CONTAINER" >/dev/null 2>&1 || die "no existe el contenedor $SRC_CONTAINER"

# Contraseña: del entorno o del DATABASE_URL del repo (nunca se imprime).
PGPASS="${CRV_PG_PASSWORD:-}"
if [ -z "$PGPASS" ]; then
  [ -f "$ROOT/.env" ] || die "falta $ROOT/.env y CRV_PG_PASSWORD no está definida"
  PGPASS="$(python3 - "$ROOT/.env" <<'PY'
import sys
from urllib.parse import urlsplit
for line in open(sys.argv[1], encoding="utf-8"):
    if line.startswith("DATABASE_URL="):
        value = line.split("=", 1)[1].strip().strip('"').strip("'")
        print(urlsplit(value).password or "")
        break
PY
)"
fi
[ -n "$PGPASS" ] || die "no se pudo obtener la contraseña de PostgreSQL"

free_gb() { df -BG --output=avail "$1" | tail -1 | tr -dc '0-9'; }
container_exists() { docker inspect "$STG_CONTAINER" >/dev/null 2>&1; }
container_running() { [ "$(docker inspect -f '{{.State.Running}}' "$STG_CONTAINER" 2>/dev/null)" = "true" ]; }
stg_psql() { docker exec -i "$STG_CONTAINER" psql -U "$PGUSER" -d "$STG_DB" -v ON_ERROR_STOP=1 "$@"; }
stg_admin() { docker exec -i "$STG_CONTAINER" psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 "$@"; }

db_exists() {
  [ "$(stg_admin -Atc "SELECT 1 FROM pg_database WHERE datname = '$STG_DB'" 2>/dev/null || true)" = "1" ]
}

create_stg_db() {
  # Misma codificación que producción (SQL_ASCII/C): evita fallos de conversión.
  docker exec -i "$STG_CONTAINER" createdb -U "$PGUSER" -T template0 -E SQL_ASCII --locale=C "$STG_DB"
}

wait_ready() {
  local i
  # initdb levanta un servidor temporal que acepta una conexión y se apaga;
  # hay que exigir DOS consultas seguidas separadas por 1 s para no correr
  # contra ese cierre (pasó en la primera creación del staging).
  for i in $(seq 1 90); do
    if docker exec "$STG_CONTAINER" psql -U "$PGUSER" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
      sleep 1
      if docker exec "$STG_CONTAINER" psql -U "$PGUSER" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

ensure_container() {
  if container_exists; then
    if ! container_running; then log "arrancando $STG_CONTAINER"; docker start "$STG_CONTAINER" >/dev/null; fi
  else
    mkdir -p "$(dirname "$STG_PGDATA")"
    [ "$(free_gb "$(dirname "$STG_PGDATA")")" -ge "$MIN_FREE_GB" ] \
      || die "espacio insuficiente en $(dirname "$STG_PGDATA") (mínimo ${MIN_FREE_GB} GB)"
    mkdir -p "$STG_PGDATA"
    log "creando contenedor $STG_CONTAINER (:$STG_PORT, pgdata $STG_PGDATA)"
    docker run -d --name "$STG_CONTAINER" \
      --restart unless-stopped \
      --user "$(id -u):$(id -g)" \
      -e POSTGRES_USER="$PGUSER" \
      -e POSTGRES_PASSWORD="$PGPASS" \
      -e POSTGRES_DB=postgres \
      -e HOME=/tmp \
      -p "127.0.0.1:${STG_PORT}:5432" \
      -v "$STG_PGDATA:/var/lib/postgresql/data" \
      "$STG_IMAGE" >/dev/null
  fi
  wait_ready || die "$STG_CONTAINER no respondió en 90 s"
}

verify_loaded() {
  local users albums tasks
  users=$(stg_psql -Atc "SELECT count(*) FROM auth.users")
  albums=$(stg_psql -Atc "SELECT count(*) FROM media.video_albums")
  tasks=$(stg_psql -Atc "SELECT count(*) FROM auth.tasks")
  log "verificación: users=$users albums=$albums tasks=$tasks"
  [ "$users" -ge 1 ] || die "la copia no cargó auth.users"
  [ "$albums" -ge 1 ] || die "la copia no cargó media.video_albums"
}

load_partial() {
  local args=() t log_file="/tmp/crv_staging_restore_$$.log" rc errors
  for t in "${EXCLUDED_DATA[@]}"; do args+=("--exclude-table-data=$t"); done
  mkdir -p "$(dirname "$DUMP_HOST")"
  log "volcando esquema + datos pequeños de $SRC_DB (sin 12 tablas históricas)"
  docker exec "$SRC_CONTAINER" pg_dump -U "$PGUSER" -d "$SRC_DB" \
    --no-owner --no-privileges "${args[@]}" -Fc -f "/tmp/crv_staging_$$.dump"
  docker cp "$SRC_CONTAINER:/tmp/crv_staging_$$.dump" "$DUMP_HOST" >/dev/null
  docker cp "$DUMP_HOST" "$STG_CONTAINER:/tmp/crv_staging.dump" >/dev/null
  log "restaurando en $STG_DB (triggers de FK desactivados durante la carga)"
  set +e
  docker exec "$STG_CONTAINER" pg_restore -U "$PGUSER" -d "$STG_DB" \
    --no-owner --no-privileges --disable-triggers /tmp/crv_staging.dump >"$log_file" 2>&1
  rc=$?
  set -e
  errors=$(grep -c "could not execute query" "$log_file" 2>/dev/null || true)
  rm -f "$DUMP_HOST" "$log_file"
  docker exec "$STG_CONTAINER" rm -f /tmp/crv_staging.dump >/dev/null
  docker exec "$SRC_CONTAINER" rm -f "/tmp/crv_staging_$$.dump" >/dev/null
  if [ "$rc" -ne 0 ] && [ "${errors:-0}" -eq 0 ]; then
    die "pg_restore falló sin errores de constraint; revisa el log de la unidad"
  fi
  [ "${errors:-0}" -gt 0 ] && log "aviso: ${errors} constraints FK no recreadas (dependen de las tablas históricas omitidas)"
  log "limpiando sesiones copiadas"
  stg_psql -q -c "TRUNCATE auth.sessions, auth.herra_sessions;" >/dev/null
  log "actualizando estadísticas"
  stg_psql -q -c "ANALYZE;" >/dev/null
  verify_loaded
}

load_full() {
  log "copia COMPLETA de $SRC_DB → $STG_DB (20 GB; puede tardar)"
  docker exec "$SRC_CONTAINER" pg_dump -U "$PGUSER" -d "$SRC_DB" \
    --no-owner --no-privileges -Fp \
    | docker exec -i "$STG_CONTAINER" psql -U "$PGUSER" -d "$STG_DB" -v ON_ERROR_STOP=1 -q
  log "limpiando sesiones copiadas"
  stg_psql -q -c "TRUNCATE auth.sessions, auth.herra_sessions;" >/dev/null
  stg_psql -q -c "ANALYZE;" >/dev/null
  verify_loaded
}

check() {
  if ! container_exists; then echo "(no existe $STG_CONTAINER)"; return 0; fi
  docker ps --filter "name=$STG_CONTAINER" --format '{{.Names}} {{.Status}} {{.Ports}}'
  if db_exists; then
    stg_admin -Atc "SELECT '$STG_DB | ' || pg_size_pretty(pg_database_size('$STG_DB'))"
    stg_psql -Atc "
      SELECT 'users=' || count(*) FROM auth.users
      UNION ALL SELECT 'admins=' || count(*) FROM auth.admins
      UNION ALL SELECT 'tasks=' || count(*) FROM auth.tasks
      UNION ALL SELECT 'sessions=' || count(*) FROM auth.sessions
      UNION ALL SELECT 'claims=' || count(*) FROM ingest.claims
      UNION ALL SELECT 'albums=' || count(*) FROM media.video_albums"
  else
    echo "(no existe la base $STG_DB)"
  fi
}

ACTION="${1:-}"
MODE="partial"
[ "${2:-}" = "--full" ] && MODE="full"

case "$ACTION" in
  create)
    ensure_container
    if db_exists; then die "$STG_DB ya existe; usa 'refresh' para recargarla"; fi
    create_stg_db
    if [ "$MODE" = "full" ]; then load_full; else load_partial; fi
    check
    ;;
  refresh)
    ensure_container
    if db_exists; then
      log "recreando $STG_DB"
      stg_admin -q -c "DROP DATABASE \"$STG_DB\" WITH (FORCE);"
    fi
    create_stg_db
    if [ "$MODE" = "full" ]; then load_full; else load_partial; fi
    check
    ;;
  check)
    check
    ;;
  drop)
    if container_exists; then
      log "parando y eliminando $STG_CONTAINER"
      docker rm -f "$STG_CONTAINER" >/dev/null
    fi
    if [ "${2:-}" = "--purge" ]; then
      log "borrando $STG_PGDATA"
      rm -rf -- "$STG_PGDATA"
    else
      log "datos conservados en $STG_PGDATA (usa --purge para borrarlos)"
    fi
    ;;
  *)
    echo "uso: $0 create|refresh|check|drop [--full|--purge]" >&2
    exit 2
    ;;
esac
