#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export OPENSPORT_STATE_DIR=${OPENSPORT_STATE_DIR:-"$ROOT/.opensport"}
mkdir -p "$OPENSPORT_STATE_DIR"
OPENSPORT_STATE_DIR=$(cd "$OPENSPORT_STATE_DIR" && pwd)
export OPENSPORT_STATE_DIR
export OPENSPORT_HOST_UID=$(id -u)
export OPENSPORT_HOST_GID=$(id -g)
export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-opensport}
[[ "$COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Invalid Compose project name.' >&2; exit 1; }
COMPOSE=(docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$OPENSPORT_STATE_DIR/.env" -f "$ROOT/deploy/compose.yml")
helper() { docker run --rm -i --user "$OPENSPORT_HOST_UID:$OPENSPORT_HOST_GID" -v "$OPENSPORT_STATE_DIR:/state" -v "$ROOT/scripts/ops.mjs:/tools/ops.mjs:ro" node:22.22.0-alpine node /tools/ops.mjs "$@"; }
require_init() { test -f "$OPENSPORT_STATE_DIR/.env" || { echo 'Run ./scripts/ops.sh init first.' >&2; exit 1; }; }
case "${1:-help}" in
  init) helper init "${2:-http://localhost:8080}" ;;
  up)
    require_init
    "${COMPOSE[@]}" stop web
    "${COMPOSE[@]}" up -d --wait --wait-timeout 240 db auth rest realtime storage imgproxy api-gw functions
    "${COMPOSE[@]}" run --rm -T migrate
    "${COMPOSE[@]}" up -d --build --wait --wait-timeout 240 web
    echo 'OpenSport is ready. Run ./scripts/ops.sh bootstrap for the first administrator.'
    ;;
  down) require_init; "${COMPOSE[@]}" down ;;
  status) require_init; "${COMPOSE[@]}" ps ;;
  logs) require_init; "${COMPOSE[@]}" logs --tail 100 "${2:-web}" ;;
  migrate)
    require_init
    "${COMPOSE[@]}" stop web
    "${COMPOSE[@]}" run --rm -T migrate
    "${COMPOSE[@]}" up -d --wait web
    ;;
  bootstrap)
    require_init
    IFS= read -r -p 'Administrator email: ' email
    IFS= read -r -p 'Display name: ' display_name
    IFS= read -r -s -p 'Password (at least 12 characters): ' password; printf '\n'
    IFS= read -r -s -p 'Confirm password: ' confirmation; printf '\n'
    test "$password" = "$confirmation" || { echo 'Passwords differ.' >&2; exit 1; }
    printf '%s\n%s\n%s\n' "$email" "$display_name" "$password" | "${COMPOSE[@]}" run --rm -T operator bootstrap
    unset password confirmation
    ;;
  recover)
    require_init
    IFS= read -r -p 'Email of the account to restore as administrator: ' email
    printf '%s\n' "$email" | "${COMPOSE[@]}" run --rm -T operator recover
    ;;
  backup)
    require_init
    mkdir -p "$OPENSPORT_STATE_DIR/backups"
    backup_name="opensport-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
    "${COMPOSE[@]}" stop -t 90
    # Do not restart on a failed snapshot; report the failure for an operator to inspect.
    "${COMPOSE[@]}" run --rm -T --no-deps maintenance backup "$backup_name"
    "${COMPOSE[@]}" up -d --wait --wait-timeout 240
    echo "Backup: $OPENSPORT_STATE_DIR/backups/$backup_name (keep its .sha256 file too)"
    ;;
  restore)
    test -n "${2:-}" || { echo 'Usage: ./scripts/ops.sh restore /path/to/backup.tar.gz' >&2; exit 1; }
    test ! -f "$OPENSPORT_STATE_DIR/.env" || { echo 'Restore requires a fresh OPENSPORT_STATE_DIR and COMPOSE_PROJECT_NAME.' >&2; exit 1; }
    test -f "$2.sha256" || { echo 'Missing backup .sha256 companion.' >&2; exit 1; }
    mkdir -p "$OPENSPORT_STATE_DIR/backups"
    cp "$2" "$OPENSPORT_STATE_DIR/backups/restore.tar.gz"
    cp "$2.sha256" "$OPENSPORT_STATE_DIR/backups/restore.tar.gz.sha256"
    helper restore-env restore.tar.gz
    "${COMPOSE[@]}" run --rm -T --no-deps maintenance restore restore.tar.gz
    echo 'Restore complete. Run ./scripts/ops.sh up using the same project and state directory.'
    ;;
  *)
    echo 'OpenSport operations (Docker Engine + Compose required)'
    echo '  init [http://localhost:8080 | https://team.example.org]'
    echo '  up | down | status | logs [service] | migrate'
    echo '  bootstrap | recover | backup | restore /path/to/backup.tar.gz'
    echo 'Optional: OPENSPORT_STATE_DIR and COMPOSE_PROJECT_NAME isolate installations.'
    ;;
esac
