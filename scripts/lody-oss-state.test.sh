#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lody-oss-state-test.XXXXXX")"

cleanup() {
  case "$(basename "$TEST_ROOT")" in
    lody-oss-state-test.*) rm -rf -- "$TEST_ROOT" ;;
  esac
}
trap cleanup EXIT

mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/data/loro-repo/ws" "$TEST_ROOT/data/chats/session-1"
mkdir -p "$TEST_ROOT/data/npm-cache" "$TEST_ROOT/data/run" "$TEST_ROOT/backups"
printf '#!/bin/sh\nexit 1\n' >"$TEST_ROOT/bin/lsof"
printf '#!/bin/sh\nexit 1\n' >"$TEST_ROOT/bin/ss"
chmod +x "$TEST_ROOT/bin/lsof" "$TEST_ROOT/bin/ss"
printf 'catalog-original\n' >"$TEST_ROOT/data/workspace-catalog.json"
printf 'identity-original\n' >"$TEST_ROOT/data/local-identity.json"
printf 'repo-original\n' >"$TEST_ROOT/data/loro-repo/ws/store.sqlite3"
printf 'chat-original\n' >"$TEST_ROOT/data/chats/session-1/file.txt"
printf 'cache\n' >"$TEST_ROOT/data/npm-cache/ignored"

PATH="$TEST_ROOT/bin:$PATH" LODY_OSS_DATA_DIR="$TEST_ROOT/data" \
  "$SCRIPT_DIR/lody-oss-state.sh" backup "$TEST_ROOT/backups" >/dev/null
snapshot="$(find "$TEST_ROOT/backups" -type f -name '*.tar.gz' -print -quit)"
[[ -n "$snapshot" ]]
! tar -tzf "$snapshot" | grep -q '^npm-cache/'

printf 'catalog-mutated\n' >"$TEST_ROOT/data/workspace-catalog.json"
PATH="$TEST_ROOT/bin:$PATH" LODY_OSS_DATA_DIR="$TEST_ROOT/data" \
  "$SCRIPT_DIR/lody-oss-state.sh" restore "$snapshot" >/dev/null
grep -q '^catalog-original$' "$TEST_ROOT/data/workspace-catalog.json"
rollback="$(find "$TEST_ROOT" -maxdepth 1 -type d -name 'data.pre-restore-*' -print -quit)"
grep -q '^catalog-mutated$' "$rollback/workspace-catalog.json"
[[ ! -e "$TEST_ROOT/data/npm-cache" ]]

printf '#!/bin/sh\nexit 0\n' >"$TEST_ROOT/bin/lsof"
if PATH="$TEST_ROOT/bin:$PATH" LODY_OSS_DATA_DIR="$TEST_ROOT/data" \
  "$SCRIPT_DIR/lody-oss-state.sh" backup "$TEST_ROOT/backups" >/dev/null 2>&1; then
  printf 'expected active-writer check to fail\n' >&2
  exit 1
fi

printf 'lody-oss-state self-check passed\n'
