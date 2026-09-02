# HEM — Hudson-Elise-Minecraft

**Target:** Minecraft Java Edition **1.21.5** in a browser, with persistent private solo worlds and real-time private shared worlds.

HEM is a **clean-room browser reproduction** backed by a real **Paper 1.21.5** authority for vanilla server-side behavior. It does not redistribute Mojang's client or proprietary art/audio assets. The browser implements presentation/input with open-source web tooling and original HEM assets; Paper owns authoritative world generation, mobs, redstone, crafting, inventories, combat, dimensions, chunk ticking and Anvil saves.

## What this repository contains

- `apps/hub` — public HEM launcher/world service on Cloudflare Workers + D1.
- `apps/client` — reproducible HEM build layer over `zardoy/minecraft-web-client`, forced to the 1.21.5 protocol/data target and HEM auto-auth bridge.
- `apps/orchestrator` — starts one isolated Paper 1.21.5 process per HEM world, on demand, then stops idle worlds safely.
- `apps/server-plugin` — Paper plugin that freezes new connections until a short-lived, one-use HEM launch token is consumed.
- `apps/proxy` — allowlisted WebSocket → Minecraft TCP bridge for browsers.
- `infra` — Docker Compose/Caddy production host and cold R2 backup helper.
- `tests/system` — real Paper + two-Chromium 1.21.5 acceptance test.

## Eagler-style profile and launcher

First launch now includes a private HEM player profile with editable display name, Classic/Slim skin model, validated 64×64 (plus legacy 64×32) PNG skin upload, interactive WebGL 3D preview, device recovery, and later profile editing. The visible HEM name is kept separate from the immutable private game-login identifier so renaming a player does not destroy saved Paper playerdata.

The main menu keeps the familiar stacked **Singleplayer / Multiplayer / Join Private World / Options / Profile** flow using original HEM styling rather than Mojang assets.

Uploaded skins now propagate into the authenticated Paper player profile as a modern `textures` property (including Classic/Slim metadata) so every tracking client receives the same skin identity. RC11 replaces the flat launcher mockup with a dependency-free WebGL Classic/Slim player preview using the real uploaded skin atlas, base + outer layers and drag rotation; legacy 64×32 skins are face-mirrored into a complete 64×64 Classic atlas before use. RC11 also re-announces post-auth profile changes to already-connected players, and the two-browser system gate requires each browser to fetch the other player’s distinct custom skin before it can pass.

## Singleplayer means full Minecraft rules

HEM's main **Singleplayer** button creates a private cloud/server-backed Paper world with one member. It is not the upstream browser client's simplified local Flying Squid world. That choice is intentional: the simplified integrated server is not full 1.21.5, while Paper is.

The create-world screen now supports **Survival / Creative / Hardcore**, Peaceful–Hard difficulty, Default / Superflat / Large Biomes / Amplified generation, Generate Structures, seed, private Solo/Shared access and per-world commands. Paper maps these directly to native `server.properties` (`hardcore`, `level-type`, `generate-structures`) so they persist with the actual world.

Each world also stores an independent **Allow Commands** setting. When enabled, HEMGate grants the authenticated player command permissions only inside that isolated Paper process and enables command blocks; disabling it keeps the world non-op.

Each HEM world receives its own server directory:

```text
/data/worlds/w_.../
  world/
  world_nether/
  world_the_end/
  playerdata / advancements / stats (inside the native world data)
  plugins/HEMGate.jar
  server.properties
```

That means Hudson's solo world, Elise's solo world and a shared Hudson+Elise world cannot leak inventories or world data into one another.

## Multiplayer model

A shared world is also a normal Paper world. Both browsers connect to the same process simultaneously through the proxy. Paper is authoritative. Either player can leave and return later; the world remains on disk. An accepted invite becomes permanent HEM membership, so the world stays in that player's Multiplayer list.


### World downgrade safety

RC11 targets Minecraft Java 1.21.5 (DataVersion 4325). Before starting an existing Paper world, the orchestrator reads `world/level.dat` and refuses to launch any world whose DataVersion is newer than 4325. **Do not point RC30 at a world that RC9/RC10 already opened with 1.21.11.** Restore a 1.21.5-or-older backup instead. This guard prevents an unsafe Minecraft world downgrade.

## Release status

This source tree is **HEM 1.0.0 RC30**, not a falsely labeled final build.

RC30 continues the **confirmed live Minecraft 1.21.5 runtime repair path**. The RC29 run proved the first `hem:session` lease now arrives successfully and advanced through reciprocal remote skins, then failed specifically after Hudson refreshed: the refreshed tab did not complete resume + rotated-lease storage. Static tracing exposed a connection-lifecycle race in HEMGate: authorization was keyed only by Minecraft UUID, so an old connection's late `PlayerQuitEvent` could remove authorization belonging to the newly refreshed connection with the same UUID. RC30 makes authorization connection-scoped by Player identity. It also removes the repeated server-timing assumption from lease rotation: the browser now requests `/hem lease` after auth/resume and retries a secret-free request until Paper has observed `hem:session`; the server keeps that request idempotent and at most one active one-use resume token per player. RC29's exact no-trailing-NUL REGISTER patch remains mandatory. The exact v0.1.99 source commit, frozen lockfile, RC26 chunk decoder patch, RC27 sound/HTTPS-skin repairs, RC21 manifest-first checkout protection and repo-root package remain unchanged.

RC11 closes the last completely-unimplemented parity rows: the ledger has **0 TODOs**. The client build preserves the pinned upstream source provenance and SHA-256, pins minecraft-web-client v0.1.99 (the later stable 0.1 release that inherits the upstream 1.21.5 protocol update and adds further runtime/entity/renderer fixes), preserves its checked-in package/lock graph with a **frozen lockfile**, and then **verifies HEM's installed 1.21.5 protocol/data stack before bundling**. Literal version tokens inside historical `supportedVersions.mjs` are informational only and are never treated as a complete support list. `npm run doctor` reports local prerequisites; `npm run doctor:system` is a strict machine-readable preflight used by System Acceptance. That does **not** mean full 1.21.5 parity yet. RC27 carries **163 mandatory live gameplay/client gates plus the longevity soak**, and `npm run parity:full` deliberately refuses the full-parity label while any ledger row is still `PARTIAL`. New RC11 coverage includes Spring to Life plants/eggs/animal variants and dry-grass growth, native structure/biome probes, random ticks, survival mining speed, archaeology blocks, workstation windows, original HEM audio/damage feedback, modern settings transport, elytra/firework use, modern item/book/navigation paths, durability, armor mitigation, bow/wind-charge/mace paths, Java quasi-connectivity, Crafter trigger state, villager trading, sculk vibration, vehicle mount/dismount and inventories, trapped/shulker boxes, smoker/blast-furnace processing, expanded redstone I/O, HUD/scoreboard/team packets, recipe/statistics/advancement packets, command completion and multiplayer leave/rejoin events, plus the RC11 closure batches for seed authority, walls/vines/bubble columns/powder snow, archaeology brushing, native brewing/smithing/grindstone results, death drops, End Gateway + dragon exit-fountain state, attack cooldown/criticals, bundle storage, furnace XP, target/activator-rail/torch-burnout behavior, paid beacon effects, directional shields, Protection IV, Fire Aspect, Totems, potion→milk effect clearing and dynamic world-border updates.


Local source verification currently passes **109/109 tests** and **57/57 release contracts**. The final release gate is `.github/workflows/system-1215.yml`, which must successfully:

1. build the actual browser client against 1.21.5 data/protocol plus the pinned modern item-definition asset layer;
2. launch the HEM profile UI in Chromium and certify WebGL Classic/Slim rendering, drag rotation and legacy 64×32 normalization;
3. build and start checksum-pinned Paper 1.21.5;
4. launch two independent Chromium profiles into the same Paper world and authenticate both through HEMGate;
5. require actual rendered chunk-section meshes, runtime 1.21.5 registries and reciprocal custom-skin fetches;
6. prove browser refresh through a rotated five-minute one-use resume lease;
7. stop the real proxy, prove both clients disconnect/presence clears, restart it, and prove both same tabs resume;
8. prove real-time movement through both Mineflayer controls and a normal Chromium `W` key, plus jump/fall and one-block obstacle traversal, native minecart mount/dismount, shared block updates and client-originated mining + placement with post-placement renderer stability;
9. prove distinct inventories, armor/offhand equipment, client-origin commands, lever + repeater + redstone-dust propagation, chest/barrel/shulker state and per-player ender-chest isolation;
10. prove 2×2 and true 3×3 browser crafting, furnace + smoker + blast-furnace processing, dropped-item entities, water/lava states, piston movement and hopper transfer;
11. prove Mace/Wind Charge plus native 1.21.5 Spring to Life plant/item paths, Brown/Blue Eggs, warm/cold farm-animal variants and Short→Tall Dry Grass bone-meal growth;
12. synchronize representative villager/armor-stand/Overworld/Nether/End hostile entity families;
13. prove 25-message client-origin chat stability, survival damage, horizontal knockback, fall damage, hunger depletion, death and client-origin respawn;
14. prove server-authoritative time/weather/difficulty, native world-border constraint, command dimension transfers and native Nether/End portal entry;
15. hold both browser clients/renderers healthy through a 60-minute main/manual certification soak;
16. force-kill active Paper, restart the same world and prove flushed world/player state recovers;
17. fully stop/restart Paper and prove shared world plus both player inventories persist;
18. start an isolated private Singleplayer Paper world and prove shared playerdata does not leak, then restart it and prove its own inventory/Anvil persistence;
19. run the real cold backup/restore scripts against the orchestrator volume through a deterministic local-rclone remote and prove good restore;
20. deliberately feed a checksum-valid but unusable restore after mutation begins and prove automatic rollback preserves native world state;
21. emit launcher, gameplay and restore machine-readable certificates and independently verify every required named gate, soak threshold and exact final upstream pin.

**Only a green exact-pinned workflow plus the finite production blockers in `docs/RELEASE_BLOCKERS.md` is grounds to promote and tag `v1.0.0`.** The browser-client dependency stack can change independently of Paper and registry metadata, so forcing the version number without behavioral evidence would not be honest.

### Browser-client reproducibility

`apps/client/build-client.mjs` accepts `MWC_REF`. **v0.1.99 is intentionally older than current upstream:** HEM targets 1.21.5, and v0.1.99 is the pinned later stable 0.1 release that inherits native 1.21.5 support from v0.1.98 and includes additional runtime fixes. The default stays on `0359f20b8d721ea44c7ddb633c985a71574c73d3` until another exact commit is independently proven by HEM's protocol/data checks and full live acceptance.  RC/system runs default to the exact upstream v0.1.99 stable-release commit `0359f20b8d721ea44c7ddb633c985a71574c73d3` (overrideable with `MWC_REF`), and every build records both the requested ref and resolved Git commit in `hem-build.json`. For final certification set `MWC_REF=<40-character known-good SHA>`; non-commit refs are rejected. System Acceptance enforces exact pinning on every run, and the production Cloudflare workflow always requires the exact pinned SHA.

## Local checks

```bash
npm test
npm run verify
npm run parity
npm run parity:full   # intentionally fails until every PARTIAL becomes PASS
npm run release:guard
npm run preflight
```

RC11 also validates the complete D1 migration chain against SQLite. Hardcore persistence uses the existing `game_mode=survival` value plus a dedicated `hardcore` flag, so upgrades remain compatible with the original database constraint. The world list includes owner-only Edit/Rename while keeping the native Paper save directory stable.

Final promotion is evidence-driven rather than status-file-driven. `npm run release:reconcile` derives readiness from the exact-pinned 60-minute system certificate, the production Cloudflare R2 restore/rollback certificate and the completed household acceptance worksheet. `npm run drill:r2-production` performs the destructive restore exercise only when the explicit disposable-host confirmation is present; `npm run verify:r2-production` and `npm run verify:manual` independently validate the two production/human evidence artifacts. The four release-blocker status words in Markdown cannot make a release pass or fail by themselves.

RC27 retains Paper **1.21.5 build 114** by exact SHA-256, rather than downloading a moving “latest” build. Production backups gracefully stop every child Paper process (`save-all flush` → `stop`) before copying world files. RC11 writes relocatable checksums and adds `infra/restore-r2.sh`, which verifies the checksum and archive paths before touching the live volume, creates a local rollback image, and automatically restores that rollback if extraction/verification fails. Multiplayer presence is tracked per player with monotonic timestamps so reordered join/quit HTTP notifications cannot leave a world falsely occupied.

The heavyweight browser/Paper system gate requires Docker, internet access and Chromium; see [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md).

## Deployment overview

You need:

- Cloudflare account for the HEM hub, D1 and HEM client static deployment;
- a small Linux VPS with Docker for Paper + proxy (8 GB RAM is a comfortable starting point for up to two active worlds with the included defaults);
- two DNS names pointing to the VPS, e.g. `play.example.com` and `control.example.com`;
- one public Hub URL, e.g. `https://hem.example.com`;
- one public browser-client URL, e.g. `https://client.example.com`.

See [`docs/DEPLOY.md`](docs/DEPLOY.md). The Cloudflare deployment workflow now renders its production config from GitHub Environment variables, validates secrets/placeholders, applies D1 migrations, deploys the client and hub, installs Worker secrets, verifies the deployed client's `hem-build.json` is exactly HEM RC27 / Minecraft 1.21.5 and carries the deterministic 1.21.5 chunk-decoder patch attestation and was built from an exact upstream commit ref equal to the resolved commit, then checks the public hub health endpoint.

## Saves and backups

Paper continuously performs normal native world saves. HEM additionally includes `infra/backup-r2.sh`, which takes a **cold** snapshot of the entire world volume and uploads it through rclone to an R2 remote. Cold snapshots are used because copying region files while Paper is writing them is not a reliable disaster-recovery strategy. `infra/restore-r2.sh` performs the inverse operation only after an explicit destructive-confirmation flag, checksum validation, archive path-safety validation, and a pre-restore local rollback snapshot. System Acceptance now exercises this logic automatically with a disposable local-filesystem rclone remote, including a successful restore and automatic rollback after a deliberately invalid destructive restore. A real disposable-host **Cloudflare R2 transport** restore drill is still required before `v1.0.0`.

## EULA and assets

The orchestrator refuses to create Paper worlds unless `ACCEPT_MINECRAFT_EULA=TRUE` is explicitly configured. Set it only after reviewing and accepting the Minecraft EULA.

HEM's launcher uses original CSS artwork and HEM branding; it does not include the Mojang/Minecraft logo. HEM is an unofficial private fan project and is not affiliated with Mojang Studios or Microsoft. Review Mojang/Microsoft usage terms before making a public distribution beyond your household.

## Why not Eaglercraft?

HEM needs real 1.21.5 behavior. Mature Eaglercraft builds are based on much older Java Edition versions. A modern real Paper 1.21.5 authority plus a current browser protocol client is a much shorter and safer path to correct mobs, dimensions, redstone, containers, combat, world generation and saves.
