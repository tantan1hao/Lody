#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly HOST_PORT="${LODY_OSS_HOST_PORT:-17789}"
readonly RAW_DATA_DIR="${LODY_OSS_DATA_DIR:-${HOME:?HOME is required}/.lody-oss}"
readonly STATE_ITEMS=(
  workspace-catalog.json
  local-identity.json
  machine-id
  loro-repo
  chats
  orchestration
  session-files
)

TEMP_DIR=''

die() {
  printf 'lody-oss-state: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -z "$TEMP_DIR" || ! -d "$TEMP_DIR" ]]; then
    return
  fi
  case "$(basename "$TEMP_DIR")" in
    .lody-oss-state.* | lody-oss-state.*) rm -rf -- "$TEMP_DIR" ;;
  esac
}
trap cleanup EXIT

resolve_data_dir() {
  local name parent home_dir resolved
  [[ -n "$RAW_DATA_DIR" && "$RAW_DATA_DIR" != '/' ]] || \
    die "refusing broad data directory: $RAW_DATA_DIR"
  name="$(basename "$RAW_DATA_DIR")"
  parent="$(dirname "$RAW_DATA_DIR")"
  case "$name" in
    '' | '.' | '..' | '/') die "unsafe data directory: $RAW_DATA_DIR" ;;
  esac
  [[ -d "$parent" ]] || die "data-directory parent does not exist: $parent"
  parent="$(cd "$parent" && pwd -P)"
  home_dir="$(cd "${HOME:?HOME is required}" && pwd -P)"
  resolved="$parent/$name"
  [[ "$resolved" != '/' && "$resolved" != "$home_dir" ]] || \
    die "refusing broad data directory: $resolved"
  printf '%s\n' "$resolved"
}

assert_stopped() {
  local checked=0
  if command -v lsof >/dev/null 2>&1; then
    checked=1
    if lsof -nP -iTCP:"$HOST_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      die "Lody OSS is listening on 127.0.0.1:$HOST_PORT; quit the desktop or stop the daemon first"
    fi
  fi
  if command -v ss >/dev/null 2>&1; then
    checked=1
    if ss -ltnH "sport = :$HOST_PORT" 2>/dev/null | grep -q .; then
      die "Lody OSS is listening on 127.0.0.1:$HOST_PORT; quit the desktop or stop the daemon first"
    fi
  fi
  ((checked == 1)) || die 'cannot verify that Lody OSS is stopped; install lsof or ss'
}

snapshot_items() {
  local data_dir="$1" item
  SNAPSHOT_ITEMS=()
  for item in "${STATE_ITEMS[@]}"; do
    if [[ -e "$data_dir/$item" || -L "$data_dir/$item" ]]; then
      SNAPSHOT_ITEMS+=("$item")
    fi
  done
  ((${#SNAPSHOT_ITEMS[@]} > 0)) || die "no session state found in $data_dir"
}

backup_state() {
  local destination="$1" data_dir timestamp host archive
  [[ -n "$destination" ]] || die 'backup destination is required'
  command -v rsync >/dev/null 2>&1 || die 'rsync is required'
  data_dir="$(resolve_data_dir)"
  [[ -d "$data_dir" ]] || die "data directory does not exist: $data_dir"
  [[ ! -L "$data_dir" ]] || die "data directory must not be a symlink: $data_dir"
  assert_stopped
  snapshot_items "$data_dir"

  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lody-oss-state.XXXXXX")"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  host="$(hostname -s 2>/dev/null | tr -c 'A-Za-z0-9._-' '_' | sed 's/_$//')"
  [[ -n "$host" ]] || host=unknown-host
  archive="$TEMP_DIR/lody-oss-${host}-${timestamp}.tar.gz"
  tar -C "$data_dir" -czf "$archive" "${SNAPSHOT_ITEMS[@]}"

  if [[ "$destination" == *:* && "$destination" != /* ]]; then
    rsync -a "$archive" "${destination%/}/"
  else
    mkdir -p -- "$destination"
    rsync -a "$archive" "${destination%/}/"
  fi
  printf 'snapshot: %s/%s\n' "${destination%/}" "$(basename "$archive")"
}

validate_archive() {
  local archive="$1" entry
  tar -tzf "$archive" >"$TEMP_DIR/archive.list"
  [[ -s "$TEMP_DIR/archive.list" ]] || die 'snapshot is empty'
  while IFS= read -r entry; do
    case "$entry" in
      '' | /* | '..' | ../* | */../* | */..) die "unsafe archive entry: $entry" ;;
    esac
    case "$entry" in
      workspace-catalog.json | local-identity.json | machine-id | \
        loro-repo | loro-repo/* | chats | chats/* | orchestration | orchestration/* | \
        session-files | session-files/*) ;;
      *) die "unexpected archive entry: $entry" ;;
    esac
  done <"$TEMP_DIR/archive.list"
}

restore_state() {
  local archive="$1" data_dir parent staging timestamp rollback=''
  [[ -f "$archive" ]] || die "snapshot does not exist: $archive"
  data_dir="$(resolve_data_dir)"
  [[ ! -L "$data_dir" ]] || die "data directory must not be a symlink: $data_dir"
  assert_stopped

  parent="$(dirname "$data_dir")"
  TEMP_DIR="$(mktemp -d "$parent/.lody-oss-state.XXXXXX")"
  staging="$TEMP_DIR/restored"
  mkdir -m 700 "$staging"
  validate_archive "$archive"
  tar -xzf "$archive" -C "$staging"

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  if [[ -e "$data_dir" ]]; then
    rollback="${data_dir}.pre-restore-${timestamp}"
    [[ ! -e "$rollback" ]] || rollback="${rollback}-$$"
    mv -- "$data_dir" "$rollback"
  fi

  if ! mv -- "$staging" "$data_dir"; then
    if [[ -n "$rollback" && ! -e "$data_dir" ]]; then
      mv -- "$rollback" "$data_dir"
    fi
    die 'restore failed; the previous data directory was put back'
  fi
  chmod 700 "$data_dir"
  printf 'restored: %s\n' "$data_dir"
  if [[ -n "$rollback" ]]; then
    printf 'rollback: %s\n' "$rollback"
  fi
}

usage() {
  cat <<'EOF'
Usage:
  scripts/lody-oss-state.sh backup <local-dir|user@host:/remote-dir>
  scripts/lody-oss-state.sh restore <local-snapshot.tar.gz>

Set LODY_OSS_DATA_DIR only when the state root is not ~/.lody-oss.
EOF
}

case "${1:-}" in
  backup)
    [[ $# -eq 2 ]] || { usage >&2; exit 2; }
    backup_state "$2"
    ;;
  restore)
    [[ $# -eq 2 ]] || { usage >&2; exit 2; }
    restore_state "$2"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
