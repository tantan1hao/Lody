#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly DATA_DIR="${LODY_OSS_DATA_DIR:-${HOME:?HOME is required}/.lody-oss}"
readonly CONFIG_PATH="${LODY_OSS_BACKUP_CONFIG:-$DATA_DIR/backup-config.json}"
readonly HOST_PORT="${LODY_OSS_HOST_PORT:-17789}"
readonly PROCESS_PATTERN="${LODY_OSS_PROCESS_PATTERN:-/Lody OSS.app/Contents/MacOS/Lody OSS$}"
readonly STATE_ITEMS=(
  workspace-catalog.json
  local-identity.json
  machine-id
  loro-repo
  chats
  orchestration
  session-files
  electron-settings.json
)

BACKUP_STARTED=0

die() {
  printf 'lody-oss-restic-backup: %s\n' "$*" >&2
  return 1
}

notify_failure() {
  local status="$1" ntfy_url=''
  ((status != 0 && BACKUP_STARTED == 1)) || return 0
  command -v jq >/dev/null 2>&1 || return 0
  command -v curl >/dev/null 2>&1 || return 0
  ntfy_url="$(jq -r '.ntfyUrl // empty' "$CONFIG_PATH" 2>/dev/null || true)"
  [[ "$ntfy_url" == https://* ]] || return 0
  curl --fail --silent --show-error --max-time 10 \
    -H 'Title: Lody OSS' \
    -H 'Tags: warning' \
    --data-binary "$(hostname -s 2>/dev/null || hostname) · backup failed" \
    "$ntfy_url" >/dev/null 2>&1 || true
}

on_exit() {
  local status="$?"
  notify_failure "$status"
  exit "$status"
}
trap on_exit EXIT

[[ -f "$CONFIG_PATH" ]] || {
  printf 'lody-oss-restic-backup: skipped; %s is not configured\n' "$CONFIG_PATH"
  exit 0
}
command -v jq >/dev/null 2>&1 || die 'jq is required'

jq -e '
  .version == 1 and
  (.repository | type == "string" and length > 0) and
  (.resticPath | type == "string" and startswith("/")) and
  (.passwordCommand | type == "string" and length > 0) and
  ((.sftpCommand // "") | type == "string") and
  ((.ntfyUrl // "") | type == "string")
' "$CONFIG_PATH" >/dev/null || die "invalid backup config: $CONFIG_PATH"

if [[ "$HOST_PORT" != 0 ]] && command -v lsof >/dev/null 2>&1 && \
  lsof -nP -iTCP:"$HOST_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  printf 'lody-oss-restic-backup: skipped; port %s is active\n' "$HOST_PORT"
  exit 0
fi
if [[ -n "$PROCESS_PATTERN" ]] && pgrep -f "$PROCESS_PATTERN" >/dev/null 2>&1; then
  printf 'lody-oss-restic-backup: skipped; Lody OSS is running\n'
  exit 0
fi

repository="$(jq -er '.repository' "$CONFIG_PATH")"
restic_path="$(jq -er '.resticPath' "$CONFIG_PATH")"
password_command="$(jq -er '.passwordCommand' "$CONFIG_PATH")"
sftp_command="$(jq -r '.sftpCommand // empty' "$CONFIG_PATH")"
[[ -x "$restic_path" ]] || die "restic is not executable: $restic_path"

state_paths=()
for item in "${STATE_ITEMS[@]}"; do
  [[ -e "$DATA_DIR/$item" || -L "$DATA_DIR/$item" ]] && state_paths+=("$DATA_DIR/$item")
done
((${#state_paths[@]} > 0)) || die "no Lody OSS state found in $DATA_DIR"

machine_id='unknown-machine'
if [[ -s "$DATA_DIR/machine-id" ]]; then
  machine_id="$(tr -d '\r\n' <"$DATA_DIR/machine-id")"
  [[ -n "$machine_id" ]] || machine_id='unknown-machine'
fi
host_name="$(hostname -s 2>/dev/null || hostname)"

args=(-r "$repository" --password-command "$password_command")
[[ -n "$sftp_command" ]] && args+=(-o "sftp.command=$sftp_command")
args+=(
  backup
  --host "$host_name"
  --tag lody-oss
  --tag "machine:$machine_id"
  "${state_paths[@]}"
)

BACKUP_STARTED=1
"$restic_path" "${args[@]}"
BACKUP_STARTED=0
printf 'lody-oss-restic-backup: completed for %s (%s)\n' "$host_name" "$machine_id"
