#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
fail=0
ok(){ printf 'PASS %s\n' "$1"; }
bad(){ printf 'FAIL %s\n' "$1" >&2; fail=1; }
command -v docker >/dev/null 2>&1 && ok 'Docker installed' || bad 'Docker is required on the game host'
docker compose version >/dev/null 2>&1 && ok 'Docker Compose available' || bad 'Docker Compose v2 is required'
[[ -f .env ]] && ok 'infra/.env exists' || bad 'copy infra/.env.example to infra/.env and configure it'
if [[ -f .env ]]; then
  set -a; source ./.env; set +a
  [[ "${ACCEPT_MINECRAFT_EULA:-}" == 'TRUE' ]] && ok 'Minecraft EULA explicitly accepted' || bad 'set ACCEPT_MINECRAFT_EULA=TRUE only after reviewing the EULA'
  for key in PLAY_DOMAIN CONTROL_DOMAIN CLIENT_ORIGIN HEM_HUB_URL ORCHESTRATOR_KEY SERVER_SERVICE_KEY; do
    value="${!key:-}"
    [[ -n "$value" && "$value" != *example.com* && "$value" != *replace* ]] && ok "$key configured" || bad "$key is missing/placeholder"
  done
  orch_key="${ORCHESTRATOR_KEY:-}"; server_key="${SERVER_SERVICE_KEY:-}"
  [[ ${#orch_key} -ge 32 ]] && ok 'ORCHESTRATOR_KEY length' || bad 'ORCHESTRATOR_KEY must be >=32 characters'
  [[ ${#server_key} -ge 32 ]] && ok 'SERVER_SERVICE_KEY length' || bad 'SERVER_SERVICE_KEY must be >=32 characters'
fi
(( fail == 0 )) || exit 1
echo 'HEM game-host preflight passed.'
