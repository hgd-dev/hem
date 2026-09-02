#!/usr/bin/env bash
set -euo pipefail

: "${RCLONE_REMOTE:?Set RCLONE_REMOTE, e.g. hem-r2:hem-backups}"
: "${HEM_COMPOSE_DIR:=/opt/hem/infra}"
: "${HEM_RESTART_SERVICES:=orchestrator proxy caddy}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$(mktemp -d)"
STOPPED=0

cleanup() {
  rc=$?
  trap - EXIT INT TERM
  set +e
  if [[ "$STOPPED" == "1" ]]; then
    cd "$HEM_COMPOSE_DIR"
    docker compose up -d $HEM_RESTART_SERVICES >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$HEM_COMPOSE_DIR"
ORCHESTRATOR_ID="$(docker compose ps -aq orchestrator | head -n1)"
[[ -n "$ORCHESTRATOR_ID" ]] || { echo 'HEM orchestrator container not found; run docker compose up/create first.' >&2; exit 1; }
WORLD_VOLUME="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data/worlds"}}{{.Name}}{{end}}{{end}}' "$ORCHESTRATOR_ID")"
[[ -n "$WORLD_VOLUME" ]] || { echo 'HEM orchestrator /data/worlds volume mount not found' >&2; exit 1; }

# The orchestrator handles SIGTERM by save-all/stop and waits for every Paper child.
# Give it enough time to finish region/playerdata writes before Docker escalates.
docker compose stop -t 60 orchestrator
STOPPED=1

docker run --rm -v "$WORLD_VOLUME:/worlds:ro" -v "$TMP:/backup" alpine:3.22 \
  sh -eu -c 'cd /worlds && tar -czf /backup/hem-worlds.tar.gz .'
(cd "$TMP" && sha256sum hem-worlds.tar.gz > hem-worlds.tar.gz.sha256)
printf 'HEM backup UTC: %s\nHEM: 1.0.0-rc.32\nPaper: 1.21.5 build 114\n' "$STAMP" > "$TMP/README.txt"

# Upload, then independently compare the remote objects before restarting HEM.
rclone copy "$TMP/" "$RCLONE_REMOTE/$STAMP/"
rclone check "$TMP/" "$RCLONE_REMOTE/$STAMP/" --one-way

# Restart only after the off-site copy and verification succeed. The EXIT trap is also a safety net.
docker compose up -d $HEM_RESTART_SERVICES
STOPPED=0
printf 'Backup uploaded and verified: %s/%s/\n' "$RCLONE_REMOTE" "$STAMP"
