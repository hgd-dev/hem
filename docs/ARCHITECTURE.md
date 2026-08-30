# HEM architecture

## Core principle

**Do not reimplement vanilla 1.21.5 server behavior.** Paper 1.21.5 is the source of truth.

```text
Public HEM Hub (Cloudflare Worker + D1)
  ├─ player identities/recovery credentials
  ├─ solo/shared world metadata
  ├─ memberships + one-use invites
  └─ 90-second one-use launch sessions
           │
           ├── ensure world ──────────────┐
           │                              │
Browser HEM client                        ▼
(minecraft-web-client / Mineflayer)   Orchestrator (VPS)
           │                           ├─ Paper world A process
           │ WSS → TCP proxy          ├─ Paper world B process
           └──────────────────────────►└─ ... on-demand, bounded
                                            │
                                            ├─ world/
                                            ├─ world_nether/
                                            └─ world_the_end/
```

## Why one Paper process per HEM world

A process-per-world model gives HEM the strongest isolation with the least custom game logic:

- native Overworld/Nether/End relationship and portal behavior;
- native player UUID data, inventories, ender chest, stats and advancements isolated by filesystem;
- native server properties per world (seed, mode, difficulty);
- normal Anvil/region saves;
- normal redstone, mobs, AI, containers, recipes and commands;
- no multiworld plugin semantics standing between players and vanilla/Paper behavior.

For two people, bounded on-demand processes are operationally simpler than inventing a multi-tenant Minecraft server.

## World lifetime

1. Player selects a world in the HEM hub.
2. Hub verifies membership.
3. Hub asks the orchestrator to ensure that Paper world is running.
4. If stopped, orchestrator selects an internal port and starts Paper.
5. HEMGate loads before player use of the world.
6. Hub issues a 90-second one-use token bound to the exact HEM world and exact private Minecraft login name.
7. Browser connects through the allowlisted WebSocket proxy.
8. HEM browser bridge sends `/hem auth <token>`.
9. HEMGate consumes the token from the Hub. Until success the player is frozen and cannot interact, move, damage, manipulate inventory, drop/pick up or execute other commands.
10. Paper plays normally after authorization.
11. When the final authenticated player leaves, the orchestrator starts its idle timer.
12. Idle stop sends `save-all flush`, then `stop`.

## Singleplayer vs multiplayer

There is intentionally no game-engine difference.

- **Singleplayer:** membership count is one; the world is private to its creator.
- **Multiplayer:** a shared world can add members via a one-use invite. Once accepted, membership is permanent until an administrative removal feature is added.

Both use exactly the same Paper 1.21.5 path.

## Browser compatibility layer

The browser client is built reproducibly from the exact `zardoy/minecraft-web-client` v0.1.98 release commit `cdd8c31a0e9261ee57fb66ff8ca5af0e074bff78`, the upstream release that added 1.21.5 protocol support. HEM patches:

- `minecraft-data` override → `3.114.0`;
- the exposed supported-version list → only `1.21.5`;
- `allowAutoConnect` → true in the built config;
- HEM title;
- HEM one-use authorization bridge.

The build records the exact upstream Git commit in `hem-build.json`.

This patch deliberately does **not** claim that the upstream renderer already has perfect 1.21.5 visual coverage. The real two-browser workflow is the compatibility gate.

## Network boundaries

Raw Paper ports are exposed only inside the Docker network. The public proxy can dial only `orchestrator` and only the configured Paper port range. The public control endpoint requires a strong service key. HEMGate prevents an unauthenticated proxy user from using a Paper world.

## Capacity

Defaults are intentionally household-scale:

- maximum active worlds: 2;
- max players per Paper world: 4;
- per-world JVM: Xms 512 MiB / Xmx 3 GiB;
- view distance: 10;
- simulation distance: 8;
- idle stop: 15 minutes after the last authenticated player leaves.

For Hudson + Elise, an 8 GB VPS is a sensible starting configuration. Increase memory before increasing active-world count.
