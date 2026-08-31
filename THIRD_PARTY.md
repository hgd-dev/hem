# HEM third-party components

HEM is an integration project. This source package does not vendor the upstream browser-client repository, Paper server jar, Minecraft game assets, or Mojang/Microsoft logos.

## minecraft-web-client

- Project: `zardoy/minecraft-web-client`
- Role: browser Minecraft protocol client / renderer / UI base
- Upstream license: MIT (see upstream repository)
- HEM build: `apps/client/build-client.mjs`
- The exact resolved upstream commit is recorded into built `hem-build.json`.

## PrismarineJS ecosystem

The browser client depends on Mineflayer, minecraft-protocol, minecraft-data and related Prismarine libraries through its upstream dependency graph. HEM preserves the exact dependency graph checked into the pinned v0.1.98 release and installs it with `--frozen-lockfile`; the resolved package versions and package/lock SHA-256 hashes are recorded in `hem-build.json`. HEM then rejects the build unless the installed graph resolves Minecraft 1.21.5 / protocol 770 and the required 1.21.5 registries/assets.

## Paper

HEM downloads a stable Paper 1.21.5 server build from PaperMC at runtime. Paper is not included in this source archive. Review Paper's own license and documentation before redistribution.

## Minecraft / Mojang / Microsoft

HEM is an unofficial fan project and is not affiliated with Mojang Studios or Microsoft. HEM does not include the Minecraft logo or a copied Mojang asset bundle. The operator must review and accept the Minecraft EULA before the orchestrator will start a world.
