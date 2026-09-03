# HEM RC34 — go live

This is the shortest safe path from the source ZIP to a playable public HEM deployment.

## A. Push source to GitHub

Create a private repository named `hem` and push this source tree. Keep `.env` files and generated `wrangler.production.jsonc` out of Git; they are already ignored.

## B. Run the release gates first

Before CI, `npm run doctor` gives an advisory local prerequisite report. The System Acceptance workflow itself runs strict `npm run doctor:system`, which must pass before live gameplay certification.

In GitHub Actions run:

1. **HEM CI**
2. **HEM 1.21.5 System Acceptance**

Do not expose HEM to normal play until the second workflow prints:

```text
HEM 1.21.5 SYSTEM ACCEPTANCE PASSED
```

That workflow first certifies the launcher’s WebGL Classic/Slim 3D skin preview and legacy-skin normalization, then builds the actual browser client, boots exact Paper 1.21.5 build 114 and launches two Chromium clients. It checks rendered chunks, real-time Mineflayer + normal-keyboard movement/jump/fall including one-block obstacle traversal, mining/placement plus post-placement renderer stability, commands, armor/offhand, lever + repeater + redstone-dust propagation, chest/barrel/shulker/private ender chest, 2×2 + 3×3 crafting, furnace/smoker/blast-furnace processing, minecart riding, dropped items, fluids, pistons/hoppers, 1.21.5-only content, representative entity families, reciprocal custom-skin fetches, refresh/reconnect, a real proxy stop/start + same-tab resume, chat stability, combat/knockback/fall damage, hunger/death/respawn, time/weather/difficulty, world-border constraint, command dimension transfer + native Nether/End portal entry, a 60-minute soak, forced Paper crash recovery, full restarts, multiplayer + isolated Singleplayer persistence, and a deterministic cold-backup restore + rollback drill. It then independently verifies launcher, gameplay and restore certificates.

## C. Create Cloudflare D1

```bash
npx wrangler@4.124.0 d1 create hem
```

Save the returned database ID.

## D. Configure GitHub Environment `production`

Variables:

- `HEM_D1_DATABASE_ID`
- `HEM_CLIENT_URL`
- `HEM_PROXY_URL`
- `HEM_ORCHESTRATOR_URL`
- `HEM_HUB_URL`

Secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `HOUSEHOLD_CODE`
- `IDENTITY_PEPPER`
- `SERVER_SERVICE_KEY`
- `ORCHESTRATOR_KEY`

Generate the three machine secrets with `openssl rand -hex 32`. The last two must match the game-host `.env`.

## E. Bring up the Paper game host

On an always-on Linux VPS/host with Docker:

```bash
cd infra
cp .env.example .env
# fill .env and review/accept the Minecraft EULA before setting ACCEPT_MINECRAFT_EULA=TRUE
./preflight.sh
docker compose up -d --build
```

Point `PLAY_DOMAIN` and `CONTROL_DOMAIN` DNS to this host. Caddy handles TLS. Raw Paper ports are never published.

## F. Deploy Cloudflare

Take the exact `upstreamCommit` from the successful System Acceptance `hem-build.json`/`hem-1215-certification.json`. Run System Acceptance manually once more with that exact SHA as `mwc_ref`; exact pinning is mandatory in the workflow. Then run **Deploy HEM Cloudflare** and provide the same exact 40-character SHA as its required `mwc_ref` input. The deploy workflow rejects moving branch/tag refs, builds the client, validates production configuration, applies D1 migrations, deploys client + hub, writes Worker secrets and checks `/api/health`.

## G. First real play

1. Open the public HEM hub URL in Hudson's browser and register with the household code.
2. Export a device backup from Profile.
3. Create a Singleplayer world, enter, change the world, leave, relaunch, verify persistence.
4. Open the hub on Elise's browser and register.
5. Create a Multiplayer world, generate one invite, redeem it on Elise's browser.
6. Both click the same saved Multiplayer world and play together.
7. Exit both, let the world stop, then relaunch it and confirm blocks/inventories/locations persist.

After the 60-minute automated acceptance is green, download its `artifacts/` evidence into the source tree. Run the **real Cloudflare R2** disposable-host drill with `HEM_DISPOSABLE_HOST_CONFIRM=HEM_DISPOSABLE_R2_DRILL RCLONE_REMOTE=<your-r2-remote> npm run drill:r2-production`, then copy the resulting `hem-production-r2-restore.json` into `artifacts/`. Complete and sign `docs/MANUAL_ACCEPTANCE.md`, run `npm run verify:manual`, and keep its generated evidence in `artifacts/`.

Reconcile all four evidence-derived blockers and require an actual zero-blocker state:

```bash
npm run release:reconcile
npm run release:readiness -- --final
npm run promote
```

`npm run promote` converts the same evidence-complete RC27 source tree to `1.0.0` and regenerates `SOURCE_MANIFEST.sha256`. Rebuild/rerun **HEM 1.21.5 System Acceptance** against the same exact upstream SHA on that final tree with the exact pinned SHA (pinning is now mandatory in the workflow); replace the RC automation artifacts with the final ones. Then run:

```bash
npm run release:guard
npm run manifest:verify
npm run package
```

Only that final green tree is eligible to tag `v1.0.0`.
