# HEM RC18 verification record

Date: 2026-08-31

## Completed in the build sandbox

- Reconstructed real source tree after discovering the previous preserved RC contained documentation only.
- `node --check` on generated Node/browser sources.
- `npm test`: **85/85 passing** source/logic/security/release-gate tests in the current RC18 local pass.
- `npm run verify`: **53/53 release contracts passing** across 93 source files.
- `npm run manifest:verify`: exact SHA-256 manifest verification for every shipped source file listed in `SOURCE_MANIFEST.sha256`; packaging refuses a stale manifest.
- 1.21.5 server authority is a separate Paper process per HEM world. Paper is pinned to **1.21.5 build 114** with exact SHA-256 verification.
- HEM browser build script checks out the exact v0.1.98 release commit, preserves and hashes its checked-in `package.json` + `pnpm-lock.yaml`, installs with the upstream-declared pnpm version and `--frozen-lockfile`, forces the 1.21.5 version gate, enables auto-connect, and refuses to bundle unless the resulting installed graph resolves Minecraft 1.21.5 / protocol 770 / DataVersion 4325 with complete registry round-trips and the native Spring to Life item-definition layer.
- Existing world safety is version-aware: RC11 parses gzip-compressed NBT `world/level.dat` and refuses to open a world with DataVersion newer than 4325, preventing an unsafe downgrade from an RC9/RC10 1.21.11 world.
- Paper login is gated by a 90-second one-use Cloudflare launch session in production.
- Production raw Paper ports are not published.
- WebSocket proxy destination is allowlisted to the orchestrator's bounded port range.
- Native Paper saves are supplemented by a cold R2/rclone backup helper. RC11 fixes the backup checksum so it remains verifiable after download and adds a destructive-confirmation restore helper with checksum validation, archive traversal rejection, a pre-restore rollback image, native `level.dat` verification, and automatic rollback on a failed restore.
- Multiplayer presence is timestamped per player, preventing reordered join/quit delivery from corrupting active-player counts.
- Production Cloudflare deployment has a generated-config/secret preflight, D1 migration step, Worker-secret installation and public health check.
- Hub static responses include a restrictive CSP and related browser security headers. Uploaded custom skins are validated, served with WebGL-compatible CORS, injected into Paper player profiles with Classic/Slim texture metadata, and shown in a dependency-free WebGL Classic/Slim 3D launcher preview with outer layers and drag rotation; legacy 64×32 skins are normalized to a complete Classic 64×64 atlas.
- Native Java-style world creation now includes Survival / Creative / Hardcore, Peaceful–Hard difficulty, Default / Superflat / Large Biomes / Amplified world types, Generate Structures, seed and per-world Allow Commands. Hardcore is enforced as Survival + Hard by Paper.
- Per-world **Allow Commands** is now a first-class HEM world property: it travels through D1 → orchestrator → Paper `enable-command-block`/HEMGate and grants the authenticated player operator status only for that isolated world. The client-origin command acceptance no longer depends on a hidden `op` step.
- A full two-Chromium + Paper 1.21.5 GitHub Actions acceptance workflow is included; RC11 additionally gates reciprocal live custom-skin fetches, browser refresh through a rotated one-use resume lease, a 60-minute main/manual two-browser renderer/session soak (5 minutes on pull requests), a real proxy stop/start resume test, and forced active-Paper `SIGKILL` recovery before the existing shared/Singleplayer persistence checks. RC11 also names every required gameplay gate, expands live coverage to normal keyboard movement, jump/fall damage, hunger/death/respawn, armor/offhand, 3×3 crafting, barrel + private ender chest, repeaters, redstone dust, time/weather/difficulty, world border, native portal entry and representative entity families, and emits `hem-1215-certification.json` alongside launcher/restore certificates and screenshot evidence. The workflow runs the real backup/restore helpers through a deterministic local-rclone remote, proves a good restore, then proves automatic rollback after a deliberately invalid destructive restore.

## Not executable in this sandbox

This runtime does not provide Docker or Gradle, and its shell DNS cannot resolve GitHub/npm (a direct `git ls-remote` fails with `Could not resolve host: github.com`). Therefore it cannot truthfully provide the final live result for:

- compiling the Paper plugin against the remote Paper API repository;
- downloading/starting a real Paper 1.21.5 server;
- cloning/installing/building minecraft-web-client;
- running the two Chromium 1.21.5 system acceptance test.

Those operations are encoded in CI instead of being claimed as completed.

## Final-release rule

Do not promote this RC to `v1.0.0` until the exact-pinned `.github/workflows/system-1215.yml` certification is green for 60 minutes, the production Cloudflare R2 restore has passed, and `docs/MANUAL_ACCEPTANCE.md` is signed off. `npm run promote` is the supported transition.

## RC15 frozen-dependency hotfix
- RC15 keeps the exact v0.1.98 source commit but stops rewriting its Prismarine dependency overrides. RC13's unfrozen install could re-resolve a moving `minecraft-protocol#master` dependency while retaining an older v0.1.98 patch, which is the `ERR_PNPM_PATCH_FAILED` seen in GitHub Actions.
- RC15 treats the v0.1.98 lockfile as release provenance: it hashes `package.json` and `pnpm-lock.yaml`, uses the package's declared pnpm version, installs with `--frozen-lockfile`, verifies neither metadata file changed, and records those hashes plus the actual installed dependency versions in `hem-build.json`.
- Protocol/data certification remains fail-closed: after the frozen install HEM still requires Minecraft 1.21.5 / protocol 770 / DataVersion 4325, required Spring to Life registries, full item/block/entity round-trips and the 1.21.5 item-definition layer before any browser bundle can be emitted.

## RC13 upstream pin hotfix
- RC13 pinned the browser client default to upstream v0.1.98 commit `cdd8c31a0e9261ee57fb66ff8ca5af0e074bff78`, the release containing the 1.21.5 protocol support update; CI and System Acceptance reject moving branches/tags for acceptance.

## RC11 hardening
- Upstream compatibility attestation: `hem-build.json` preserves the pristine historical `supportedVersions.mjs` SHA-256 and literal version tokens for provenance, records the v0.1.98 release identity, and only certifies after the installed HEM protocol/data stack resolves Minecraft 1.21.5 / protocol 770 / DataVersion 4325 with the required registries. Historical literal tokens are not misused as a complete support list.
- Visible in-client fatal diagnostics for build identity, 1.21.5 registry, renderer-health and authorization failures; broken sessions no longer fail as a silent blank/half-connected game.
- Orchestrator runtime/config validation, Paper pre-ready failure state, controlled retry delay, and world-config fingerprinting prevent silent crash loops or accidental reuse with changed world settings.
- `npm run doctor` / `npm run doctor:system` emit `artifacts/hem-doctor.json`; strict System Acceptance requires Docker, the built client identity, and pinned GitHub/Paper reachability before gameplay begins.
- Required live acceptance now includes a 1.21.5 one-block obstacle traversal and post-placement renderer-stability gate, targeting the exact movement/render regression classes that flat-ground protocol checks can miss. It also requires native minecart mount/dismount, shulker-box access, and real smoker + blast-furnace processing.
- Dependency-free WebGL Classic/Slim 3D launcher skin preview with base/outer layers, drag rotation, dedicated Playwright acceptance, and correct legacy 64×32 → Classic 64×64 normalization.
- Named live-gate manifest + independent certificate verifier covering launcher, gameplay, recovery, soak and upstream pinning.
- Expanded two-browser gates for normal keyboard movement, block placement, jump/fall damage, hunger/death/respawn, armor/offhand, 3×3 crafting, barrel/ender-chest isolation, repeaters/redstone dust, time/weather/difficulty, world border, native portal entry and representative entity families.
- Deterministic Docker+rclone-local cold-backup restore/rollback drill; this proves recovery logic while leaving real Cloudflare R2 transport as a separate final manual requirement.
- `npm run parity` reports the machine-parsed ledger; `npm run release:guard` uses the finite `docs/RELEASE_BLOCKERS.md` promotion list rather than requiring every compatibility-roadmap row to be PASS, while still requiring pinned 60-minute certification for final 1.0.0.
- 85/85 local tests and 53/53 release contracts.
- Browser refresh recovery via a five-minute rotating one-use in-memory resume lease delivered over `hem:session`; the original launch token remains one-use and URL-fragment-only.
- Post-auth skin profile re-announcement plus reciprocal two-browser custom-texture fetch assertions.
- Test-only forced Paper crash endpoint, gated by `HEM_ENABLE_TEST_FAULTS`, with world/player persistence recovery assertions.
- Relocatable R2 backup checksums and guarded restore/rollback helper.
- 60-minute two-browser certification soak encoded in the main/manual system workflow.
- Backward-safe Hardcore D1 persistence plus real SQLite migration tests.
- Unit-tested Paper server.properties generation and owner-only Edit World / rename flow.
- Final-certification guard: `HEM_REQUIRE_PINNED_MWC=true` rejects branch/tag refs, System Acceptance can require the exact SHA, and production Cloudflare deployment always requires an exact upstream commit ref equal to the resolved commit.
- Client build validates the frozen upstream `mc-assets` dependency's native 1.21.5 item-definition layer for Mace, Wind Charge and Spring to Life items, while keeping live rendering parity as an acceptance requirement rather than a paper claim.

## RC11 parity expansion

- Parity ledger: **PASS=12 / PARTIAL=134 / TODO=0 / TOTAL=146**. Zero TODO means every tracked family now has an implementation or executable acceptance path; it is not the same as full parity.
- Mandatory live System Acceptance: **163 named gates plus the configured soak**. The certificate verifier derives the required set from `tests/system/required-gates-1215.json`.
- `npm run parity:full` is the strict full-parity guard and remains expected to fail until all 134 PARTIAL rows have been converted to PASS by live evidence or a user-approved browser exception.
- RC11 expands browser-facing Options with FOV, sensitivity, render distance, view bobbing, smooth lighting, sky/day-cycle, raw input, master/music volume, high contrast and reduced motion.
- RC11 adds original synthesized HEM feedback audio and a damage vignette without redistributing Mojang assets.
- The live suite now includes native worldgen/structure locates, seed authority, random ticks, survival mining timing, archaeology brushing/modern blocks, broad workstations plus real brewing/smithing/grindstone results, item durability/components/bundles, furnace XP, elytra/fireworks, attack cooldown/criticals, directional shields, Protection IV, Fire Aspect, Totems, potion→milk clearing, bow/wind-charge/mace paths, Spring to Life growth/variants, Java quasi-connectivity, Crafter/target/observer/tripwire/activator-rail/torch-burnout redstone behavior, paid beacon effects, villager trading, sculk vibration, minecart/boat/mount inventories, End Gateway + dragon exit-fountain state, HUD/scoreboard/team packets, dynamic world-border updates, recipe/statistics/advancement synchronization, command completion and real remote leave/rejoin events.

## RC15 verifier-layout hotfix
- RC15 keeps RC14's exact v0.1.98 frozen dependency graph, but stops assuming every historical renderer/UI dependency exposes `package.json` through Node's package resolver. GitHub Actions proved the frozen install succeeded and only the HEM metadata probe failed on `minecraft-renderer/package.json`.
- The post-install verifier now resolves dependency versions when package metadata is directly exposed, checks known historical workspace locations, and otherwise records the dependency declaration/embedded-transitive status. The release-critical 1.21.5 checks remain the actual registry/protocol/data assertions: Minecraft 1.21.5, protocol 770, DataVersion 4325, modern blocks/items/entities, 1.21.5 item definitions, and spawn-egg assets.
- This change does not weaken the frozen-lockfile provenance or live two-browser acceptance gates; it removes a false negative from an informational dependency-version field.

## RC16 orchestrator Java-runtime hotfix
- GitHub Actions proved the RC15 browser build advanced far enough to build the orchestrator image, where Debian Bookworm rejected `openjdk-21-jre-headless` because that package is not available from its default repositories.
- RC16 keeps the Node 22 Bookworm runtime but copies the Java 21 JRE from `eclipse-temurin:21-jre-jammy`, sets `JAVA_HOME`/`PATH`, and executes `java -version` during the image build. The orchestrator no longer depends on Bookworm apt for Java 21.
- A release contract rejects any regression back to `apt-get install openjdk-21-jre-headless`.

## RC17 proxy git-dependency Docker hotfix
- GitHub Actions advanced through the browser client and orchestrator-image stages, then proved the proxy image failed because `npm install --omit=dev` resolves the git-based `net-browserify` dependency while `node:22-bookworm-slim` does not contain `git`.
- RC17 uses a dedicated dependency stage that installs only `git` and `ca-certificates`, resolves production npm dependencies there, and copies `node_modules` into a clean Node 22 Bookworm runtime image. Git is therefore available where npm needs it without being shipped in the runtime layer.
- A release contract locks the two-stage proxy build so this failure cannot silently regress.

## RC18 launcher drag-certification hotfix
- GitHub Actions advanced through the browser-client build, orchestrator image, proxy image, and both launcher/client test origins before failing only in the launcher drag-rotation assertion.
- The 3D preview already set `__hemPreviewDragged = true` during pointer movement, but the normal click-suppression handler deliberately reset that transient flag after mouse-up so a drag would not open the PNG picker. The acceptance test read the transient flag after release and therefore produced a false negative even when rotation input had executed.
- RC18 adds a persistent per-canvas `__hemPreviewDragCount` that increments once for each real pointer drag while keeping the transient click-suppression flag unchanged. The Playwright gate now records the counter before and after an actual `page.mouse` drag and requires it to increase, so drag rotation remains mandatory without racing the click cleanup path.
- Release contracts require both the persistent drag counter and the before/after Playwright assertion, preventing regression back to the false-negative signal.
