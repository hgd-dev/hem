# HEM RC39 Dedicated Transport Design

Date: 2026-09-12
Baseline: HEM v1.0.0-rc.38
Target: browser client <-> Paper 1.21.5 transport reliability

## Decision

RC39 replaces the generic `net-browserify` browser/server transport path with a purpose-built HEM raw WebSocket-to-TCP tunnel. Minecraft protocol handling, Mineflayer, rendering, RC38 connection generations, authorization, resume leases, Paper, and gameplay parity remain above/below this transport boundary and are not rewritten.

This is the broadest safe fix because RC38 proved that one unchanged physical client generation can receive Paper keepalives and call `client.write('keep_alive', ...)` with matching IDs, while Paper still disconnects both clients for timeout. The remaining unproven boundary is transport of serialized client bytes from the browser to Paper.

## Goals

1. Guarantee ordered binary delivery in both directions.
2. Guarantee that a successful browser write is either forwarded to the TCP socket or produces an explicit transport failure; no silent drops.
3. Preserve Node `net.Socket` behavior expected by the pinned Minecraft client sufficiently for the existing client to run unchanged above the adapter.
4. Use one WebSocket per Minecraft TCP connection, removing the current HTTP `/connect` token bootstrap plus second WebSocket association.
5. Lock all TCP destinations to the configured orchestrator host and world-port allowlist server-side.
6. Add exact per-connection byte/message/write/drain/close diagnostics at browser and gateway boundaries without exposing auth or resume secrets.
7. Make system acceptance prove that the same physical browser generation survives multiple Paper keepalive cycles over the new transport before later gameplay gates run.
8. Preserve RC38 refresh/resume and proxy-outage recovery semantics.

## Non-goals

- Do not implement a Minecraft packet parser in the gateway.
- Do not terminate or reinterpret Minecraft protocol packets in the gateway.
- Do not relax Paper keepalive or timeout configuration to hide transport failure.
- Do not keep `net-browserify` as an active production fallback after the dedicated transport is certified.
- Do not move launch or resume credentials into transport URLs, headers, logs, or diagnostics.
- Do not expand the proxy to arbitrary hosts or ports.

## Architecture

### Browser side

Create `apps/client/hem-net-socket.cjs`, a small browser-compatible `net` adapter implementing the subset required by the pinned `node-minecraft-protocol` stack:

- `connect` / `createConnection`
- `Socket` as a Duplex stream
- `write`, `_write`, `_read`, `end`, `destroy`, `destroySoon`
- `setTimeout`, `setNoDelay`, `setKeepAlive`
- `address`, `readyState`, remote address/port fields
- connection/error/close/end/timeout events used by the client stack

The adapter opens a single WebSocket URL derived from the configured proxy origin:

`ws://127.0.0.1:8080/hem-tcp?host=orchestrator&port=31008`

Production code MUST NOT trust the supplied host. The gateway maps or validates it against `MC_HOST` and only permits ports within `WORLD_PORT_START..WORLD_PORT_END`.

The browser socket sets `binaryType = 'arraybuffer'` before traffic. Incoming ArrayBuffers are converted synchronously to Buffers and pushed into the Duplex stream in WebSocket message order. No Blob/FileReader path is used.

Outgoing Buffer data is sent as binary WebSocket frames. The adapter maintains an ordered write queue and only invokes stream callbacks after `WebSocket.send()` has accepted the frame. Because browser WebSocket lacks a true drain callback, the adapter uses `bufferedAmount` high/low watermarks to pause queued sends and periodically retry until buffered bytes fall below the low watermark. This prevents unbounded buffering while preserving byte order.

String control messages are not mixed into the Minecraft byte stream. Gateway close/error metadata is conveyed by WebSocket close code/reason and surfaced through socket errors/close diagnostics.

### Gateway side

Replace `apps/proxy/server.cjs` with HEM-owned Express/HTTP + `ws` gateway behavior:

- `GET /healthz` remains.
- WebSocket upgrade path: `/hem-tcp` only.
- Validate Origin against `CLIENT_ORIGIN` when configured.
- Validate requested port is an integer in `[WORLD_PORT_START, WORLD_PORT_END]`.
- Ignore/reject arbitrary hostnames; all TCP connections target `MC_HOST`.
- Open one `net.Socket` to `MC_HOST:port` per accepted WebSocket.
- Disable application idle timeout on established TCP connections; Paper/Minecraft controls liveness.
- Browser binary WS message -> exact `Buffer` -> `socket.write`.
- Respect TCP backpressure: if `socket.write()` returns false, pause processing additional client frames until `drain`.
- TCP `data` -> binary WS send in Node stream order.
- Respect WebSocket buffered amount / ready state and close consistently if either half fails.
- Closing either side closes the other exactly once.

No `/api/vm/net/connect` token map or generic destination list remains in the active gateway.

### Diagnostics

Each physical transport connection receives a random non-secret diagnostic connection ID generated by the gateway and reported to the browser after WebSocket open via response header if available or a reserved WebSocket subprotocol/initial metadata strategy that cannot be confused with Minecraft bytes. Preferred design: place the ID in the WebSocket HTTP response header and keep the WebSocket stream binary-only after open. If browser APIs cannot read the response header, generate a browser local transport ID and correlate gateway logs by remote connection ordering; do not inject text into the byte stream.

Browser diagnostics per RC38 generation:

- transport implementation ID: `hem-raw-tcp-v1`
- websocket opens/closes
- frames sent/received
- bytes sent/received
- current/max `bufferedAmount`
- queued write count/bytes
- socket error/end/close reason
- keepalive seen/responses/fallbacks as already tracked

Gateway diagnostic counters per connection:

- WS frames/bytes received from browser
- TCP write calls/bytes attempted
- TCP write backpressure count
- TCP drain count
- TCP bytes received from Paper
- WS frames/bytes sent to browser
- TCP/WS open/close timestamps
- close/error reason

Gateway logs MUST NOT print raw Minecraft payload bytes, launch tokens, resume leases, or chat contents.

### Build integration

`apps/client/build-client.mjs` will stop patching `net-browserify` ordering as the production mechanism. Instead, after the frozen upstream install, resolve the package/module alias used for Node `net` in the browser bundle and replace/alias it to HEM's `hem-net-socket.cjs` adapter.

The build attestation `hem-build.json` gains:

- `transport: "hem-raw-tcp-v1"`
- `netBrowserifyProductionTransport: false`
- `orderedBinaryDelivery: true`
- `singleWebSocketTcpTunnel: true`

The old ordering patch can remain in source only for historical provenance during RC39 if release verification clearly asserts it is no longer the active production transport. Prefer removing it from active build execution and package dependencies.

### Proxy package dependencies

`apps/proxy/package.json` removes `net-browserify`. Add `ws` explicitly if needed. Keep only dependencies used by the HEM gateway.

## Backpressure and ordering contract

For browser -> Paper:

1. Minecraft serializer produces Buffer A, then Buffer B.
2. HEM Duplex `_write` queues A then B.
3. HEM sends WS frame A before frame B.
4. Gateway receives frame A before frame B.
5. Gateway calls TCP `write(A)` before `write(B)`.
6. If TCP backpressure occurs after A, B waits until `drain`.

For Paper -> browser:

1. Node TCP socket emits data chunks in stream order.
2. Gateway sends each as a binary WS frame in that order.
3. Browser WebSocket emits message events in order.
4. HEM converts ArrayBuffer synchronously and pushes each Buffer in that same order.

No asynchronous Blob conversion or token-to-socket association race is permitted.

## Failure semantics

- TCP connect failure -> WebSocket closes with application close code and short non-secret reason.
- Invalid port/origin -> reject WebSocket upgrade before TCP connection.
- TCP error/end/close -> close WS once and surface reason in browser diagnostics.
- WS error/close -> destroy TCP socket once.
- Browser write after close -> stream callback receives an error; it must not report success.
- Backpressure timeout is not used during normal play. If a bounded queue safety limit is exceeded, fail the connection loudly rather than silently dropping bytes.

## Security

- Destination host is server-controlled (`MC_HOST`).
- Destination port is restricted to configured world range.
- Origin allowlist remains enforced.
- No arbitrary TCP proxy behavior.
- No Minecraft payload logging.
- No auth/resume secret logging or transport propagation.
- Health endpoint reveals only target host label and allowed port range as today.

## TDD plan / required tests

### Browser adapter unit tests

Red first, then green:

1. opens exactly one WebSocket for one TCP connection;
2. sets `binaryType = arraybuffer` before open/data;
3. preserves two outgoing writes in order;
4. delays later writes while simulated `bufferedAmount` is above high watermark;
5. resumes queued writes when buffer drops;
6. incoming ArrayBuffers are pushed in order and never use FileReader;
7. write after close returns/callbacks an error;
8. close/error destroys stream exactly once;
9. `setTimeout(0)` disables browser-side idle timeout;
10. adapter exposes required `net` API surface for the pinned client.

### Gateway unit/integration tests

1. rejects out-of-range ports;
2. rejects disallowed Origin;
3. always targets configured `MC_HOST` rather than arbitrary user host;
4. forwards binary WS payload byte-for-byte to TCP;
5. forwards TCP bytes byte-for-byte to WS;
6. preserves multiple frame/chunk ordering;
7. pauses client-to-TCP forwarding on TCP backpressure and resumes on `drain`;
8. WS close destroys TCP exactly once;
9. TCP close closes WS exactly once;
10. established socket has no generic idle timeout;
11. diagnostics count bytes/frames without recording payload contents.

### Build/release tests

1. production bundle attests `hem-raw-tcp-v1`;
2. production build no longer executes `patch-net-browserify-ordering.mjs` as its active transport fix;
3. proxy package does not depend on `net-browserify`;
4. release verifier rejects old transport attestation.

### Live Paper acceptance

Before normal parity gates:

1. launch Hudson and Elise;
2. capture one physical generation for each;
3. require at least 3 Paper keepalives and matching client responses on that same generation;
4. require gateway diagnostics to show client->TCP bytes increasing during those responses;
5. require those generation IDs never change during the gate;
6. require Paper logs contain no `Timed out` for either player;
7. continue through RC38 refresh/resume;
8. stop/restart the HEM gateway and require same-tab recovery using retained resume leases;
9. continue all existing gameplay parity gates and soak.

A generation replacement during the initial transport certification gate is a failure, not recovery.

## Release scope

RC39 changes the transport subsystem only. Existing gameplay/parity fixes remain intact. If the new tunnel passes the transport gate but later gameplay gates fail, subsequent RCs debug those gates independently; RC39 must not bundle unrelated gameplay changes.

## Success criteria

RC39 is considered to have fixed the current blocker only when GitHub Actions proves both browsers survive the strict same-generation keepalive gate over `hem-raw-tcp-v1` with no Paper timeout, and the refresh + gateway-outage recovery gates pass afterward.
