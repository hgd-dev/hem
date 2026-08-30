# Deploy HEM

## 1. Prerequisites

- GitHub repository containing this source tree.
- Cloudflare account.
- Linux VPS with Docker Engine + Docker Compose plugin; start with roughly 8 GB RAM for the included two-active-world defaults.
- Java is inside the orchestrator container; no host Java installation is required.
- DNS names for proxy and orchestrator control, e.g. `play.example.com`, `control.example.com`.

Review the Minecraft EULA. The game host will refuse to create a world unless you explicitly set `ACCEPT_MINECRAFT_EULA=TRUE`.

## 2. Create Cloudflare D1 once

Create the database:

```bash
npx wrangler@4.124.0 d1 create hem
```

Copy the returned database ID. Do **not** commit production secrets or hand-edit generated config files. The deployment workflow renders `apps/hub/wrangler.production.jsonc` from GitHub Environment variables and applies migrations automatically.

## 3. Configure the GitHub `production` Environment

Environment variables (`vars`):

- `HEM_D1_DATABASE_ID` — ID returned by `wrangler d1 create hem`.
- `HEM_CLIENT_URL` — final client origin, for example `https://hem-client.<account>.workers.dev`.
- `HEM_PROXY_URL` — public TLS proxy, for example `https://play.example.com`.
- `HEM_ORCHESTRATOR_URL` — public TLS control URL, for example `https://control.example.com`.
- `HEM_HUB_URL` — final HEM hub origin, for example `https://hem-hub.<account>.workers.dev`.

Environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `HOUSEHOLD_CODE` — the private code Hudson/Elise use only when registering a new browser profile.
- `IDENTITY_PEPPER` — generate with `openssl rand -hex 32`.
- `SERVER_SERVICE_KEY` — generate with `openssl rand -hex 32`.
- `ORCHESTRATOR_KEY` — generate with `openssl rand -hex 32`.

`SERVER_SERVICE_KEY` and `ORCHESTRATOR_KEY` must exactly match the values on the game host.

The **Deploy HEM Cloudflare** workflow now performs, in order:

1. exact-commit-pinned 1.21.5 browser-client build (`mwc_ref` is a required workflow input);
2. production-config rendering + placeholder/secret preflight;
3. client deployment;
4. remote D1 migration;
5. hub deployment;
6. Worker secret installation;
7. public `/api/health` verification.

## 4. Game host (VPS or always-on Linux PC)

HEM cannot run full Paper Java worlds on GitHub Pages/Cloudflare Workers alone. You need one always-on compute host. A small Linux VPS is the clean production choice; an always-on home Linux machine also works if you expose only the two TLS endpoints safely.

Copy the host environment and configure it:

```bash
cd infra
cp .env.example .env
chmod 600 .env
# edit .env
./preflight.sh
```

Review the Minecraft EULA first. Set `ACCEPT_MINECRAFT_EULA=TRUE` only if you accept it.

Point DNS for `PLAY_DOMAIN` and `CONTROL_DOMAIN` to the host, then:

```bash
docker compose up -d --build
curl https://control.example.com/healthz
curl https://play.example.com/healthz
```

Caddy obtains TLS automatically when DNS and ports 80/443 are correct. Raw Paper ports are Docker-internal only. The orchestrator downloads exactly **Paper 1.21.5 build 114**, verifies the pinned SHA-256 before use, and refuses a mismatched server artifact.

## 4a. What “Singleplayer” means in HEM

Singleplayer is a one-member private Paper world, not an offline browser-only simulation. This is intentional: it gives the solo world the same full 1.21.5 server rules, mobs, dimensions, redstone and save format as multiplayer. It therefore requires the HEM game host to be reachable.

## 5. Release gate

Run **HEM 1.21.5 System Acceptance** in GitHub Actions. It defaults to the exact known-good upstream v0.1.98 commit `cdd8c31a0e9261ee57fb66ff8ca5af0e074bff78` and rejects moving branch/tag refs. To test another upstream revision, provide another exact 40-character SHA. It should upload rendered browser evidence plus `hem-1215-certification.json` and end with:

```text
HEM 1.21.5 SYSTEM ACCEPTANCE PASSED
```

Then complete the manual two-player checklist in `docs/ACCEPTANCE.md`.

## 6. Backups

Configure rclone with an R2 S3 remote, then set `RCLONE_REMOTE` to `remote:bucket/prefix` and schedule `infra/backup-r2.sh` during a quiet period.

The helper stops the orchestrator first so every child Paper process receives a save/stop before the world-volume tarball is created. This favors recoverability over zero downtime.

List available backup stamps with your configured rclone remote, then restore only after selecting the exact UTC stamp:

```bash
cd /opt/hem/infra
RCLONE_REMOTE='remote:bucket/prefix' \
BACKUP_STAMP='YYYYMMDDTHHMMSSZ' \
RESTORE_CONFIRM='RESTORE_HEM_WORLDS' \
./restore-r2.sh
```

The helper downloads before touching the live volume, verifies the SHA-256, rejects absolute/path-traversal archive entries, stops the orchestrator, captures a local pre-restore rollback tarball, restores the selected snapshot, requires at least one native `world/level.dat`, and rolls the old volume back automatically if the destructive phase fails. Perform the first drill on a disposable/copy host and verify real block + player inventory state before trusting backups.

## Upgrade rule

Never silently move the game server or browser data version away from 1.21.5 in a HEM 1.x patch. Test upgrades in a copy of the world volume and keep backups before changing Paper/client dependencies.
