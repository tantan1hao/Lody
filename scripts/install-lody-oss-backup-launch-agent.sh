#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
readonly REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
readonly DATA_DIR="${LODY_OSS_DATA_DIR:-${HOME:?HOME is required}/.lody-oss}"
readonly BIN_DIR="$DATA_DIR/bin"
readonly LOG_DIR="$DATA_DIR/logs"
readonly TARGET_SCRIPT="$BIN_DIR/lody-oss-restic-backup.sh"
readonly TARGET_PLIST="$HOME/Library/LaunchAgents/dev.loro.lody.oss.backup.plist"
readonly TEMPLATE="$REPO_ROOT/ops/lody-oss/dev.loro.lody.oss.backup.plist"

mkdir -p "$BIN_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"
install -m 700 "$SCRIPT_DIR/lody-oss-restic-backup.sh" "$TARGET_SCRIPT"
install -m 600 "$TEMPLATE" "$TARGET_PLIST"
/usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 $TARGET_SCRIPT" "$TARGET_PLIST"
/usr/libexec/PlistBuddy -c "Set :StandardOutPath $LOG_DIR/backup.log" "$TARGET_PLIST"
/usr/libexec/PlistBuddy -c "Set :StandardErrorPath $LOG_DIR/backup-error.log" "$TARGET_PLIST"
plutil -lint "$TARGET_PLIST" >/dev/null

launchctl bootout "gui/$UID" "$TARGET_PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$TARGET_PLIST"
printf 'installed: %s\n' "$TARGET_PLIST"
