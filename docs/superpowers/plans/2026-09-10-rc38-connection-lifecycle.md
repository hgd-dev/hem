# HEM RC38 Connection Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HEM's 1.21.5 browser transport and authorization lifecycle generation-aware so reconnects cannot hide dead sockets and every new physical connection reauthorizes correctly.

**Architecture:** Keep the existing pinned Minecraft-Web-Client / node-minecraft-protocol stack, but introduce a page-local generation manager keyed by `bot._client` identity. Diagnostics, authorization, resume-channel registration, and keepalive acceptance become generation-scoped; the system test captures generation IDs and requires physical-connection continuity across each transport gate.

**Tech Stack:** JavaScript, Node.js, Playwright, Mineflayer/node-minecraft-protocol browser bundle, Paper 1.21.5, Docker Compose system harness.

**Spec:** `docs/superpowers/specs/2026-09-10-rc38-connection-lifecycle-design.md`

## Global Constraints

- Target remains Minecraft / Paper `1.21.5`.
- Keep the pinned upstream `v0.1.99` compatibility contract.
- Do not persist launch or resume credentials in query parameters, localStorage, diagnostics, or logs.
- Launch token may be consumed only once per page launch.
- Resume lease remains browser-local and short-lived.
- Do not replace `net-browserify` in RC38.
- Do not weaken or skip any existing parity gates.
- A reconnect during the keepalive gate is a failure, not a pass.

---

### Task 1: Add generation-scoped lifecycle state to the browser bridge

**Files:**
- Modify: `apps/client/hem-bridge.js`
- Test: `tests/client/hem-bridge-lifecycle.test.mjs` (create if no equivalent focused test exists)

**Interfaces:**
- Produces: `parity.connection.activeGenerationId: number | null`
- Produces: `parity.connection.generations: Array<GenerationSnapshot>`
- Produces: generation snapshots with `id`, `connected`, `startedAt`, `endedAt`, `keepAliveSeen`, `keepAliveResponses`, `keepAliveFallbacks`, `clientEndReason`, `clientErrors`, `authorization`, and `resumeChannelRegistered`.

- [ ] **Step 1: Write a failing lifecycle test**

Create a focused test harness that evaluates `hem-bridge.js` against two fake bot/client identities in one page lifecycle. Assert that attaching diagnostics to client A creates generation 1, reattaching A is idempotent, and attaching client B creates generation 2 while marking generation 1 ended/disconnected.

- [ ] **Step 2: Run the focused test and confirm RED**

Run the repository's existing Node test command for the new test file. Expected failure: no generation-aware diagnostics surface exists.

- [ ] **Step 3: Implement minimal generation manager**

In `hem-bridge.js`, add:

```js
const connection = {
  nextGenerationId: 1,
  activeGenerationId: null,
  generations: [],
}
parity.connection = connection

const generationByClient = new WeakMap()

function currentGeneration () {
  return connection.generations.find(g => g.id === connection.activeGenerationId) || null
}

function beginGeneration (client) {
  const existing = generationByClient.get(client)
  if (existing) return existing
  const prior = currentGeneration()
  if (prior && !prior.endedAt) {
    prior.connected = false
    prior.endedAt = Date.now()
  }
  const generation = {
    id: connection.nextGenerationId++,
    startedAt: Date.now(),
    endedAt: 0,
    connected: false,
    keepAliveSeen: 0,
    keepAliveResponses: 0,
    keepAliveFallbacks: 0,
    clientEndReason: '',
    clientErrors: [],
    authorization: { mode: '', attempted: false, authenticated: false, failed: false },
    resumeChannelRegistered: false,
  }
  generationByClient.set(client, generation)
  connection.generations.push(generation)
  if (connection.generations.length > 8) connection.generations.shift()
  connection.activeGenerationId = generation.id
  return generation
}
```

Adapt event handlers so client/bot end events update the generation that owns those handlers, not whichever generation happens to be active later.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Expected: generation identity, rollover, idempotency, and bounded history all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/client/hem-bridge.js tests/client/hem-bridge-lifecycle.test.mjs
git commit -m "fix: track physical browser connection generations"
```

### Task 2: Make authorization repeat once per physical generation

**Files:**
- Modify: `apps/client/hem-bridge.js`
- Test: `tests/client/hem-bridge-lifecycle.test.mjs`

**Interfaces:**
- Consumes: generation object from Task 1.
- Produces: exactly one auth/resume attempt per generation.
- Produces: page-local `launchTokenConsumed` boolean.

- [ ] **Step 1: Add failing tests for second-generation authorization**

Test these cases explicitly:

```js
// generation 1 + fragment token => one /hem auth command
// generation 2 + retained lease => one /hem resume command
// generation 3 + retained lease => another /hem resume command
// authenticated=true on generation 1 must not make generation 2 authenticated
```

- [ ] **Step 2: Run and confirm RED**

Expected failure: current page-scoped `sent` prevents the second physical connection from sending a resume command.

- [ ] **Step 3: Replace page-scoped `sent` with per-generation state**

Use:

```js
let launchTokenConsumed = false

function authorizeGeneration (bot, generation) {
  if (!bot?.entity || typeof bot.chat !== 'function' || generation.authorization.attempted) return

  if (token && !launchTokenConsumed) {
    launchTokenConsumed = true
    generation.authorization.mode = 'launch'
    generation.authorization.attempted = true
    try { sessionStorage.removeItem(resumeKey) } catch {}
    history.replaceState(null, '', canonicalRecoveryUrl)
    bot.chat(`/hem auth ${token}`)
    return
  }

  const resume = readResume()
  if (resume) {
    generation.authorization.mode = 'resume'
    generation.authorization.attempted = true
    parity.resume.attempted = true
    bot.chat(`/hem resume ${resume}`)
  }
}
```

Update message/kick/end handlers so generation authorization flags are updated on their owning generation. Keep the top-level authorization object only as a compatibility mirror of the active generation if existing tests depend on it.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Expected: every fresh physical generation gets exactly one credential attempt and no stale auth state leaks across generations.

- [ ] **Step 5: Commit**

```bash
git add apps/client/hem-bridge.js tests/client/hem-bridge-lifecycle.test.mjs
git commit -m "fix: reauthorize each physical browser connection"
```

### Task 3: Preserve a canonical non-secret recovery URL

**Files:**
- Modify: `apps/client/hem-bridge.js`
- Test: `tests/client/hem-bridge-lifecycle.test.mjs`

**Interfaces:**
- Produces: `canonicalRecoveryUrl: string` containing pathname + full non-secret search string and no hash credential.

- [ ] **Step 1: Add failing URL secrecy/preservation tests**

Assert that a source URL containing `ip`, `version`, `proxy`, `username`, repeated `setting` values, and `#hemToken=...` produces a recovery URL retaining every query parameter but containing neither `hemToken` nor the resume lease.

- [ ] **Step 2: Run and confirm RED**

Expected failure if current replacement logic is not explicitly represented/testable as canonical recovery state.

- [ ] **Step 3: Implement canonical URL capture**

At startup:

```js
const canonicalRecoveryUrl = `${location.pathname}${location.search}`
```

Use it for `history.replaceState` after launch-token consumption and expose only a boolean diagnostic such as `parity.resume.recoveryUrlReady = true`; do not expose the URL if avoiding destination leakage is preferred by the current diagnostics contract.

- [ ] **Step 4: Run focused tests and confirm GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/client/hem-bridge.js tests/client/hem-bridge-lifecycle.test.mjs
git commit -m "fix: preserve non-secret reconnect launch URL"
```

### Task 4: Scope keepalive counters and channel registration to generations

**Files:**
- Modify: `apps/client/hem-bridge.js`
- Test: `tests/client/hem-bridge-lifecycle.test.mjs`

**Interfaces:**
- Consumes: keepalive guard state returned by `attachHemKeepAliveGuard(client)`.
- Produces: generation-local counter synchronization.

- [ ] **Step 1: Add failing counter-isolation tests**

Simulate client A with 3/3 keepalives, then client B with 0/0. Assert active generation B reports 0/0 and cannot inherit A's counts. Assert each client gets independent resume-channel registration.

- [ ] **Step 2: Run and confirm RED**

Expected failure: RC37 mirrors keepalive data into one page-wide `parity.transport` object.

- [ ] **Step 3: Bind keepalive/channel handlers to owning generation**

Synchronize guard counters into `generation.keepAliveSeen`, `generation.keepAliveResponses`, and `generation.keepAliveFallbacks`. Mirror only the active generation into legacy `parity.transport` fields if necessary. Set `generation.resumeChannelRegistered = true` only for the client on which registration succeeded.

- [ ] **Step 4: Run focused tests and confirm GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/client/hem-bridge.js tests/client/hem-bridge-lifecycle.test.mjs
git commit -m "fix: isolate transport diagnostics by connection generation"
```

### Task 5: Strengthen the two-browser keepalive gate

**Files:**
- Modify: `tests/system/browser-1215.mjs`

**Interfaces:**
- Consumes: `__HEM_PARITY__.connection.activeGenerationId` and generation history.
- Produces: a keepalive acceptance gate that cannot pass across reconnects.

- [ ] **Step 1: Add helper for same-generation transport observation**

Implement a helper with semantics equivalent to:

```js
async function sustainGeneration(page, label, durationMs = 20_000) {
  const start = await page.evaluate(() => globalThis.__HEM_PARITY__?.connection?.activeGenerationId)
  if (!Number.isInteger(start)) throw new Error(`${label}: missing active connection generation`)
  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    const state = await page.evaluate(id => {
      const p = globalThis.__HEM_PARITY__
      const g = p?.connection?.generations?.find(entry => entry.id === id)
      return {
        active: p?.connection?.activeGenerationId,
        connected: g?.connected === true,
        endedAt: Number(g?.endedAt || 0),
        seen: Number(g?.keepAliveSeen || 0),
        responses: Number(g?.keepAliveResponses || 0),
        endReason: String(g?.clientEndReason || ''),
      }
    }, start)
    if (state.active !== start || !state.connected || state.endedAt) {
      throw new Error(`${label}: physical connection generation changed or ended during keepalive gate`)
    }
    await sleep(250)
  }
  const finalState = await page.evaluate(id => {
    const g = globalThis.__HEM_PARITY__?.connection?.generations?.find(entry => entry.id === id)
    return g ? { seen: g.keepAliveSeen, responses: g.keepAliveResponses } : null
  }, start)
  if (!finalState || finalState.seen < 3 || finalState.responses < finalState.seen) {
    throw new Error(`${label}: insufficient same-generation Paper keepalive round trips`)
  }
  return start
}
```

- [ ] **Step 2: Replace cumulative gate with the helper**

Store Hudson and Elise's surviving generation IDs for later comparison.

- [ ] **Step 3: Run the system harness and confirm RC37 behavior is now exposed**

Expected: if auto-reconnect occurs during the observation window, the test fails instead of reporting a false green.

- [ ] **Step 4: Commit**

```bash
git add tests/system/browser-1215.mjs
git commit -m "test: require same-generation keepalive survival"
```

### Task 6: Prove refresh and proxy recovery create and authenticate fresh generations

**Files:**
- Modify: `tests/system/browser-1215.mjs`

**Interfaces:**
- Consumes: active generation ID and generation-local authorization state.
- Produces: generation-aware `session.refresh-resume` and `session.proxy-outage-resume` gates.

- [ ] **Step 1: Capture pre-refresh generation**

Before Hudson reload, capture `activeGenerationId`. After reload and `pageReady`, require a different generation ID and require that generation's `authorization.mode === 'resume'`, `attempted === true`, and `authenticated === true`.

- [ ] **Step 2: Capture pre-outage generation IDs**

Before stopping the proxy, save both active generation IDs.

- [ ] **Step 3: Strengthen outage proof**

After proxy stop, require both saved generations to report disconnected/ended and Paper to report zero authenticated players.

- [ ] **Step 4: Strengthen recovery proof**

After proxy health returns and both tabs reload their current canonical query URL, require each browser's active generation ID to differ from its pre-outage generation and require generation-local resume authentication success.

- [ ] **Step 5: Run two-browser acceptance**

Expected: both players return, both renderers recover, and later multiplayer/gameplay gates execute on live post-recovery generations.

- [ ] **Step 6: Commit**

```bash
git add tests/system/browser-1215.mjs
git commit -m "test: verify generation-aware refresh and proxy resume"
```

### Task 7: Update RC identity and verification evidence

**Files:**
- Modify: release/version files already used by RC37
- Modify: `VERIFICATION.md` if current release process records gate evidence there
- Modify: `SOURCE_MANIFEST.sha256` only through the repository's existing manifest generation command

**Interfaces:**
- Consumes: all prior passing changes.
- Produces: RC38 identity with no stale RC37 references in runtime build metadata.

- [ ] **Step 1: Search for `rc.37` / `RC37` references**

Use repository search and classify each occurrence as runtime identity, release documentation, or historical evidence. Do not rewrite historical changelog entries that are meant to remain history.

- [ ] **Step 2: Update runtime/release identity to RC38**

Ensure `hem-bridge.js` and generated `hem-build.json` agree on the exact RC38 version string used by the current build process.

- [ ] **Step 3: Regenerate build/manifest using existing scripts**

Run only repository-defined build/verification commands; do not hand-edit generated hashes.

- [ ] **Step 4: Commit**

```bash
git add apps/client VERIFICATION.md SOURCE_MANIFEST.sha256
git commit -m "chore: prepare HEM RC38 release identity"
```

### Task 8: Full verification and escalation decision

**Files:**
- No new code unless verification finds a concrete defect.

**Interfaces:**
- Produces: evidence that RC38 either passes strict acceptance or justifies RC39 transport replacement.

- [ ] **Step 1: Run focused lifecycle tests**

Expected: PASS.

- [ ] **Step 2: Run repository verification command**

Use the exact existing verification command from `package.json` / `VERIFICATION.md`. Expected: PASS.

- [ ] **Step 3: Run full two-browser 1.21.5 acceptance**

Expected evidence for both browsers:
- unchanged physical generation survives keepalive observation;
- no Paper `Timed out` during that gate;
- refresh produces a new resume-authenticated generation;
- proxy outage ends both active generations;
- proxy restart produces new resume-authenticated generations;
- same world and renderer state recover;
- later parity gates remain green.

- [ ] **Step 4: Apply escalation rule if needed**

If the same unchanged generation still shows correct keepalive request/response traffic and Paper later times out, stop patching lifecycle heuristics and open RC39 as a transport replacement effort centered on a purpose-built ordered WebSocket-to-TCP gateway.

- [ ] **Step 5: Package and verify from a blank extraction**

Create the full RC38 repository ZIP using the existing release packaging process. Extract it into a clean directory, run the release verification command there, and compare the packaged source manifest to the working tree's generated manifest.

- [ ] **Step 6: Final commit / tag only after evidence is green**

Use the repository's existing RC naming convention.
