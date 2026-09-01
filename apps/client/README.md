# HEM browser client

This directory does not vendor Mojang assets or an opaque Eaglercraft binary. `build-client.mjs` checks out the exact MIT-licensed `zardoy/minecraft-web-client` v0.1.99 stable-release commit `0359f20b8d721ea44c7ddb633c985a71574c73d3`, which inherits the 1.21.5 protocol support introduced in v0.1.98 and adds later runtime fixes; HEM records that commit in `hem-build.json` and narrows the exposed client target to `1.21.5`.

HEM intentionally preserves v0.1.99's checked-in dependency graph. The build hashes `package.json` and `pnpm-lock.yaml`, uses the upstream-declared pnpm version, installs with `--frozen-lockfile`, then confirms neither metadata file changed. This prevents moving Git dependencies such as `minecraft-protocol#master` from drifting away from the patch snapshot that v0.1.99 was released with.

After installation HEM independently verifies that the actual installed data stack can load Minecraft 1.21.5, resolves protocol 770 / DataVersion 4325, round-trips the item/block/entity registries, and contains the required Spring to Life item-definition layer. The resolved dependency versions and frozen metadata hashes are written to `hem-build.json`.

The upstream browser client publicly documents server support through 1.21.5. A successful source build is still **not** sufficient for HEM 1.0: the two-browser live acceptance suite in `docs/ACCEPTANCE.md` must pass against Paper 1.21.5.
