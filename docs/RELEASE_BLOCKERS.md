# HEM 1.0.0 release blockers

This file is the finite production-release gate for HEM 1.0.0.

The much larger `PARITY_1_21_5.md` ledger remains the compatibility and improvement roadmap. A PARTIAL or TODO parity line does **not** by itself force HEM to remain a release candidate forever. HEM 1.0.0 may ship once every blocker below is CLOSED and the release guard verifies the pinned certification artifacts.

A final release must still be described accurately as a private browser Minecraft 1.21.5-compatible experience; the stronger phrase **full 1.21.5 parity** remains reserved for a zero-known-gap parity ledger.

Status syntax is machine parsed. Only `OPEN` and `CLOSED` are valid. All four blockers are **evidence-derived at runtime**. The Markdown status tokens are declarations/documentation only; release readiness recomputes the effective state from real artifacts every time. Exact-pinned 60-minute certification closes the first two, `hem-production-r2-restore.json` closes the R2 blocker, and a fully completed/validated `MANUAL_ACCEPTANCE.md` closes household acceptance. This prevents promotion from depending on hand-editing status words. `npm run release:reconcile` writes the effective state to `artifacts/hem-release-readiness.json`.

- OPEN pinned-live-acceptance — Run the complete two-Chromium + Paper 1.21.5 system workflow against an exact 40-character minecraft-web-client commit and retain a passing `hem-1215-certification.json`.
- OPEN sixty-minute-soak — The pinned system certification must contain the required 60-minute two-browser renderer/session/gameplay soak.
- OPEN production-r2-restore — On a disposable production-shaped host, upload a real backup to the configured Cloudflare R2 remote, restore it into an empty world volume, and verify native Paper world/player data before reconnecting clients.
- OPEN household-manual-acceptance — Complete `docs/MANUAL_ACCEPTANCE.md` with both intended players across create/join/rejoin/save/restart/skin/settings flows and record the signed-off evidence.

Current RC41 evidence note: the exact RC40 Actions run materially narrowed the blocker. A direct Node/Mineflayer control survived 5/5 Paper keepalives, both initial Chromium generations passed sustained same-generation keepalives over `hem-raw-tcp-v1`, and Hudson completed refresh/resume. Hudson's refreshed generation then timed out roughly 45 seconds after joining, matching a first Paper challenge plus the timeout window, while the later deliberate proxy outage showed that a WebSocket transport error could fail to mark the physical generation ended. RC41 responds synchronously in the generic keepalive packet turn while suppressing the upstream duplicate, treats a WebSocket transport error as a terminal raw-socket close, and requires the refreshed generation to prove two keepalive round trips over at least 35 seconds before outage testing. The pinned-live and soak blockers remain OPEN until this exact RC41 build passes the full workflow.

## Promotion rule

When each item is genuinely complete, place/produce its evidence in the expected location. Do not hand-edit status tokens to bypass evidence. Then run:

```bash
npm run release:reconcile
npm run verify
npm run promote
```

`release:guard` intentionally does not require every compatibility-roadmap row to be PASS. It does require all release blockers to be effectively CLOSED and the exact-pinned 60-minute system certificate to verify. After `npm run promote`, rerun System Acceptance on the resulting `1.0.0` tree with the same exact upstream SHA, then run `npm run release:guard` before tagging.
