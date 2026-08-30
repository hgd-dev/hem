#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${RCLONE_REMOTE:?Set RCLONE_REMOTE to the production Cloudflare R2 remote/bucket, e.g. hem-r2:hem-backups}"
: "${HEM_COMPOSE_DIR:=/opt/hem/infra}"
: "${HEM_DISPOSABLE_HOST_CONFIRM:=}"
: "${HEM_EVIDENCE_DIR:=$ROOT/artifacts}"

if [[ "$HEM_DISPOSABLE_HOST_CONFIRM" != 'HEM_DISPOSABLE_R2_DRILL' ]]; then
  echo 'Refusing destructive production-R2 drill. Use only a disposable/copy host and set HEM_DISPOSABLE_HOST_CONFIRM=HEM_DISPOSABLE_R2_DRILL.' >&2
  exit 2
fi
for command in docker rclone node tar sha256sum; do command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }; done

HEM_VERSION="$(node -p "require('$ROOT/package.json').version")"
REMOTE_ALIAS="${RCLONE_REMOTE%%:*}"
[[ "$REMOTE_ALIAS" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'RCLONE_REMOTE must use a named rclone remote such as hem-r2:hem-backups.' >&2; exit 2; }
REMOTE_CONFIG="$(rclone config show "$REMOTE_ALIAS" 2>/dev/null || true)"
grep -Eq '^type\s*=\s*s3\s*$' <<<"$REMOTE_CONFIG" || { echo 'Configured rclone remote is not an S3 backend.' >&2; exit 1; }
grep -Eiq '^endpoint\s*=\s*https://[^ ]*r2\.cloudflarestorage\.com/?\s*$' <<<"$REMOTE_CONFIG" || { echo 'Configured S3 endpoint is not a verifiable Cloudflare R2 endpoint.' >&2; exit 1; }
unset REMOTE_CONFIG

cd "$HEM_COMPOSE_DIR"
ORCHESTRATOR_ID="$(docker compose ps -aq orchestrator | head -n1)"
[[ -n "$ORCHESTRATOR_ID" ]] || { echo 'HEM orchestrator container not found; create the production-shaped stack first.' >&2; exit 1; }
WORLD_VOLUME="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data/worlds"}}{{.Name}}{{end}}{{end}}' "$ORCHESTRATOR_ID")"
[[ -n "$WORLD_VOLUME" ]] || { echo 'HEM orchestrator /data/worlds volume mount not found.' >&2; exit 1; }

native_counts() {
  docker run --rm -v "$WORLD_VOLUME:/worlds:ro" alpine:3.22 sh -eu -c '
    levels=$(find /worlds -type f -path "*/world/level.dat" | wc -l | tr -d " ")
    players=$(find /worlds -type f -path "*/world/playerdata/*.dat" | wc -l | tr -d " ")
    printf "%s %s\n" "$levels" "$players"
  '
}
read -r PRE_LEVELS PRE_PLAYERS < <(native_counts)
(( PRE_LEVELS >= 1 )) || { echo 'Production R2 drill requires at least one existing native Paper world/level.dat.' >&2; exit 1; }
(( PRE_PLAYERS >= 1 )) || { echo 'Production R2 drill requires at least one existing native Paper playerdata file.' >&2; exit 1; }

TMP="$(mktemp -d)"
BAD_STAMP=''
cleanup() {
  rc=$?
  trap - EXIT INT TERM
  set +e
  if [[ -n "$BAD_STAMP" ]]; then rclone purge "$RCLONE_REMOTE/$BAD_STAMP/" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

BACKUP_OUTPUT="$(HEM_COMPOSE_DIR="$HEM_COMPOSE_DIR" "$ROOT/infra/backup-r2.sh")"
printf '%s\n' "$BACKUP_OUTPUT"
BACKUP_STAMP="$(grep -Eo '[0-9]{8}T[0-9]{6}Z' <<<"$BACKUP_OUTPUT" | tail -n1)"
[[ "$BACKUP_STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo 'Could not identify backup stamp from verified backup output.' >&2; exit 1; }

mkdir -p "$TMP/remote" "$TMP/expected"
rclone copy "$RCLONE_REMOTE/$BACKUP_STAMP/" "$TMP/remote/"
(cd "$TMP/remote" && sha256sum -c hem-worlds.tar.gz.sha256)
tar -xzf "$TMP/remote/hem-worlds.tar.gz" -C "$TMP/expected"
EXPECTED_HASHES="$(cd "$TMP/expected" && find . -type f \( -path '*/world/level.dat' -o -path '*/world/playerdata/*.dat' \) -print | LC_ALL=C sort | xargs -r sha256sum)"
[[ -n "$EXPECTED_HASHES" ]] || { echo 'Verified remote backup contains no native world/player data.' >&2; exit 1; }

# Prove disaster recovery from an actually empty world volume on this disposable host.
docker compose stop -t 60 orchestrator
docker run --rm -v "$WORLD_VOLUME:/worlds" alpine:3.22 sh -eu -c 'find /worlds -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
RESTORE_CONFIRM=RESTORE_HEM_WORLDS BACKUP_STAMP="$BACKUP_STAMP" HEM_COMPOSE_DIR="$HEM_COMPOSE_DIR" "$ROOT/infra/restore-r2.sh"

ACTUAL_HASHES="$(docker run --rm -v "$WORLD_VOLUME:/worlds:ro" alpine:3.22 sh -eu -c 'cd /worlds; find . -type f \( -path "*/world/level.dat" -o -path "*/world/playerdata/*.dat" \) -print | LC_ALL=C sort | xargs -r sha256sum')"
[[ "$ACTUAL_HASHES" == "$EXPECTED_HASHES" ]] || { echo 'Restored native world/player hashes differ from the verified R2 archive.' >&2; exit 1; }
read -r POST_LEVELS POST_PLAYERS < <(native_counts)
(( POST_LEVELS >= 1 && POST_PLAYERS >= 1 )) || { echo 'Restored world volume lost native level/player data.' >&2; exit 1; }

# Prove restore-r2.sh rolls the volume back after a post-mutation failure, using the same real R2 transport.
sleep 1
BAD_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$TMP/bad/payload"
printf 'intentionally invalid HEM restore drill\n' > "$TMP/bad/payload/not-a-world.txt"
(cd "$TMP/bad" && tar -czf hem-worlds.tar.gz payload && sha256sum hem-worlds.tar.gz > hem-worlds.tar.gz.sha256)
printf 'HEM backup UTC: %s\nHEM: %s\nPaper: 1.21.5 build 114\n' "$BAD_STAMP" "$HEM_VERSION" > "$TMP/bad/README.txt"
rclone copy "$TMP/bad/" "$RCLONE_REMOTE/$BAD_STAMP/"
rclone check "$TMP/bad/" "$RCLONE_REMOTE/$BAD_STAMP/" --one-way
BEFORE_ROLLBACK="$ACTUAL_HASHES"
set +e
RESTORE_CONFIRM=RESTORE_HEM_WORLDS BACKUP_STAMP="$BAD_STAMP" HEM_COMPOSE_DIR="$HEM_COMPOSE_DIR" "$ROOT/infra/restore-r2.sh" >"$TMP/bad-restore.log" 2>&1
BAD_RC=$?
set -e
(( BAD_RC != 0 )) || { cat "$TMP/bad-restore.log" >&2; echo 'Intentionally invalid R2 restore unexpectedly succeeded.' >&2; exit 1; }
grep -q 'rolling back the pre-restore snapshot' "$TMP/bad-restore.log" || { cat "$TMP/bad-restore.log" >&2; echo 'Invalid restore failed without proving automatic rollback.' >&2; exit 1; }
AFTER_ROLLBACK="$(docker run --rm -v "$WORLD_VOLUME:/worlds:ro" alpine:3.22 sh -eu -c 'cd /worlds; find . -type f \( -path "*/world/level.dat" -o -path "*/world/playerdata/*.dat" \) -print | LC_ALL=C sort | xargs -r sha256sum')"
[[ "$AFTER_ROLLBACK" == "$BEFORE_ROLLBACK" ]] || { echo 'Automatic rollback did not restore the pre-failure native data hashes.' >&2; exit 1; }

mkdir -p "$HEM_EVIDENCE_DIR"
cat > "$HEM_EVIDENCE_DIR/hem-production-r2-restore.json" <<JSON
{
  "hemVersion": "$HEM_VERSION",
  "transport": "cloudflare-r2",
  "rcloneBackend": "s3-cloudflare-r2",
  "remoteAlias": "$REMOTE_ALIAS",
  "backupStamp": "$BACKUP_STAMP",
  "remoteCopyVerified": true,
  "emptyVolumeRestore": true,
  "nativeLevelDatFiles": $POST_LEVELS,
  "nativePlayerDataFiles": $POST_PLAYERS,
  "nativeHashesMatch": true,
  "invalidArchiveRejectedAfterMutation": true,
  "automaticRollback": true,
  "rollbackHashesMatch": true,
  "completedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
node "$ROOT/scripts/verify-production-r2-evidence.mjs" "$HEM_EVIDENCE_DIR/hem-production-r2-restore.json"
printf 'Production Cloudflare R2 disaster-recovery drill passed. Evidence: %s\n' "$HEM_EVIDENCE_DIR/hem-production-r2-restore.json"
