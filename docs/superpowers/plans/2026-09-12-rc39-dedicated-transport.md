# RC39 Dedicated Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace HEM's active `net-browserify` transport with a HEM-owned ordered single-WebSocket raw TCP tunnel and prove same-generation Paper keepalive survival end-to-end.

**Architecture:** A browser-side `net`-compatible Duplex adapter opens one WebSocket per Minecraft TCP connection. A HEM gateway validates the origin/port, always targets the configured Minecraft host, and pipes ordered binary frames to one Node TCP socket with explicit backpressure. RC38 auth/resume/generation logic remains unchanged above this transport boundary; build/release attestation proves the old generic transport is no longer active.

**Tech Stack:** Node.js 22, CommonJS browser shim, Node `stream.Duplex`, Express/HTTP, `ws`, Node `net`, Playwright, Docker Compose, Paper 1.21.5.

**Spec:** `docs/superpowers/specs/2026-09-12-rc39-dedicated-transport-design.md`

## Global Constraints

- Target remains Minecraft / Paper `1.21.5` and pinned minecraft-web-client `v0.1.99` commit `0359f20b8d721ea44c7ddb633c985a71574c73d3`.
- Keep RC38 physical connection generations, launch auth, resume leases, plugin-channel registration, renderer/parity gates, and gameplay logic intact.
- Active production transport must be `hem-raw-tcp-v1`; `net-browserify` must not remain an active production fallback.
- One browser WebSocket maps to exactly one server TCP socket.
- Gateway always targets `MC_HOST`; requested port must be within `WORLD_PORT_START..WORLD_PORT_END`.
- No Minecraft payload, launch token, resume lease, or chat-body logging.
- No Paper timeout relaxation and no Minecraft packet parsing in the gateway.
- Preserve strict byte ordering and fail loudly rather than silently dropping queued writes.

---

### Task 1: Browser `net.Socket` adapter

**Files:**
- Create: `apps/client/hem-net-socket.cjs`
- Create: `tests/hem-net-socket.test.mjs`

**Interfaces:**
- Consumes: browser global `WebSocket`, Node/browserified `stream.Duplex`, proxy configuration supplied through `setProxy({ hostname, port, path, requestProtocol })`.
- Produces: CommonJS `net` subset exporting `Socket`, `Stream`, `connect`, `createConnection`, `setProxy`, `isIP`, `isIPv4`, `isIPv6`.
- Diagnostics: each socket exposes `__hemTransportState` with implementation `hem-raw-tcp-v1`, frame/byte/buffer/queue/close/error counters.

- [ ] **Step 1: Write the failing adapter tests**

Create `tests/hem-net-socket.test.mjs` that loads `apps/client/hem-net-socket.cjs` in a VM with fake `WebSocket` and asserts:

```js
assert.equal(socket._ws.binaryType, 'arraybuffer')
assert.deepEqual(fake.sent.map(Buffer.from), [Buffer.from([1,2]), Buffer.from([3,4])])
assert.equal(socket.__hemTransportState.implementation, 'hem-raw-tcp-v1')
assert.equal(fake.instances.length, 1)
assert.match(fake.instances[0].url, /\/hem-tcp\?port=31008/)
```

Also cover high-water buffering, ordered incoming ArrayBuffers, write-after-close callback error, idempotent destroy/close, `setTimeout(0)`, and required API surface.

- [ ] **Step 2: Run the adapter tests and confirm RED**

Run:
```bash
node --test tests/hem-net-socket.test.mjs
```
Expected: FAIL because `apps/client/hem-net-socket.cjs` does not exist.

- [ ] **Step 3: Implement the minimal adapter**

Implement a browser-compatible Duplex with this contract:

```js
const stream = require('stream')
const util = require('util')
const timers = require('timers')

const TRANSPORT_ID = 'hem-raw-tcp-v1'
let proxy = { protocol: 'ws', requestProtocol: 'http:', hostname: '127.0.0.1', port: '8080', path: '/hem-tcp' }

function Socket (options = {}) {
  stream.Duplex.call(this, options)
  this.readable = false
  this.writable = false
  this._connecting = false
  this._writeQueue = []
  this._queueBytes = 0
  this.__hemTransportState = { implementation: TRANSPORT_ID, websocketOpens: 0, websocketCloses: 0, framesSent: 0, framesReceived: 0, bytesSent: 0, bytesReceived: 0, maxBufferedAmount: 0, queuedWrites: 0, queuedBytes: 0, closeReason: '', errors: [] }
}
util.inherits(Socket, stream.Duplex)
```

`connect()` must construct a single `/hem-tcp?port=<validated port>` WebSocket, set `binaryType='arraybuffer'` immediately, push incoming ArrayBuffers synchronously, and mark the stream connected only after `open`.

`_write()` must queue buffers in call order. A `flushWrites()` helper sends the head entry only when the socket is OPEN and `bufferedAmount <= HIGH_WATER`; if buffered amount is high, schedule another flush and keep later writes queued. The write callback fires only after `send()` accepted the frame. A bounded queue overflow or send failure calls the callback with an Error and tears down the socket.

- [ ] **Step 4: Run adapter tests and confirm GREEN**

Run:
```bash
node --test tests/hem-net-socket.test.mjs
node --check apps/client/hem-net-socket.cjs
```
Expected: all adapter tests PASS and syntax check exits 0.

- [ ] **Step 5: Commit the adapter task**

```bash
git add apps/client/hem-net-socket.cjs tests/hem-net-socket.test.mjs
git commit -m "feat: add dedicated HEM browser TCP adapter"
```

### Task 2: Dedicated WebSocket-to-TCP gateway

**Files:**
- Replace: `apps/proxy/server.cjs`
- Modify: `apps/proxy/package.json`
- Modify: `apps/proxy/Dockerfile`
- Create: `tests/hem-raw-tcp-gateway.test.mjs`

**Interfaces:**
- Consumes: `PORT`, `MC_HOST`, `WORLD_PORT_START`, `WORLD_PORT_END`, `CLIENT_ORIGIN`.
- Produces: `GET /healthz`, WebSocket upgrade `/hem-tcp?port=<n>`, JSON diagnostics endpoint `GET /debug/connections` in test mode only (`HEM_ENABLE_TEST_DIAGNOSTICS=true`).
- Each accepted WebSocket maps to one `net.connect({host: MC_HOST, port})` socket.

- [ ] **Step 1: Write failing gateway tests**

Use dependency injection exported from `server.cjs` so tests can supply fake TCP sockets and a temporary HTTP server. Assert:

```js
assert.equal(result.targetHost, 'orchestrator')
assert.equal(result.targetPort, 31008)
assert.deepEqual(tcp.writes, [Buffer.from([1,2]), Buffer.from([3,4])])
assert.equal(tcp.setTimeoutCalls.at(-1), 0)
```

Also assert invalid port rejection, disallowed Origin rejection, TCP `write(false)` pauses later WS frames until `drain`, TCP data is sent to WS in order, and WS/TCP close propagation is idempotent.

- [ ] **Step 2: Run gateway tests and confirm RED**

Run:
```bash
node --test tests/hem-raw-tcp-gateway.test.mjs
```
Expected: FAIL against the generic `net-browserify` server.

- [ ] **Step 3: Implement the HEM gateway**

Replace generic middleware with explicit HTTP + `ws` handling:

```js
const http = require('http')
const net = require('net')
const express = require('express')
const { WebSocketServer, WebSocket } = require('ws')

function createHemGateway ({ host, start, end, origin, tcpConnect = net.connect }) {
  // validate configuration
  // create Express health endpoint
  // attach WebSocketServer({ noServer: true })
  // upgrade only /hem-tcp with allowed Origin and in-range integer port
  // tcpConnect({ host, port })
  // ws binary -> ordered TCP write queue with drain backpressure
  // TCP data -> ws.send(buffer, { binary: true })
  // close either side exactly once
  // maintain secret-free per-connection counters
}
```

Do not trust `host` from the browser URL. Remove `net-browserify` from proxy dependencies and add `ws` explicitly. Remove the Dockerfile's `git` installation because npm no longer needs a git dependency.

- [ ] **Step 4: Run gateway tests and syntax checks**

```bash
node --test tests/hem-raw-tcp-gateway.test.mjs
node --check apps/proxy/server.cjs
```
Expected: PASS.

- [ ] **Step 5: Commit the gateway task**

```bash
git add apps/proxy/server.cjs apps/proxy/package.json apps/proxy/Dockerfile tests/hem-raw-tcp-gateway.test.mjs
git commit -m "feat: replace generic proxy with HEM raw TCP gateway"
```

### Task 3: Build alias and release attestation

**Files:**
- Modify: `apps/client/build-client.mjs`
- Create: `apps/client/install-hem-net-transport.mjs`
- Modify: `tests/net-browserify-ordering-patch.test.mjs` (convert to inactive-transport historical assertion)
- Create: `tests/hem-raw-transport-build.test.mjs`
- Modify: `scripts/verify.mjs`
- Modify: `.github/workflows/deploy-cloudflare.yml`

**Interfaces:**
- Consumes: frozen upstream install and runtime-resolved `net-browserify` package path.
- Produces: the resolved browser `net` implementation replaced with HEM adapter source, plus `hem-build.json` fields:

```json
{
  "transport": "hem-raw-tcp-v1",
  "netBrowserifyProductionTransport": false,
  "orderedBinaryDelivery": true,
  "singleWebSocketTcpTunnel": true
}
```

- [ ] **Step 1: Write failing build/release tests**

Assert that build-client executes `install-hem-net-transport.mjs`, does not execute `patch-net-browserify-ordering.mjs`, the proxy package lacks `net-browserify`, and deployment verification requires the new attestation.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
node --test tests/hem-raw-transport-build.test.mjs tests/net-browserify-ordering-patch.test.mjs
```
Expected: FAIL on RC38 build behavior.

- [ ] **Step 3: Implement runtime-resolved adapter installation**

`install-hem-net-transport.mjs` must resolve the installed `net-browserify` package from the frozen upstream graph, verify the expected historical package shape, back up provenance metadata only, and replace its browser entrypoint with the contents of `apps/client/hem-net-socket.cjs`. Emit `.hem-net-transport.json` with `transportId`, `runtimeResolved`, `singleWebSocketTcpTunnel`, `orderedBinaryDelivery`, and source SHA-256.

`build-client.mjs` must invoke this installer instead of the ordering patch and copy the resulting attestation into `hem-build.json`.

- [ ] **Step 4: Update fail-closed release/deploy verification**

`verify.mjs` and deploy workflow must require `transport === 'hem-raw-tcp-v1'`, `netBrowserifyProductionTransport === false`, `orderedBinaryDelivery === true`, and `singleWebSocketTcpTunnel === true`; remove the old active ordering-patch requirement.

- [ ] **Step 5: Run focused tests and syntax checks**

```bash
node --test tests/hem-raw-transport-build.test.mjs tests/net-browserify-ordering-patch.test.mjs
node --check apps/client/install-hem-net-transport.mjs
node --check apps/client/build-client.mjs
node --check scripts/verify.mjs
```
Expected: PASS.

- [ ] **Step 6: Commit build integration**

```bash
git add apps/client/build-client.mjs apps/client/install-hem-net-transport.mjs tests/hem-raw-transport-build.test.mjs tests/net-browserify-ordering-patch.test.mjs scripts/verify.mjs .github/workflows/deploy-cloudflare.yml
git commit -m "build: certify dedicated HEM raw TCP transport"
```

### Task 4: Runtime and live acceptance diagnostics

**Files:**
- Modify: `apps/client/hem-bridge.js`
- Modify: `tests/system/browser-1215.mjs`
- Modify: `tests/system/docker-compose.yml`
- Modify: `tests/connection-generation-acceptance.test.mjs`
- Create: `tests/raw-transport-acceptance-contract.test.mjs`

**Interfaces:**
- Consumes: active generation's socket `__hemTransportState`, gateway `/debug/connections` when test diagnostics are enabled.
- Produces: generation diagnostics containing transport ID/byte counters; system gate verifies same generation, >=3 keepalive round trips, browser bytes sent, gateway TCP bytes written, and no Paper timeout.

- [ ] **Step 1: Write failing acceptance-contract tests**

Assert that the system runner checks `transport.implementation === 'hem-raw-tcp-v1'`, captures one generation ID, requires it unchanged, queries gateway diagnostics, and rejects Paper `lost connection: Timed out` during certification.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
node --test tests/connection-generation-acceptance.test.mjs tests/raw-transport-acceptance-contract.test.mjs
```
Expected: FAIL until the new diagnostics are wired.

- [ ] **Step 3: Wire adapter diagnostics into RC38 generation state**

When a physical client generation is attached, locate its underlying socket/stream transport if available and periodically copy only secret-free counters into that generation's `transport` object. Keep existing protocol keepalive counters separate from raw tunnel counters.

- [ ] **Step 4: Strengthen live certification**

For Hudson and Elise concurrently:

```js
const generationId = await activeGenerationId(page)
await sustainGeneration(page, label, { minimumKeepAlives: 3, minimumMs: 65_000 })
assert.equal(await activeGenerationId(page), generationId)
```

During the same window, query `http://127.0.0.1:8080/debug/connections` and require browser->gateway frames/bytes and gateway->TCP write bytes to increase. After the window, inspect Paper logs and fail on any timeout for either synthetic player.

Enable `HEM_ENABLE_TEST_DIAGNOSTICS=true` only in the test compose proxy service.

- [ ] **Step 5: Run focused tests and syntax checks**

```bash
node --test tests/connection-generation-acceptance.test.mjs tests/raw-transport-acceptance-contract.test.mjs
node --check apps/client/hem-bridge.js
node --check tests/system/browser-1215.mjs
```
Expected: PASS.

- [ ] **Step 6: Commit acceptance changes**

```bash
git add apps/client/hem-bridge.js tests/system/browser-1215.mjs tests/system/docker-compose.yml tests/connection-generation-acceptance.test.mjs tests/raw-transport-acceptance-contract.test.mjs
git commit -m "test: certify raw tunnel across Paper keepalive boundary"
```

### Task 5: RC39 release identity, docs, full verification and package

**Files:**
- Modify versioned release files via `npm run set-version -- 1.0.0-rc.39` or repository-supported equivalent.
- Modify: `README.md`, `VERIFICATION.md`, `docs/ARCHITECTURE.md`, `docs/ACCEPTANCE.md`, `docs/GO_LIVE.md`, `docs/RELEASE_BLOCKERS.md`, `docs/SECURITY.md`, `THIRD_PARTY.md` as required by contracts.
- Modify: `SOURCE_MANIFEST.sha256`.

**Interfaces:**
- Produces: full RC39 repo ZIP and evidence that source/static/release gates pass. Live Paper acceptance remains GitHub Actions authority if local environment cannot build pinned upstream.

- [ ] **Step 1: Bump RC identity to `1.0.0-rc.39` and update docs**

Document that RC39 removes `net-browserify` from the active production transport, retains the package only as a frozen upstream resolution target whose browser entrypoint is replaced at build time, and makes `hem-raw-tcp-v1` mandatory.

- [ ] **Step 2: Run the complete source suite**

```bash
npm test
npm run verify
npm run manifest:write
npm run manifest:verify
```
Expected: zero failures.

- [ ] **Step 3: Run syntax/build preflight**

```bash
node --check apps/client/hem-net-socket.cjs
node --check apps/client/install-hem-net-transport.mjs
node --check apps/client/build-client.mjs
node --check apps/client/hem-bridge.js
node --check apps/proxy/server.cjs
node --check tests/system/browser-1215.mjs
```

Attempt the exact pinned build:
```bash
MWC_REF=0359f20b8d721ea44c7ddb633c985a71574c73d3 HEM_REQUIRE_PINNED_MWC=true node apps/client/build-client.mjs
```
If external DNS blocks GitHub, record that environment limitation and do not claim live certification.

- [ ] **Step 4: Run the two-browser system harness when the pinned build succeeds**

```bash
docker compose -f tests/system/docker-compose.yml up -d --build
node tests/system/static-client.mjs &
node tests/system/static-hub.mjs &
node tests/system/browser-1215.mjs
```
Required evidence: same generation survives >=3 keepalives for both browsers, gateway TCP-write counters increase, no Paper timeout, refresh/resume passes, gateway outage/recovery passes, and later gameplay gates continue.

- [ ] **Step 5: Package and verify the exact ZIP**

```bash
npm run package:repo-root
```
Extract the generated ZIP into an empty directory and rerun `npm test`, `npm run verify`, and `npm run manifest:verify` there. Compute SHA-256 of the final ZIP.

- [ ] **Step 6: Commit release metadata**

```bash
git add -A
git commit -m "release: HEM v1.0.0-rc.39"
```
