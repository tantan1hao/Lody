#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
readonly TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lody-oss-restic-test.XXXXXX")"
trap 'rm -rf -- "$TEMP_ROOT"' EXIT

mkdir -p "$TEMP_ROOT/data/loro-repo"
printf 'machine-test\n' >"$TEMP_ROOT/data/machine-id"
printf '{}\n' >"$TEMP_ROOT/data/workspace-catalog.json"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf '\''%s\n'\'' "$@" >"${FAKE_RESTIC_LOG:?}"' \
  >"$TEMP_ROOT/fake-restic"
jq -n \
  --arg resticPath "$TEMP_ROOT/fake-restic" \
  '{
    version: 1,
    repository: "sftp:test@example.invalid:/repo",
    resticPath: $resticPath,
    passwordCommand: "printf test-password",
    sftpCommand: "ssh test@example.invalid -s sftp"
  }' >"$TEMP_ROOT/config.json"
chmod 700 "$TEMP_ROOT/fake-restic"

FAKE_RESTIC_LOG="$TEMP_ROOT/restic.args" \
LODY_OSS_DATA_DIR="$TEMP_ROOT/data" \
LODY_OSS_BACKUP_CONFIG="$TEMP_ROOT/config.json" \
LODY_OSS_HOST_PORT=0 \
LODY_OSS_PROCESS_PATTERN='^definitely-not-a-real-lody-process$' \
  "$SCRIPT_DIR/lody-oss-restic-backup.sh" >/dev/null

grep -Fx -- 'machine:machine-test' "$TEMP_ROOT/restic.args" >/dev/null
grep -Fx -- "$TEMP_ROOT/data/loro-repo" "$TEMP_ROOT/restic.args" >/dev/null
grep -Fx -- "$TEMP_ROOT/data/workspace-catalog.json" "$TEMP_ROOT/restic.args" >/dev/null
if grep -Fx -- 'test-password' "$TEMP_ROOT/restic.args" >/dev/null; then
  printf 'password leaked into restic argv\n' >&2
  exit 1
fi

printf 'lody-oss-restic-backup self-test passed\n'
