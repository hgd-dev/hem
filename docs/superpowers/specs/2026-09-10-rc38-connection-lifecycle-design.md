# HEM RC38 Connection Lifecycle Redesign

Baseline: RC37 (`e9ca2467f6160228f3ff2efe58b5e61566c1733f`)
Target: Minecraft / Paper 1.21.5 browser acceptance

## Problem

RC37 proves that the pinned browser client can render a real 1.21.5 world, authenticate two players, exchange multiple Paper keepalives, carry settings and profile signals, obtain a short-lived reconnect lease, and refresh/resume successfully. However, the latest system run also shows lifecycle defects: Paper still times out physical browser connections after the initial keepalive gate; diagnostics are page-scoped and cumulative; authorization is page-scoped via a one-shot `sent` flag; and later reconnects can have a valid resume lease without sending a fresh authorization command.

## Goals

- Track each physical `bot._client` lifetime as a distinct generation.
- Ensure keepalive acceptance is evaluated against one unchanged physical generation.
- Reauthorize every new physical connection with the launch token once or retained short-lived resume lease thereafter.
- Preserve a canonical same-tab non-secret recovery URL.
- Make proxy outage recovery deterministic.
- Retain the pinned v0.1.99 / Minecraft 1.21.5 compatibility contract and guarded keepalive fallback.

## Non-goals

- Do not replace `net-browserify` in RC38.
- Do not relax Paper timeout behavior or acceptance requirements.
- Do not persist launch credentials in query parameters, localStorage, diagnostics, or logs.
- Do not extend resume leases beyond server-defined lifetime.
- Do not alter unrelated gameplay parity gates.

## Design

1. `hem-bridge.js` assigns a monotonically increasing generation ID for every new physical `bot._client`. Each generation records connection state, keepalive counts, end reason, bounded errors, authorization state, and resume-channel registration.
2. Remove the page-scoped `sent` decision. The first eligible generation may consume the fragment launch token exactly once. Every later generation sends `/hem resume <lease>` once if a valid browser-local lease exists.
3. Keep `history.replaceState` but preserve the current origin/path and all non-secret query parameters. Never include the launch token or resume lease in the canonical recovery URL.
4. Change `browser-1215.mjs` so the transport gate captures the active generation and only passes if that same generation remains active, connected, and responsive for the whole gate.
5. Refresh and proxy-outage recovery must prove generation replacement plus fresh per-generation resume authorization, not rely on stale page-wide flags.
6. If a same-generation socket still receives and responds to keepalives but Paper later times out, escalate RC39 to a purpose-built ordered WebSocket-to-TCP gateway.

## Expected primary files

- `apps/client/hem-bridge.js`
- `tests/system/browser-1215.mjs`
- lifecycle-focused tests under `tests/`
- release/version metadata only where required by the repository's existing RC process

`apps/client/hem-keepalive-guard.cjs` stays behaviorally unchanged unless a failing test proves otherwise.
