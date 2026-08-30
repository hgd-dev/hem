# HEM browser client

This directory does not vendor Mojang assets or an opaque Eaglercraft binary. `build-client.mjs` checks out the current `next` branch of the MIT-licensed `zardoy/minecraft-web-client`, records the exact commit used in `hem-build.json`, pins `minecraft-data` to 3.114.0, and narrows the client version selector to HEM's target `1.21.5`.

The upstream browser client still publicly documents support only through 1.21.5. Therefore a successful build is **not** sufficient for HEM 1.0: the live acceptance suite in `docs/ACCEPTANCE.md` must pass against Paper 1.21.5.
