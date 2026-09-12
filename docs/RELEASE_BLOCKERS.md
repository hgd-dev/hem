# HEM 1.0.0 release blockers

This file is the finite production-release gate for HEM 1.0.0.

The much larger `PARITY_1_21_5.md` ledger remains the compatibility and improvement roadmap. A PARTIAL or TODO parity line does **not** by itself force HEM to remain a release candidate forever. HEM 1.0.0 may ship once every blocker below is CLOSED and the release guard verifies the pinned certification artifacts.

A final release must still be described accurately as a private browser Minecraft 1.21.5-compatible experience; the stronger phrase **full 1.21.5 parity** remains reserved for a zero-known-gap parity ledger.

Status syntax is machine parsed. Only `OPEN` and `CLOSED` are valid. All four blockers are **evidence-derived at runtime**. The Markdown status tokens are declarations/documentation only; release readiness recomputes the effective state from real artifacts every time. Exact-pinned 60-minute certification closes the first two, `hem-production-r2-restore.json` closes the R2 blocker, and a fully completed/validated `MANUAL_ACCEPTANCE.md` closes household acceptance. This prevents promotion from depending on hand-editing status words. `npm run release:reconcile` writes the effective state to `artifacts/hem-release-readiness.json`.

- OPEN pinned-live-acceptance — Run the complete two-Chromium + Paper 1.21.5 system workflow against an exact 40-character minecraft-web-client commit and retain a passing `hem-1215-certification.json`.
- OPEN sixty-minute-soak — The pinned system certification must contain the required 60-minute two-browser renderer/session/gameplay soak.
- OPEN production-r2-restore — On a disposable production-shaped host, upload a real backup to the configured Cloudflare R2 remote, restore it into an empty world volume, and verify native Paper world/player data before reconnecting clients.
- OPEN household-manual-acceptance — Complete `docs/MANUAL_ACCEPTANCE.md` with both intended players across create/join/rejoin/save/restart/skin/settings flows and record the signed-off evidence.

Current RC40 evidence note: RC39 successfully replaced the active browser↔Paper transport with `hem-raw-tcp-v1`, but the pinned two-browser workflow still timed out both clients. RC40 is therefore a root-cause discrimination release rather than another blind transport patch. Before Chromium starts, a direct Node/Mineflayer control client from the exact frozen upstream graph connects straight to the same Paper TCP listener for at least 75 seconds and four keepalive cycles. Browser generations additionally record main-thread event-loop lag, and failure handling preserves the raw tunnel connection ID so gateway byte counters and the Paper tail are available even after page teardown. The pinned-live and soak blockers remain OPEN until this exact RC40 build passes the full workflow.

## Promotion rule

When each item is genuinely complete, place/produce its evidence in the expected location. Do not hand-edit status tokens to bypass evidence. Then run:

```bash
npm run release:reconcile
npm run verify
npm run promote
```

`release:guard` intentionally does not require every compatibility-roadmap row to be PASS. It does require all release blockers to be effectively CLOSED and the exact-pinned 60-minute system certificate to verify. After `npm run promote`, rerun System Acceptance on the resulting `1.0.0` tree with the same exact upstream SHA, then run `npm run release:guard` before tagging.
