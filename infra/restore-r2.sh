#!/usr/bin/env bash
set -euo pipefail

: "${RCLONE_REMOTE:?Set RCLONE_REMOTE, e.g. hem-r2:hem-backups}"
: "${BACKUP_STAMP:=${1:-}}"
: "${HEM_COMPOSE_DIR:=/opt/hem/infra}"
: "${HEM_RESTART_SERVICES:=orchestrator proxy caddy}"
: "${RESTORE_CONFIRM:=}"

if [[ -z "$BACKUP_STAMP" || ! "$BACKUP_STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo 'Usage: RESTORE_CONFIRM=RESTORE_HEM_WORLDS BACKUP_STAMP=YYYYMMDDTHHMMSSZ ./restore-r2.sh' >&2
  exit 2
fi
if [[ "$RESTORE_CONFIRM" != 'RESTORE_HEM_WORLDS' ]]; then
  echo 'Refusing destructive restore. Set RESTORE_CONFIRM=RESTORE_HEM_WORLDS after confirming the backup stamp.' >&2
  exit 2
fi

TMP="$(mktemp -d)"
ROLLBACK="$TMP/pre-restore-worlds.tar.gz"
STOPPED=0
MUTATED=0
WORLD_VOLUME=''

cleanup() {
  rc=$?
  trap - EXIT INT TERM
  set +e
  if [[ "$rc" != 0 && "$MUTATED" == 1 && -n "$WORLD_VOLUME" && -f "$ROLLBACK" ]]; then
    echo 'Restore failed after world-volume mutation; rolling back the pre-restore snapshot.' >&2
    docker run --rm -v "$WORLD_VOLUME:/worlds" -v "$TMP:/restore" alpine:3.22 sh -eu -c '
      find /worlds -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
      tar -xzf /restore/pre-restore-worlds.tar.gz -C /worlds
    ' || true
  fi
  if [[ "$STOPPED" == 1 ]]; then
    cd "$HEM_COMPOSE_DIR"
    docker compose up -d $HEM_RESTART_SERVICES >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Download into an isolated directory before touching the live Docker volume.
rclone copy "$RCLONE_REMOTE/$BACKUP_STAMP/" "$TMP/"
for required in hem-worlds.tar.gz hem-worlds.tar.gz.sha256 README.txt; do
  [[ -f "$TMP/$required" ]] || { echo "Backup is incomplete: missing $required" >&2; exit 1; }
done
(cd "$TMP" && sha256sum -c hem-worlds.tar.gz.sha256)

# Refuse an archive created by a materially different server baseline.
grep -Fxq 'HEM: 1.0.0-rc.24' "$TMP/README.txt" || { echo 'Backup HEM release metadata does not match 1.0.0-rc.24.' >&2; exit 1; }
grep -Fxq 'Paper: 1.21.5 build 114' "$TMP/README.txt" || { echo 'Backup Paper metadata does not match 1.21.5 build 114.' >&2; exit 1; }

# Reject archive paths that could escape the target volume.
while IFS= read -r entry; do
  case "$entry" in
    /*|../*|*/../*|*/..)
      echo "Unsafe path in backup archive: $entry" >&2
      exit 1
      ;;
  esac
done < <(tar -tzf "$TMP/hem-worlds.tar.gz")

cd "$HEM_COMPOSE_DIR"
ORCHESTRATOR_ID="$(docker compose ps -aq orchestrator | head -n1)"
[[ -n "$ORCHESTRATOR_ID" ]] || { echo 'HEM orchestrator container not found; run docker compose up/create first.' >&2; exit 1; }
WORLD_VOLUME="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data/worlds"}}{{.Name}}{{end}}{{end}}' "$ORCHESTRATOR_ID")"
[[ -n "$WORLD_VOLUME" ]] || { echo 'HEM orchestrator /data/worlds volume mount not found' >&2; exit 1; }

docker compose stop -t 60 orchestrator
STOPPED=1

# Keep an immediate local rollback image in case extraction or verification fails.
docker run --rm -v "$WORLD_VOLUME:/worlds:ro" -v "$TMP:/restore" alpine:3.22 \
  sh -eu -c 'cd /worlds && tar -czf /restore/pre-restore-worlds.tar.gz .'

MUTATED=1
docker run --rm -v "$WORLD_VOLUME:/worlds" -v "$TMP:/restore:ro" alpine:3.22 sh -eu -c '
  find /worlds -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  tar -xzf /restore/hem-worlds.tar.gz -C /worlds
'

# A useful HEM recovery snapshot must contain at least one native Paper world.
if ! docker run --rm -v "$WORLD_VOLUME:/worlds:ro" alpine:3.22 sh -eu -c \
  "find /worlds -type f -path '*/world/level.dat' -print -quit | grep -q ."; then
  echo 'Restored archive has no native Paper world/level.dat; refusing to accept this restore.' >&2
  exit 1
fi

# Start the same production services only after checksum, metadata, path safety,
# extraction, and native-world verification have all succeeded.
docker compose up -d $HEM_RESTART_SERVICES
STOPPED=0
MUTATED=0
printf 'Restore completed from %s/%s/\n' "$RCLONE_REMOTE" "$BACKUP_STAMP"
printf 'Next: launch a disposable/copied HEM world and verify block + player inventory state before declaring the drill passed.\n'
