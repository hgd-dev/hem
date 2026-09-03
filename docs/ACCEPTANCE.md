# HEM 1.21.5 release acceptance

HEM is **not final** merely because `npm test` passes. Browser 1.21.5 compatibility is an external integration property.

## Automated gate

Run the GitHub Actions workflow:

**HEM 1.21.5 System Acceptance** (`.github/workflows/system-1215.yml`)

It builds the real browser client and launches an isolated test stack containing:

- Paper 1.21.5 build 114 (checksum-pinned);
- HEMGate;
- HEM orchestrator;
- HEM WebSocket→TCP proxy;
- test-only launch-token service plus a dedicated HTTPS custom-skin origin;
- two independent headless Chromium browser contexts.

The workflow verifies:

1. The HEM launcher opens from a real Chromium page with a functioning WebGL 3D skin preview.
2. Classic and Slim arm geometry both render; drag rotation works; a legacy 64×32 upload is normalized to a complete Classic 64×64 atlas.
3. Paper 1.21.5 reaches ready state for a real shared HEM world.
4. Hudson and Elise each connect from independent Chromium contexts through the real WebSocket→TCP proxy.
5. HEMGate authenticates both one-use launch sessions and Paper reports two players.
6. Both clients load protocol 770 / 1.21.5 registries and live rendered chunk-section meshes; `hem-build.json` must attest the deterministic `hem-prismarine-chunk-1215-nosize-v5` block/biome no-size-prefix decoder patch and the generated `/sounds.js` byte-count/SHA-256 before the renderer/capability gate can pass.
7. Each browser fetches the other player’s distinct custom HEM skin over the system HTTPS skin origin after post-auth profile re-announcement.
8. A normal browser refresh reauthorizes through the retained five-minute browser-local `hem:session` reconnect lease without reusing the original one-use launch token or putting secrets in the URL; a fresh launch revokes the prior reconnect lease.
9. The Docker proxy is actually stopped; both clients disconnect and Paper presence reaches zero. After restart, the same tabs recover through their still-valid browser-local reconnect leases.
10. Elise sees Hudson as a remote entity, receives horizontal movement, and sees a browser-origin jump.
11. A real Chromium `W` key event (not a direct Mineflayer control call) moves Hudson server-authoritatively and Elise sees that movement.
12. A controlled vertical fall is server-authoritative and produces fall damage.
13. Both clients receive the same authoritative Paper block state, including Crafter/Trial Spawner/Vault/Copper Bulb sentinels.
14. Hudson performs client-originated mining **and** block placement actions and Elise receives both resulting block changes.
15. Distinct Hudson/Elise inventories synchronize from Paper; an iron chestplate and shield synchronize through armor/offhand equipment slots and the remote entity.
16. A normal HEM world with **Allow Commands: On** accepts a client-origin command without a hidden test-only `op` step.
17. Lever→lamp and repeater→lamp powered/depowered states synchronize across browsers; redstone dust carries analog power to a downstream lamp and depowers correctly.
18. Native chest and barrel contents synchronize; Hudson’s ender-chest contents remain private from Elise.
19. Browser-origin crafting works in both the 2×2 player grid and a true 3×3 crafting table.
20. Furnace input/fuel/progress/output synchronize.
21. Dropped item entities, water/lava states, piston movement and hopper→chest transfer synchronize.
22. Mace and Wind Charge reach the browser inventory, alongside 1.21.5 Spring to Life items: Firefly Bush, Leaf Litter, Wildflowers, Bush, Short/Tall Dry Grass, Cactus Flower, Brown Egg and Blue Egg.
23. Warm/cold Pig, Cow and Chicken variant data synchronize as native 1.21.5 entity sentinels, and browser-used bone meal grows Short Dry Grass into Tall Dry Grass.
24. Representative entity families also synchronize: villager, armor stand, breeze, warden, blaze, enderman and shulker.
25. The same browser session survives a 25-message client-origin chat sequence, guarding the known-risk 1.21.5 chat-acknowledgement path.
26. Survival combat causes health loss **and horizontal knockback**.
27. Survival lifecycle reaches the browser end-to-end: hunger depletes food, death is observed, and the client issues a normal respawn.
28. Server-authoritative night time and rain/clear weather state reach the browser.
29. Server-authoritative Hard difficulty reaches both browsers and can be reset to Normal.
30. A temporarily shrunken native world border constrains browser-player movement and is then restored.
31. The browser survives command-controlled Overworld → Nether → End → Overworld dimension transfers.
32. Hudson also enters the Nether and End through native portal blocks, proving normal player portal-trigger handling independent of command dimension transfer.
33. Main/manual certification runs keep both authenticated browsers and live renderers healthy for 60 minutes; pull requests run a five-minute smoke soak.
34. The test writes and flushes a crash marker, kills the active Paper JVM with test-only `SIGKILL`, verifies both browsers disconnect, restarts the same world, and proves the marker plus both player inventories recovered.
35. Paper is then stopped completely and restarted through the normal graceful lifecycle; shared-world Anvil data plus both players’ inventories persist.
36. A second private Paper world is started as HEM Singleplayer; shared-world player data must not leak, and the solo world’s own inventory/block data persist across restart.
37. The real backup/restore scripts run against the actual orchestrator world volume through a deterministic local-filesystem rclone remote: a valid cold backup restores cleanly and removes post-backup mutation.
38. The restore drill then supplies a checksum-valid but semantically invalid archive *after* destructive mutation has begun; restore must fail and automatically roll the original world back with native `level.dat` intact. This proves recovery logic, not Cloudflare R2 transport.
39. A rendered Chromium screenshot and three machine-readable artifacts are uploaded: `hem-launcher-certification.json`, `hem-1215-certification.json`, and `hem-restore-certification.json`. `scripts/verify-certification.mjs` requires all named gameplay gates, launcher WebGL/Classic/Slim/legacy proof, restore+rollback proof, the requested soak duration, and exact upstream pinning for a final certification.

The system stack keeps `HEM_ENABLE_ADMIN_COMMANDS=true` only for its internal control-plane setup commands (teleports, fixtures, summons, restart assertions). The **client-origin command** check itself no longer `op`s the player through that control plane; permission must come from the HEM world's normal Allow Commands setting.

The browser build writes its resolved upstream Git SHA to `apps/client/dist/hem-build.json`. Manual System Acceptance exposes only `mwc_ref`, which must be an exact 40-character commit SHA. It defaults to HEM's pinned v0.1.99 stable upstream commit with inherited 1.21.5 protocol provenance `0359f20b8d721ea44c7ddb633c985a71574c73d3` and exact pinning is mandatory on every run; non-commit refs fail before cloning. Production Cloudflare deploys always require that exact pinned SHA. `npm run release:guard` treats the parity ledger as the ongoing compatibility roadmap. On a final `1.0.0` tree it blocks release while any of the four production evidence checks are invalid/missing or while the exact-pinned 60-minute certification artifacts are absent/incomplete; the literal OPEN/CLOSED words in `docs/RELEASE_BLOCKERS.md` are not trusted as proof. The stronger **full 1.21.5 parity** claim still requires the zero-known-gap ledger standard.

## Manual final pass

After automated acceptance is green, deploy to the intended VPS/Cloudflare URLs and play from two normal browsers. Complete this once before tagging 1.0.0:

- [ ] Both players create/recover profiles, upload distinct skins, and see the correct Classic/Slim skin on each other in live gameplay.
- [ ] Hudson creates a private Singleplayer world, plays, exits and resumes with inventory/location intact.
- [ ] Elise creates an independent Singleplayer world and Hudson cannot see it.
- [ ] One player creates a shared world and sends one invite.
- [ ] Other player redeems it; the shared world remains in Multiplayer after refresh/re-login.
- [ ] Refresh an active game tab; it reconnects without returning to the launcher. Confirm the reconnect lease expires on schedule and a fresh launcher authorization revokes the old lease.
- [ ] Both play simultaneously for at least 60 minutes.
- [ ] Mining, placing, crafting table, furnace, chest and inventory manipulation work.
- [ ] A world created with Allow Commands: On accepts normal player commands and command-block use; a world created with it Off does not grant those privileges.
- [ ] Normal player chat continues working beyond 25 messages without disconnect/desync.
- [ ] Hunger/health/fall damage/death/respawn work.
- [ ] Hostile and passive mobs visibly render and behave.
- [ ] 1.21.5 Spring to Life content visibly works: Firefly Bush, Leaf Litter, Wildflowers, Bush, Short/Tall Dry Grass and Cactus Flower render/interact; Brown/Blue Eggs appear correctly; warm/cold farm-animal variants render correctly.
- [ ] Melee/ranged combat works.
- [ ] Basic redstone/repeater/piston/hopper behavior is visible and synchronized.
- [ ] Water/lava updates are visible.
- [ ] Nether portal transition works for both players.
- [ ] End portal and End dimension render/work.
- [ ] Disconnect/reconnect preserves each player's state.
- [ ] Closing both clients and waiting for idle shutdown produces a clean Paper stop.
- [ ] Relaunch restores the same world.
- [ ] R2 cold backup completes; `restore-r2.sh` restores the chosen stamp on a disposable/copy host; block + player inventory state is verified after restore; rollback behavior is also exercised once with a deliberately invalid test archive.
- [ ] No recurring fatal browser console/page errors.
- [ ] No Paper crash or watchdog termination.

If any box fails, the release is still RC and the failing client path must be patched.
