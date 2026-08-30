#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly ENV_FILE="${LODY_OSS_CONTROL_BACKUP_ENV:-/etc/lody-oss/control-backup.env}"
readonly DATABASE="${LODY_OSS_STREAMS_DATABASE:-/srv/lody-oss/control/streams.sqlite}"

[[ -f "$ENV_FILE" ]] || {
  printf 'missing control backup environment: %s\n' "$ENV_FILE" >&2
  exit 1
}
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"

restic_args=(-r "$RESTIC_REPOSITORY" --password-file "$RESTIC_PASSWORD_FILE" --no-cache)
[[ -n "${RESTIC_SFTP_COMMAND:-}" ]] && restic_args+=(-o "sftp.command=$RESTIC_SFTP_COMMAND")

case "${1:-backup}" in
  backup)
    [[ -f "$DATABASE" ]] || {
      printf 'Streams database does not exist: %s\n' "$DATABASE" >&2
      exit 1
    }
    snapshot_dir="$(mktemp -d /srv/lody-oss/control/.backup.XXXXXX)"
    snapshot="$snapshot_dir/streams.sqlite"
    cleanup() {
      unlink "$snapshot" 2>/dev/null || true
      rmdir "$snapshot_dir" 2>/dev/null || true
    }
    trap cleanup EXIT
    sqlite3 "$DATABASE" '.timeout 5000' ".backup '$snapshot'"
    [[ "$(sqlite3 "$snapshot" 'PRAGMA integrity_check;')" == 'ok' ]] || {
      printf 'SQLite integrity check failed\n' >&2
      exit 1
    }
    restic "${restic_args[@]}" backup \
      --host tan \
      --tag lody-oss-control \
      "$snapshot"
    restic "${restic_args[@]}" forget \
      --host tan \
      --tag lody-oss-control \
      --keep-daily 7 \
      --keep-weekly 4 \
      --keep-monthly 6 \
      --prune
    ;;
  check)
    restic "${restic_args[@]}" check
    ;;
  *)
    printf 'usage: %s [backup|check]\n' "$0" >&2
    exit 2
    ;;
esac
