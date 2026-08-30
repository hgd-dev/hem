#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HEM_VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")"
COMPOSE_DIR="$ROOT/tests/system"
REMOTE="${HEM_TEST_RCLONE_REMOTE:-/tmp/hem-r2-local}"
export HEM_COMPOSE_DIR="$COMPOSE_DIR"
export HEM_RESTART_SERVICES='orchestrator proxy'
export RCLONE_REMOTE="$REMOTE"
rm -rf "$REMOTE"
mkdir -p "$REMOTE" "$ROOT/artifacts"

volume_name() {
  local id
  id="$(cd "$COMPOSE_DIR" && docker compose ps -aq orchestrator | head -n1)"
  [[ -n "$id" ]] || { echo 'orchestrator container missing' >&2; return 1; }
  docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data/worlds"}}{{.Name}}{{end}}{{end}}' "$id"
}

world_volume="$(volume_name)"
[[ -n "$world_volume" ]] || { echo 'world volume missing' >&2; exit 1; }

# The browser acceptance has already created native shared/solo worlds.
docker run --rm -v "$world_volume:/worlds:ro" alpine:3.22 sh -eu -c \
  "find /worlds -type f -path '*/world/level.dat' -print -quit | grep -q ."

backup_out="$("$ROOT/infra/backup-r2.sh")"
printf '%s\n' "$backup_out"
stamp="$(printf '%s\n' "$backup_out" | sed -n 's#.*Backup uploaded and verified: .*/\([0-9]\{8\}T[0-9]\{6\}Z\)/#\1#p' | tail -n1)"
[[ "$stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo 'Could not parse backup stamp' >&2; exit 1; }

# Mutate the live volume after backup; a good restore must remove this marker.
world_volume="$(volume_name)"
docker run --rm -v "$world_volume:/worlds" alpine:3.22 sh -eu -c 'echo mutation >/worlds/HEM_AFTER_BACKUP.txt'
RESTORE_CONFIRM=RESTORE_HEM_WORLDS BACKUP_STAMP="$stamp" "$ROOT/infra/restore-r2.sh"
world_volume="$(volume_name)"
if docker run --rm -v "$world_volume:/worlds:ro" alpine:3.22 test -e /worlds/HEM_AFTER_BACKUP.txt; then
  echo 'Good restore failed to replace post-backup mutation.' >&2
  exit 1
fi
docker run --rm -v "$world_volume:/worlds:ro" alpine:3.22 sh -eu -c \
  "find /worlds -type f -path '*/world/level.dat' -print -quit | grep -q ."

# Now prove automatic rollback after a destructive restore has already started.
# This fake archive has valid metadata/checksum but no native world/level.dat, so
# restore-r2.sh must replace the volume, detect the bad restore, then roll back.
bad_stamp='20990101T000000Z'
bad_dir="$REMOTE/$bad_stamp"
mkdir -p "$bad_dir" /tmp/hem-bad-restore
printf 'invalid restore body\n' >/tmp/hem-bad-restore/not-a-world.txt
( cd /tmp/hem-bad-restore && tar -czf "$bad_dir/hem-worlds.tar.gz" . )
( cd "$bad_dir" && sha256sum hem-worlds.tar.gz > hem-worlds.tar.gz.sha256 )
printf 'HEM backup UTC: %s\nHEM: %s\nPaper: 1.21.5 build 114\n' "$bad_stamp" "$HEM_VERSION" >"$bad_dir/README.txt"
rm -rf /tmp/hem-bad-restore

world_volume="$(volume_name)"
docker run --rm -v "$world_volume:/worlds" alpine:3.22 sh -eu -c 'echo preserve-me >/worlds/HEM_ROLLBACK_SENTINEL.txt'
set +e
RESTORE_CONFIRM=RESTORE_HEM_WORLDS BACKUP_STAMP="$bad_stamp" "$ROOT/infra/restore-r2.sh" >/tmp/hem-invalid-restore.log 2>&1
invalid_rc=$?
set -e
cat /tmp/hem-invalid-restore.log
[[ "$invalid_rc" -ne 0 ]] || { echo 'Invalid restore unexpectedly succeeded.' >&2; exit 1; }
world_volume="$(volume_name)"
docker run --rm -v "$world_volume:/worlds:ro" alpine:3.22 test -f /worlds/HEM_ROLLBACK_SENTINEL.txt
docker run --rm -v "$world_volume:/worlds:ro" alpine:3.22 sh -eu -c \
  "find /worlds -type f -path '*/world/level.dat' -print -quit | grep -q ."

cat >"$ROOT/artifacts/hem-restore-certification.json" <<JSON
{
  "hemVersion": "$HEM_VERSION",
  "transport": "rclone-local-filesystem",
  "goodRestore": true,
  "postBackupMutationRemoved": true,
  "invalidArchiveRejectedAfterMutation": true,
  "automaticRollback": true,
  "backupStamp": "$stamp",
  "completedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
printf 'HEM BACKUP/RESTORE + ROLLBACK DRILL PASSED\n'
