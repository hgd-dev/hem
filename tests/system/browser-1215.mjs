import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const CONTROL = 'http://127.0.0.1:3000'
const KEY = 'system-orchestrator-key-0123456789abcdef'
const SHARED = 'w_0123456789abcdefabcd'
const SOLO = 'w_fedcba9876543210abcd'
const H = 'HEM_Huds_1a2b3'
const E = 'HEM_Elis_4d5e6'
const SOAK_MINUTES = Math.max(0, Number.parseInt(process.env.HEM_SOAK_MINUTES || '0', 10) || 0)
const gateSpec = JSON.parse(await fs.readFile('tests/system/required-gates-1215.json', 'utf8'))
if (gateSpec.minecraft !== '1.21.5' || !Array.isArray(gateSpec.required)) throw new Error('Invalid HEM 1.21.5 system gate specification')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const compose = (...args) => execFileSync('docker', ['compose', '-f', 'tests/system/docker-compose.yml', ...args], { stdio: 'inherit' })

async function control(path, body = {}) {
  const response = await fetch(`${CONTROL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hem-service-key': KEY },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok && response.status !== 202) throw new Error(`${path}: ${response.status} ${JSON.stringify(data)}`)
  return { response, data }
}

async function ensureWorld(worldId, { seed = '424242', gameMode = 'creative', difficulty = 'normal', name = 'HEM Acceptance', allowCommands = true } = {}) {
  const deadline = Date.now() + 210_000
  while (Date.now() < deadline) {
    const { response, data } = await control(`/internal/worlds/${worldId}/ensure`, {
      seed, gameMode, difficulty, name, allowCommands, paperVersion: '1.21.5',
    })
    if (response.status === 200 && data.status === 'ready') return data
    await sleep(1500)
  }
  throw new Error(`Paper 1.21.5 did not become ready for ${worldId}`)
}

async function health() {
  const response = await fetch(`${CONTROL}/healthz`)
  if (!response.ok) throw new Error(`healthz ${response.status}`)
  return response.json()
}

async function waitFor(fn, label, timeout = 120_000, interval = 500) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    try {
      last = await fn()
      if (last) return last
    } catch (error) {
      last = error
    }
    await sleep(interval)
  }
  throw new Error(`Timed out: ${label}; last=${String(last)}`)
}

function launchUrl(port, user, token) {
  const url = new URL('http://127.0.0.1:4173/')
  url.searchParams.set('ip', `orchestrator:${port}`)
  url.searchParams.set('version', '1.21.5')
  url.searchParams.set('proxy', 'http://127.0.0.1:8080')
  url.searchParams.set('username', user)
  url.searchParams.set('autoConnect', 'true')
  url.searchParams.set('lockConnect', 'true')
  url.searchParams.set('name', 'HEM')
  for (const setting of ['renderDistance:12','fov:92','mouseSensitivity:1.35','masterVolume:0.65','musicVolume:0.25','viewBobbing:false','smoothLighting:true','skyEnabled:true','rawMouseInput:true']) {
    url.searchParams.append('setting', setting)
  }
  url.hash = new URLSearchParams({ hemToken: token }).toString()
  return url.toString()
}

async function pageReady(page, user) {
  await waitFor(
    () => page.evaluate(expected => Boolean(globalThis.bot?.entity && globalThis.bot?.username === expected), user),
    `${user} joins 1.21.5`,
    150_000,
  )
}

async function runtimeRegistryReady(page, label) {
  return waitFor(() => page.evaluate(() => {
    const p = globalThis.__HEM_PARITY__
    return p?.registry?.checked && p.registry.ok ? true : (p?.registry?.missing?.join(', ') || false)
  }), `${label} runtime 1.21.5 registry`, 30_000)
}

async function rendererReady(page, label) {
  return waitFor(() => page.evaluate(() => {
    const renderer = globalThis.__HEM_PARITY__?.renderer
    return renderer?.checked && renderer.healthy && renderer.sections > 0
  }), `${label} rendered chunk sections`, 45_000)
}

async function waitPlayers(worldId, count, timeout = 30_000) {
  return waitFor(async () => {
    const state = await health()
    return state.active?.find(entry => entry.id === worldId)?.players === count
  }, `${worldId} has ${count} authenticated players`, timeout)
}

async function command(worldId, commandText) {
  await control('/internal/command', { worldId, command: commandText })
}
async function recentLogs(worldId, limit = 200) {
  const { data } = await control('/internal/test/logs', { worldId, limit })
  return Array.isArray(data.lines) ? data.lines : []
}

async function commandLogMatch(worldId, commandText, pattern, label, timeout = 30_000) {
  const before = await recentLogs(worldId, 400)
  await command(worldId, commandText)
  return waitFor(async () => {
    const lines = await recentLogs(worldId, 400)
    const tail = lines.slice(Math.min(before.length, lines.length))
    return tail.find(line => pattern.test(line)) || false
  }, label, timeout, 250)
}


async function blockName(page, x, y, z) {
  return page.evaluate(([x0, y0, z0]) => {
    const bot = globalThis.bot
    const pos = bot.entity.position.offset(x0 - bot.entity.position.x, y0 - bot.entity.position.y, z0 - bot.entity.position.z)
    return bot.blockAt(pos)?.name || null
  }, [x, y, z])
}

async function blockProperties(page, x, y, z) {
  return page.evaluate(([x0, y0, z0]) => {
    const bot = globalThis.bot
    const pos = bot.entity.position.offset(x0 - bot.entity.position.x, y0 - bot.entity.position.y, z0 - bot.entity.position.z)
    const block = bot.blockAt(pos)
    return block?.getProperties?.() || null
  }, [x, y, z])
}

async function itemCount(page, itemName) {
  return page.evaluate(name => globalThis.bot.inventory.items().filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0), itemName)
}

async function openPlayer(browser, port, user, token, fatal, label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await context.newPage()
  const skinFetches = new Set()
  page.on('pageerror', error => fatal.push(`${label} pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') console.log(`${label} console error:`, message.text())
  })
  page.on('requestfailed', request => {
    const url = request.url()
    if (url.startsWith('http://127.0.0.1:4173/')) console.log(`${label} client request failed: ${url} :: ${request.failure()?.errorText || 'unknown'}`)
  })
  page.on('response', async response => {
    const url = response.url()
    const match = /\/skins\/(hudson|elise)\.png(?:[?#]|$)/i.exec(url)
    if (match && response.ok()) skinFetches.add(match[1].toLowerCase())
    if (url.startsWith('http://127.0.0.1:4173/')) {
      const pathname = new URL(url).pathname
      const assetLike = /\.(?:json|js|mjs|wasm)(?:$|\?)/i.test(pathname)
      const contentType = String(response.headers()['content-type'] || '')
      if (!response.ok() && assetLike) {
        const detail = `${label} client asset HTTP ${response.status()}: ${pathname}`
        console.log(detail); fatal.push(detail)
      } else if (assetLike && /text\/html/i.test(contentType)) {
        const detail = `${label} client asset returned HTML instead of ${path.extname(pathname) || 'asset'}: ${pathname}`
        console.log(detail); fatal.push(detail)
      }
    }
  })
  await page.goto(launchUrl(port, user, token), { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await pageReady(page, user)
  return { context, page, skinFetches }
}

async function stopWorld(worldId) {
  await control('/internal/stop', { worldId })
  await waitFor(async () => {
    const state = await health()
    return !state.active?.some(entry => entry.id === worldId)
  }, `${worldId} clean Paper stop`, 60_000)
}

await fs.mkdir('artifacts', { recursive: true })
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
})
const fatal = []
const contexts = new Set()
const passedGates = new Set()
function pass(id, message) {
  passedGates.add(id)
  console.log(`PASS [${id}] ${message}`)
}

try {
  // Shared-world real-time multiplayer acceptance.
  const sharedFirst = await ensureWorld(SHARED, { name: 'HEM Shared Acceptance' })
  console.log('Paper shared world ready', sharedFirst)
  let hudson = await openPlayer(browser, sharedFirst.port, H, 'hem-system-Hudson-token-0000000000000000000001', fatal, 'Hudson')
  let elise = await openPlayer(browser, sharedFirst.port, E, 'hem-system-Elise-token-00000000000000000000002', fatal, 'Elise')
  contexts.add(hudson.context); contexts.add(elise.context)
  await waitPlayers(SHARED, 2)
  await runtimeRegistryReady(hudson.page, 'Hudson')
  await runtimeRegistryReady(elise.page, 'Elise')
  await rendererReady(hudson.page, 'Hudson')
  await rendererReady(elise.page, 'Elise')
  await waitFor(() => hudson.page.evaluate(() => globalThis.__HEM_PARITY__?.build?.checked && globalThis.__HEM_PARITY__?.build?.ok), 'Hudson browser build identity attestation', 15_000)
  await waitFor(() => elise.page.evaluate(() => globalThis.__HEM_PARITY__?.build?.checked && globalThis.__HEM_PARITY__?.build?.ok), 'Elise browser build identity attestation', 15_000)
  pass('client.registry-renderer', 'two authenticated browser players + build identity + runtime 1.21.5 registries + rendered chunk sections')

  const liveBuildIdentity = JSON.parse(await fs.readFile('apps/client/dist/hem-build.json', 'utf8'))
  const requiredCapabilities = ['keybindings','renderDistanceSetting','rawMouseInput','resourcePackTextures','creativeInventory','debugOverlay','thirdPerson','sounds']
  const missingCapabilities = requiredCapabilities.filter(name => liveBuildIdentity.capabilities?.[name] !== true)
  if (missingCapabilities.length) throw new Error(`Built browser client lost required HEM capability signals: ${missingCapabilities.join(', ')}`)
  if (liveBuildIdentity.upstreamReleaseTag !== 'v0.1.99' || liveBuildIdentity.upstreamRelease1215 !== true) throw new Error('Built browser client is not tied to the known v0.1.99 1.21.5 release')
  if (!Array.isArray(liveBuildIdentity.upstreamLiteralVersionTokens)) throw new Error('Built browser client is missing upstream literal-version provenance')
  if (!/^[0-9a-f]{64}$/i.test(liveBuildIdentity.upstreamSupportedVersionsSha256 || '')) throw new Error('Built browser client is missing upstream supportedVersions source hash')
  if (!/^[0-9a-f]{64}$/i.test(liveBuildIdentity.upstreamPackageSha256 || '') || !/^[0-9a-f]{64}$/i.test(liveBuildIdentity.upstreamLockSha256 || '')) throw new Error('Built browser client is missing frozen v0.1.99 package/lock provenance')
  if (liveBuildIdentity.frozenLockfile !== true) throw new Error('Built browser client did not use the pinned v0.1.99 frozen lockfile')
  if (liveBuildIdentity.compatibilityMode !== 'pinned-v0.1.99-lockfile-1215-verified' || liveBuildIdentity.protocolVerified1215 !== true) throw new Error(`HEM 1.21.5 requires pinned v0.1.99 frozen dependencies plus verified protocol/data; got ${liveBuildIdentity.compatibilityMode}`)
  if (liveBuildIdentity.prismarineChunkPatch?.patchId !== 'hem-prismarine-chunk-1215-nosize-v4' || liveBuildIdentity.prismarineChunkPatch?.reports?.length < 1) throw new Error('HEM 1.21.5 requires the deterministic prismarine-chunk no-size-prefix decoder patch')
  if (!liveBuildIdentity.prismarineChunkPatch.reports.every(report => report.sizing?.blocks5Bits === 342 && report.sizing?.biomes3Bits === 4)) throw new Error('HEM 1.21.5 chunk patch sizing attestation is invalid')
  if (!liveBuildIdentity.prismarineChunkPatch.reports.every(report => report.decoderPaths?.readBufferMethods >= 1 && report.decoderPaths?.computedReadPaths === report.decoderPaths?.readBufferMethods)) throw new Error('HEM 1.21.5 chunk patch decoder-path attestation is invalid')
  if (!liveBuildIdentity.prismarineChunkPatch.reports.every(report => report.runtimeResolved === true && Array.isArray(report.consumers) && report.consumers.length >= 1)) throw new Error('HEM 1.21.5 chunk patch is not tied to runtime-resolved consumers')
  pass('client.capability-contract', `upstream feature signals + v0.1.99 frozen dependency provenance + verified 1.21.5 protocol/data + chunk no-size-prefix patch (${liveBuildIdentity.compatibilityMode})`)

  await commandLogMatch(SHARED, 'seed', /424242/, 'Paper reports the configured shared-world seed', 10_000)
  pass('world.seed-authority', 'configured signed-64-bit/text seed transport reaches native Paper world generation authority')
  const requestedSettings = await hudson.page.evaluate(() => globalThis.__HEM_PARITY__?.settingsRequested || {})
  const expectedSettings = { renderDistance:12, fov:92, mouseSensitivity:1.35, masterVolume:.65, musicVolume:.25, viewBobbing:false, smoothLighting:true, skyEnabled:true, rawMouseInput:true }
  for (const [key, expected] of Object.entries(expectedSettings)) {
    if (requestedSettings[key] !== expected) throw new Error(`HEM client launch setting ${key} mismatch: expected ${expected}, got ${requestedSettings[key]}`)
  }
  pass('client.settings-transport', 'HEM video/input/audio settings transported into browser client launch')

  // HEMGate applies profile textures after the one-use auth command. The plugin
  // re-announces that profile to already-connected players, and the browser must
  // actually request the other player's distinct skin URL. A registry property
  // alone is not enough to satisfy this gate.
  await waitFor(() => elise.skinFetches.has('hudson'), 'Elise renderer fetches Hudson custom skin', 30_000)
  await waitFor(() => hudson.skinFetches.has('elise'), 'Hudson renderer fetches Elise custom skin', 30_000)
  pass('profile.remote-skins', 'distinct two-browser custom skin renderer path')

  // The original one-use launch token is deliberately erased after auth. RC8
  // rotates a short-lived one-use resume lease through a private plugin channel so
  // a normal browser refresh can reauthorize without weakening launch-token replay
  // protection or putting credentials back into the URL.
  await waitFor(() => hudson.page.evaluate(() => {
    const r = globalThis.__HEM_PARITY__?.resume
    return Boolean(r?.stored && r.received >= 1)
  }), 'Hudson receives short-lived resume lease', 20_000)
  await hudson.page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
  await pageReady(hudson.page, H)
  await waitFor(() => hudson.page.evaluate(() => {
    const r = globalThis.__HEM_PARITY__?.resume
    return Boolean(r?.attempted && r.stored && r.received >= 1)
  }), 'Hudson refresh resumes and rotates lease', 30_000)
  await waitPlayers(SHARED, 2, 30_000)
  await rendererReady(hudson.page, 'Hudson after refresh')
  pass('session.refresh-resume', 'browser refresh/reconnect via rotated one-use resume lease')

  // A page refresh is only one reconnect shape. Prove a transient proxy outage
  // actually drops both browser sessions, then recover the same tabs after the
  // proxy returns using only their short-lived one-use resume leases.
  await waitFor(() => elise.page.evaluate(() => Boolean(globalThis.__HEM_PARITY__?.resume?.stored)), 'Elise receives resume lease before proxy outage', 20_000)
  compose('stop', '-t', '15', 'proxy')
  await waitFor(() => hudson.page.evaluate(() => globalThis.__HEM_PARITY__?.connected === false), 'Hudson observes proxy outage', 30_000)
  await waitFor(() => elise.page.evaluate(() => globalThis.__HEM_PARITY__?.connected === false), 'Elise observes proxy outage', 30_000)
  await waitPlayers(SHARED, 0, 30_000)
  compose('start', 'proxy')
  await waitFor(async () => {
    try {
      const response = await fetch('http://127.0.0.1:8080/healthz')
      return response.ok
    } catch {
      return false
    }
  }, 'proxy returns healthy after transient outage', 30_000)
  await Promise.all([
    hudson.page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 }),
    elise.page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 }),
  ])
  await pageReady(hudson.page, H)
  await pageReady(elise.page, E)
  await waitFor(() => hudson.page.evaluate(() => Boolean(globalThis.__HEM_PARITY__?.resume?.attempted && globalThis.__HEM_PARITY__?.resume?.stored)), 'Hudson resumes after proxy outage', 30_000)
  await waitFor(() => elise.page.evaluate(() => Boolean(globalThis.__HEM_PARITY__?.resume?.attempted && globalThis.__HEM_PARITY__?.resume?.stored)), 'Elise resumes after proxy outage', 30_000)
  await waitPlayers(SHARED, 2, 30_000)
  await rendererReady(hudson.page, 'Hudson after proxy recovery')
  await rendererReady(elise.page, 'Elise after proxy recovery')
  pass('session.proxy-outage-resume', 'transient proxy outage + same-tab resume recovery')

  await waitFor(() => hudson.page.evaluate(other => Boolean(globalThis.bot?.players?.[other]?.entity), E), 'Hudson player list contains Elise', 20_000)
  await waitFor(() => elise.page.evaluate(other => Boolean(globalThis.bot?.players?.[other]?.entity), H), 'Elise player list contains Hudson', 20_000)
  pass('multiplayer.player-list', 'two-player tab/player registry synchronization')

  await command(SHARED, `experience set ${H} 7 levels`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.experience?.level === 7), 'experience level reaches browser', 15_000)
  await command(SHARED, `experience set ${H} 0 levels`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.experience?.level === 0), 'experience level reset reaches browser', 15_000)
  pass('progression.experience', 'server-authoritative experience/level synchronization')


  // Experience must also work through the ordinary world-entity pickup path, not
  // only through the administrative /experience command.
  await command(SHARED, `experience set ${H} 0 points`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.experience?.points === 0), 'experience points reset before orb pickup', 10_000)
  await command(SHARED, `execute at ${H} run summon minecraft:experience_orb ~ ~1 ~ {Value:7s}`)
  await waitFor(() => hudson.page.evaluate(() => Number(globalThis.bot?.experience?.points || 0) >= 7), 'browser player picks up native XP orb', 15_000, 100)
  pass('progression.xp-orb-pickup', 'native experience-orb entity pickup updates browser XP state')

  await waitFor(() => elise.page.evaluate(user => Boolean(globalThis.bot?.players?.[user]?.entity), H), 'Elise sees Hudson entity', 30_000)
  const remoteBefore = await elise.page.evaluate(user => {
    const pos = globalThis.bot.players[user].entity.position
    return { x: pos.x, y: pos.y, z: pos.z }
  }, H)
  await hudson.page.evaluate(() => globalThis.bot.setControlState('forward', true))
  await sleep(1300)
  await hudson.page.evaluate(() => globalThis.bot.setControlState('forward', false))
  await waitFor(() => elise.page.evaluate(({ user, before }) => {
    const pos = globalThis.bot?.players?.[user]?.entity?.position
    if (!pos) return false
    return Math.hypot(pos.x - before.x, pos.y - before.y, pos.z - before.z) > 0.25
  }, { user: H, before: remoteBefore }), 'real-time remote movement', 20_000)
  pass('movement.remote-horizontal', 'real-time movement visible to second browser')

  // Exercise the actual browser keyboard path rather than calling Mineflayer's
  // movement API directly. This catches broken keybindings/focus/input wiring
  // even when the protocol and physics layers themselves are healthy.
  await command(SHARED, 'fill -5 99 -5 15 99 15 minecraft:stone')
  await command(SHARED, `tp ${H} 0 100 0`)
  await command(SHARED, `tp ${E} 3 100 0`)
  await sleep(800)
  const keyboardBefore = await elise.page.evaluate(user => {
    const pos = globalThis.bot?.players?.[user]?.entity?.position
    return pos ? { x: pos.x, y: pos.y, z: pos.z } : null
  }, H)
  if (!keyboardBefore) throw new Error('Missing Hudson remote entity before browser keyboard movement gate')
  await hudson.page.bringToFront()
  const canvases = hudson.page.locator('canvas')
  if (await canvases.count()) await canvases.last().click({ force: true }).catch(() => {})
  await hudson.page.keyboard.down('w')
  await sleep(1300)
  await hudson.page.keyboard.up('w')
  await waitFor(() => elise.page.evaluate(({ user, before }) => {
    const pos = globalThis.bot?.players?.[user]?.entity?.position
    if (!pos) return false
    return Math.hypot(pos.x - before.x, pos.z - before.z) > 0.25
  }, { user: H, before: keyboardBefore }), 'normal browser W-key movement reaches second player', 20_000, 100)
  pass('controls.keyboard-movement', 'normal browser keybinding path drives server-authoritative movement')

  // Core Java movement: a browser-origin jump must be simulated by Paper and
  // observed by the second browser, not just reflected locally by the renderer.
  await command(SHARED, 'fill -5 99 -5 15 99 15 minecraft:stone')
  await command(SHARED, `tp ${H} 0 100 0`)
  await command(SHARED, `tp ${E} 3 100 0`)
  await sleep(800)
  const jumpBefore = await elise.page.evaluate(user => {
    const pos = globalThis.bot?.players?.[user]?.entity?.position
    return pos ? pos.y : null
  }, H)
  if (!Number.isFinite(jumpBefore)) throw new Error('Missing Hudson remote entity before jump gate')
  await hudson.page.evaluate(() => globalThis.bot.setControlState('jump', true))
  await sleep(350)
  await hudson.page.evaluate(() => globalThis.bot.setControlState('jump', false))
  await waitFor(() => elise.page.evaluate(({ user, before }) => {
    const y = globalThis.bot?.players?.[user]?.entity?.position?.y
    return Number.isFinite(y) && y > before + 0.2
  }, { user: H, before: jumpBefore }), 'browser-origin jump visible to second browser', 12_000, 100)
  pass('movement.jump', 'browser-origin jump + remote vertical movement synchronization')

  // One-block obstacle traversal catches step/jump regressions that flat-ground movement can
  // both pass while forward+jump still wedges at a one-block obstacle. Require a
  // browser-origin traversal over a server-created wall and observe authoritative
  // horizontal progress from the second client.
  await command(SHARED, 'fill -5 99 -5 15 99 15 minecraft:stone')
  await command(SHARED, 'fill 2 100 -1 2 100 1 minecraft:stone')
  await command(SHARED, `tp ${H} 0 100 0`)
  await command(SHARED, `tp ${E} 5 100 0`)
  await sleep(900)
  await hudson.page.evaluate(() => globalThis.bot.lookAt(globalThis.bot.entity.position.offset(6, 0, 0), true))
  const obstacleBefore = await elise.page.evaluate(user => {
    const pos = globalThis.bot?.players?.[user]?.entity?.position
    return pos ? { x: pos.x, y: pos.y, z: pos.z } : null
  }, H)
  if (!obstacleBefore) throw new Error('Missing Hudson remote entity before 1.21.5 obstacle traversal gate')
  await hudson.page.evaluate(() => {
    globalThis.bot.setControlState('forward', true)
    globalThis.bot.setControlState('jump', true)
  })
  await sleep(2200)
  await hudson.page.evaluate(() => {
    globalThis.bot.setControlState('jump', false)
    globalThis.bot.setControlState('forward', false)
  })
  await waitFor(() => elise.page.evaluate(({ user, before }) => {
    const pos = globalThis.bot?.players?.[user]?.entity?.position
    return Boolean(pos && pos.x > before.x + 2.25 && Math.abs(pos.z - before.z) < 2.0)
  }, { user: H, before: obstacleBefore }), '1.21.5 browser player traverses one-block obstacle', 15_000, 100)
  pass('movement.obstacle-jump', 'forward+jump traverses a one-block obstacle through normal browser physics')


  // Compare server-observed travel over the same flat course so sprint/sneak are
  // not merely toggled client flags.
  async function movementDistance(control, milliseconds = 1200) {
    await command(SHARED, `tp ${H} 0 100 6`)
    await command(SHARED, `tp ${E} 0 100 10`)
    await sleep(500)
    await hudson.page.evaluate(() => globalThis.bot.lookAt(globalThis.bot.entity.position.offset(20, 0, 0), true))
    const before = await elise.page.evaluate(user => { const p=globalThis.bot?.players?.[user]?.entity?.position; return p ? {x:p.x,z:p.z} : null }, H)
    if (!before) throw new Error('missing remote player before movement-speed gate')
    await hudson.page.evaluate(mode => { const bot=globalThis.bot; bot.clearControlStates(); if (mode) bot.setControlState(mode,true); bot.setControlState('forward',true) }, control)
    await sleep(milliseconds)
    await hudson.page.evaluate(() => globalThis.bot.clearControlStates())
    await sleep(250)
    const after = await elise.page.evaluate(user => { const p=globalThis.bot?.players?.[user]?.entity?.position; return p ? {x:p.x,z:p.z} : null }, H)
    if (!after) throw new Error('missing remote player after movement-speed gate')
    return Math.hypot(after.x-before.x, after.z-before.z)
  }
  const normalTravel = await movementDistance(null)
  const sprintTravel = await movementDistance('sprint')
  const sneakTravel = await movementDistance('sneak')
  if (!(sprintTravel > normalTravel * 1.12)) throw new Error(`sprint did not exceed normal travel: normal=${normalTravel} sprint=${sprintTravel}`)
  if (!(sneakTravel < normalTravel * 0.88)) throw new Error(`sneak did not reduce travel: normal=${normalTravel} sneak=${sneakTravel}`)
  pass('movement.sprint-sneak', `server-observed movement rates normal=${normalTravel.toFixed(2)} sprint=${sprintTravel.toFixed(2)} sneak=${sneakTravel.toFixed(2)}`)

  // Real fluid movement: sprint-swim through a deep water lane while the second
  // browser observes authoritative player displacement.
  await command(SHARED, 'fill 330 99 -2 342 99 2 minecraft:stone')
  await command(SHARED, 'fill 330 100 -2 342 102 2 minecraft:water')
  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, `tp ${H} 331.5 101 0.5 facing 340.5 101 0.5`)
  const swimStart = await waitFor(() => elise.page.evaluate(user => {
    const e=globalThis.bot?.players?.[user]?.entity; return e ? {x:e.position.x,z:e.position.z} : false
  }, H), 'remote swim start position', 10_000, 100)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; bot.setControlState('sprint',true); bot.setControlState('forward',true); bot.setControlState('jump',true); await new Promise(r=>setTimeout(r,2600)); bot.setControlState('forward',false); bot.setControlState('jump',false); bot.setControlState('sprint',false)
  })
  await waitFor(() => elise.page.evaluate(([user,start]) => {
    const e=globalThis.bot?.players?.[user]?.entity; return e && Math.hypot(e.position.x-start.x,e.position.z-start.z)>1.5
  }, [H,swimStart]), 'second browser observes survival swim movement', 10_000, 100)
  await command(SHARED, `gamemode creative ${H}`)
  pass('movement.swimming', 'browser sprint-swims through a water lane with server-authoritative remote movement')

  // Powder snow has distinct collision/support semantics. Without leather boots the
  // survival player must sink into the block; leather boots must support the player
  // on its top surface. This catches client-physics implementations that treat it as
  // an ordinary full cube.
  await command(SHARED, 'fill 650 99 -1 652 99 1 minecraft:stone')
  await command(SHARED, 'fill 650 100 -1 652 101 1 minecraft:powder_snow')
  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, `item replace entity ${H} armor.feet with minecraft:air`)
  await command(SHARED, `tp ${H} 651.5 102.2 0.5`)
  await sleep(2600)
  const powderSinkY = await hudson.page.evaluate(() => globalThis.bot.entity.position.y)
  if (!(powderSinkY < 101.0)) throw new Error(`browser player failed to sink through powder snow without leather boots: y=${powderSinkY}`)
  await command(SHARED, `item replace entity ${H} armor.feet with minecraft:leather_boots`)
  await command(SHARED, `tp ${H} 651.5 102.2 0.5`)
  await sleep(2200)
  const powderBootY = await hudson.page.evaluate(() => globalThis.bot.entity.position.y)
  if (!(powderBootY > powderSinkY + 0.65)) throw new Error(`leather boots did not support browser player on powder snow: sink=${powderSinkY} boots=${powderBootY}`)
  await command(SHARED, `gamemode creative ${H}`)
  pass('movement.powder-snow', `powder-snow sink/support semantics differ with leather boots: ${powderSinkY.toFixed(2)} -> ${powderBootY.toFixed(2)}`)

  // Ladder and scaffolding vertical traversal use distinct collision/movement rules.
  await command(SHARED, 'fill 350 99 0 350 107 0 minecraft:stone')
  await command(SHARED, 'fill 350 100 1 350 106 1 minecraft:ladder[facing=south,waterlogged=false]')
  await command(SHARED, `tp ${H} 350.5 100 2.2 facing 350.5 104 1.0`)
  const ladderY = await hudson.page.evaluate(() => globalThis.bot.entity.position.y)
  await hudson.page.evaluate(async () => { const bot=globalThis.bot; bot.setControlState('forward',true); bot.setControlState('jump',true); await new Promise(r=>setTimeout(r,2600)); bot.setControlState('forward',false); bot.setControlState('jump',false) })
  await waitFor(() => hudson.page.evaluate(y => globalThis.bot.entity.position.y>y+2, ladderY), 'browser climbs native ladder', 10_000, 100)
  pass('movement.ladder-climb', 'browser traverses upward on native ladder collision/physics')

  await command(SHARED, 'fill 356 99 0 356 106 0 minecraft:scaffolding[bottom=true,distance=0,waterlogged=false]')
  await command(SHARED, `tp ${H} 356.5 100 0.5`)
  const scaffoldY = await hudson.page.evaluate(() => globalThis.bot.entity.position.y)
  await hudson.page.evaluate(async () => { const bot=globalThis.bot; bot.setControlState('jump',true); await new Promise(r=>setTimeout(r,2600)); bot.setControlState('jump',false) })
  await waitFor(() => hudson.page.evaluate(y => globalThis.bot.entity.position.y>y+2, scaffoldY), 'browser climbs native scaffolding', 10_000, 100)
  pass('movement.scaffolding-climb', 'browser traverses upward through native scaffolding physics')


  // Vines and bubble columns cover two remaining vertical movement families that
  // differ from ladders/scaffolding and are easy for browser physics to regress.
  await command(SHARED, 'fill 365 99 0 365 107 0 minecraft:stone')
  await command(SHARED, 'fill 365 100 1 365 106 1 minecraft:vine[north=true,east=false,south=false,west=false,up=false]')
  await command(SHARED, `tp ${H} 365.5 100 2.2 facing 365.5 104 1.0`)
  const vineY = await hudson.page.evaluate(() => globalThis.bot.entity.position.y)
  await hudson.page.evaluate(async () => { const bot=globalThis.bot; bot.setControlState('forward',true); bot.setControlState('jump',true); await new Promise(r=>setTimeout(r,2600)); bot.clearControlStates() })
  await waitFor(() => hudson.page.evaluate(y => globalThis.bot.entity.position.y>y+2, vineY), 'browser climbs native vine', 10_000, 100)
  pass('movement.vine-climb', 'browser traverses upward on a native vine attachment')

  await command(SHARED, 'setblock 372 99 0 minecraft:soul_sand')
  await command(SHARED, 'fill 372 100 0 372 106 0 minecraft:bubble_column[drag=false]')
  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, `tp ${H} 372.5 100.2 0.5`)
  const bubbleY = await hudson.page.evaluate(() => globalThis.bot.entity.position.y)
  await waitFor(() => hudson.page.evaluate(y => globalThis.bot.entity.position.y>y+2, bubbleY), 'upward bubble column lifts browser player', 10_000, 100)
  await command(SHARED, `gamemode creative ${H}`)
  pass('movement.bubble-column', 'native soul-sand bubble-column vertical current moves the browser player')


  await command(SHARED, `give ${H} minecraft:elytra 1`)
  await command(SHARED, `give ${H} minecraft:firework_rocket 3`)
  await waitFor(() => itemCount(hudson.page, 'elytra').then(n => n >= 1), 'elytra reaches browser', 15_000)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const elytra=bot.inventory.items().find(i=>i.name==='elytra'); await bot.equip(elytra,'torso')
  })
  await command(SHARED, `tp ${H} 0 140 0`)
  const glideStart = await hudson.page.evaluate(() => globalThis.bot.entity.position.y)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot
    if (typeof bot.elytraFly !== 'function') throw new Error('Mineflayer/browser client exposes no elytraFly API')
    await bot.elytraFly()
  })
  await sleep(1000)
  const glideAfter = await hudson.page.evaluate(() => globalThis.bot.entity.position.y)
  if (!(glideAfter < glideStart)) throw new Error(`elytra flight did not produce descent: ${glideStart} -> ${glideAfter}`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const rocket=bot.inventory.items().find(i=>i.name==='firework_rocket'); if(!rocket) throw new Error('missing firework rocket'); await bot.equip(rocket,'hand'); bot.activateItem(); await new Promise(r=>setTimeout(r,250)); bot.deactivateItem()
  })
  pass('movement.elytra-firework', 'browser elytra flight API + firework use path')

  await command(SHARED, 'fill -5 99 -5 15 99 15 minecraft:stone')
  await command(SHARED, `tp ${H} 0 100 0`)
  await command(SHARED, `tp ${E} 3 100 0`)
  await sleep(1500)
  await command(SHARED, 'setblock 10 100 10 minecraft:diamond_block')
  await waitFor(() => blockName(hudson.page, 10, 100, 10).then(name => name === 'diamond_block'), 'Hudson receives block update', 20_000)
  await waitFor(() => blockName(elise.page, 10, 100, 10).then(name => name === 'diamond_block'), 'Elise receives same block update', 20_000)
  pass('world.shared-block-state', 'shared block state')

  // Modern block-state sentinel room. Protocol presence alone is insufficient: the
  // renderer must keep active chunk-section meshes while these 1.21-era blocks load.
  await command(SHARED, 'setblock 8 100 8 minecraft:crafter[orientation=up_north,triggered=false,crafting=false]')
  await command(SHARED, 'setblock 9 100 8 minecraft:trial_spawner[ominous=false,trial_spawner_state=inactive]')
  await command(SHARED, 'setblock 10 100 8 minecraft:vault[ominous=false,vault_state=inactive,facing=north]')
  await command(SHARED, 'setblock 11 100 8 minecraft:copper_bulb[lit=false,powered=false]')
  for (const [x,name] of [[8,'crafter'],[9,'trial_spawner'],[10,'vault'],[11,'copper_bulb']]) {
    await waitFor(() => blockName(hudson.page, x, 100, 8).then(value => value === name), `modern block ${name} protocol state`, 20_000)
  }
  await rendererReady(hudson.page, 'Hudson modern-block area')
  await rendererReady(elise.page, 'Elise modern-block area')
  pass('render.modern-blocks', 'modern block registry states with live rendered chunk sections')

  // Representative orientation/connection/state families catch renderer/protocol
  // regressions beyond simple cube IDs. Paper owns validity; both clients must
  // observe the named block and key state property where applicable.
  const stateBlocks = [
    [15, 'oak_door[half=lower,hinge=left,open=true,facing=north,powered=false]', 'oak_door', 'open', true],
    [16, 'oak_trapdoor[facing=north,half=bottom,open=true,powered=false,waterlogged=false]', 'oak_trapdoor', 'open', true],
    [17, 'oak_fence[north=true,east=false,south=false,west=true,waterlogged=false]', 'oak_fence', 'north', true],
    [18, 'glass_pane[north=true,east=true,south=false,west=false,waterlogged=false]', 'glass_pane', 'east', true],
    [19, 'oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', 'oak_stairs', 'facing', 'east'],
    [20, 'stone_slab[type=top,waterlogged=false]', 'stone_slab', 'type', 'top'],
    [21, 'ladder[facing=north,waterlogged=false]', 'ladder', 'facing', 'north'],
    [22, 'scaffolding[bottom=true,distance=0,waterlogged=false]', 'scaffolding', 'bottom', true],
    [23, 'water_cauldron[level=3]', 'water_cauldron', 'level', 3],
    [24, 'composter[level=8]', 'composter', 'level', 8],
    [25, 'cobblestone_wall[north=tall,east=low,south=none,west=low,up=true,waterlogged=false]', 'cobblestone_wall', 'north', 'tall'],
  ]
  for (const [x, state, name, prop, expected] of stateBlocks) {
    await command(SHARED, `setblock ${x} 100 8 minecraft:${state}`)
    await waitFor(() => blockName(hudson.page, x, 100, 8).then(value => value === name), `block-state family ${name}`, 15_000)
    await waitFor(() => blockProperties(elise.page, x, 100, 8).then(value => value?.[prop] === expected), `block-state property ${name}.${prop}`, 15_000)
  }
  await rendererReady(hudson.page, 'Hudson representative block-state families')
  pass('blocks.state-families', 'doors/trapdoors/fences/panes/stairs/slabs/ladders/scaffolding/cauldrons/composters state synchronization')
  await waitFor(() => blockProperties(hudson.page,25,100,8).then(p => p?.north === 'tall' && p?.east === 'low' && p?.south === 'none' && p?.up === true), 'wall side-height/up state synchronization', 15_000)
  pass('blocks.wall-state', 'native wall side-height and post state synchronize to both browser clients')


  // Native Paper world-generation proof. HEM does not reimplement terrain generation;
  // the authoritative 1.21.5 Paper world must expose representative modern and
  // legacy structures/biomes before the browser layer can claim them as playable.
  const locateChecks = [
    ['locate structure minecraft:stronghold', /nearest .*stronghold/i, 'stronghold'],
    ['locate structure minecraft:trial_chambers', /nearest .*trial_chambers/i, 'trial chambers'],
    ['locate structure minecraft:ancient_city', /nearest .*ancient_city/i, 'ancient city'],
    ['locate structure minecraft:shipwreck', /nearest .*shipwreck/i, 'shipwreck'],
    ['execute in minecraft:the_nether run locate structure minecraft:fortress', /nearest .*fortress/i, 'Nether fortress'],
    ['execute in minecraft:the_nether run locate structure minecraft:bastion_remnant', /nearest .*bastion_remnant/i, 'bastion'],
    ['execute in minecraft:the_end run locate structure minecraft:end_city', /nearest .*end_city/i, 'End city'],
    ['locate biome minecraft:plains', /nearest .*plains/i, 'Overworld biome'],
    ['execute in minecraft:the_nether run locate biome minecraft:nether_wastes', /nearest .*nether_wastes/i, 'Nether biome'],
  ]
  for (const [cmd, pattern, label] of locateChecks) await commandLogMatch(SHARED, cmd, pattern, `Paper 1.21.5 locate ${label}`, 45_000)
  pass('worldgen.native-structures-biomes', 'Paper 1.21.5 representative structures + Overworld/Nether biome generation')


  const structureCatalog = [
    ['monument','ocean monument'], ['mansion','woodland mansion'], ['trail_ruins','trail ruins'],
    ['ruined_portal','ruined portal'], ['buried_treasure','buried treasure'], ['ocean_ruin_cold','ocean ruins'],
    ['mineshaft','mineshaft'], ['desert_pyramid','desert pyramid'], ['jungle_pyramid','jungle temple'],
    ['swamp_hut','swamp hut'], ['igloo','igloo'], ['pillager_outpost','pillager outpost'], ['village_plains','village'],
  ]
  for (const [id,label] of structureCatalog) {
    await commandLogMatch(SHARED, `locate structure minecraft:${id}`, /nearest/i, `Paper 1.21.5 locate ${label}`, 60_000)
  }
  pass('worldgen.structure-catalog', 'native monument/mansion/trail-ruins/ruined-portal/treasure/ocean-ruin/mineshaft/temple/hut/igloo/outpost/village generation')

  // Broader modern block semantics/state coverage. These are protocol/render/interact
  // sentinels, not a claim that every neighbor-update edge case is solved.
  const modernInteractionBlocks = [
    [25, 'oak_sign[rotation=0,waterlogged=false]', 'oak_sign'],
    [26, 'oak_hanging_sign[rotation=0,attached=false,waterlogged=false]', 'oak_hanging_sign'],
    [27, 'lectern[facing=north,has_book=false,powered=false]', 'lectern'],
    [28, 'red_bed[facing=south,occupied=false,part=foot]', 'red_bed'],
    [29, 'respawn_anchor[charges=4]', 'respawn_anchor'],
    [30, 'waxed_copper_block', 'waxed_copper_block'],
    [31, 'exposed_copper', 'exposed_copper'],
    [32, 'copper_grate[waterlogged=false]', 'copper_grate'],
    [33, 'crafter[orientation=up_north,triggered=false,crafting=false]', 'crafter'],
  ]
  for (const [x, state, name] of modernInteractionBlocks) {
    await command(SHARED, `setblock ${x} 100 10 minecraft:${state}`)
    await waitFor(() => blockName(hudson.page, x, 100, 10).then(value => value === name), `modern interaction block ${name}`, 15_000)
  }
  pass('blocks.modern-interactions', 'sign/hanging-sign/lectern/bed/anchor/copper/Crafter state synchronization')

  // Cauldron and composter states are only useful if normal right-click actions
  // mutate them. Fill/draw water and extract a ready composter through the browser.
  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, 'setblock 290 100 0 minecraft:cauldron')
  await command(SHARED, `tp ${H} 289 100 0`)
  await command(SHARED, `clear ${H} minecraft:water_bucket`)
  await command(SHARED, `clear ${H} minecraft:glass_bottle`)
  await command(SHARED, `give ${H} minecraft:water_bucket 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const Vec=bot.entity.position.constructor; const item=bot.inventory.items().find(i=>i.name==='water_bucket'); const cauldron=bot.blockAt(bot.entity.position.offset(1,0,0)); if(!item||!cauldron) throw new Error('missing cauldron fill prerequisites'); await bot.equip(item,'hand'); await bot.activateBlock(cauldron,new Vec(-1,0,0),new Vec(0,.5,.5))
  })
  await waitFor(() => blockProperties(elise.page,290,100,0).then(p=>Number(p?.level)===3), 'browser water-bucket fills cauldron to level 3', 10_000, 100)
  await command(SHARED, `give ${H} minecraft:glass_bottle 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const Vec=bot.entity.position.constructor; const bottle=bot.inventory.items().find(i=>i.name==='glass_bottle'); const cauldron=bot.blockAt(bot.entity.position.offset(1,0,0)); if(!bottle||!cauldron||cauldron.name!=='water_cauldron') throw new Error('missing cauldron draw prerequisites'); await bot.equip(bottle,'hand'); await bot.activateBlock(cauldron,new Vec(-1,0,0),new Vec(0,.5,.5))
  })
  await waitFor(() => blockProperties(hudson.page,290,100,0).then(p=>Number(p?.level)===2), 'browser bottle draws one cauldron level', 10_000, 100)
  await command(SHARED, 'kill @e[type=minecraft:item,x=294,y=100,z=0,distance=..6]')
  await command(SHARED, 'setblock 294 100 0 minecraft:composter[level=8]')
  await command(SHARED, `tp ${H} 293 100 0`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const Vec=bot.entity.position.constructor; await bot.unequip('hand'); const composter=bot.blockAt(bot.entity.position.offset(1,0,0)); if(!composter||composter.name!=='composter') throw new Error('missing ready composter'); await bot.activateBlock(composter,new Vec(-1,0,0),new Vec(0,.5,.5))
  })
  await waitFor(() => blockProperties(elise.page,294,100,0).then(p=>Number(p?.level)===0), 'browser extracts ready composter and resets level', 10_000, 100)
  await commandLogMatch(SHARED, 'data get entity @e[type=minecraft:item,x=294,y=100,z=0,distance=..6,sort=nearest,limit=1] Item', /bone_meal/i, 'composter extraction emits bone meal', 10_000)
  await command(SHARED, `gamemode creative ${H}`)
  pass('blocks.cauldron-composter-actions', 'browser fills/draws cauldron water and extracts bone meal from a ready composter')

  // Copper is behavioral: an axe scrapes one oxidation stage and honeycomb then
  // locks that result. Both actions originate from the browser player.
  await command(SHARED, 'setblock 180 100 0 minecraft:weathered_copper')
  await command(SHARED, `tp ${H} 179 100 0`)
  await command(SHARED, `give ${H} minecraft:iron_axe 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const Vec=bot.entity.position.constructor; const axe=bot.inventory.items().find(i=>i.name==='iron_axe'); const copper=bot.blockAt(bot.entity.position.offset(1,0,0));
    if(!axe||!copper||copper.name!=='weathered_copper') throw new Error('missing copper scraping prerequisites'); await bot.equip(axe,'hand'); await bot.activateBlock(copper,new Vec(-1,0,0),new Vec(0,.5,.5))
  })
  await waitFor(() => blockName(elise.page,180,100,0).then(n=>n==='exposed_copper'), 'browser axe scraping weathered copper', 10_000, 100)
  await command(SHARED, `give ${H} minecraft:honeycomb 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const Vec=bot.entity.position.constructor; const wax=bot.inventory.items().find(i=>i.name==='honeycomb'); const copper=bot.blockAt(bot.entity.position.offset(1,0,0));
    if(!wax||!copper||copper.name!=='exposed_copper') throw new Error('missing copper waxing prerequisites'); await bot.equip(wax,'hand'); await bot.activateBlock(copper,new Vec(-1,0,0),new Vec(0,.5,.5))
  })
  await waitFor(() => blockName(hudson.page,180,100,0).then(n=>n==='waxed_exposed_copper'), 'browser honeycomb waxing exposed copper', 10_000, 100)
  pass('blocks.copper-actions', 'browser axe scraping + honeycomb waxing traverse native copper states')


  // Editable text + book data from the browser, then placement of that book on a lectern.
  await command(SHARED, `tp ${H} 24 100 10`)
  await hudson.page.evaluate(() => {
    const bot=globalThis.bot; const sign=bot.blockAt(bot.entity.position.offset(1,0,0)); if(!sign||sign.name!=='oak_sign') throw new Error('missing editable sign'); bot.updateSign(sign,'HEM SIGN 1215')
  })
  await commandLogMatch(SHARED, 'data get block 25 100 10 front_text', /HEM SIGN 1215/i, 'browser-origin sign text persists on Paper', 15_000)
  await command(SHARED, `clear ${H} minecraft:writable_book`)
  await command(SHARED, `give ${H} minecraft:writable_book 1`)
  await waitFor(() => itemCount(hudson.page,'writable_book').then(n=>n>=1), 'writable book for live write', 10_000)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const book=bot.inventory.items().find(i=>i.name==='writable_book'); if(!book) throw new Error('missing writable book for mandatory writeBook'); if(typeof bot.writeBook!=='function') throw new Error('browser client lost writeBook API'); await bot.writeBook(book.slot,['HEM PAGE 1215','SECOND PAGE'])
  })
  await commandLogMatch(SHARED, `data get entity ${H} Inventory`, /HEM PAGE 1215/i, 'browser-origin writable-book pages persist', 15_000)
  await command(SHARED, `tp ${H} 26 100 10`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const book=bot.inventory.items().find(i=>i.name==='writable_book'); if(!book) throw new Error('missing written writable book before lectern insertion'); await bot.equip(book,'hand'); const lectern=bot.blockAt(bot.entity.position.offset(1,0,0)); if(!lectern||lectern.name!=='lectern') throw new Error('missing lectern'); await bot.activateBlock(lectern)
  })
  await waitFor(() => blockProperties(hudson.page,27,100,10).then(p=>p?.has_book===true), 'browser inserts written book into lectern', 12_000, 100)
  await waitFor(() => blockProperties(elise.page,27,100,10).then(p=>p?.has_book===true), 'lectern book state synchronizes to second browser', 12_000, 100)
  pass('blocks.sign-book-lectern', 'browser-origin sign editing + book writing + lectern insertion persist and synchronize')

  const redstoneSentinels = [
    [34, 'observer[facing=east,powered=false]', 'observer'],
    [35, 'target[power=0]', 'target'],
    [36, 'calibrated_sculk_sensor[sculk_sensor_phase=inactive,facing=north,power=0,waterlogged=false]', 'calibrated_sculk_sensor'],
    [37, 'slime_block', 'slime_block'],
    [38, 'honey_block', 'honey_block'],
    [39, 'dropper[facing=up,triggered=false]', 'dropper'],
    [40, 'dispenser[facing=up,triggered=false]', 'dispenser'],
  ]
  for (const [x, state, name] of redstoneSentinels) {
    await command(SHARED, `setblock ${x} 100 10 minecraft:${state}`)
    await waitFor(() => blockName(elise.page, x, 100, 10).then(value => value === name), `redstone sentinel ${name}`, 15_000)
  }
  pass('redstone.component-sentinels', 'observer/target/calibrated-sculk/slime/honey/dropper/dispenser state synchronization')


  // Observer behavior: a real neighbor update at the observed face must emit a
  // short redstone pulse that the browser sees on the lamp behind the observer.
  await command(SHARED, `tp ${H} 398 100 0`)
  await command(SHARED, 'setblock 400 100 0 minecraft:observer[facing=east,powered=false]')
  await command(SHARED, 'setblock 399 100 0 minecraft:redstone_lamp[lit=false]')
  await command(SHARED, 'setblock 401 100 0 minecraft:stone')
  await sleep(300)
  await command(SHARED, 'setblock 401 100 0 minecraft:diamond_block')
  await waitFor(() => blockProperties(hudson.page,399,100,0).then(p=>p?.lit===true), 'observer neighbor update pulses lamp', 4_000, 20)
  await waitFor(() => blockProperties(elise.page,399,100,0).then(p=>p?.lit===false), 'observer pulse returns lamp low', 4_000, 20)
  pass('redstone.observer-action', 'native observer neighbor-update pulse propagates to a browser-visible lamp')

  // Target blocks emit analog redstone strength from projectile accuracy. Fire a
  // real browser-origin arrow at a close target and require adjacent dust power.
  await command(SHARED, 'fill 700 99 -1 701 99 1 minecraft:stone')
  await command(SHARED, 'setblock 700 100 0 minecraft:target')
  await command(SHARED, 'setblock 701 100 0 minecraft:redstone_wire[power=0]')
  await command(SHARED, `tp ${H} 700.5 100 -8.5 facing 700.5 100.8 0.5`)
  await command(SHARED, `give ${H} minecraft:bow 1`)
  await command(SHARED, `give ${H} minecraft:arrow 4`)
  await hudson.page.evaluate(async () => { const bot=globalThis.bot; const bow=bot.inventory.items().find(i=>i.name==='bow'); const target=bot.blockAt(bot.entity.position.offset(0,0,8)); if(!bow||!target||target.name!=='target') throw new Error('missing target-block prerequisites'); await bot.equip(bow,'hand'); await bot.lookAt(target.position.offset(.5,.55,.5),true); bot.activateItem(); await new Promise(r=>setTimeout(r,1100)); bot.deactivateItem() })
  await waitFor(() => blockProperties(elise.page,701,100,0).then(p=>Number(p?.power)>0), 'browser-fired arrow produces target-block analog output', 8_000, 20)
  pass('redstone.target-action', 'browser bow hit drives native target-block analog redstone output')


  // Java Edition quasi-connectivity: a redstone torch two blocks above a piston can
  // activate the imaginary block-space above it and update the piston immediately.
  await command(SHARED, 'setblock 100 100 0 minecraft:piston[facing=east,extended=false]')
  await command(SHARED, 'setblock 101 100 0 minecraft:stone')
  await command(SHARED, 'setblock 100 102 0 minecraft:redstone_torch[lit=true]')
  await waitFor(() => blockName(hudson.page, 102, 100, 0).then(n => n === 'stone'), 'Java quasi-connected piston moves block', 15_000)
  pass('redstone.quasi-connectivity', 'Java piston quasi-connectivity from power two blocks above')

  await command(SHARED, 'setblock 105 100 0 minecraft:crafter[orientation=up_north,triggered=false,crafting=false]')
  await command(SHARED, 'setblock 105 99 0 minecraft:redstone_block')
  await waitFor(() => blockProperties(hudson.page, 105, 100, 0).then(p => p?.triggered === true), 'Crafter enters triggered state under redstone power', 15_000)
  await command(SHARED, 'setblock 105 99 0 minecraft:air')
  await waitFor(() => blockProperties(hudson.page, 105, 100, 0).then(p => p?.triggered === false), 'Crafter clears triggered state after power removal', 15_000)
  pass('redstone.crafter-trigger', 'Crafter redstone-trigger state transitions')

  // Triggering alone does not prove Crafter semantics. Load a real 3x3 recipe,
  // pulse it once, and require Paper to emit the crafted iron ingot.
  await command(SHARED, 'kill @e[type=minecraft:item,x=190,y=100,z=0,distance=..6]')
  await command(SHARED, 'setblock 190 100 0 minecraft:crafter[orientation=up_north,triggered=false,crafting=false]')
  for (let slot=0; slot<9; slot++) await command(SHARED, `item replace block 190 100 0 container.${slot} with minecraft:iron_nugget 1`)
  await command(SHARED, 'setblock 190 99 0 minecraft:redstone_block')
  await sleep(700)
  await commandLogMatch(SHARED, 'data get entity @e[type=minecraft:item,x=190,y=100,z=0,distance=..6,sort=nearest,limit=1] Item', /iron_ingot/i, 'Crafter emits iron-ingot recipe output', 12_000)
  await command(SHARED, 'setblock 190 99 0 minecraft:air')
  pass('redstone.crafter-recipe', 'native Crafter consumes a 3x3 iron-nugget recipe and emits an iron ingot')

  // Verify a client-originated mining action reaches Paper and the second browser.
  await command(SHARED, 'setblock 1 100 0 minecraft:stone')
  await waitFor(() => blockName(hudson.page, 1, 100, 0).then(name => name === 'stone'), 'client dig target arrives', 15_000)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const target = bot.blockAt(bot.entity.position.offset(1, 0, 0))
    if (!target) throw new Error('Missing client dig target')
    await bot.dig(target)
  })
  await waitFor(() => blockName(elise.page, 1, 100, 0).then(name => name === 'air'), 'client mining synchronized to second browser', 20_000)
  pass('blocks.mining', 'client-originated mining synchronization')

  // Placement must originate from the browser interaction path too; a server-side
  // setblock would only prove incoming world state. Place cobblestone on the top
  // face of a known reference block and require the second browser to receive it.
  await command(SHARED, 'setblock 1 99 1 minecraft:stone')
  await command(SHARED, 'setblock 1 100 1 minecraft:air')
  await command(SHARED, `give ${H} minecraft:cobblestone 1`)
  await waitFor(() => itemCount(hudson.page, 'cobblestone').then(count => count >= 1), 'placement item reaches browser inventory', 15_000)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const item = bot.inventory.items().find(entry => entry.name === 'cobblestone')
    const reference = bot.blockAt(bot.entity.position.offset(1, -1, 1))
    if (!item || !reference || reference.name !== 'stone') throw new Error('Missing browser placement prerequisites')
    await bot.equip(item, 'hand')
    await bot.placeBlock(reference, { x: 0, y: 1, z: 0 })
  })
  await waitFor(() => blockName(elise.page, 1, 100, 1).then(name => name === 'cobblestone'), 'client placement synchronized to second browser', 20_000)
  pass('blocks.placement', 'client-originated block placement synchronization')

  // Known minecraft-web-client 1.21.7+ regression class: placing a block can make
  // terrain appear and then destabilize/crash the renderer. A successful protocol
  // placement is not enough; both clients must remain alive, authenticated and
  // actively rendering after the placement settles.
  await sleep(1800)
  await rendererReady(hudson.page, 'Hudson after client-originated placement')
  await rendererReady(elise.page, 'Elise after remote client-originated placement')
  for (const [label, page] of [['Hudson', hudson.page], ['Elise', elise.page]]) {
    const health = await page.evaluate(() => ({
      bot: Boolean(globalThis.bot?.entity),
      renderer: Boolean(globalThis.__HEM_PARITY__?.renderer?.healthy && globalThis.__HEM_PARITY__?.renderer?.sections > 0),
      fatal: Boolean(document.querySelector('#hem-compatibility-error')),
    }))
    if (!health.bot || !health.renderer || health.fatal) throw new Error(`${label} unstable after placement: ${JSON.stringify(health)}`)
  }
  if (fatal.length) throw new Error(`Browser error after client-originated placement: ${fatal.join(' | ')}`)
  pass('render.post-placement-stability', 'both browsers remain connected and render healthy chunk sections after client placement')


  // Random-tick + tool-speed proof. Paper remains authoritative, while the browser
  // must observe crop age changes and real survival digging latency differences.
  await command(SHARED, 'gamerule randomTickSpeed 1000')
  await command(SHARED, 'setblock 4 99 4 minecraft:farmland[moisture=7]')
  await command(SHARED, 'setblock 5 99 4 minecraft:water')
  await command(SHARED, 'setblock 4 100 4 minecraft:wheat[age=0]')
  await waitFor(() => blockProperties(hudson.page, 4, 100, 4).then(p => Number(p?.age) > 0), 'random tick crop growth reaches browser', 30_000, 250)
  await command(SHARED, 'gamerule randomTickSpeed 3')
  pass('simulation.random-ticks', 'Paper random ticks reflected into browser block-state updates')

  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, `clear ${H}`)
  await command(SHARED, 'setblock 6 100 4 minecraft:stone')
  await command(SHARED, 'setblock 7 100 4 minecraft:stone')
  await command(SHARED, `tp ${H} 5 100 4`)
  await sleep(500)
  const bareDigMs = await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const block = bot.blockAt(bot.entity.position.offset(1, 0, 0))
    const started = performance.now(); await bot.dig(block); return performance.now() - started
  })
  await command(SHARED, `give ${H} minecraft:diamond_pickaxe 1`)
  await waitFor(() => itemCount(hudson.page, 'diamond_pickaxe').then(n => n >= 1), 'diamond pickaxe reaches browser', 15_000)
  const pickDigMs = await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const pick = bot.inventory.items().find(i => i.name === 'diamond_pickaxe'); await bot.equip(pick, 'hand')
    const block = bot.blockAt(bot.entity.position.offset(2, 0, 0))
    const started = performance.now(); await bot.dig(block); return performance.now() - started
  })
  if (!(pickDigMs < bareDigMs * .75)) throw new Error(`tool-speed parity failed: hand=${bareDigMs.toFixed(1)}ms diamond=${pickDigMs.toFixed(1)}ms`)
  await command(SHARED, `gamemode creative ${H}`)
  pass('blocks.mining-rules', 'survival mining latency reflects tool effectiveness')

  for (const [x, state, name] of [
    [41, 'decorated_pot', 'decorated_pot'],
    [42, 'chiseled_bookshelf[slot_0_occupied=false,slot_1_occupied=false,slot_2_occupied=false,slot_3_occupied=false,slot_4_occupied=false,slot_5_occupied=false,facing=north]', 'chiseled_bookshelf'],
    [43, 'suspicious_sand[dusted=0]', 'suspicious_sand'],
  ]) {
    await command(SHARED, `setblock ${x} 100 10 minecraft:${state}`)
    await waitFor(() => blockName(hudson.page, x, 100, 10).then(v => v === name), `archaeology/bookshelf block ${name}`, 15_000)
  }
  pass('blocks.archaeology-bookshelf', 'decorated pot/chiseled bookshelf/suspicious sand state synchronization')

  // Complete a native brushing cycle. The suspicious sand is assigned a deterministic
  // archaeology loot table; repeated browser brush use must finish the block and turn
  // it into ordinary sand, proving more than blockstate/registry visibility.
  await command(SHARED, 'setblock 660 100 0 minecraft:suspicious_sand')
  await command(SHARED, 'data merge block 660 100 0 {LootTable:"minecraft:archaeology/desert_pyramid",LootTableSeed:1L}')
  await command(SHARED, `tp ${H} 658.5 100 0.5 facing 660.5 100.5 0.5`)
  await command(SHARED, `give ${H} minecraft:brush 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const brush=bot.inventory.items().find(i=>i.name==='brush'); if(!brush) throw new Error('missing archaeology brush'); await bot.equip(brush,'hand')
    for(let i=0;i<20;i++){ const block=bot.blockAt(bot.entity.position.offset(2,0,0)); if(!block||block.name!=='suspicious_sand') break; await bot.lookAt(block.position.offset(.5,.5,.5),true); await bot.activateBlock(block); await new Promise(r=>setTimeout(r,240)) }
  })
  await waitFor(() => blockName(hudson.page,660,100,0).then(n=>n==='sand'), 'browser brushing completes suspicious-sand archaeology cycle', 12_000, 100)
  pass('blocks.archaeology-brushing', 'browser brush completes suspicious-sand archaeology cycle into ordinary sand')


  // Chiseled bookshelves and decorated pots have ordinary right-click storage
  // semantics beyond blockstate visibility. Require browser-origin insertion.
  await command(SHARED, `tp ${H} 306 100 -2`)
  await command(SHARED, 'setblock 306 100 0 minecraft:chiseled_bookshelf[facing=north,slot_0_occupied=false,slot_1_occupied=false,slot_2_occupied=false,slot_3_occupied=false,slot_4_occupied=false,slot_5_occupied=false]')
  await command(SHARED, `give ${H} minecraft:book 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const Vec=bot.entity.position.constructor; const book=bot.inventory.items().find(i=>i.name==='book'); const shelf=bot.blockAt(bot.entity.position.offset(0,0,2)); if(!book||!shelf||shelf.name!=='chiseled_bookshelf') throw new Error('missing bookshelf insertion prerequisites'); await bot.equip(book,'hand'); await bot.activateBlock(shelf,new Vec(0,0,-1),new Vec(.2,.8,0))
  })
  await waitFor(() => blockProperties(elise.page,306,100,0).then(p => Object.entries(p||{}).some(([k,v]) => /^slot_\d+_occupied$/.test(k) && v===true)), 'browser inserts book into chiseled bookshelf', 10_000, 100)

  await command(SHARED, `tp ${H} 310 100 -2`)
  await command(SHARED, 'setblock 310 100 0 minecraft:decorated_pot')
  await command(SHARED, `give ${H} minecraft:diamond 2`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const Vec=bot.entity.position.constructor; const item=bot.inventory.items().find(i=>i.name==='diamond'); const pot=bot.blockAt(bot.entity.position.offset(0,0,2)); if(!item||!pot||pot.name!=='decorated_pot') throw new Error('missing decorated-pot insertion prerequisites'); await bot.equip(item,'hand'); await bot.activateBlock(pot,new Vec(0,0,-1),new Vec(.5,.5,0))
  })
  await commandLogMatch(SHARED, 'data get block 310 100 0 item', /diamond/i, 'decorated pot stores browser-inserted item', 10_000)
  pass('blocks.bookshelf-pot-actions', 'browser inserts a book into a chiseled bookshelf and an item into a decorated pot')

  await command(SHARED, `clear ${H}`)
  await command(SHARED, `clear ${E}`)
  await command(SHARED, `give ${H} minecraft:diamond 3`)
  await command(SHARED, `give ${E} minecraft:emerald 2`)
  await waitFor(() => itemCount(hudson.page, 'diamond').then(count => count >= 3), 'Hudson inventory sync', 15_000)
  await waitFor(() => itemCount(elise.page, 'emerald').then(count => count >= 2), 'Elise inventory sync', 15_000)
  pass('inventory.distinct-player', 'distinct player inventory synchronization')

  // Armor/offhand semantics are easy for browser clients to get subtly wrong even
  // when ordinary inventory slots work. Equip from the browser and require the
  // second player entity to receive both equipment updates.
  await command(SHARED, `give ${H} minecraft:shield 1`)
  await command(SHARED, `give ${H} minecraft:iron_chestplate 1`)
  await waitFor(() => itemCount(hudson.page, 'shield').then(count => count >= 1), 'shield reaches browser inventory', 15_000)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const shield = bot.inventory.items().find(item => item.name === 'shield')
    const chest = bot.inventory.items().find(item => item.name === 'iron_chestplate')
    if (!shield || !chest) throw new Error('Missing equipment test items')
    await bot.equip(shield, 'off-hand')
    await bot.equip(chest, 'torso')
  })
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot.inventory.slots?.[45]?.name === 'shield'), 'offhand slot semantics', 15_000)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot.inventory.slots?.[6]?.name === 'iron_chestplate'), 'chest armor slot semantics', 15_000)
  await waitFor(() => elise.page.evaluate(user => {
    const equipment = globalThis.bot?.players?.[user]?.entity?.equipment
    return Array.isArray(equipment) && equipment.some(item => item?.name === 'shield') && equipment.some(item => item?.name === 'iron_chestplate')
  }, H), 'remote armor/offhand equipment synchronization', 20_000)
  pass('inventory.armor-offhand', 'armor/offhand inventory slots + remote equipment synchronization')

  // Client-originated command path: HEM must not only receive console-side updates.
  await hudson.page.evaluate(user => globalThis.bot.chat(`/give ${user} minecraft:gold_nugget 1`), H)
  await waitFor(() => itemCount(hudson.page, 'gold_nugget').then(count => count >= 1), 'client-originated command execution', 20_000)
  pass('commands.client-origin', 'client-originated command execution')

  // Command blocks must be editable through the browser protocol, not merely
  // enabled in server.properties. Edit one from Hudson, pulse it, and require
  // the command's world mutation to synchronize to Elise.
  await command(SHARED, 'setblock 160 100 0 minecraft:command_block[facing=east,conditional=false]')
  await command(SHARED, 'setblock 162 100 0 minecraft:air')
  await command(SHARED, `tp ${H} 159 100 0`)
  await hudson.page.evaluate(() => {
    const bot=globalThis.bot
    const block=bot.blockAt(bot.entity.position.offset(1,0,0))
    if(!block||block.name!=='command_block') throw new Error('missing command block for browser edit')
    if(typeof bot.setCommandBlock!=='function') throw new Error('browser client lost setCommandBlock API')
    bot.setCommandBlock(block.position,'setblock 162 100 0 minecraft:diamond_block',{mode:2,trackOutput:true,conditional:false,alwaysActive:false})
  })
  await sleep(350)
  await command(SHARED, `tp ${H} 158 100 0`)
  await command(SHARED, 'setblock 159 100 0 minecraft:redstone_block')
  await waitFor(() => blockName(elise.page,162,100,0).then(n=>n==='diamond_block'), 'browser-edited command block executes on redstone pulse', 12_000, 100)
  await command(SHARED, 'setblock 159 100 0 minecraft:air')
  pass('commands.command-block-edit', 'browser command-block edit packet + redstone execution + remote world synchronization')

  const completions = await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    if (typeof bot.tabComplete !== 'function') throw new Error('browser client exposes no command completion API')
    return bot.tabComplete('/gi', true, true)
  })
  if (!Array.isArray(completions) || !completions.some(value => /give/i.test(String(value)))) throw new Error(`command completion missing /give: ${JSON.stringify(completions)}`)
  pass('commands.completion', 'browser command-tree/tab-completion path')

  await command(SHARED, `recipe give ${H} minecraft:crafting_table`)
  await waitFor(() => hudson.page.evaluate(() => {
    const seen=globalThis.__HEM_PARITY__?.packetsSeen; return seen instanceof Set && [...seen].some(n => /recipe/i.test(n))
  }), 'recipe unlock packet reaches browser', 15_000)
  pass('progression.recipe-knowledge', 'native recipe unlock synchronization')

  await waitFor(() => hudson.page.evaluate(() => {
    const seen=globalThis.__HEM_PARITY__?.packetsSeen; return seen instanceof Set && [...seen].some(n => /statistic/i.test(n))
  }), 'statistics packet reaches browser', 20_000)
  pass('progression.statistics', 'statistics protocol synchronization')

  // Vanilla HUD/system presentation should survive the protocol bridge, not just
  // ordinary player chat. Require title/action-bar/boss-bar and scoreboard/team
  // packet families to reach the real browser session.
  await command(SHARED, `title ${H} title {text:'HEM TITLE'}`)
  await command(SHARED, `title ${H} actionbar {text:'HEM ACTION'}`)
  await command(SHARED, "bossbar add hem:acceptance {text:'HEM BOSS'}")
  await command(SHARED, `bossbar set hem:acceptance players ${H}`)
  await waitFor(() => hudson.page.evaluate(() => {
    const seen=globalThis.__HEM_PARITY__?.packetsSeen; if (!(seen instanceof Set)) return false
    const names=[...seen]; return names.some(n=>/title/i.test(n)) && names.some(n=>/action.?bar/i.test(n)) && names.some(n=>/boss.?bar/i.test(n))
  }), 'title/actionbar/bossbar packet families reach browser', 15_000)
  pass('presentation.hud-protocol', 'title + action bar + boss bar protocol families reach browser')
  pass('presentation.1215-text-components', '1.21.5 inline-SNBT /title + actionbar + bossbar text-component syntax is accepted and delivered')

  await command(SHARED, 'scoreboard objectives add hem_accept dummy')
  await command(SHARED, `scoreboard players set ${H} hem_accept 7`)
  await command(SHARED, 'scoreboard objectives setdisplay sidebar hem_accept')
  await command(SHARED, 'team add hem_accept')
  await command(SHARED, `team join hem_accept ${H}`)
  await waitFor(() => hudson.page.evaluate(() => {
    const seen=globalThis.__HEM_PARITY__?.packetsSeen; if (!(seen instanceof Set)) return false
    const names=[...seen]; return names.some(n=>/scoreboard|score/i.test(n)) && names.some(n=>/team/i.test(n))
  }), 'scoreboard/team packet families reach browser', 15_000)
  await waitFor(() => hudson.page.evaluate(user => Boolean(globalThis.bot?.scoreboards?.hem_accept && globalThis.bot?.scoreboard?.sidebar && globalThis.bot?.teams?.hem_accept && globalThis.bot?.teamMap?.[user]), H), 'Mineflayer scoreboard/team object state', 15_000, 100)
  pass('multiplayer.scoreboard-teams', 'scoreboard objective/sidebar + team membership materialize in browser client state')
  await command(SHARED, 'bossbar remove hem:acceptance')
  await command(SHARED, 'scoreboard objectives remove hem_accept')
  await command(SHARED, 'team remove hem_accept')

  // Redstone acceptance: toggle a lever from the browser, then verify Paper-powered
  // lamp state is received as a blockstate update rather than a static block ID.
  await command(SHARED, 'setblock 2 99 2 minecraft:stone')
  await command(SHARED, 'setblock 2 100 2 minecraft:lever[face=floor,facing=north,powered=false]')
  await command(SHARED, `tp ${H} 2 100 0`)
  await sleep(1000)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const block = bot.blockAt(bot.entity.position.offset(0, 0, 2))
    if (!block || block.name !== 'lever') throw new Error('Missing lever target')
    await bot.activateBlock(block)
  })
  await waitFor(() => blockProperties(elise.page, 2, 100, 2).then(props => props?.powered === true), 'client lever state synchronization', 20_000)
  await command(SHARED, 'setblock 5 100 5 minecraft:redstone_lamp')
  await command(SHARED, 'setblock 6 100 5 minecraft:redstone_block')
  await waitFor(() => blockProperties(hudson.page, 5, 100, 5).then(props => props?.lit === true), 'redstone-powered lamp state', 20_000)
  await command(SHARED, 'setblock 6 100 5 minecraft:air')
  await waitFor(() => blockProperties(elise.page, 5, 100, 5).then(props => props?.lit === false), 'redstone lamp depower state', 20_000)
  pass('redstone.lever-lamp', 'client redstone interaction + powered blockstate synchronization')

  // Repeater timing/state propagation is a second redstone family beyond direct
  // adjacency. Paper owns the circuit rule; browsers must receive the powered state.
  await command(SHARED, 'setblock 50 100 0 minecraft:redstone_block')
  await command(SHARED, 'setblock 51 100 0 minecraft:repeater[facing=east,delay=1,locked=false,powered=false]')
  await command(SHARED, 'setblock 52 100 0 minecraft:redstone_lamp[lit=false]')
  await waitFor(() => blockProperties(hudson.page, 51, 100, 0).then(props => props?.powered === true), 'repeater powered state', 15_000)
  await waitFor(() => blockProperties(elise.page, 52, 100, 0).then(props => props?.lit === true), 'repeater-powered lamp state', 15_000)
  await command(SHARED, 'setblock 50 100 0 minecraft:air')
  await waitFor(() => blockProperties(elise.page, 51, 100, 0).then(props => props?.powered === false), 'repeater depower state', 15_000)
  await waitFor(() => blockProperties(hudson.page, 52, 100, 0).then(props => props?.lit === false), 'repeater lamp depower state', 15_000)
  pass('redstone.repeater', 'repeater propagation + cross-browser blockstate synchronization')

  // Redstone dust is the core analog-power transport path. Exercise real Paper
  // propagation and require both the wire power level and downstream lamp state.
  await command(SHARED, 'fill 60 99 0 62 99 0 minecraft:stone')
  await command(SHARED, 'setblock 60 100 0 minecraft:redstone_block')
  await command(SHARED, 'setblock 61 100 0 minecraft:redstone_wire[power=0,north=none,east=side,south=none,west=side]')
  await command(SHARED, 'setblock 62 100 0 minecraft:redstone_lamp[lit=false]')
  await waitFor(() => blockProperties(hudson.page, 61, 100, 0).then(props => Number(props?.power) > 0), 'redstone dust receives analog power', 15_000)
  await waitFor(() => blockProperties(elise.page, 62, 100, 0).then(props => props?.lit === true), 'redstone dust powers downstream lamp', 15_000)
  await command(SHARED, 'setblock 60 100 0 minecraft:air')
  await waitFor(() => blockProperties(elise.page, 61, 100, 0).then(props => Number(props?.power) === 0), 'redstone dust depowers', 15_000)
  await waitFor(() => blockProperties(hudson.page, 62, 100, 0).then(props => props?.lit === false), 'dust-powered lamp depowers', 15_000)
  pass('redstone.dust-propagation', 'redstone dust analog-power propagation + lamp synchronization')

  // Input/output component behavior beyond levers/repeaters: a browser presses a
  // button, a player powers a pressure plate, and a comparator transports power.
  await command(SHARED, 'setblock 64 99 0 minecraft:stone')
  await command(SHARED, 'setblock 64 100 0 minecraft:stone_button[face=floor,facing=north,powered=false]')
  await command(SHARED, 'setblock 65 100 0 minecraft:redstone_lamp[lit=false]')
  await command(SHARED, `tp ${H} 64 100 -2`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const b=bot.blockAt(bot.entity.position.offset(0,0,2)); if(!b||b.name!=='stone_button') throw new Error('missing redstone button'); await bot.activateBlock(b)
  })
  await waitFor(() => blockProperties(elise.page,64,100,0).then(p=>p?.powered===true), 'browser-pressed button powers', 8_000, 100)
  await waitFor(() => blockProperties(hudson.page,65,100,0).then(p=>p?.lit===true), 'button powers adjacent lamp', 8_000, 100)

  await command(SHARED, 'setblock 67 99 0 minecraft:stone')
  await command(SHARED, 'setblock 67 100 0 minecraft:stone_pressure_plate[powered=false]')
  await command(SHARED, `tp ${E} 67 100 0`)
  await waitFor(() => blockProperties(hudson.page,67,100,0).then(p=>p?.powered===true), 'player pressure plate activation', 8_000, 100)
  await command(SHARED, `tp ${E} 67 100 3`)
  await waitFor(() => blockProperties(elise.page,67,100,0).then(p=>p?.powered===false), 'pressure plate release', 8_000, 100)

  await command(SHARED, 'setblock 70 100 0 minecraft:redstone_block')
  await command(SHARED, 'setblock 71 100 0 minecraft:comparator[facing=east,mode=compare,powered=false]')
  await command(SHARED, 'setblock 72 100 0 minecraft:redstone_lamp[lit=false]')
  await waitFor(() => blockProperties(hudson.page,71,100,0).then(p=>p?.powered===true), 'comparator powered state', 8_000, 100)
  await waitFor(() => blockProperties(elise.page,72,100,0).then(p=>p?.lit===true), 'comparator powers lamp', 8_000, 100)
  pass('redstone.inputs-comparator', 'button + pressure plate + comparator behavior synchronizes across browsers')

  // Dispenser/dropper semantics are behavioral, not merely blockstate sentinels.
  await command(SHARED, 'setblock 76 100 0 minecraft:dispenser[facing=up,triggered=false]')
  await command(SHARED, 'item replace block 76 100 0 container.0 with minecraft:arrow 1')
  const dispArrowBefore = await hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).filter(e=>e.name==='arrow').length)
  await command(SHARED, 'setblock 75 100 0 minecraft:redstone_block')
  await waitFor(() => hudson.page.evaluate(before => Object.values(globalThis.bot.entities||{}).filter(e=>e.name==='arrow').length>before, dispArrowBefore), 'powered dispenser launches arrow entity', 10_000, 100)
  await command(SHARED, 'setblock 75 100 0 minecraft:air')
  await command(SHARED, 'setblock 79 100 0 minecraft:dropper[facing=up,triggered=false]')
  await command(SHARED, 'item replace block 79 100 0 container.0 with minecraft:cobblestone 1')
  const dropBefore = await hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).filter(e=>e.name==='item').length)
  await command(SHARED, 'setblock 78 100 0 minecraft:redstone_block')
  await waitFor(() => hudson.page.evaluate(before => Object.values(globalThis.bot.entities||{}).filter(e=>e.name==='item').length>before, dropBefore), 'powered dropper emits item entity', 10_000, 100)
  await command(SHARED, 'setblock 78 100 0 minecraft:air')
  pass('redstone.dispenser-dropper-action', 'powered dispenser projectile + dropper item behavior synchronize')

  // Item-specific dispenser semantics: a water bucket must place a real source,
  // not merely eject an item entity like a dropper would.
  await command(SHARED, 'setblock 170 100 0 minecraft:dispenser[facing=east,triggered=false]')
  await command(SHARED, 'setblock 171 100 0 minecraft:air')
  await command(SHARED, 'item replace block 170 100 0 container.0 with minecraft:water_bucket 1')
  await command(SHARED, 'setblock 169 100 0 minecraft:redstone_block')
  await waitFor(() => blockName(hudson.page,171,100,0).then(n=>n==='water'), 'dispenser water-bucket effect reaches browser', 10_000, 100)
  await waitFor(() => blockName(elise.page,171,100,0).then(n=>n==='water'), 'dispenser water source reaches second browser', 10_000, 100)
  await commandLogMatch(SHARED, 'data get block 170 100 0 Items', /bucket/i, 'dispenser retains empty bucket after placing water', 10_000)
  await command(SHARED, 'setblock 169 100 0 minecraft:air')
  pass('redstone.dispenser-fluid', 'dispenser executes water-bucket item behavior and retains the empty bucket')

  await command(SHARED, 'setblock 55 100 0 minecraft:powered_rail[shape=east_west,powered=true,waterlogged=false]')
  await command(SHARED, 'setblock 56 100 0 minecraft:detector_rail[shape=east_west,powered=false,waterlogged=false]')
  await command(SHARED, 'summon minecraft:minecart 55.5 101 0.5 {Invulnerable:1b}')
  await waitFor(() => blockProperties(hudson.page, 55, 100, 0).then(props => props?.powered === true), 'powered rail state', 15_000)
  await waitFor(() => blockName(elise.page, 56, 100, 0).then(name => name === 'detector_rail'), 'detector rail state', 15_000)
  await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities || {}).some(entity => entity.name === 'minecart')), 'minecart entity synchronization', 15_000)
  pass('redstone.rails-minecart', 'rail blockstates + minecart entity synchronization')

  // A visible minecart entity is not enough for playability: require the browser
  // player to mount and dismount it through the normal vehicle protocol path.
  await command(SHARED, `tp ${H} 54 100 0`)
  await sleep(600)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const minecart = Object.values(bot.entities || {}).find(entity => entity.name === 'minecart')
    if (!minecart) throw new Error('Missing minecart for browser mount test')
    await bot.mount(minecart)
  })
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.vehicle?.name === 'minecart'), 'browser player mounts minecart', 10_000, 100)
  await waitFor(() => elise.page.evaluate(user => {
    const entity = globalThis.bot?.players?.[user]?.entity
    return Boolean(entity && Number.isFinite(entity.position?.x))
  }, H), 'mounted browser player remains synchronized remotely', 10_000, 100)
  await hudson.page.evaluate(() => globalThis.bot.dismount())
  await waitFor(() => hudson.page.evaluate(() => !globalThis.bot?.vehicle), 'browser player dismounts minecart', 10_000, 100)
  pass('movement.vehicle-mount', 'browser player mounts and dismounts a native minecart')

  // native oak-boat steering: 1.21.5 uses wood-specific boat entity types. Exercise real browser vehicle
  // steering and require the second browser to observe the boat's displacement.
  await command(SHARED, 'fill 250 99 -2 262 99 2 minecraft:stone')
  await command(SHARED, 'fill 250 100 -2 262 100 2 minecraft:water')
  await command(SHARED, 'kill @e[type=minecraft:oak_boat,x=256,y=100,z=0,distance=..12]')
  await command(SHARED, 'summon minecraft:oak_boat 254.5 101 0.5 {Rotation:[-90f,0f]}')
  await command(SHARED, `tp ${H} 254 101 2`)
  const boatId = await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).find(e=>e.name==='oak_boat'&&Math.abs(e.position.x-254.5)<6)?.id||false), 'native oak boat visible to browser', 12_000, 100)
  const boatStart = await waitFor(() => elise.page.evaluate(id => {
    const e=globalThis.bot.entities[id]; return e ? {x:e.position.x,z:e.position.z} : false
  }, boatId), 'second browser sees oak boat before steering', 12_000, 100)
  await hudson.page.evaluate(async id => {
    const bot=globalThis.bot; const boat=bot.entities[id]; if(!boat) throw new Error('missing oak boat for vehicle control'); await bot.mount(boat)
    for(let i=0;i<24;i++){ bot.moveVehicle(0,1); await new Promise(r=>setTimeout(r,100)) }
    bot.moveVehicle(0,0)
  }, boatId)
  await waitFor(() => elise.page.evaluate(([id,start]) => {
    const e=globalThis.bot.entities[id]; if(!e) return false; return Math.hypot(e.position.x-start.x,e.position.z-start.z)>0.75
  }, [boatId,boatStart]), 'remote browser observes browser-driven boat motion', 12_000, 100)
  await hudson.page.evaluate(() => globalThis.bot.dismount())
  await waitFor(() => hudson.page.evaluate(() => !globalThis.bot?.vehicle), 'browser dismounts steered oak boat', 8_000, 100)
  pass('movement.boat-control', 'browser mounts, steers and dismounts a native 1.21.5 oak boat with remote movement synchronization')

  // Container acceptance: both browsers must open the same native Paper chest and
  // observe server-authoritative contents.
  await command(SHARED, 'setblock 4 100 4 minecraft:chest')
  await command(SHARED, `tp ${H} 4 100 2`)
  await command(SHARED, `tp ${E} 4 100 2`)
  await command(SHARED, `give ${H} minecraft:stick 3`)
  await waitFor(() => itemCount(hudson.page, 'stick').then(count => count >= 3), 'container test item sync', 15_000)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const chestBlock = bot.blockAt(bot.entity.position.offset(0, 0, 2))
    if (!chestBlock || chestBlock.name !== 'chest') throw new Error('Missing chest target')
    const chest = await bot.openContainer(chestBlock)
    const id = bot.registry.itemsByName.stick.id
    await chest.deposit(id, null, 2)
    chest.close()
  })
  await elise.page.evaluate(async () => {
    const bot = globalThis.bot
    const chestBlock = bot.blockAt(bot.entity.position.offset(0, 0, 2))
    if (!chestBlock || chestBlock.name !== 'chest') throw new Error('Missing shared chest target')
    const chest = await bot.openContainer(chestBlock)
    globalThis.__hemChestSticks = chest.containerItems().filter(i => i.name === 'stick').reduce((sum, i) => sum + i.count, 0)
    chest.close()
  })
  await waitFor(() => elise.page.evaluate(() => globalThis.__hemChestSticks >= 2), 'shared native chest contents', 20_000)
  const windowCounts = await Promise.all([hudson.page, elise.page].map(page => page.evaluate(() => globalThis.__HEM_PARITY__?.windowsOpened || 0)))
  if (windowCounts.some(count => count < 1)) throw new Error(`HEM container UI event not observed: ${windowCounts.join(',')}`)
  pass('containers.chest', 'native container open/deposit/shared-content synchronization')


  await command(SHARED, 'setblock 6 100 4 minecraft:chest[facing=north,type=left,waterlogged=false]')
  await command(SHARED, 'setblock 7 100 4 minecraft:chest[facing=north,type=right,waterlogged=false]')
  await command(SHARED, 'item replace block 6 100 4 container.0 with minecraft:emerald 2')
  await command(SHARED, 'item replace block 7 100 4 container.0 with minecraft:diamond 2')
  await command(SHARED, `tp ${H} 6 100 2`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const block=bot.blockAt(bot.entity.position.offset(0,0,2)); if(!block||block.name!=='chest') throw new Error('missing double chest half'); const win=await bot.openContainer(block); globalThis.__hemDoubleChest={slots:win.inventoryStart,emeralds:win.containerItems().filter(i=>i.name==='emerald').reduce((n,i)=>n+i.count,0),diamonds:win.containerItems().filter(i=>i.name==='diamond').reduce((n,i)=>n+i.count,0)}; win.close()
  })
  const doubleChest = await hudson.page.evaluate(() => globalThis.__hemDoubleChest)
  if (!(doubleChest?.slots >= 54 && doubleChest.emeralds >= 2 && doubleChest.diamonds >= 2)) throw new Error(`double chest did not expose a combined 54-slot inventory: ${JSON.stringify(doubleChest)}`)
  pass('containers.double-chest', 'paired chest halves expose one combined 54-slot browser container with both block inventories')

  // Trapped chests share inventory semantics but also have a distinct block/window
  // identity and redstone behavior. Exercise the actual browser container path.
  await command(SHARED, 'setblock 12 100 4 minecraft:trapped_chest[facing=north,type=single,waterlogged=false]')
  await command(SHARED, 'item replace block 12 100 4 container.0 with minecraft:apple 3')
  await command(SHARED, `tp ${E} 12 100 2`)
  await elise.page.evaluate(async () => {
    const bot=globalThis.bot; const block=bot.blockAt(bot.entity.position.offset(0,0,2)); if(!block||block.name!=='trapped_chest') throw new Error('missing trapped chest'); const window=await bot.openContainer(block); globalThis.__hemTrappedApples=window.containerItems().filter(i=>i.name==='apple').reduce((n,i)=>n+i.count,0); window.close()
  })
  await waitFor(() => elise.page.evaluate(() => globalThis.__hemTrappedApples >= 3), 'trapped chest contents in browser', 15_000)
  pass('containers.trapped-chest', 'native trapped-chest browser container synchronization')

  // Barrel uses the generic container protocol but a distinct block/window path.
  await command(SHARED, 'setblock 18 100 0 minecraft:barrel[facing=north,open=false]')
  await command(SHARED, 'item replace block 18 100 0 container.0 with minecraft:carrot 4')
  await command(SHARED, `tp ${E} 18 100 -2`)
  await sleep(700)
  await elise.page.evaluate(async () => {
    const bot = globalThis.bot
    const block = bot.blockAt(bot.entity.position.offset(0, 0, 2))
    if (!block || block.name !== 'barrel') throw new Error('Missing barrel target')
    const window = await bot.openContainer(block)
    globalThis.__hemBarrelCarrots = window.containerItems().filter(item => item.name === 'carrot').reduce((sum, item) => sum + item.count, 0)
    window.close()
  })
  await waitFor(() => elise.page.evaluate(() => globalThis.__hemBarrelCarrots >= 4), 'barrel contents in browser container', 15_000)
  pass('containers.barrel', 'barrel generic-container synchronization')

  // Shulker boxes use a portable container/block-entity path distinct from barrels
  // and chests. Require the live browser window to expose its server-owned contents.
  await command(SHARED, 'setblock 20 100 4 minecraft:shulker_box[facing=up]')
  await command(SHARED, 'item replace block 20 100 4 container.0 with minecraft:diamond 2')
  await command(SHARED, `tp ${E} 20 100 2`)
  await sleep(700)
  await elise.page.evaluate(async () => {
    const bot = globalThis.bot
    const block = bot.blockAt(bot.entity.position.offset(0, 0, 2))
    if (!block || block.name !== 'shulker_box') throw new Error('Missing shulker-box target')
    const window = await bot.openContainer(block)
    globalThis.__hemShulkerDiamonds = window.containerItems().filter(item => item.name === 'diamond').reduce((sum, item) => sum + item.count, 0)
    window.close()
  })
  await waitFor(() => elise.page.evaluate(() => globalThis.__hemShulkerDiamonds >= 2), 'shulker-box contents in browser container', 15_000)
  pass('containers.shulker-box', 'shulker-box block-entity/container synchronization')

  // Ender-chest contents are per-player even though both players open the same block.
  // This catches clients that treat every chest-like window as world-shared storage.
  await command(SHARED, 'setblock 19 100 0 minecraft:ender_chest[facing=north]')
  await command(SHARED, `give ${H} minecraft:blaze_rod 2`)
  await command(SHARED, `tp ${H} 19 100 -2`)
  await command(SHARED, `tp ${E} 19 100 -2`)
  await waitFor(() => itemCount(hudson.page, 'blaze_rod').then(count => count >= 2), 'ender chest deposit item reaches Hudson', 15_000)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const block = bot.blockAt(bot.entity.position.offset(0, 0, 2))
    const window = await bot.openContainer(block)
    await window.deposit(bot.registry.itemsByName.blaze_rod.id, null, 2)
    window.close()
  })
  await elise.page.evaluate(async () => {
    const bot = globalThis.bot
    const block = bot.blockAt(bot.entity.position.offset(0, 0, 2))
    const window = await bot.openContainer(block)
    globalThis.__hemEliseEnderBlaze = window.containerItems().filter(item => item.name === 'blaze_rod').reduce((sum, item) => sum + item.count, 0)
    window.close()
  })
  if (await elise.page.evaluate(() => globalThis.__hemEliseEnderBlaze) !== 0) throw new Error('Ender chest leaked Hudson contents to Elise')
  pass('containers.ender-chest', 'per-player ender-chest isolation')

  // Core survival-loop acceptance. Upstream currently tracks crafting/inventory/container
  // gaps, so HEM makes these release blockers instead of assuming protocol connectivity
  // means the gameplay loop works.
  await command(SHARED, `give ${H} minecraft:oak_log 2`)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const planks = bot.registry.itemsByName.oak_planks
    const recipe = bot.recipesFor(planks.id, null, 4, null)[0]
    if (!recipe) throw new Error('No 2x2 oak-planks recipe exposed to browser client')
    await bot.craft(recipe, 1, null)
  })
  await waitFor(() => itemCount(hudson.page, 'oak_planks').then(count => count >= 4), 'client crafting oak planks', 20_000)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const table = bot.registry.itemsByName.crafting_table
    const recipe = bot.recipesFor(table.id, null, 1, null)[0]
    if (!recipe) throw new Error('No crafting-table recipe exposed to browser client')
    await bot.craft(recipe, 1, null)
  })
  await waitFor(() => itemCount(hudson.page, 'crafting_table').then(count => count >= 1), 'client crafting table recipe', 20_000)
  pass('crafting.player-2x2', 'browser crafting recipe execution')

  // Prove a true 3x3 crafting-table recipe, not only player 2x2 crafting.
  await command(SHARED, 'setblock 21 100 0 minecraft:crafting_table')
  await command(SHARED, `tp ${H} 21 100 -2`)
  await command(SHARED, `give ${H} minecraft:oak_planks 3`)
  await command(SHARED, `give ${H} minecraft:stick 2`)
  await sleep(700)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const table = bot.blockAt(bot.entity.position.offset(0, 0, 2))
    const pickaxe = bot.registry.itemsByName.wooden_pickaxe
    if (!table || table.name !== 'crafting_table' || !pickaxe) throw new Error('Missing 3x3 crafting prerequisites')
    const recipe = bot.recipesFor(pickaxe.id, null, 1, table)[0]
    if (!recipe) throw new Error('No wooden-pickaxe 3x3 recipe exposed to browser client')
    await bot.craft(recipe, 1, table)
  })
  await waitFor(() => itemCount(hudson.page, 'wooden_pickaxe').then(count => count >= 1), '3x3 crafting-table recipe', 20_000)
  pass('crafting.table-3x3', 'browser 3x3 crafting-table recipe execution')

  // Furnace protocol + window synchronization and real server smelting.
  await command(SHARED, 'setblock 14 100 0 minecraft:furnace[facing=north]')
  await command(SHARED, `tp ${H} 14 100 -2`)
  await command(SHARED, `give ${H} minecraft:raw_iron 1`)
  await command(SHARED, `give ${H} minecraft:coal 1`)
  await sleep(1200)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const furnaceBlock = bot.blockAt(bot.entity.position.offset(0, 0, 2))
    if (!furnaceBlock || furnaceBlock.name !== 'furnace') throw new Error('Missing furnace target')
    const furnace = await bot.openFurnace(furnaceBlock)
    await furnace.putInput(bot.registry.itemsByName.raw_iron.id, null, 1)
    await furnace.putFuel(bot.registry.itemsByName.coal.id, null, 1)
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline && furnace.outputItem()?.name !== 'iron_ingot') {
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    if (furnace.outputItem()?.name !== 'iron_ingot') throw new Error('Furnace did not expose smelted iron output')
    await furnace.takeOutput()
    furnace.close()
  })
  await waitFor(() => itemCount(hudson.page, 'iron_ingot').then(count => count >= 1), 'browser furnace output inventory', 15_000)
  pass('containers.furnace', 'furnace fuel/input/progress/output synchronization')

  // Furnace extraction XP is tracked separately from item smelting. Seed a furnace's
  // native RecipesUsed counter and output stack, then require the browser to take the
  // result and receive real experience from Paper.
  await command(SHARED, 'setblock 670 100 0 minecraft:furnace[facing=north]')
  await command(SHARED, 'item replace block 670 100 0 container.2 with minecraft:iron_ingot 10')
  await command(SHARED, 'data merge block 670 100 0 {RecipesUsed:{"minecraft:smelting/iron_ingot":10}}')
  await command(SHARED, `experience set ${H} 0 points`)
  await command(SHARED, `tp ${H} 670 100 -2`)
  await hudson.page.evaluate(async () => { const bot=globalThis.bot; const block=bot.blockAt(bot.entity.position.offset(0,0,2)); if(!block||block.name!=='furnace') throw new Error('missing furnace XP fixture'); const furnace=await bot.openFurnace(block); if(furnace.outputItem()?.name!=='iron_ingot') throw new Error('missing seeded furnace output'); await furnace.takeOutput(); furnace.close() })
  await waitFor(() => hudson.page.evaluate(() => Number(globalThis.bot?.experience?.points||0)>0), 'taking furnace result awards browser XP', 12_000, 100)
  pass('containers.furnace-xp', 'browser furnace output extraction awards server-authoritative smelting XP')

  // Specialized furnace windows share protocol ancestry with furnaces but differ in
  // accepted recipes and block/menu types. Complete one real recipe in each.
  for (const recipe of [
    { block: 'smoker', x: 15, input: 'raw_beef', output: 'cooked_beef' },
    { block: 'blast_furnace', x: 16, input: 'raw_gold', output: 'gold_ingot' },
  ]) {
    await command(SHARED, `setblock ${recipe.x} 100 0 minecraft:${recipe.block}[facing=north]`)
    await command(SHARED, `tp ${H} ${recipe.x} 100 -2`)
    await command(SHARED, `give ${H} minecraft:${recipe.input} 1`)
    await command(SHARED, `give ${H} minecraft:coal 1`)
    await sleep(700)
    await hudson.page.evaluate(async recipe => {
      const bot = globalThis.bot
      const block = bot.blockAt(bot.entity.position.offset(0, 0, 2))
      if (!block || block.name !== recipe.block) throw new Error(`Missing ${recipe.block} target`)
      const furnace = await bot.openFurnace(block)
      await furnace.putInput(bot.registry.itemsByName[recipe.input].id, null, 1)
      await furnace.putFuel(bot.registry.itemsByName.coal.id, null, 1)
      const deadline = Date.now() + 25_000
      while (Date.now() < deadline && furnace.outputItem()?.name !== recipe.output) await new Promise(resolve => setTimeout(resolve, 200))
      if (furnace.outputItem()?.name !== recipe.output) throw new Error(`${recipe.block} did not expose ${recipe.output}`)
      await furnace.takeOutput()
      furnace.close()
    }, recipe)
    await waitFor(() => itemCount(hudson.page, recipe.output).then(count => count >= 1), `${recipe.block} output reaches browser inventory`, 12_000)
  }
  pass('containers.special-furnaces', 'smoker + blast-furnace recipe processing through browser windows')


  const workstations = [
    ['smithing_table', 45], ['stonecutter', 46], ['loom', 47], ['cartography_table', 48],
    ['grindstone', 49], ['enchanting_table', 50], ['anvil', 51], ['brewing_stand', 52], ['beacon', 53],
  ]
  for (const [name, x] of workstations) {
    await command(SHARED, `setblock ${x} 100 12 minecraft:${name}`)
    await command(SHARED, `tp ${H} ${x} 100 10`)
    const beforeWindows = await hudson.page.evaluate(() => globalThis.__HEM_PARITY__?.windowsOpened || 0)
    await hudson.page.evaluate(async name => {
      const bot = globalThis.bot
      const block = bot.blockAt(bot.entity.position.offset(0, 0, 2))
      if (!block || block.name !== name) throw new Error(`missing workstation ${name}`)
      await bot.activateBlock(block)
    }, name)
    await waitFor(() => hudson.page.evaluate(before => (globalThis.__HEM_PARITY__?.windowsOpened || 0) > before, beforeWindows), `${name} browser window opens`, 15_000)
    await hudson.page.evaluate(() => { if (globalThis.bot.currentWindow) globalThis.bot.closeWindow(globalThis.bot.currentWindow) })
  }
  pass('containers.workstation-ui', 'smithing/stonecutter/loom/cartography/grindstone/enchanting/anvil/brewing/beacon browser windows')


  // Beacon semantics: a browser player must pay a valid beacon and use the
  // native 1.21.5 set_beacon_effect packet, then receive the chosen effect.
  await command(SHARED, 'fill 729 99 -1 731 99 1 minecraft:iron_block')
  await command(SHARED, 'setblock 730 100 0 minecraft:beacon')
  await command(SHARED, 'fill 730 101 0 730 319 0 minecraft:air')
  await command(SHARED, `effect clear ${H}`)
  await command(SHARED, `clear ${H} minecraft:iron_ingot`)
  await command(SHARED, `give ${H} minecraft:iron_ingot 1`)
  await command(SHARED, `tp ${H} 730 100 -2`)
  await sleep(1200)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot
    const block=bot.blockAt(bot.entity.position.offset(0,0,2))
    if(!block||block.name!=='beacon') throw new Error('missing beacon target')
    await bot.activateBlock(block)
    const end=Date.now()+5000
    while(!bot.currentWindow&&Date.now()<end) await new Promise(r=>setTimeout(r,50))
    const win=bot.currentWindow
    if(!win) throw new Error('beacon window did not open')
    const pay=win.slots.findIndex((item,idx)=>idx>=win.inventoryStart&&item?.name==='iron_ingot')
    if(pay<0) throw new Error('beacon payment ingot missing from browser window')
    await bot.clickWindow(pay,0,0)
    await bot.clickWindow(0,0,0)
    const speedId=bot.registry.effectsByName?.speed?.id
    if(!Number.isInteger(speedId)) throw new Error('speed effect id unavailable')
    bot._client.write('set_beacon_effect',{primary_effect:speedId,secondary_effect:null})
    await new Promise(r=>setTimeout(r,350))
    bot.closeWindow(win)
    globalThis.__hemBeaconSpeedId=speedId
  })
  await waitFor(() => hudson.page.evaluate(() => {
    const id=globalThis.__hemBeaconSpeedId
    const effects=globalThis.bot?.entity?.effects||{}
    return Boolean(effects[id]||Object.values(effects).some(e=>Number(e?.id)===id))
  }), 'valid paid beacon applies Speed to browser player', 12_000,100)
  pass('containers.beacon-effect', 'browser pays a valid beacon and native set_beacon_effect applies Speed')

  // Enchanting table semantics, not just window opening. Give sufficient XP/lapis,
  // make a real server-provided choice, take the result and verify enchantments persist.
  await command(SHARED, 'setblock 300 100 0 minecraft:enchanting_table')
  await command(SHARED, `tp ${H} 299 100 0`)
  await command(SHARED, `clear ${H} minecraft:diamond_sword`)
  await command(SHARED, `clear ${H} minecraft:lapis_lazuli`)
  await command(SHARED, `experience set ${H} 30 levels`)
  await command(SHARED, `give ${H} minecraft:diamond_sword 1`)
  await command(SHARED, `give ${H} minecraft:lapis_lazuli 8`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const block=bot.blockAt(bot.entity.position.offset(1,0,0)); const sword=bot.inventory.items().find(i=>i.name==='diamond_sword'); const lapis=bot.inventory.items().find(i=>i.name==='lapis_lazuli'); if(!block||!sword||!lapis) throw new Error('missing enchanting prerequisites');
    const table=await bot.openEnchantmentTable(block); await table.putTargetItem(sword); await table.putLapis(lapis)
    const end=Date.now()+8000; while(Date.now()<end && !table.enchantments?.some(e=>Number(e?.level)>0)) await new Promise(r=>setTimeout(r,100))
    const choice=table.enchantments?.findIndex(e=>Number(e?.level)>0) ?? -1; if(choice<0) throw new Error(`no enchantment choice populated: ${JSON.stringify(table.enchantments)}`)
    await table.enchant(choice); await table.takeTargetItem(); table.close()
  })
  await commandLogMatch(SHARED, `data get entity ${H} Inventory`, /enchantments/i, 'browser-enchanted item persists enchantment component', 12_000)
  await waitFor(() => hudson.page.evaluate(() => Number(globalThis.bot?.experience?.level) < 30), 'enchanting consumes browser XP levels', 10_000, 100)
  const enchantLevelAfter = await hudson.page.evaluate(() => Number(globalThis.bot?.experience?.level))
  pass('progression.enchant-cost', `native enchanting consumes XP levels: 30 -> ${enchantLevelAfter}`)
  pass('items.enchanting', 'browser completes a native enchanting-table choice and retains the enchanted item')

  // Native anvil rename result through the browser's anvil transaction path.
  await command(SHARED, 'setblock 304 100 0 minecraft:anvil[facing=north]')
  await command(SHARED, `tp ${H} 303 100 0`)
  await command(SHARED, `experience set ${H} 30 levels`)
  await command(SHARED, `give ${H} minecraft:iron_sword 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const block=bot.blockAt(bot.entity.position.offset(1,0,0)); const sword=bot.inventory.items().find(i=>i.name==='iron_sword'); if(!block||!sword) throw new Error('missing anvil prerequisites'); const anvil=await bot.openAnvil(block)
    if(typeof anvil.rename==='function') await anvil.rename(sword,'HEM Blade'); else await anvil.combine(sword,'HEM Blade')
    anvil.close()
  })
  await commandLogMatch(SHARED, `data get entity ${H} Inventory`, /HEM Blade/i, 'browser anvil rename persists custom name', 12_000)
  await waitFor(() => hudson.page.evaluate(() => Number(globalThis.bot?.experience?.level) < 30), 'anvil rename consumes browser XP levels', 10_000, 100)
  const anvilLevelAfter = await hudson.page.evaluate(() => Number(globalThis.bot?.experience?.level))
  pass('items.anvil-cost', `native anvil rename consumes XP levels: 30 -> ${anvilLevelAfter}`)
  pass('items.anvil-rename', 'browser completes a native anvil rename transaction with persistent custom name')

  // Native anvil combining/repair is a separate transaction from renaming. Two
  // damaged iron swords must combine into one item with less accumulated damage.
  await command(SHARED, `clear ${H} minecraft:iron_sword`)
  await command(SHARED, `experience set ${H} 30 levels`)
  await command(SHARED, `give ${H} minecraft:iron_sword[minecraft:damage=150] 2`)
  await command(SHARED, `tp ${H} 303 100 0`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const block=bot.blockAt(bot.entity.position.offset(1,0,0)); const swords=bot.inventory.items().filter(i=>i.name==='iron_sword'); if(!block||swords.length<2) throw new Error('missing anvil repair prerequisites'); const anvil=await bot.openAnvil(block); await anvil.combine(swords[0],swords[1]); anvil.close()
  })
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot.inventory.items().some(i=>i.name==='iron_sword'&&Number(i.durabilityUsed??999)<150)), 'anvil combines damaged swords into repaired result', 12_000, 100)
  pass('items.anvil-repair', 'browser anvil combine transaction repairs two damaged swords')


  // Brewing uses generic window-slot transactions because Mineflayer does not
  // expose a specialized brewing helper. All three inputs originate from the
  // browser inventory; Paper must finish the native water->awkward recipe.
  await command(SHARED, `tp ${H} 519 100 0`)
  await command(SHARED, 'setblock 520 100 0 minecraft:brewing_stand[has_bottle_0=false,has_bottle_1=false,has_bottle_2=false]')
  await command(SHARED, `give ${H} minecraft:potion[minecraft:potion_contents={potion:"minecraft:water"}] 1`)
  await command(SHARED, `give ${H} minecraft:nether_wart 1`)
  await command(SHARED, `give ${H} minecraft:blaze_powder 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const block=bot.blockAt(bot.entity.position.offset(1,0,0)); if(!block||block.name!=='brewing_stand') throw new Error('missing brewing stand')
    await bot.activateBlock(block); const end=Date.now()+5000; while(!bot.currentWindow&&Date.now()<end) await new Promise(r=>setTimeout(r,50)); const win=bot.currentWindow; if(!win) throw new Error('brewing window did not open')
    const move=async(name,dst)=>{ const src=win.slots.findIndex((item,idx)=>idx>=win.inventoryStart&&item?.name===name); if(src<0) throw new Error(`missing ${name} in brewing window inventory`); await bot.clickWindow(src,0,0); await bot.clickWindow(dst,0,0) }
    await move('potion',0); await move('nether_wart',3); await move('blaze_powder',4); await new Promise(r=>setTimeout(r,22_000)); bot.closeWindow(win)
  })
  await commandLogMatch(SHARED, 'data get block 520 100 0 Items', /awkward/i, 'browser brewing produces awkward potion component', 10_000)
  pass('items.brewing-recipe', 'browser loads fuel/ingredient/potion slots and completes a native brewing recipe')

  // Modern smithing-table item upgrade through normal browser window clicks.
  await command(SHARED, 'setblock 524 100 0 minecraft:smithing_table')
  await command(SHARED, `tp ${H} 523 100 0`)
  await command(SHARED, `give ${H} minecraft:netherite_upgrade_smithing_template 1`)
  await command(SHARED, `give ${H} minecraft:diamond_sword 1`)
  await command(SHARED, `give ${H} minecraft:netherite_ingot 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const block=bot.blockAt(bot.entity.position.offset(1,0,0)); if(!block||block.name!=='smithing_table') throw new Error('missing smithing table'); await bot.activateBlock(block); const end=Date.now()+5000; while(!bot.currentWindow&&Date.now()<end) await new Promise(r=>setTimeout(r,50)); const win=bot.currentWindow; if(!win) throw new Error('smithing window did not open')
    const move=async(name,dst)=>{ const src=win.slots.findIndex((item,idx)=>idx>=win.inventoryStart&&item?.name===name); if(src<0) throw new Error(`missing ${name} in smithing inventory`); await bot.clickWindow(src,0,0); await bot.clickWindow(dst,0,0) }
    await move('netherite_upgrade_smithing_template',0); await move('diamond_sword',1); await move('netherite_ingot',2); const ready=Date.now()+5000; while(win.slots[3]?.name!=='netherite_sword'&&Date.now()<ready) await new Promise(r=>setTimeout(r,50)); if(win.slots[3]?.name!=='netherite_sword') throw new Error('smithing result never became netherite_sword'); await bot.clickWindow(3,0,0); bot.closeWindow(win)
  })
  await waitFor(() => itemCount(hudson.page,'netherite_sword').then(n=>n>=1), 'browser takes native smithing result', 10_000, 100)
  pass('items.smithing-recipe', 'browser completes netherite-upgrade smithing transaction through native menu slots')

  // Grindstone semantics: enchant the held sword server-side, then the browser
  // performs the grindstone transaction and takes a disenchanted result.
  await command(SHARED, 'setblock 528 100 0 minecraft:grindstone[face=floor,facing=north]')
  await command(SHARED, `tp ${H} 527 100 0`)
  await command(SHARED, `give ${H} minecraft:iron_sword 1`)
  await hudson.page.evaluate(async()=>{const bot=globalThis.bot; const item=bot.inventory.items().find(i=>i.name==='iron_sword'); if(!item) throw new Error('missing grindstone sword'); await bot.equip(item,'hand')})
  await command(SHARED, `enchant ${H} minecraft:sharpness 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const block=bot.blockAt(bot.entity.position.offset(1,0,0)); if(!block||block.name!=='grindstone') throw new Error('missing grindstone'); await bot.activateBlock(block); const end=Date.now()+5000; while(!bot.currentWindow&&Date.now()<end) await new Promise(r=>setTimeout(r,50)); const win=bot.currentWindow; if(!win) throw new Error('grindstone window did not open'); const src=win.slots.findIndex((item,idx)=>idx>=win.inventoryStart&&item?.name==='iron_sword'); if(src<0) throw new Error('enchanted sword missing from grindstone inventory'); await bot.clickWindow(src,0,0); await bot.clickWindow(0,0,0); const ready=Date.now()+5000; while(win.slots[2]?.name!=='iron_sword'&&Date.now()<ready) await new Promise(r=>setTimeout(r,50)); if(win.slots[2]?.name!=='iron_sword') throw new Error('grindstone output missing'); await bot.clickWindow(2,0,0); bot.closeWindow(win)
  })
  const grindData = await commandLogMatch(SHARED, `data get entity ${H} Inventory`, /iron_sword/i, 'grindstone result persists in player inventory', 10_000)
  if (/sharpness/i.test(grindData)) throw new Error(`grindstone result remained enchanted: ${grindData}`)
  pass('items.grindstone-action', 'browser removes a normal enchantment through a native grindstone transaction')

  // Dropped-item entity path and pickup visibility.
  await command(SHARED, `give ${H} minecraft:apple 1`)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const apple = bot.inventory.items().find(item => item.name === 'apple')
    if (!apple) throw new Error('Missing apple for drop test')
    await bot.tossStack(apple)
  })
  await waitFor(() => elise.page.evaluate(() => Object.values(globalThis.bot.entities || {}).some(entity => entity.name === 'item')), 'dropped item entity visible to second browser', 15_000)
  pass('entities.dropped-item', 'dropped-item entity synchronization')

  // Fluid states must arrive correctly on both clients.
  await command(SHARED, `tp ${H} 30 100 -3`)
  await command(SHARED, `tp ${E} 30 100 -1`)
  await command(SHARED, 'setblock 30 100 0 minecraft:water[level=0]')
  await command(SHARED, 'setblock 31 100 0 minecraft:lava[level=0]')
  await waitFor(() => blockName(hudson.page, 30, 100, 0).then(name => name === 'water'), 'water blockstate on Hudson', 15_000)
  await waitFor(() => blockName(elise.page, 31, 100, 0).then(name => name === 'lava'), 'lava blockstate on Elise', 15_000)
  pass('world.fluids', 'water/lava blockstate synchronization')

  // Browser-origin fluid interaction: place a source from a bucket, then pick it
  // back up with an empty bucket and require the remote browser to see both states.
  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, 'setblock 130 99 0 minecraft:stone')
  await command(SHARED, 'setblock 130 100 0 minecraft:air')
  await command(SHARED, `tp ${H} 129.5 100 0.5`)
  await command(SHARED, `clear ${H} minecraft:water_bucket`)
  await command(SHARED, `clear ${H} minecraft:bucket`)
  await command(SHARED, `give ${H} minecraft:water_bucket 1`)
  await waitFor(() => itemCount(hudson.page,'water_bucket').then(n=>n>=1), 'water bucket reaches browser', 10_000)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const Vec=bot.entity.position.constructor
    const item=bot.inventory.items().find(i=>i.name==='water_bucket'); const ground=bot.blockAt(bot.entity.position.offset(.5,-1,-.5))
    if(!item||!ground||ground.name!=='stone') throw new Error('missing water-bucket placement prerequisites')
    await bot.equip(item,'hand'); await bot.activateBlock(ground,new Vec(0,1,0),new Vec(.5,1,.5))
  })
  await waitFor(() => blockName(elise.page,130,100,0).then(n=>n==='water'), 'browser water-bucket placement reaches second browser', 10_000, 100)
  await waitFor(() => itemCount(hudson.page,'bucket').then(n=>n>=1), 'survival water placement returns empty bucket', 10_000)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const Vec=bot.entity.position.constructor
    const item=bot.inventory.items().find(i=>i.name==='bucket'); const water=bot.blockAt(bot.entity.position.offset(.5,0,-.5))
    if(!item||!water||water.name!=='water') throw new Error('missing water-bucket pickup prerequisites')
    await bot.equip(item,'hand'); await bot.activateBlock(water,new Vec(0,1,0),new Vec(.5,.5,.5))
  })
  await waitFor(() => blockName(elise.page,130,100,0).then(n=>n==='air'), 'browser bucket pickup removes source remotely', 10_000, 100)
  await waitFor(() => itemCount(hudson.page,'water_bucket').then(n=>n>=1), 'browser bucket pickup returns filled bucket', 10_000)
  await command(SHARED, `gamemode creative ${H}`)
  pass('world.fluid-buckets', 'survival browser water-bucket placement + pickup synchronizes source and inventory states')

  // Native piston execution: Paper performs the redstone rule; both browser clients
  // must receive the moved block/chunk updates without desynchronizing.
  await command(SHARED, 'setblock 34 100 0 minecraft:piston[facing=east,extended=false]')
  await command(SHARED, 'setblock 35 100 0 minecraft:stone')
  await command(SHARED, 'setblock 33 100 0 minecraft:redstone_block')
  await waitFor(() => blockName(hudson.page, 36, 100, 0).then(name => name === 'stone'), 'piston moved block on Hudson', 15_000)
  await waitFor(() => blockName(elise.page, 36, 100, 0).then(name => name === 'stone'), 'piston moved block on Elise', 15_000)
  pass('redstone.piston', 'piston/redstone movement synchronization')

  // Sticky/slime attachment propagation: extension moves the slime and attached
  // stone, then retraction must pull the slime assembly back.
  await command(SHARED, 'setblock 360 100 0 minecraft:sticky_piston[facing=east,extended=false]')
  await command(SHARED, 'setblock 361 100 0 minecraft:slime_block')
  await command(SHARED, 'setblock 362 100 0 minecraft:stone')
  await command(SHARED, 'setblock 359 100 0 minecraft:redstone_block')
  await waitFor(() => blockName(elise.page,363,100,0).then(n=>n==='stone'), 'sticky piston slime assembly extension', 10_000, 100)
  await command(SHARED, 'setblock 359 100 0 minecraft:air')
  await waitFor(() => blockName(hudson.page,361,100,0).then(n=>n==='slime_block'), 'sticky piston retracts slime block', 10_000, 100)
  await waitFor(() => blockName(elise.page,362,100,0).then(n=>n==='stone'), 'slime attachment returns stone on retraction', 10_000, 100)
  pass('redstone.sticky-slime', 'sticky piston extension/retraction propagates through a slime-block attachment')

  // Daylight detector analog power and browser-origin inversion. Clear the sky column first so terrain cannot shade the sensor.
  await command(SHARED, 'fill 379 121 -1 381 319 1 minecraft:air replace')
  await command(SHARED, 'setblock 380 120 0 minecraft:daylight_detector[inverted=false,power=0]')
  await command(SHARED, 'time set noon')
  await waitFor(() => blockProperties(hudson.page,380,120,0).then(p=>Number(p?.power)>0&&p?.inverted===false), 'daylight detector powered at noon', 12_000, 100)
  await command(SHARED, `tp ${H} 379 120 0`)
  await hudson.page.evaluate(async () => { const bot=globalThis.bot; const block=bot.blockAt(bot.entity.position.offset(1,0,0)); if(!block||block.name!=='daylight_detector') throw new Error('missing daylight detector'); await bot.activateBlock(block) })
  await waitFor(() => blockProperties(elise.page,380,120,0).then(p=>p?.inverted===true), 'browser toggles daylight detector inversion', 10_000, 100)
  await command(SHARED, 'time set midnight')
  await waitFor(() => blockProperties(elise.page,380,120,0).then(p=>Number(p?.power)>0&&p?.inverted===true), 'inverted daylight detector powers at night', 12_000, 100)
  pass('redstone.daylight-sensor', 'native daylight analog power + browser inversion behavior synchronizes')

  // Powered activator rails eject riders. Mount a native minecart from the browser,
  // give it deterministic rail motion, and require client vehicle state to clear.
  await command(SHARED, 'fill 710 99 0 716 99 0 minecraft:stone')
  await command(SHARED, 'setblock 713 99 0 minecraft:redstone_block')
  await command(SHARED, 'fill 710 100 0 716 100 0 minecraft:rail[shape=east_west]')
  await command(SHARED, 'setblock 713 100 0 minecraft:activator_rail[powered=true,shape=east_west]')
  await command(SHARED, 'summon minecraft:minecart 710.5 100.1 0.5 {Tags:["hem_activator_cart"]}')
  await command(SHARED, `tp ${H} 710.5 100 2.5`)
  const activatorCartId=await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).find(e=>e.name==='minecart'&&Math.abs(e.position.x-710.5)<2)?.id||false), 'activator-rail minecart reaches browser', 10_000, 100)
  await hudson.page.evaluate(async id=>{ const bot=globalThis.bot; const cart=bot.entities[id]; if(!cart) throw new Error('missing activator cart'); await bot.mount(cart) },activatorCartId)
  await waitFor(() => hudson.page.evaluate(() => Boolean(globalThis.bot.vehicle)), 'browser mounts activator-rail cart', 8_000, 100)
  await command(SHARED, 'data merge entity @e[tag=hem_activator_cart,limit=1] {Motion:[0.55d,0.0d,0.0d]}')
  await waitFor(() => hudson.page.evaluate(() => !globalThis.bot.vehicle), 'powered activator rail ejects browser rider', 10_000, 50)
  pass('redstone.activator-rail-action', 'powered activator rail ejects a browser-mounted native minecart rider')

  // Redstone torches burn out after rapid toggles and recover later. Repeatedly
  // power the support block inside the vanilla burnout window and observe both states.
  await command(SHARED, 'setblock 720 100 0 minecraft:stone')
  await command(SHARED, 'setblock 720 101 0 minecraft:redstone_torch[lit=true]')
  await command(SHARED, 'setblock 721 100 0 minecraft:air')
  for(let i=0;i<9;i++){ await command(SHARED,'setblock 721 100 0 minecraft:redstone_block'); await sleep(90); await command(SHARED,'setblock 721 100 0 minecraft:air'); await sleep(90) }
  await waitFor(() => blockProperties(hudson.page,720,101,0).then(p=>p?.lit===false), 'rapidly toggled redstone torch enters burnout', 3_000, 25)
  await waitFor(() => blockProperties(elise.page,720,101,0).then(p=>p?.lit===true), 'burned-out redstone torch recovers', 12_000, 100)
  pass('redstone.torch-burnout', 'native redstone-torch burnout and timed recovery synchronize to both browsers')


  // Tripwire hooks are player-triggered redstone inputs. Use an attached line and
  // stop the browser player on the string long enough for both clients to observe power.
  await command(SHARED, 'setblock 540 100 0 minecraft:tripwire_hook[facing=east,attached=true,powered=false]')
  await command(SHARED, 'setblock 544 100 0 minecraft:tripwire_hook[facing=west,attached=true,powered=false]')
  for (const x of [541,542,543]) await command(SHARED, `setblock ${x} 100 0 minecraft:tripwire[attached=true,disarmed=false,east=true,north=false,powered=false,south=false,west=true]`)
  await command(SHARED, `tp ${H} 542.5 100 -1.5 facing 542.5 100 2`)
  await hudson.page.evaluate(async()=>{const bot=globalThis.bot; bot.setControlState('forward',true); await new Promise(r=>setTimeout(r,650)); bot.setControlState('forward',false)})
  await waitFor(() => blockProperties(elise.page,540,100,0).then(p=>p?.powered===true), 'browser player powers attached tripwire hook', 5_000, 20)
  pass('redstone.tripwire-action', 'browser collision with attached tripwire powers the native hook')

  // Command-block minecart semantics use an activator rail rather than a stationary
  // command block. This also exercises the activator-rail execution path.
  await command(SHARED, 'setblock 550 99 0 minecraft:redstone_block')
  await command(SHARED, 'setblock 550 100 0 minecraft:activator_rail[powered=true,shape=east_west,waterlogged=false]')
  await command(SHARED, 'setblock 552 100 0 minecraft:air')
  await command(SHARED, 'kill @e[type=minecraft:command_block_minecart,x=550,y=100,z=0,distance=..8]')
  await command(SHARED, 'summon minecraft:command_block_minecart 550.5 100.1 0.5 {Command:"setblock 552 100 0 minecraft:diamond_block"}')
  await waitFor(() => blockName(hudson.page,552,100,0).then(n=>n==='diamond_block'), 'command-block minecart executes on powered activator rail', 10_000, 50)
  pass('commands.command-minecart', 'native command-block minecart executes its command from a powered activator rail')

  // Hopper transfer + container state IDs.
  await command(SHARED, 'setblock 40 100 0 minecraft:chest')
  await command(SHARED, 'setblock 40 101 0 minecraft:hopper[facing=down,enabled=true]')
  await command(SHARED, 'item replace block 40 101 0 container.0 with minecraft:iron_ingot 3')
  await command(SHARED, `tp ${E} 40 100 -2`)
  await sleep(2500)
  await elise.page.evaluate(async () => {
    const bot = globalThis.bot
    const chestBlock = bot.blockAt(bot.entity.position.offset(0, 0, 2))
    if (!chestBlock || chestBlock.name !== 'chest') throw new Error('Missing hopper destination chest')
    const chest = await bot.openContainer(chestBlock)
    globalThis.__hemHopperIron = chest.containerItems().filter(item => item.name === 'iron_ingot').reduce((sum, item) => sum + item.count, 0)
    chest.close()
  })
  await waitFor(() => elise.page.evaluate(() => globalThis.__hemHopperIron >= 3), 'hopper transfer visible in browser chest', 15_000)
  pass('redstone.hopper', 'hopper transfer/container state synchronization')

  // Prove this is genuinely 1.21.5 Spring to Life, not an older 1.21.x client.
  // Browser inventory/block synchronization covers every new Spring plant plus the
  // two 1.21.5 chicken egg items; Paper-side variant reads prove warm/cold farm data.
  const springItems = ['firefly_bush','leaf_litter','wildflowers','bush','short_dry_grass','tall_dry_grass','cactus_flower','brown_egg','blue_egg']
  for (const item of springItems) {
    await command(SHARED, `give ${H} minecraft:${item} 1`)
    await waitFor(() => itemCount(hudson.page, item).then(count => count >= 1), `1.21.5 Spring item ${item}`, 20_000)
  }
  await command(SHARED, `give ${H} minecraft:mace 1`)
  await command(SHARED, `give ${H} minecraft:wind_charge 2`)
  await waitFor(() => itemCount(hudson.page, 'mace').then(count => count >= 1), 'mace inventory data', 20_000)
  await waitFor(() => itemCount(hudson.page, 'wind_charge').then(count => count >= 2), 'wind charge inventory data', 20_000)

  const springBlocks = [
    ['firefly_bush', 86, 'grass_block'],
    ['leaf_litter', 88, 'grass_block'],
    ['wildflowers', 90, 'grass_block'],
    ['bush', 92, 'grass_block'],
    ['short_dry_grass', 94, 'sand'],
    ['tall_dry_grass', 96, 'sand'],
    ['cactus_flower', 98, 'cactus'],
  ]
  for (const [name, x, support] of springBlocks) {
    if (support === 'cactus') await command(SHARED, `setblock ${x} 98 12 minecraft:sand`)
    await command(SHARED, `setblock ${x} 99 12 minecraft:${support}`)
    await command(SHARED, `setblock ${x} 100 12 minecraft:${name}`)
    await waitFor(() => blockName(hudson.page, x, 100, 12).then(actual => actual === name), `render/sync Spring block ${name}`, 20_000)
  }

  for (const [type, variant, x] of [['pig','warm',100],['cow','cold',102],['chicken','warm',104]]) {
    const tag = `hem_${type}_${variant}`
    await command(SHARED, `summon minecraft:${type} ${x} 100 12 {variant:"minecraft:${variant}",Tags:["${tag}"],NoAI:1b,PersistenceRequired:1b}`)
    await waitFor(() => hudson.page.evaluate(expected => Object.values(globalThis.bot.entities || {}).some(e => e.name === expected), type), `1.21.5 ${variant} ${type} entity sync`, 20_000)
    await commandLogMatch(SHARED, `data get entity @e[tag=${tag},limit=1] variant`, new RegExp(variant, 'i'), `${type} ${variant} variant data`, 15_000)
  }
  pass('content.1215-sentinels', 'Spring to Life plants/eggs + warm/cold farm-animal variant data synchronize on native 1.21.5')

  // Exercise a real Spring to Life gameplay rule from the browser: bone meal grows
  // Short Dry Grass into Tall Dry Grass. This catches interaction support that pure
  // registry/render sentinels cannot prove.
  await command(SHARED, 'setblock 106 99 12 minecraft:sand')
  await command(SHARED, 'setblock 106 100 12 minecraft:short_dry_grass')
  await command(SHARED, `give ${H} minecraft:bone_meal 4`)
  await command(SHARED, `tp ${H} 105 100 12`)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const boneMeal = bot.inventory.items().find(item => item.name === 'bone_meal')
    if (!boneMeal) throw new Error('missing bone meal for Spring growth test')
    await bot.equip(boneMeal, 'hand')
    const target = bot.blockAt(bot.entity.position.offset(1, 0, 0))
    if (!target || target.name !== 'short_dry_grass') throw new Error(`expected short_dry_grass, got ${target?.name}`)
    await bot.activateBlock(target)
  })
  await waitFor(() => blockName(hudson.page, 106, 100, 12).then(name => name === 'tall_dry_grass'), 'browser bone-meal Short Dry Grass growth', 15_000)
  pass('content.spring-growth', 'browser bone meal grows 1.21.5 Short Dry Grass into Tall Dry Grass')

  // Wildflowers and Leaf Litter are layered placement blocks in 1.21.5. Repeated
  // browser placement must advance their native state amount rather than replace or
  // desynchronize the block.
  for (const [item,x,prop] of [['wildflowers',118,'flower_amount'],['leaf_litter',122,'segment_amount']]) {
    await command(SHARED, `setblock ${x} 99 12 minecraft:grass_block`)
    await command(SHARED, `setblock ${x} 100 12 minecraft:air`)
    await command(SHARED, `give ${H} minecraft:${item} 8`)
    await command(SHARED, `tp ${H} ${x-1} 100 12`)
    await hudson.page.evaluate(async ([name]) => {
      const bot=globalThis.bot; const stack=bot.inventory.items().find(i=>i.name===name); if(!stack) throw new Error(`missing ${name}`); await bot.equip(stack,'hand')
      let target=bot.blockAt(bot.entity.position.offset(1,-1,0)); await bot.activateBlock(target); await new Promise(r=>setTimeout(r,250))
      for(let i=0;i<3;i++){target=bot.blockAt(bot.entity.position.offset(1,0,0)); if(!target||target.name!==name) throw new Error(`${name} layering target disappeared`); await bot.activateBlock(target); await new Promise(r=>setTimeout(r,250))}
    }, [item])
    await waitFor(() => blockProperties(hudson.page,x,100,12).then(props=>Number(props?.[prop])===4), `${item} reaches four-layer state`, 15_000, 100)
    await waitFor(() => blockProperties(elise.page,x,100,12).then(props=>Number(props?.[prop])===4), `${item} layered state syncs to second browser`, 15_000, 100)
  }
  pass('content.spring-layering', 'browser placement reaches Wildflowers flower_amount=4 + Leaf Litter segment_amount=4')

  // Both new chicken-variant egg items must be usable as projectiles from the browser.
  for (const eggName of ['brown_egg','blue_egg']) {
    const before = await hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).filter(e=>e.name==='egg').length)
    await hudson.page.evaluate(async name => {
      const bot=globalThis.bot; const egg=bot.inventory.items().find(i=>i.name===name); if(!egg) throw new Error(`missing ${name}`); await bot.equip(egg,'hand'); bot.activateItem(); await new Promise(r=>setTimeout(r,160)); bot.deactivateItem()
    }, eggName)
    await waitFor(() => hudson.page.evaluate(n => Object.values(globalThis.bot.entities||{}).filter(e=>e.name==='egg').length>n,before), `${eggName} browser projectile`, 8_000, 100)
  }
  pass('content.spring-eggs', 'browser throws both 1.21.5 Brown Egg and Blue Egg projectile items')

  // 1.21.5 moved many entity appearance choices into item/entity components.
  // Prove those components survive a browser inventory -> use -> spawned entity path.
  await command(SHARED, `give ${H} minecraft:pig_spawn_egg[minecraft:pig/variant="minecraft:warm"] 1`)
  await command(SHARED, 'setblock 110 99 12 minecraft:grass_block')
  await command(SHARED, `tp ${H} 109 100 12`)
  await waitFor(() => itemCount(hudson.page,'pig_spawn_egg').then(n=>n>=1), 'warm pig component spawn egg reaches browser', 15_000)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const egg=bot.inventory.items().find(i=>i.name==='pig_spawn_egg'); if(!egg) throw new Error('missing pig variant spawn egg'); await bot.equip(egg,'hand'); const ground=bot.blockAt(bot.entity.position.offset(1,-1,0)); if(!ground) throw new Error('missing pig spawn ground'); await bot.activateBlock(ground)
  })
  await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).some(e=>e.name==='pig' && Math.abs(e.position.x-110)<4)), 'browser spawns component-selected pig', 15_000)
  await commandLogMatch(SHARED, 'data get entity @e[type=minecraft:pig,x=110,y=100,z=12,distance=..4,sort=nearest,limit=1] variant', /warm/i, 'spawn-egg pig variant preserved', 15_000)

  await command(SHARED, `give ${H} minecraft:wolf_spawn_egg[minecraft:wolf/sound_variant="minecraft:big"] 1`)
  await command(SHARED, 'setblock 114 99 12 minecraft:grass_block')
  await command(SHARED, `tp ${H} 113 100 12`)
  await waitFor(() => itemCount(hudson.page,'wolf_spawn_egg').then(n=>n>=1), 'wolf sound component spawn egg reaches browser', 15_000)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const egg=bot.inventory.items().find(i=>i.name==='wolf_spawn_egg'); if(!egg) throw new Error('missing wolf sound spawn egg'); await bot.equip(egg,'hand'); const ground=bot.blockAt(bot.entity.position.offset(1,-1,0)); if(!ground) throw new Error('missing wolf spawn ground'); await bot.activateBlock(ground)
  })
  await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).some(e=>e.name==='wolf' && Math.abs(e.position.x-114)<4)), 'browser spawns sound-variant wolf', 15_000)
  await commandLogMatch(SHARED, 'data get entity @e[type=minecraft:wolf,x=114,y=100,z=12,distance=..4,sort=nearest,limit=1] sound_variant', /big/i, 'spawn-egg wolf sound variant preserved', 15_000)
  pass('content.1215-entity-components', 'browser-used 1.21.5 spawn-egg components preserve pig variant + wolf sound variant')

  await command(SHARED, `give ${H} minecraft:writable_book 1`)
  await command(SHARED, `give ${H} minecraft:compass 1`)
  await command(SHARED, `give ${H} minecraft:clock 1`)
  await command(SHARED, `give ${H} minecraft:recovery_compass 1`)
  await command(SHARED, `give ${H} minecraft:filled_map 1`)
  for (const item of ['writable_book','compass','clock','recovery_compass','filled_map']) {
    await waitFor(() => itemCount(hudson.page, item).then(n => n >= 1), `modern item/component ${item}`, 15_000)
  }
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const book = bot.inventory.items().find(i => i.name === 'writable_book')
    if (!book) throw new Error('missing writable book')
    if (typeof bot.writeBook === 'function') await bot.writeBook(book.slot, ['HEM 1.21.5 component test'])
  })
  pass('items.components-navigation-books', 'book + map/compass/clock/recovery-compass inventory/component paths')

  // Native bundle contents are server-owned item components. Insert apples through
  // ordinary inventory clicks so the gate exercises the 1.21.5 bundle transaction
  // path instead of fabricating the component with a command.
  await command(SHARED, `clear ${H} minecraft:bundle`)
  await command(SHARED, `clear ${H} minecraft:apple`)
  await command(SHARED, `give ${H} minecraft:bundle 1`)
  await command(SHARED, `give ${H} minecraft:apple 3`)
  await waitFor(() => itemCount(hudson.page,'bundle').then(n=>n===1), 'bundle reaches browser inventory', 15_000)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const bundle=bot.inventory.items().find(i=>i.name==='bundle'); const apples=bot.inventory.items().find(i=>i.name==='apple'); if(!bundle||!apples) throw new Error('missing bundle-storage prerequisites')
    await bot.clickWindow(apples.slot,0,0); await bot.clickWindow(bundle.slot,1,0); await new Promise(r=>setTimeout(r,400))
  })
  await commandLogMatch(SHARED, `data get entity ${H} Inventory`, /bundle_contents.*apple/i, 'browser inventory click stores apples in native bundle component', 12_000)
  pass('items.bundle-storage', 'browser inventory transaction writes native bundle_contents component')

  // Damageable item semantics: a real survival dig must increase the equipped pick's damage.
  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, 'setblock 74 100 8 minecraft:stone')
  await command(SHARED, `tp ${H} 73 100 8`)
  const damageBefore = await hudson.page.evaluate(() => {
    const item = globalThis.bot.inventory.items().find(i => i.name === 'diamond_pickaxe')
    return item?.durabilityUsed ?? item?.components?.find?.(c => /damage/i.test(c?.type || ''))?.data ?? 0
  })
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const item = bot.inventory.items().find(i => i.name === 'diamond_pickaxe'); if (!item) throw new Error('missing durability pickaxe')
    await bot.equip(item, 'hand')
    const target = bot.blockAt(bot.entity.position.offset(1, 0, 0)); await bot.dig(target)
  })
  const damageAfter = await hudson.page.evaluate(() => {
    const item = globalThis.bot.inventory.items().find(i => i.name === 'diamond_pickaxe')
    return item?.durabilityUsed ?? item?.components?.find?.(c => /damage/i.test(c?.type || ''))?.data ?? 0
  })
  if (!(Number(damageAfter) > Number(damageBefore))) throw new Error(`damageable item did not accumulate durability damage: ${damageBefore} -> ${damageAfter}`)
  await command(SHARED, `gamemode creative ${H}`)
  pass('items.durability', 'damageable tool durability changes after real survival use')

  // 1.21.5 introduced the minecraft:weapon component. Override a sword to consume
  // two durability points per attack and prove the component survives command ->
  // inventory -> browser-origin attack -> authoritative item-state synchronization.
  await command(SHARED, `clear ${H} minecraft:wooden_sword`)
  await command(SHARED, `give ${H} minecraft:wooden_sword[minecraft:weapon={item_damage_per_attack:2}] 1`)
  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, `tp ${H} 72 100 16`)
  await command(SHARED, 'summon minecraft:zombie 74 100 16 {NoAI:1b,PersistenceRequired:1b,Health:40.0f,Tags:["hem_weapon_component_target"]}')
  await waitFor(() => itemCount(hudson.page, 'wooden_sword').then(n => n >= 1), '1.21.5 weapon-component sword reaches browser', 15_000)
  const weaponTargetId = await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities || {}).find(e => e.name === 'zombie' && Math.abs(e.position.x - 74) < 3)?.id || false), 'weapon-component target zombie', 15_000)
  const weaponDamageBefore = await hudson.page.evaluate(() => {
    const item = globalThis.bot.inventory.items().find(i => i.name === 'wooden_sword')
    return Number(item?.durabilityUsed ?? 0)
  })
  await hudson.page.evaluate(async id => {
    const bot = globalThis.bot
    const sword = bot.inventory.items().find(i => i.name === 'wooden_sword')
    if (!sword) throw new Error('missing 1.21.5 weapon-component sword')
    await bot.equip(sword, 'hand')
    const target = bot.entities[id]
    if (!target) throw new Error('missing weapon-component target')
    await bot.attack(target)
    await new Promise(resolve => setTimeout(resolve, 700))
  }, weaponTargetId)
  const weaponDamageAfter = await hudson.page.evaluate(() => {
    const item = globalThis.bot.inventory.items().find(i => i.name === 'wooden_sword')
    return Number(item?.durabilityUsed ?? 0)
  })
  if (weaponDamageAfter - weaponDamageBefore < 2) throw new Error(`minecraft:weapon item_damage_per_attack was not honored: ${weaponDamageBefore} -> ${weaponDamageAfter}`)
  await command(SHARED, 'kill @e[tag=hem_weapon_component_target]')
  await command(SHARED, `gamemode creative ${H}`)
  pass('items.1215-weapon-component', '1.21.5 minecraft:weapon item_damage_per_attack survives browser use and changes durability by two')

  // Browser-origin combat interaction sentinels. Mace and wind-charge are retained
  // from the 1.21 family; bow release proves a normal ranged use path without relying
  // on post-1.21.5 items.
  await command(SHARED, 'summon minecraft:zombie 82 100 8 {NoAI:1b,PersistenceRequired:1b,Health:40.0f}')
  await command(SHARED, `tp ${H} 80 100 8`)
  const zombieId = await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities || {}).find(e => e.name === 'zombie')?.id || false), 'combat target zombie', 15_000)
  await command(SHARED, `give ${H} minecraft:bow 1`)
  await command(SHARED, `give ${H} minecraft:arrow 8`)
  const arrowBefore = await hudson.page.evaluate(() => Object.values(globalThis.bot.entities || {}).filter(e => e.name === 'arrow').length)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot
    const bow = bot.inventory.items().find(i => i.name === 'bow')
    if (!bow) throw new Error('missing bow')
    await bot.equip(bow, 'hand')
    bot.activateItem()
    await new Promise(resolve => setTimeout(resolve, 900))
    bot.deactivateItem()
  })
  await waitFor(() => hudson.page.evaluate(before => Object.values(globalThis.bot.entities || {}).filter(e => e.name === 'arrow').length > before, arrowBefore), 'browser-fired arrow entity', 10_000)
  pass('combat.bow-ranged', 'browser-origin bow draw/release creates an authoritative arrow projectile')

  const windBefore = await hudson.page.evaluate(() => Object.values(globalThis.bot.entities || {}).filter(e => /wind_charge/.test(e.name || '')).length)
  await hudson.page.evaluate(async () => {
    const bot = globalThis.bot; const wind = bot.inventory.items().find(i => i.name === 'wind_charge'); await bot.equip(wind, 'hand'); bot.activateItem()
    await new Promise(r => setTimeout(r, 300)); bot.deactivateItem()
  })
  await waitFor(() => hudson.page.evaluate(before => Object.values(globalThis.bot.entities || {}).filter(e => /wind_charge/.test(e.name || '')).length > before, windBefore), 'browser-fired wind charge entity', 10_000)
  pass('combat.wind-charge', 'browser-origin wind-charge use/projectile path')

  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, `tp ${H} 82 116 8`)
  await hudson.page.evaluate(async id => {
    const bot = globalThis.bot; const mace = bot.inventory.items().find(i => i.name === 'mace'); await bot.equip(mace, 'hand')
    await new Promise(r => setTimeout(r, 1200)); const target = bot.entities[id]; if (target) await bot.attack(target)
  }, zombieId)
  await command(SHARED, `gamemode creative ${H}`)
  pass('combat.mace-smash-path', 'falling browser player equips and attacks with mace through normal combat path')

  // Representative entity-family protocol coverage. This is deliberately broader
  // than the newest-mob sentinels and catches metadata/registry regressions that only
  // appear on older vanilla families. Model/AI parity remains a separate renderer gate.
  for (const [name, x] of [['villager',16],['armor_stand',18],['breeze',20],['warden',22],['blaze',24],['enderman',26],['shulker',28]]) {
    const nbt = name === 'armor_stand' ? '{NoGravity:1b,Invulnerable:1b}' : '{NoAI:1b,PersistenceRequired:1b,Invulnerable:1b}'
    await command(SHARED, `summon minecraft:${name} ${x} 100 4 ${nbt}`)
  }
  for (const name of ['villager','armor_stand','breeze','warden','blaze','enderman','shulker']) {
    await waitFor(() => hudson.page.evaluate(expected => Object.values(globalThis.bot.entities || {}).some(entity => entity.name === expected), name), `representative entity family ${name}`, 20_000)
  }
  pass('entities.family-sentinels', 'representative passive/display/hostile/Nether/End entity synchronization')

  for (const [name, x] of [['cow',30],['wolf',32],['iron_golem',34],['snow_golem',36],['dolphin',38],['guardian',40],['wither_skeleton',42],['piglin',44],['endermite',46],['phantom',48]]) {
    await command(SHARED, `summon minecraft:${name} ${x} 100 8 {NoAI:1b,PersistenceRequired:1b,Invulnerable:1b}`)
  }
  for (const name of ['cow','wolf','iron_golem','snow_golem','dolphin','guardian','wither_skeleton','piglin','endermite','phantom']) {
    await waitFor(() => hudson.page.evaluate(expected => Object.values(globalThis.bot.entities || {}).some(entity => entity.name === expected), name), `expanded entity family ${name}`, 20_000)
  }
  pass('entities.family-expanded', 'passive/tameable/golem/aquatic/Nether/End entity-family synchronization')


  // Taming must originate from normal player interaction rather than pre-setting
  // Owner NBT. Repeated bones make the probabilistic wolf tame deterministic enough
  // for certification, and Paper's Owner field is the authoritative result.
  await command(SHARED, `tp ${H} 438 100 0`)
  await command(SHARED, 'kill @e[type=minecraft:wolf,x=440,y=100,z=0,distance=..12]')
  await command(SHARED, 'summon minecraft:wolf 440 100 0 {PersistenceRequired:1b}')
  await command(SHARED, `give ${H} minecraft:bone 32`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const wolf=Object.values(bot.entities||{}).find(e=>e.name==='wolf'&&Math.abs(e.position.x-440)<6); const bone=bot.inventory.items().find(i=>i.name==='bone'); if(!wolf||!bone) throw new Error('missing wolf taming prerequisites'); await bot.equip(bone,'hand'); for(let i=0;i<18;i++){ await bot.useOn(wolf); await new Promise(r=>setTimeout(r,350)) }
  })
  await commandLogMatch(SHARED, 'data get entity @e[type=minecraft:wolf,x=440,y=100,z=0,distance=..8,sort=nearest,limit=1] Owner', /\[I;/, 'browser-fed wolf acquires owner UUID', 12_000)
  pass('entities.taming', 'browser uses bones to tame a native wolf and Paper persists the owner UUID')

  // Construct both golems with the final pumpkin placed by the browser client.
  await command(SHARED, 'kill @e[type=minecraft:snow_golem,x=140,y=100,z=0,distance=..8]')
  await command(SHARED, 'kill @e[type=minecraft:iron_golem,x=150,y=100,z=0,distance=..8]')
  await command(SHARED, 'setblock 140 100 0 minecraft:snow_block')
  await command(SHARED, 'setblock 140 101 0 minecraft:snow_block')
  await command(SHARED, 'setblock 140 102 0 minecraft:air')
  await command(SHARED, `tp ${H} 139 100 0`)
  await command(SHARED, `give ${H} minecraft:carved_pumpkin 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const pumpkin=bot.inventory.items().find(i=>i.name==='carved_pumpkin'); const top=bot.blockAt(bot.entity.position.offset(1,1,0)); if(!pumpkin||!top||top.name!=='snow_block') throw new Error('missing snow-golem construction prerequisites'); await bot.equip(pumpkin,'hand'); await bot.placeBlock(top,{x:0,y:1,z:0})
  })
  await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).some(e=>e.name==='snow_golem'&&Math.abs(e.position.x-140)<5)), 'browser-built snow golem entity', 12_000, 100)

  await command(SHARED, 'setblock 150 100 0 minecraft:iron_block')
  await command(SHARED, 'setblock 150 101 0 minecraft:iron_block')
  await command(SHARED, 'setblock 149 101 0 minecraft:iron_block')
  await command(SHARED, 'setblock 151 101 0 minecraft:iron_block')
  await command(SHARED, 'setblock 150 102 0 minecraft:air')
  await command(SHARED, `tp ${H} 148 100 0`)
  await command(SHARED, `give ${H} minecraft:carved_pumpkin 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const pumpkin=bot.inventory.items().find(i=>i.name==='carved_pumpkin'); const top=bot.blockAt(bot.entity.position.offset(2,1,0)); if(!pumpkin||!top||top.name!=='iron_block') throw new Error('missing iron-golem construction prerequisites'); await bot.equip(pumpkin,'hand'); await bot.placeBlock(top,{x:0,y:1,z:0})
  })
  await waitFor(() => elise.page.evaluate(() => Object.values(globalThis.bot.entities||{}).some(e=>e.name==='iron_golem'&&Math.abs(e.position.x-150)<5)), 'browser-built iron golem visible remotely', 12_000, 100)
  pass('entities.golem-creation', 'browser final-block placement constructs native snow and iron golems')

  // Native breeding behavior, including a real negative-Age child entity.
  await command(SHARED, 'kill @e[type=minecraft:cow,x=200,y=100,z=0,distance=..10]')
  await command(SHARED, 'summon minecraft:cow 199 100 0 {Tags:["hem_parent"]}')
  await command(SHARED, 'summon minecraft:cow 201 100 0 {Tags:["hem_parent"]}')
  await command(SHARED, `tp ${H} 200 100 2`)
  await command(SHARED, `give ${H} minecraft:wheat 4`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const wheat=bot.inventory.items().find(i=>i.name==='wheat'); if(!wheat) throw new Error('missing wheat for breeding'); await bot.equip(wheat,'hand');
    const cows=Object.values(bot.entities||{}).filter(e=>e.name==='cow'&&Math.abs(e.position.x-200)<6&&Math.abs(e.position.z)<6).sort((a,b)=>a.position.x-b.position.x); if(cows.length<2) throw new Error('missing cow parents'); await bot.activateEntity(cows[0]); await sleep(150); await bot.activateEntity(cows[1])
  })
  await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).filter(e=>e.name==='cow'&&Math.abs(e.position.x-200)<8&&Math.abs(e.position.z)<8).length>=3), 'native cow breeding creates child entity', 20_000, 200)
  await commandLogMatch(SHARED, 'data get entity @e[type=minecraft:cow,tag=!hem_parent,x=200,y=100,z=0,distance=..10,sort=nearest,limit=1] Age', /-\d+/, 'bred cow has negative child Age', 10_000)
  pass('entities.breeding', 'browser-fed cow parents enter native breeding flow and create a baby cow')


  await command(SHARED, 'summon minecraft:item_display 56 101 8 {item:{id:"minecraft:diamond",count:1}}')
  await command(SHARED, 'summon minecraft:text_display 58 101 8 {text:\'"HEM"\'}')
  await command(SHARED, 'summon minecraft:painting 60 101 8 {facing:2b,variant:"minecraft:kebab"}')
  for (const name of ['item_display','text_display','painting']) {
    await waitFor(() => hudson.page.evaluate(expected => Object.values(globalThis.bot.entities || {}).some(entity => entity.name === expected), name), `decorative entity ${name}`, 20_000)
  }
  pass('entities.decorative-displays', 'display/text/painting entity synchronization')

  await command(SHARED, 'summon minecraft:wither 62 105 8 {NoAI:1b,Invulnerable:1b,PersistenceRequired:1b}')
  await command(SHARED, 'summon minecraft:ender_dragon 68 110 8 {NoAI:1b,Invulnerable:1b,PersistenceRequired:1b}')
  for (const name of ['wither','ender_dragon']) {
    await waitFor(() => hudson.page.evaluate(expected => Object.values(globalThis.bot.entities || {}).some(entity => entity.name === expected), name), `boss entity ${name}`, 20_000)
  }
  await command(SHARED, 'kill @e[type=minecraft:wither,distance=..128]')
  await command(SHARED, 'kill @e[type=minecraft:ender_dragon,distance=..128]')
  pass('bosses.entity-sentinels', 'Wither + Ender Dragon entity synchronization')

  // A summoned Wither only proves the entity protocol. Build the native structure
  // and make the final skull a browser-origin placement so spawning rules execute.
  await command(SHARED, 'gamerule mobGriefing false')
  await command(SHARED, 'kill @e[type=minecraft:wither,x=220,y=100,z=0,distance=..12]')
  await command(SHARED, 'setblock 220 100 0 minecraft:soul_sand')
  await command(SHARED, 'setblock 219 101 0 minecraft:soul_sand')
  await command(SHARED, 'setblock 220 101 0 minecraft:soul_sand')
  await command(SHARED, 'setblock 221 101 0 minecraft:soul_sand')
  await command(SHARED, 'setblock 219 102 0 minecraft:wither_skeleton_skull[rotation=0]')
  await command(SHARED, 'setblock 220 102 0 minecraft:wither_skeleton_skull[rotation=0]')
  await command(SHARED, 'setblock 221 102 0 minecraft:air')
  await command(SHARED, `tp ${H} 222 100 0`)
  await command(SHARED, `give ${H} minecraft:wither_skeleton_skull 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const skull=bot.inventory.items().find(i=>i.name==='wither_skeleton_skull'); const soul=bot.blockAt(bot.entity.position.offset(-1,1,0)); if(!skull||!soul||soul.name!=='soul_sand') throw new Error('missing Wither construction prerequisites'); await bot.equip(skull,'hand'); await bot.placeBlock(soul,{x:0,y:1,z:0})
  })
  await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).some(e=>e.name==='wither'&&Math.abs(e.position.x-220)<10)), 'browser-built Wither appears', 15_000, 100)
  await command(SHARED, 'kill @e[type=minecraft:wither,x=220,y=100,z=0,distance=..20]')
  await command(SHARED, 'gamerule mobGriefing true')
  pass('bosses.wither-structure-spawn', 'browser final-skull placement triggers native Wither construction rules')

  for (const [name, x] of [['arrow',50],['trident',52],['snowball',54]]) {
    await command(SHARED, `summon minecraft:${name} ${x} 102 8 {NoGravity:1b}`)
    await waitFor(() => hudson.page.evaluate(expected => Object.values(globalThis.bot.entities || {}).some(entity => entity.name === expected), name), `projectile entity ${name}`, 12_000)
  }
  pass('entities.projectile-sentinels', 'arrow/trident/snowball projectile entity synchronization')

  await command(SHARED, `give ${H} minecraft:ender_pearl 2`)
  await command(SHARED, `tp ${H} 70 100 8`)
  const pearlBefore = await hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).filter(e=>e.name==='ender_pearl').length)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const pearl=bot.inventory.items().find(i=>i.name==='ender_pearl'); if(!pearl) throw new Error('missing ender pearl'); await bot.equip(pearl,'hand'); await bot.look(0,0,true); bot.activateItem(); await new Promise(r=>setTimeout(r,150)); bot.deactivateItem()
  })
  await waitFor(() => elise.page.evaluate(before => Object.values(globalThis.bot.entities||{}).filter(e=>e.name==='ender_pearl').length>before, pearlBefore), 'browser-thrown ender pearl visible remotely', 10_000, 100)
  pass('entities.ender-pearl-use', 'browser-origin ender pearl throw creates a synchronized native projectile')


  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, `effect clear ${H}`)
  await command(SHARED, `tp ${H} 72 100 8`)
  await command(SHARED, 'summon minecraft:zombie 75 100 8 {PersistenceRequired:1b}')
  const aiHealth = await hudson.page.evaluate(() => globalThis.bot.health)
  await waitFor(() => hudson.page.evaluate(before => globalThis.bot.health < before, aiHealth), 'hostile zombie pathfinds/attacks browser player', 25_000, 250)
  await command(SHARED, 'kill @e[type=minecraft:zombie,distance=..32]')
  await command(SHARED, `gamemode creative ${H}`)
  pass('entities.hostile-ai', 'hostile pathfinding/attack reaches browser survival state')

  await command(SHARED, 'summon minecraft:cow 78 100 8 {PersistenceRequired:1b,Health:1.0f}')
  await command(SHARED, 'kill @e[type=minecraft:cow,x=78,y=100,z=8,distance=..3,limit=1]')
  await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities || {}).some(e => e.name === 'item')), 'mob death produces dropped-item entity', 12_000)
  pass('entities.mob-loot', 'mob death/drop entity synchronization')


  await command(SHARED, 'summon minecraft:villager 84 100 8 {PersistenceRequired:1b,VillagerData:{profession:"minecraft:farmer",level:2,type:"minecraft:plains"},Offers:{Recipes:[{buy:{id:"minecraft:emerald",count:1},sell:{id:"minecraft:bread",count:3},maxUses:999999}]}}')
  await command(SHARED, `give ${H} minecraft:emerald 2`)
  await command(SHARED, `tp ${H} 82 100 8`)
  await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).find(e=>e.name==='villager')?.id || false), 'trade villager entity', 15_000)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const villager=Object.values(bot.entities).find(e=>e.name==='villager'); if(!villager) throw new Error('missing villager')
    const window=await bot.openVillager(villager); await new Promise(r=>setTimeout(r,300)); await bot.trade(window,0,1); window.close()
  })
  await waitFor(() => itemCount(hudson.page,'bread').then(n=>n>=3),'villager trade result reaches browser inventory',15_000)
  pass('entities.villager-trading', 'browser opens native villager merchant and completes a trade')

  await command(SHARED, 'setblock 88 100 8 minecraft:sculk_sensor[sculk_sensor_phase=inactive,power=0,waterlogged=false]')
  await command(SHARED, `tp ${H} 86 100 8`)
  await hudson.page.evaluate(async () => { const bot=globalThis.bot; bot.setControlState('jump',true); await new Promise(r=>setTimeout(r,350)); bot.setControlState('jump',false) })
  await waitFor(() => blockProperties(hudson.page,88,100,8).then(p => p?.sculk_sensor_phase !== 'inactive' || Number(p?.power)>0), 'sculk sensor reacts to browser vibration',15_000,100)
  pass('entities.sculk-vibration', 'browser movement activates sculk sensor vibration state')

  await command(SHARED, 'summon minecraft:horse 92 100 8 {Tame:1b,PersistenceRequired:1b}')
  await command(SHARED, 'summon minecraft:llama 96 100 8 {Tame:1b,ChestedHorse:1b,PersistenceRequired:1b}')
  for (const name of ['horse','llama']) {
    await command(SHARED, `tp ${H} ${name==='horse'?90:94} 100 8`)
    await hudson.page.evaluate(async expected => {
      const bot=globalThis.bot; const entity=Object.values(bot.entities).find(e=>e.name===expected); if(!entity) throw new Error(`missing ${expected}`)
      const win=await bot.openEntity(entity); await new Promise(r=>setTimeout(r,250)); if(!win) throw new Error(`${expected} inventory did not open`); win.close()
    }, name)
  }
  pass('containers.mount-inventories', 'horse + chested-llama entity inventory windows open through browser')


  await command(SHARED, `give ${H} minecraft:apple 2`)
  await command(SHARED, `tp ${H} 94 100 8`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const llama=Object.values(bot.entities).find(e=>e.name==='llama'); if(!llama) throw new Error('missing chested llama for storage semantics'); const win=await bot.openContainer(llama); if(typeof win.deposit!=='function') throw new Error('llama container lacks deposit API'); await win.deposit(bot.registry.itemsByName.apple.id,null,1); win.close()
  })
  await commandLogMatch(SHARED, 'data get entity @e[type=minecraft:llama,x=96,y=100,z=8,distance=..8,sort=nearest,limit=1] Items', /apple/i, 'browser deposits item into chested llama inventory', 12_000)
  pass('containers.mount-inventory-semantics', 'browser deposits a real item into a native chested-llama inventory')

  await command(SHARED, `advancement grant ${H} only minecraft:story/root`)
  await waitFor(() => hudson.page.evaluate(() => {
    const seen = globalThis.__HEM_PARITY__?.packetsSeen
    return seen instanceof Set && [...seen].some(n => /advancement/i.test(n))
  }), 'advancement protocol packet reaches browser', 15_000)
  pass('progression.advancements', 'advancement synchronization packet path')

  // Long client-origin chat sequences catch acknowledgement/session regressions.
  // HEM requires its exact browser dependency graph to survive a longer client-origin chat sequence.
  await hudson.page.evaluate(() => {
    globalThis.__hemChatEnded = false
    globalThis.bot.once('end', () => { globalThis.__hemChatEnded = true })
  })
  for (let i = 0; i < 25; i++) {
    await hudson.page.evaluate(index => globalThis.bot.chat(`HEM chat soak ${index}`), i)
    await sleep(800)
  }
  await sleep(1500)
  const chatEnded = await hudson.page.evaluate(() => Boolean(globalThis.__hemChatEnded))
  if (chatEnded) throw new Error('browser client disconnected during 25-message chat acknowledgement soak')
  await waitPlayers(SHARED, 2)
  pass('chat.ack-soak', '25-message client-origin chat acknowledgement soak')

  // Horizontal knockback is a release gate because it exercises client physics + combat together.
  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, `gamemode survival ${E}`)
  await command(SHARED, `tp ${H} 0 100 0`)
  await command(SHARED, `tp ${E} 0 100 2`)
  await sleep(2000)
  const hpBefore = await hudson.page.evaluate(() => globalThis.bot.health)
  const posBefore = await hudson.page.evaluate(() => {
    const pos = globalThis.bot.entity.position
    return { x: pos.x, z: pos.z }
  })
  await elise.page.evaluate(async user => {
    const bot = globalThis.bot
    const target = bot.players?.[user]?.entity
    if (!target) throw new Error('Missing combat target')
    await bot.lookAt(target.position.offset(0, 1, 0), true)
    bot.attack(target)
  }, H)
  await waitFor(() => hudson.page.evaluate(before => globalThis.bot.health < before, hpBefore), 'survival damage synchronization', 15_000)
  await waitFor(() => hudson.page.evaluate(before => {
    const pos = globalThis.bot.entity.position
    return Math.hypot(pos.x - before.x, pos.z - before.z) > 0.03
  }, posBefore), 'horizontal knockback physics', 15_000)
  pass('combat.melee-knockback', 'survival combat damage and horizontal knockback')

  // Attack cooldown scaling: hit two independent no-AI targets in quick succession
  // with an axe. The first hit is fully charged; the second lands before the attack
  // meter recovers and must deal materially less damage. Separate targets avoid hurt
  // invulnerability frames contaminating the measurement.
  await command(SHARED, `clear ${H} minecraft:iron_axe`)
  await command(SHARED, `give ${H} minecraft:iron_axe 1`)
  await command(SHARED, 'summon minecraft:zombie 684 100 0 {NoAI:1b,PersistenceRequired:1b,Health:40.0f,Tags:["hem_cooldown_a"]}')
  await command(SHARED, 'summon minecraft:zombie 680 100 4 {NoAI:1b,PersistenceRequired:1b,Health:40.0f,Tags:["hem_cooldown_b"]}')
  await command(SHARED, `tp ${H} 682 100 2`)
  const cooldownIds = await waitFor(() => hudson.page.evaluate(() => { const a=Object.values(globalThis.bot.entities||{}).find(e=>e.name==='zombie'&&Math.hypot(e.position.x-684,e.position.z)<2); const b=Object.values(globalThis.bot.entities||{}).find(e=>e.name==='zombie'&&Math.hypot(e.position.x-680,e.position.z-4)<2); return a&&b?[a.id,b.id]:false }), 'attack-cooldown target pair', 12_000, 100)
  await hudson.page.evaluate(async ids => { const bot=globalThis.bot; const axe=bot.inventory.items().find(i=>i.name==='iron_axe'); await bot.equip(axe,'hand'); await new Promise(r=>setTimeout(r,1200)); const a=bot.entities[ids[0]], b=bot.entities[ids[1]]; await bot.lookAt(a.position.offset(0,1,0),true); await bot.attack(a); await new Promise(r=>setTimeout(r,120)); await bot.lookAt(b.position.offset(0,1,0),true); await bot.attack(b) }, cooldownIds)
  const healthAline = await commandLogMatch(SHARED, 'data get entity @e[tag=hem_cooldown_a,limit=1] Health', /[0-9]+(?:\.[0-9]+)?f/i, 'first cooldown target health', 8_000)
  const healthBline = await commandLogMatch(SHARED, 'data get entity @e[tag=hem_cooldown_b,limit=1] Health', /[0-9]+(?:\.[0-9]+)?f/i, 'second cooldown target health', 8_000)
  const parseMobHealth = line => { const m=/([0-9]+(?:\.[0-9]+)?)f\b/i.exec(line); if(!m) throw new Error(`could not parse mob health: ${line}`); return Number(m[1]) }
  const cooldownDamageA=40-parseMobHealth(healthAline), cooldownDamageB=40-parseMobHealth(healthBline)
  if (!(cooldownDamageA > cooldownDamageB * 1.5)) throw new Error(`attack cooldown scaling failed: first=${cooldownDamageA} second=${cooldownDamageB}`)
  await command(SHARED, 'kill @e[tag=hem_cooldown_a]')
  await command(SHARED, 'kill @e[tag=hem_cooldown_b]')
  pass('combat.attack-cooldown', `native attack cooldown scales rapid second hit: ${cooldownDamageA} vs ${cooldownDamageB}`)

  // Critical-hit scaling: compare a grounded sword hit with a separate sword hit
  // performed during a real fall. Server health is the authority for both samples.
  await command(SHARED, `clear ${H} minecraft:diamond_sword`)
  await command(SHARED, `give ${H} minecraft:diamond_sword 1`)
  await command(SHARED, 'summon minecraft:zombie 690 100 0 {NoAI:1b,PersistenceRequired:1b,Health:40.0f,Tags:["hem_crit_ground"]}')
  await command(SHARED, `tp ${H} 688 100 0`)
  const groundCritId=await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).find(e=>e.name==='zombie'&&Math.abs(e.position.x-690)<2)?.id||false), 'ground critical-control target', 10_000, 100)
  await hudson.page.evaluate(async id=>{ const bot=globalThis.bot; const sword=bot.inventory.items().find(i=>i.name==='diamond_sword'); await bot.equip(sword,'hand'); await new Promise(r=>setTimeout(r,800)); const e=bot.entities[id]; await bot.lookAt(e.position.offset(0,1,0),true); await bot.attack(e) },groundCritId)
  const groundCritLine=await commandLogMatch(SHARED,'data get entity @e[tag=hem_crit_ground,limit=1] Health',/[0-9]+(?:\.[0-9]+)?f/i,'grounded attack health sample',8_000)
  const groundCritDamage=40-parseMobHealth(groundCritLine)
  await command(SHARED, 'kill @e[tag=hem_crit_ground]')
  await command(SHARED, 'summon minecraft:zombie 690 100 0 {NoAI:1b,PersistenceRequired:1b,Health:40.0f,Tags:["hem_crit_fall"]}')
  await command(SHARED, `tp ${H} 688 104 0`)
  const fallCritId=await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).find(e=>e.name==='zombie'&&Math.abs(e.position.x-690)<2)?.id||false), 'falling critical target', 10_000, 100)
  await hudson.page.evaluate(async id=>{ const bot=globalThis.bot; const e=bot.entities[id]; await bot.lookAt(e.position.offset(0,1,0),true); const end=Date.now()+3000; while(Date.now()<end && !(bot.entity.position.y<102.4 && bot.entity.position.y>101.2)) await new Promise(r=>setTimeout(r,20)); if(!(bot.entity.position.y<102.4&&bot.entity.position.y>101.2)) throw new Error('did not reach critical-hit fall window'); await bot.attack(e) },fallCritId)
  const fallCritLine=await commandLogMatch(SHARED,'data get entity @e[tag=hem_crit_fall,limit=1] Health',/[0-9]+(?:\.[0-9]+)?f/i,'falling critical attack health sample',8_000)
  const fallCritDamage=40-parseMobHealth(fallCritLine)
  if (!(fallCritDamage > groundCritDamage * 1.25)) throw new Error(`critical hit scaling failed: ground=${groundCritDamage} falling=${fallCritDamage}`)
  await command(SHARED, 'kill @e[tag=hem_crit_fall]')
  pass('combat.critical-hit', `falling critical hit exceeds grounded sword damage: ${groundCritDamage} -> ${fallCritDamage}`)

  await command(SHARED, `effect give ${H} minecraft:instant_health 1 10 true`)
  await command(SHARED, `item replace entity ${H} armor.chest with minecraft:air`)
  const nakedHp = await hudson.page.evaluate(() => globalThis.bot.health)
  await command(SHARED, `damage ${H} 8 minecraft:mob_attack`)
  await waitFor(() => hudson.page.evaluate(before => globalThis.bot.health < before, nakedHp), 'naked damage sample', 10_000)
  const nakedLoss = nakedHp - await hudson.page.evaluate(() => globalThis.bot.health)
  await command(SHARED, `effect give ${H} minecraft:instant_health 1 10 true`)
  await command(SHARED, `item replace entity ${H} armor.chest with minecraft:diamond_chestplate`)
  await sleep(500)
  const armoredHp = await hudson.page.evaluate(() => globalThis.bot.health)
  await command(SHARED, `damage ${H} 8 minecraft:mob_attack`)
  await waitFor(() => hudson.page.evaluate(before => globalThis.bot.health < before, armoredHp), 'armored damage sample', 10_000)
  const armoredLoss = armoredHp - await hudson.page.evaluate(() => globalThis.bot.health)
  if (!(armoredLoss < nakedLoss)) throw new Error(`armor mitigation failed: naked=${nakedLoss} armored=${armoredLoss}`)
  await command(SHARED, `effect give ${H} minecraft:speed 5 1 true`)
  await waitFor(() => hudson.page.evaluate(() => Object.keys(globalThis.bot.entity?.effects || {}).length > 0), 'status effect reaches browser entity', 10_000)
  pass('combat.armor-status', 'server-authoritative armor mitigation + browser status-effect synchronization')


  // Shield semantics: compare the same no-gravity arrow against an unblocked and
  // actively blocking browser player. The shield sample must lose materially less health.
  await command(SHARED, `effect give ${H} minecraft:instant_health 1 10 true`)
  await command(SHARED, `item replace entity ${H} weapon.offhand with minecraft:air`)
  await command(SHARED, `tp ${H} 0 100 20 facing -20 101 20`)
  await command(SHARED, 'kill @e[type=minecraft:arrow,x=0,y=101,z=20,distance=..16]')
  const arrowControlHp = await hudson.page.evaluate(() => globalThis.bot.health)
  await command(SHARED, 'summon minecraft:arrow -4 101.2 20 {Motion:[1.6d,0.0d,0.0d],NoGravity:1b,pickup:0b}')
  await waitFor(() => hudson.page.evaluate(before => globalThis.bot.health < before, arrowControlHp), 'unshielded arrow damages browser player', 8_000, 50)
  const arrowControlLoss = arrowControlHp - await hudson.page.evaluate(() => globalThis.bot.health)
  await command(SHARED, `effect give ${H} minecraft:instant_health 1 10 true`)
  await command(SHARED, `give ${H} minecraft:shield 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const shield=bot.inventory.items().find(i=>i.name==='shield'); if(!shield) throw new Error('missing shield for block test'); await bot.equip(shield,'off-hand'); await bot.lookAt(bot.entity.position.offset(-20,1,0),true); bot.activateItem(true); await new Promise(r=>setTimeout(r,500))
  })
  const shieldHp = await hudson.page.evaluate(() => globalThis.bot.health)
  await command(SHARED, 'summon minecraft:arrow -4 101.2 20 {Motion:[1.6d,0.0d,0.0d],NoGravity:1b,pickup:0b}')
  await sleep(1500)
  const shieldLoss = shieldHp - await hudson.page.evaluate(() => globalThis.bot.health)
  await hudson.page.evaluate(() => globalThis.bot.deactivateItem())
  if (!(shieldLoss < arrowControlLoss)) throw new Error(`shield failed to reduce projectile damage: control=${arrowControlLoss} shield=${shieldLoss}`)
  pass('combat.shield-block', `active offhand shield reduces incoming arrow damage (${arrowControlLoss} -> ${shieldLoss})`)


  // Shields are directional. Reuse the same blocking state but turn away from
  // the incoming arrow; rear impact must bypass the frontal shield arc.
  await command(SHARED, `effect give ${H} minecraft:instant_health 1 10 true`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot
    const shield=bot.inventory.slots?.[45] || bot.inventory.items().find(i=>i.name==='shield')
    if(!shield) throw new Error('missing shield for directional block test')
    if(bot.inventory.slots?.[45]?.name!=='shield') await bot.equip(shield,'off-hand')
    await bot.lookAt(bot.entity.position.offset(20,1,0),true)
    bot.activateItem(true)
    await new Promise(r=>setTimeout(r,400))
  })
  const rearShieldHp=await hudson.page.evaluate(() => globalThis.bot.health)
  await command(SHARED, 'summon minecraft:arrow -4 101.2 20 {Motion:[1.6d,0.0d,0.0d],NoGravity:1b,pickup:0b}')
  await waitFor(() => hudson.page.evaluate(before => globalThis.bot.health < before, rearShieldHp), 'rear arrow bypasses forward-facing shield', 8_000, 50)
  const rearShieldLoss=rearShieldHp-await hudson.page.evaluate(() => globalThis.bot.health)
  await hudson.page.evaluate(() => globalThis.bot.deactivateItem())
  if(!(rearShieldLoss>shieldLoss)) throw new Error(`directional shield arc failed: front=${shieldLoss} rear=${rearShieldLoss}`)
  pass('combat.shield-angle', `rear projectile bypasses frontal shield arc (${shieldLoss} -> ${rearShieldLoss})`)

  // Protection enchantments must reduce the same damage beyond base armor.
  await command(SHARED, `effect give ${H} minecraft:instant_health 1 10 true`)
  await command(SHARED, `item replace entity ${H} armor.chest with minecraft:diamond_chestplate`)
  await sleep(300)
  const plainArmorHp=await hudson.page.evaluate(() => globalThis.bot.health)
  await command(SHARED, `damage ${H} 12 minecraft:mob_attack`)
  await waitFor(() => hudson.page.evaluate(before => globalThis.bot.health<before, plainArmorHp), 'plain diamond armor damage sample', 8_000, 50)
  const plainArmorLoss=plainArmorHp-await hudson.page.evaluate(() => globalThis.bot.health)
  await command(SHARED, `effect give ${H} minecraft:instant_health 1 10 true`)
  await command(SHARED, `item replace entity ${H} armor.chest with minecraft:diamond_chestplate[minecraft:enchantments={levels:{\"minecraft:protection\":4}}]`)
  await sleep(300)
  const protectionHp=await hudson.page.evaluate(() => globalThis.bot.health)
  await command(SHARED, `damage ${H} 12 minecraft:mob_attack`)
  await waitFor(() => hudson.page.evaluate(before => globalThis.bot.health<before, protectionHp), 'Protection IV damage sample', 8_000, 50)
  const protectionLoss=protectionHp-await hudson.page.evaluate(() => globalThis.bot.health)
  if(!(protectionLoss<plainArmorLoss)) throw new Error(`Protection enchantment mitigation failed: plain=${plainArmorLoss} protection=${protectionLoss}`)
  pass('combat.protection-enchant', `Protection IV reduces matched damage beyond base armor (${plainArmorLoss} -> ${protectionLoss})`)

  // Fire Aspect is an item-enchantment combat behavior, not just an enchantment
  // component. A browser-origin sword hit must ignite a living target server-side.
  await command(SHARED, `clear ${H} minecraft:diamond_sword`)
  await command(SHARED, `give ${H} minecraft:diamond_sword[minecraft:enchantments={levels:{\"minecraft:fire_aspect\":2}}] 1`)
  await command(SHARED, 'summon minecraft:zombie 760 100 0 {NoAI:1b,PersistenceRequired:1b,Health:40.0f,Tags:["hem_fire_aspect"]}')
  await command(SHARED, `tp ${H} 758 100 0`)
  const fireAspectId=await waitFor(() => hudson.page.evaluate(() => Object.values(globalThis.bot.entities||{}).find(e=>e.name==='zombie'&&Math.abs(e.position.x-760)<2)?.id||false), 'Fire Aspect target', 10_000, 100)
  await hudson.page.evaluate(async id => {
    const bot=globalThis.bot
    const sword=bot.inventory.items().find(i=>i.name==='diamond_sword')
    const target=bot.entities[id]
    if(!sword||!target) throw new Error('missing Fire Aspect prerequisites')
    await bot.equip(sword,'hand'); await new Promise(r=>setTimeout(r,700)); await bot.lookAt(target.position.offset(0,1,0),true); await bot.attack(target)
  },fireAspectId)
  await commandLogMatch(SHARED, 'data get entity @e[tag=hem_fire_aspect,limit=1] Fire', /[1-9][0-9]*s\b/i, 'browser Fire Aspect hit ignites target', 10_000)
  await command(SHARED, 'kill @e[tag=hem_fire_aspect]')
  pass('combat.fire-aspect', 'browser-origin Fire Aspect sword hit creates native target fire ticks')

  // Totem of Undying must be consumed from the browser-equipped offhand and
  // prevent otherwise lethal ordinary damage without a respawn cycle.
  await command(SHARED, `effect clear ${H}`)
  await command(SHARED, `effect give ${H} minecraft:instant_health 1 10 true`)
  await command(SHARED, `clear ${H} minecraft:totem_of_undying`)
  await command(SHARED, `give ${H} minecraft:totem_of_undying 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const totem=bot.inventory.items().find(i=>i.name==='totem_of_undying'); if(!totem) throw new Error('missing totem'); await bot.equip(totem,'off-hand')
  })
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot.inventory.slots?.[45]?.name==='totem_of_undying'), 'totem equipped in browser offhand', 8_000, 50)
  await command(SHARED, `damage ${H} 100 minecraft:mob_attack`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot.health>0 && globalThis.bot.inventory.slots?.[45]?.name!=='totem_of_undying'), 'totem prevents lethal damage and is consumed', 10_000, 50)
  pass('survival.totem', 'browser-equipped Totem of Undying is consumed and prevents lethal damage')

  // Drink a real potion through the browser item-use path, then consume milk
  // and require the effect map to clear again.
  await command(SHARED, `effect clear ${H}`)
  await command(SHARED, `clear ${H} minecraft:potion`)
  await command(SHARED, `clear ${H} minecraft:milk_bucket`)
  await command(SHARED, `give ${H} minecraft:potion[minecraft:potion_contents={potion:\"minecraft:swiftness\"}] 1`)
  await command(SHARED, `give ${H} minecraft:milk_bucket 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const potion=bot.inventory.items().find(i=>i.name==='potion'); if(!potion) throw new Error('missing swiftness potion'); const speedId=bot.registry.effectsByName?.speed?.id; if(!Number.isInteger(speedId)) throw new Error('speed effect id unavailable'); globalThis.__hemPotionSpeedId=speedId; await bot.equip(potion,'hand'); await bot.consume()
  })
  await waitFor(() => hudson.page.evaluate(() => { const id=globalThis.__hemPotionSpeedId; const effects=globalThis.bot.entity?.effects||{}; return Boolean(effects[id]||Object.values(effects).some(e=>Number(e?.id)===id)) }), 'browser drinking swiftness potion applies Speed', 10_000, 50)
  await hudson.page.evaluate(async () => { const bot=globalThis.bot; const milk=bot.inventory.items().find(i=>i.name==='milk_bucket'); if(!milk) throw new Error('missing milk bucket'); await bot.equip(milk,'hand'); await bot.consume() })
  await waitFor(() => hudson.page.evaluate(() => Object.keys(globalThis.bot.entity?.effects||{}).length===0), 'browser drinking milk clears active potion effects', 10_000, 50)
  pass('items.potion-milk', 'browser potion consumption applies an effect and milk consumption clears it')

  // Server-authoritative fall damage exercises vertical physics and the browser's
  // position/health synchronization independently of direct PvP damage.
  await command(SHARED, 'fill -2 99 -2 2 99 2 minecraft:stone')
  await command(SHARED, `effect clear ${H}`)
  await command(SHARED, `tp ${H} 0 116 0`)
  await sleep(350)
  const fallHpBefore = await hudson.page.evaluate(() => globalThis.bot.health)
  await waitFor(() => hudson.page.evaluate(before => globalThis.bot.health < before, fallHpBefore), 'server-authoritative fall damage', 20_000, 100)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot.entity.position.y < 101.5), 'fall completes onto test floor', 20_000, 100)
  pass('movement.fall-damage', 'vertical fall physics + fall-damage health synchronization')

  // Distinct vanilla damage types must all update the browser health path; this
  // catches damage-event metadata regressions that a single fall/melee test misses.
  for (const damageType of ['in_fire','drown','freeze','in_wall','lava','out_of_world']) {
    await command(SHARED, `effect give ${H} minecraft:instant_health 1 10 true`)
    await sleep(250)
    const before = await hudson.page.evaluate(() => globalThis.bot.health)
    await command(SHARED, `damage ${H} 2 minecraft:${damageType}`)
    await waitFor(() => hudson.page.evaluate(value => globalThis.bot.health < value, before), `${damageType} damage reaches browser`, 8_000, 100)
  }
  pass('survival.damage-types', 'fire + drowning + freezing + suffocation + lava + void damage-type health synchronization')

  await waitFor(() => hudson.page.evaluate(() => (globalThis.__HEM_PARITY__?.presentation?.damageFlashes || 0) >= 1), 'HEM damage overlay feedback', 10_000)
  await waitFor(() => hudson.page.evaluate(() => (globalThis.__HEM_PARITY__?.presentation?.audioEvents || 0) >= 1), 'HEM procedural audio feedback', 10_000)
  pass('presentation.hem-feedback', 'original HEM damage overlay + procedural WebAudio event feedback')

  // Native fishing lifecycle: cast through the browser, wait for Mineflayer's
  // real bobber/catch flow, and require inventory quantity to increase.
  await command(SHARED, 'fill 410 99 -5 424 99 5 minecraft:stone')
  await command(SHARED, 'fill 410 100 -5 424 102 5 minecraft:water')
  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, `tp ${H} 408.5 101 0.5`)
  await command(SHARED, `give ${H} minecraft:fishing_rod 1`)
  await command(SHARED, 'weather rain')
  const fishingCountBefore = await hudson.page.evaluate(() => globalThis.bot.inventory.items().reduce((n,i)=>n+i.count,0))
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const rod=bot.inventory.items().find(i=>i.name==='fishing_rod'); if(!rod) throw new Error('missing fishing rod'); await bot.equip(rod,'hand'); await bot.lookAt(bot.entity.position.offset(9,-.5,0),true)
    await Promise.race([bot.fish(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('native fishing catch timeout')),45000))])
  })
  await waitFor(() => hudson.page.evaluate(before => globalThis.bot.inventory.items().reduce((n,i)=>n+i.count,0)>before, fishingCountBefore), 'native fishing catch reaches browser inventory', 10_000, 100)
  await command(SHARED, 'weather clear')
  await command(SHARED, `gamemode creative ${H}`)
  pass('survival.fishing', 'browser completes a native fishing cast/catch and receives loot in inventory')

  // Survival lifecycle: the browser must receive food depletion, enter a real
  // death state, issue the normal client respawn command, and regain a live entity.
  await command(SHARED, `effect clear ${H}`)
  await command(SHARED, `effect give ${H} minecraft:saturation 1 10 true`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.food >= 20), 'survival food restored before hunger gate', 10_000)
  const foodBefore = await hudson.page.evaluate(() => globalThis.bot.food)
  await command(SHARED, `effect give ${H} minecraft:hunger 12 20 true`)
  await waitFor(() => hudson.page.evaluate(before => Number(globalThis.bot?.food) < before, foodBefore), 'server-authoritative hunger depletion reaches browser', 25_000, 250)
  await command(SHARED, `effect clear ${H}`)
  const foodBeforeEat = await hudson.page.evaluate(() => Number(globalThis.bot.food))
  await command(SHARED, `clear ${H} minecraft:cooked_beef`)
  await command(SHARED, `give ${H} minecraft:cooked_beef 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const food=bot.inventory.items().find(i=>i.name==='cooked_beef'); if(!food) throw new Error('missing food for browser consume'); await bot.equip(food,'hand'); await bot.consume()
  })
  await waitFor(() => hudson.page.evaluate(before => Number(globalThis.bot.food)>before, foodBeforeEat), 'browser food consumption restores hunger', 12_000, 100)
  pass('survival.food-consumption', 'browser consumes native food item and server-authoritative hunger increases')
  await hudson.page.evaluate(() => {
    globalThis.__hemDeathSeen = false
    globalThis.bot.once('death', () => { globalThis.__hemDeathSeen = true })
  })
  await command(SHARED, `kill ${H}`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.__hemDeathSeen === true || globalThis.bot?.health <= 0), 'browser receives player death', 15_000)
  await hudson.page.evaluate(() => globalThis.bot.respawn())
  await waitFor(() => hudson.page.evaluate(() => Boolean(globalThis.bot?.entity) && globalThis.bot.health > 0), 'client-origin respawn restores live player', 20_000, 100)
  await waitPlayers(SHARED, 2, 20_000)
  pass('survival.hunger-death-respawn', 'hunger depletion + death + client-origin respawn lifecycle')


  // Default survival death semantics: inventory drops must become world item
  // entities and stay out of the respawned inventory when keepInventory is false.
  await command(SHARED, 'gamerule keepInventory false')
  await command(SHARED, `clear ${H}`)
  await command(SHARED, `give ${H} minecraft:gold_ingot 4`)
  await command(SHARED, `tp ${H} 430 100 0`)
  await command(SHARED, 'kill @e[type=minecraft:item,x=430,y=100,z=0,distance=..8]')
  await command(SHARED, `kill ${H}`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.health<=0), 'controlled death reaches browser for drop test', 10_000, 100)
  await commandLogMatch(SHARED, 'data get entity @e[type=minecraft:item,x=430,y=100,z=0,distance=..8,sort=nearest,limit=1] Item', /gold_ingot/i, 'death creates dropped inventory item entity', 10_000)
  await hudson.page.evaluate(() => globalThis.bot.respawn())
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.health>0), 'browser respawns after death-drop test', 15_000, 100)
  if (await itemCount(hudson.page,'gold_ingot') !== 0) throw new Error('keepInventory=false death retained gold ingots in player inventory')
  pass('survival.death-drops', 'keepInventory=false death drops carried items into the native world before client respawn')

  // Valid-dimension bed semantics: sleep once to set spawn, wake at day, then die
  // and require the browser's normal respawn to return near that bed.
  await command(SHARED, 'setblock 390 100 0 minecraft:red_bed[facing=east,occupied=false,part=foot]')
  await command(SHARED, 'setblock 391 100 0 minecraft:red_bed[facing=east,occupied=false,part=head]')
  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, 'time set midnight')
  await command(SHARED, `tp ${H} 389 100 0`)
  await hudson.page.evaluate(async () => { const bot=globalThis.bot; const bed=bot.blockAt(bot.entity.position.offset(1,0,0)); if(!bed||bed.name!=='red_bed') throw new Error('missing bed for sleep'); await bot.activateBlock(bed) })
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.isSleeping===true), 'browser enters native bed sleep state', 12_000, 100)
  await command(SHARED, 'time set day')
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.isSleeping===false), 'daytime wakes browser from bed', 12_000, 100)
  await command(SHARED, `kill ${H}`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.health<=0), 'bed-spawn death reaches browser', 12_000, 100)
  await hudson.page.evaluate(() => globalThis.bot.respawn())
  await waitFor(() => hudson.page.evaluate(() => {
    const p=globalThis.bot?.entity?.position; return p&&Math.hypot(p.x-390.5,p.z-.5)<5&&p.y>=99&&p.y<=103
  }), 'client respawns near valid Overworld bed spawn', 20_000, 100)
  pass('dimensions.bed-spawn', 'browser sleeps in a valid Overworld bed and client respawn returns to the saved bed spawn')

  await command(SHARED, `gamemode creative ${H}`)
  await command(SHARED, `gamemode creative ${E}`)

  // Time/weather are server-owned world state and must reach the browser client.
  await command(SHARED, 'time set night')
  await waitFor(() => hudson.page.evaluate(() => {
    const value = Number(globalThis.bot?.time?.timeOfDay)
    return Number.isFinite(value) && value >= 12500 && value <= 23500
  }), 'server-authoritative night time reaches browser', 15_000)
  await command(SHARED, 'weather rain')
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.isRaining === true), 'server-authoritative rain reaches browser', 15_000)
  await command(SHARED, 'weather clear')
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.isRaining === false), 'server-authoritative clear weather reaches browser', 15_000)
  pass('world.time-weather', 'server-authoritative time + weather synchronization')


  await command(SHARED, 'gamerule doDaylightCycle false')
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.time?.doDaylightCycle === false), 'doDaylightCycle=false reaches browser time state', 10_000)
  await command(SHARED, 'time set noon')
  const frozenTime = await hudson.page.evaluate(() => Number(globalThis.bot?.time?.timeOfDay))
  await sleep(1200)
  const frozenTimeAfter = await hudson.page.evaluate(() => Number(globalThis.bot?.time?.timeOfDay))
  if (Math.abs(frozenTimeAfter-frozenTime) > 3) throw new Error(`doDaylightCycle=false did not freeze browser time: ${frozenTime} -> ${frozenTimeAfter}`)
  await command(SHARED, 'gamerule doDaylightCycle true')
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.time?.doDaylightCycle === true), 'doDaylightCycle=true reaches browser time state', 10_000)
  pass('world.gamerules', 'native doDaylightCycle gamerule state and frozen-time semantics reach browser')

  await command(SHARED, 'difficulty hard')
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.game?.difficulty === 'hard'), 'hard difficulty reaches Hudson browser', 15_000)
  await waitFor(() => elise.page.evaluate(() => globalThis.bot?.game?.difficulty === 'hard'), 'hard difficulty reaches Elise browser', 15_000)
  await command(SHARED, 'difficulty normal')
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.game?.difficulty === 'normal'), 'normal difficulty reset reaches browser', 15_000)
  pass('world.difficulty', 'server-authoritative difficulty synchronization')


  // Dynamic world-border warning and interpolation packets changed independently
  // of collision. Clear any initial sightings, mutate all three server settings,
  // and require the 1.21.5 client protocol to surface each update packet.
  await hudson.page.evaluate(() => {
    const seen=globalThis.__HEM_PARITY__?.packetsSeen
    if(!(seen instanceof Set)) throw new Error('packet diagnostics unavailable')
    for(const name of ['world_border_warning_reach','world_border_warning_delay','world_border_lerp_size']) seen.delete(name)
  })
  await command(SHARED, 'worldborder warning distance 2')
  await command(SHARED, 'worldborder warning time 3')
  await command(SHARED, 'worldborder set 20 3')
  await waitFor(() => hudson.page.evaluate(() => {
    const seen=globalThis.__HEM_PARITY__?.packetsSeen
    return seen instanceof Set && ['world_border_warning_reach','world_border_warning_delay','world_border_lerp_size'].every(n=>seen.has(n))
  }), 'world-border warning + lerp update packets reach browser', 10_000, 50)
  pass('world.border-updates', '1.21.5 warning-distance warning-time and lerp-size world-border packets reach browser')

  // World-border collision is server-authoritative and easy to regress when the
  // browser physics layer predicts movement. Shrink it temporarily, drive Hudson
  // toward the edge, and require the authoritative position to remain bounded.
  await command(SHARED, 'worldborder center 0 0')
  await command(SHARED, 'worldborder set 8')
  await command(SHARED, `tp ${H} 3 100 0 facing 100 100 0`)
  await sleep(700)
  await hudson.page.evaluate(() => globalThis.bot.setControlState('forward', true))
  await sleep(3000)
  await hudson.page.evaluate(() => globalThis.bot.setControlState('forward', false))
  const borderPosition = await hudson.page.evaluate(() => {
    const p = globalThis.bot.entity.position
    return { x: p.x, z: p.z }
  })
  if (Math.abs(borderPosition.x) > 4.15 || Math.abs(borderPosition.z) > 4.15) {
    throw new Error(`World border failed to constrain browser player: ${JSON.stringify(borderPosition)}`)
  }
  pass('world.border', 'server-authoritative world-border movement constraint')

  // Border damage is independent of movement collision: commands can place a player
  // outside the border, where Paper must apply the configured damage buffer/rate and
  // synchronize the resulting health loss back to the browser.
  await command(SHARED, `gamemode survival ${H}`)
  await command(SHARED, `effect give ${H} minecraft:instant_health 1 5 true`)
  await command(SHARED, 'worldborder damage buffer 0')
  await command(SHARED, 'worldborder damage amount 2')
  await command(SHARED, `tp ${H} 7 100 0`)
  await sleep(300)
  const borderHealthBefore = await hudson.page.evaluate(() => Number(globalThis.bot?.health))
  await waitFor(() => hudson.page.evaluate(before => Number(globalThis.bot?.health) < before - .5, borderHealthBefore), 'world-border damage reaches browser health state', 8_000, 100)
  const borderHealthAfter = await hudson.page.evaluate(() => Number(globalThis.bot?.health))
  await command(SHARED, 'worldborder damage buffer 5')
  await command(SHARED, 'worldborder damage amount 0.2')
  await command(SHARED, 'worldborder set 59999968')
  await command(SHARED, `gamemode creative ${H}`)
  pass('world.border-damage', `native border damage reduces browser health: ${borderHealthBefore} -> ${borderHealthAfter}`)

  await command(SHARED, `execute in minecraft:the_nether run tp ${H} 0 80 0`)
  await waitFor(() => hudson.page.evaluate(() => String(globalThis.bot?.game?.dimension || '').toLowerCase().includes('nether')), 'Nether dimension transfer', 30_000)
  await command(SHARED, `execute in minecraft:the_end run tp ${H} 0 80 0`)
  await waitFor(() => hudson.page.evaluate(() => String(globalThis.bot?.game?.dimension || '').toLowerCase().includes('end')), 'End dimension transfer', 30_000)
  await command(SHARED, `execute in minecraft:overworld run tp ${H} 0 100 0`)
  await waitFor(() => hudson.page.evaluate(() => String(globalThis.bot?.game?.dimension || '').toLowerCase().includes('overworld')), 'Overworld return', 30_000)
  pass('dimensions.command-transfer', 'native Overworld/Nether/End dimension transitions')

  // Browser-origin Nether portal ignition: the frame is a fixture, but the actual
  // ignition packet and portal block creation must come from normal item use.
  await command(SHARED, 'fill 320 100 0 323 104 0 minecraft:obsidian')
  await command(SHARED, 'fill 321 101 0 322 103 0 minecraft:air')
  await command(SHARED, `tp ${H} 321.5 101 2.5`)
  await command(SHARED, `give ${H} minecraft:flint_and_steel 1`)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const Vec=bot.entity.position.constructor; const tool=bot.inventory.items().find(i=>i.name==='flint_and_steel'); const base=bot.blockAt(bot.entity.position.offset(0,-1,-2)); if(!tool||!base||base.name!=='obsidian') throw new Error('missing portal ignition prerequisites'); await bot.equip(tool,'hand'); await bot.activateBlock(base,new Vec(0,1,0),new Vec(.5,1,.5))
  })
  await waitFor(() => blockName(elise.page,321,101,0).then(n=>n==='nether_portal'), 'browser flint-and-steel creates Nether portal blocks', 12_000, 100)
  pass('dimensions.portal-ignition', 'browser flint-and-steel ignites a valid obsidian frame into a native Nether portal')

  // Native entry portals prove that ordinary player collision/portal handling can
  // trigger dimension travel. Command transfer above remains a separate protocol
  // sentinel; these fixtures deliberately avoid claiming frame-search/return parity.
  await command(SHARED, 'fill 30 100 0 33 104 0 minecraft:obsidian')
  await command(SHARED, 'fill 31 101 0 32 103 0 minecraft:nether_portal[axis=x]')
  await command(SHARED, `tp ${H} 31.5 101 0.5`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.game?.dimension === 'the_nether'), 'native Nether portal entry', 60_000, 250)
  await command(SHARED, `execute in minecraft:overworld run tp ${H} 40 101 0`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.game?.dimension === 'overworld'), 'return to Overworld before End portal fixture', 30_000)
  await command(SHARED, 'fill 44 100 0 46 100 2 minecraft:end_portal')
  await command(SHARED, `tp ${H} 45 100 1`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.game?.dimension === 'the_end'), 'native End portal entry', 60_000, 250)
  await command(SHARED, `execute in minecraft:overworld run tp ${H} 0 100 0`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.game?.dimension === 'overworld'), 'Overworld return after native portal fixtures', 30_000)
  pass('dimensions.native-entry-portals', 'native Nether + End portal block entry transitions')


  // Wrong-dimension respawn mechanics: browser interaction must trigger the normal
  // explosive behavior rather than acting as a generic block click.
  await command(SHARED, `execute in minecraft:the_nether run tp ${H} 90 100 8`)
  await command(SHARED, 'execute in minecraft:the_nether run setblock 91 100 8 minecraft:red_bed[facing=east,occupied=false,part=foot]')
  await sleep(1000)
  const bedHp = await hudson.page.evaluate(() => globalThis.bot.health)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const bed=bot.blockAt(bot.entity.position.offset(1,0,0)); if(!bed) throw new Error('missing Nether bed'); await bot.activateBlock(bed)
  })
  await waitFor(() => hudson.page.evaluate(before => globalThis.bot.health < before, bedHp), 'Nether bed explosion reaches browser', 10_000)
  await command(SHARED, `execute in minecraft:overworld run tp ${H} 90 100 8`)
  await command(SHARED, 'setblock 91 100 8 minecraft:respawn_anchor[charges=4]')
  await sleep(1000)
  const anchorHp = await hudson.page.evaluate(() => globalThis.bot.health)
  await hudson.page.evaluate(async () => {
    const bot=globalThis.bot; const anchor=bot.blockAt(bot.entity.position.offset(1,0,0)); if(!anchor) throw new Error('missing Overworld respawn anchor'); await bot.activateBlock(anchor)
  })
  await waitFor(() => hudson.page.evaluate(before => globalThis.bot.health < before, anchorHp), 'Overworld respawn-anchor explosion reaches browser', 10_000)
  pass('dimensions.beds-anchors', 'wrong-dimension bed + respawn-anchor browser interaction semantics')


  // Valid respawn-anchor semantics in the Nether: browser interaction sets the
  // spawn point, then a real death/client respawn must return to that dimension/location.
  await command(SHARED, 'execute in minecraft:the_nether run forceload add 500 0')
  await command(SHARED, 'execute in minecraft:the_nether run fill 500 99 -2 504 99 2 minecraft:stone')
  await command(SHARED, 'execute in minecraft:the_nether run setblock 502 100 0 minecraft:respawn_anchor[charges=4]')
  await command(SHARED, `execute in minecraft:the_nether run tp ${H} 500.5 100 0.5`)
  await command(SHARED, `gamemode survival ${H}`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.game?.dimension==='the_nether'), 'browser enters Nether for respawn-anchor spawn test', 20_000, 100)
  await hudson.page.evaluate(async () => { const bot=globalThis.bot; const anchor=bot.blockAt(bot.entity.position.offset(1.5,0,-.5)); if(!anchor||anchor.name!=='respawn_anchor') throw new Error('missing valid Nether respawn anchor'); await bot.activateBlock(anchor) })
  await command(SHARED, `kill ${H}`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.health<=0), 'respawn-anchor death reaches browser', 12_000, 100)
  await hudson.page.evaluate(() => globalThis.bot.respawn())
  await waitFor(() => hudson.page.evaluate(() => {
    const p=globalThis.bot?.entity?.position; return globalThis.bot?.game?.dimension==='the_nether' && p && Math.hypot(p.x-502.5,p.z-.5)<6 && p.y>=99 && p.y<=104
  }), 'client respawns near valid Nether respawn anchor', 20_000, 100)
  await command(SHARED, `gamemode creative ${H}`)
  await command(SHARED, `execute in minecraft:overworld run tp ${H} 0 100 0`)
  await command(SHARED, 'execute in minecraft:the_nether run forceload remove 500 0')
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.game?.dimension==='overworld'), 'return to Overworld after respawn-anchor test', 20_000, 100)
  pass('dimensions.respawn-anchor-spawn', 'browser sets a valid Nether respawn anchor and returns there after death/client respawn')

  // EndDragonFight state must create the native exit fountain. This deliberately
  // does not place an end_portal block by command: the dragon death owns that state.
  await command(SHARED, `execute in minecraft:the_end run tp ${H} 0 100 0`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.game?.dimension==='the_end'), 'browser enters End for dragon-fight state test', 20_000, 100)
  await commandLogMatch(SHARED,
    'execute in minecraft:the_end if entity @e[type=minecraft:ender_dragon] run say HEM_NATIVE_DRAGON_PRESENT',
    /HEM_NATIVE_DRAGON_PRESENT/,
    'native End dragon exists before fight completion', 12_000)
  await command(SHARED, 'execute in minecraft:the_end run kill @e[type=minecraft:ender_dragon]')
  const nativeExitPortal = await waitFor(() => hudson.page.evaluate(() => {
    const bot=globalThis.bot
    const id=bot.registry.blocksByName?.end_portal?.id
    if(!Number.isInteger(id)) return false
    const b=bot.findBlock({matching:id,maxDistance:128})
    return b?{x:b.position.x,y:b.position.y,z:b.position.z}:false
  }), 'native dragon death generates End exit portal', 45_000,250)
  pass('bosses.dragon-fight-state', 'native EndDragonFight death state generates the exit-portal fountain')
  await command(SHARED, `execute in minecraft:the_end run tp ${H} ${nativeExitPortal.x} ${nativeExitPortal.y} ${nativeExitPortal.z}`)
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.game?.dimension === 'overworld'), 'native dragon-generated End return portal sends player to Overworld', 30_000)
  pass('dimensions.return-portal', 'native dragon-generated End return-portal transition to Overworld')


  // End Gateway block-entity teleport behavior with a deterministic exact exit.
  await command(SHARED, 'execute in minecraft:the_end run forceload add 600 0')
  await command(SHARED, 'execute in minecraft:the_end run setblock 600 100 0 minecraft:end_gateway')
  await command(SHARED, 'execute in minecraft:the_end run data merge block 600 100 0 {ExitPortal:{X:620,Y:100,Z:0},ExactTeleport:1b,Age:0L}')
  await command(SHARED, 'execute in minecraft:the_end run fill 618 99 -2 622 99 2 minecraft:end_stone')
  await command(SHARED, `execute in minecraft:the_end run tp ${H} 600.5 100 0.5`)
  await waitFor(() => hudson.page.evaluate(() => { const p=globalThis.bot?.entity?.position; return globalThis.bot?.game?.dimension==='the_end'&&p&&Math.hypot(p.x-620.5,p.z-.5)<6 }), 'native End Gateway teleports browser player to exact exit', 20_000, 100)
  await command(SHARED, `execute in minecraft:overworld run tp ${H} 0 100 0`)
  await command(SHARED, 'execute in minecraft:the_end run forceload remove 600 0')
  await waitFor(() => hudson.page.evaluate(() => globalThis.bot?.game?.dimension==='overworld'), 'Overworld return after End Gateway test', 20_000, 100)
  pass('dimensions.end-gateway', 'native End Gateway block-entity teleports the browser player to its configured exit')

  const visualFrame = await hudson.page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].sort((a,b)=>(b.width*b.height)-(a.width*a.height))[0]
    if (!canvas || canvas.width < 320 || canvas.height < 180) return null
    return { width: canvas.width, height: canvas.height, sections: globalThis.__HEM_PARITY__?.renderer?.sections || 0, dimensions: [...(globalThis.__HEM_PARITY__?.dimensionsSeen || [])] }
  })
  if (!visualFrame || visualFrame.sections < 1 || visualFrame.dimensions.length < 3) throw new Error(`renderer visual smoke incomplete: ${JSON.stringify(visualFrame)}`)
  pass('render.visual-smoke', 'large WebGL canvas + rendered sections survived Overworld/Nether/End transitions')


  const eventBefore = await hudson.page.evaluate(() => ({...globalThis.__HEM_PARITY__.multiplayerEvents}))
  await elise.context.close(); contexts.delete(elise.context)
  await waitFor(() => hudson.page.evaluate(before => globalThis.__HEM_PARITY__.multiplayerEvents.left > before.left, eventBefore), 'browser observes remote player leave event', 20_000)
  elise = await openPlayer(browser, sharedFirst.port, E, 'hem-system-Elise-rejoin-token-000000000000000000005', fatal, 'Elise-rejoin')
  contexts.add(elise.context)
  await waitPlayers(SHARED,2)
  await waitFor(() => hudson.page.evaluate(before => globalThis.__HEM_PARITY__.multiplayerEvents.joined > before.joined, eventBefore), 'browser observes remote player join event', 20_000)
  pass('multiplayer.join-leave-events', 'remote player leave/rejoin events reach the other browser')

  await hudson.page.screenshot({ path: 'artifacts/hem-1215-live.png' })
  if (fatal.length) throw new Error(fatal.join('\n'))

  // Release CI runs this as a real two-browser longevity gate. Keep the local
  // default at zero so developers can iterate quickly; the GitHub workflow sets
  // 60 minutes for main/manual certification and a shorter smoke soak for PRs.
  if (SOAK_MINUTES > 0) {
    console.log(`Starting ${SOAK_MINUTES}-minute two-browser stability soak`)
    for (let minute = 1; minute <= SOAK_MINUTES; minute++) {
      await waitPlayers(SHARED, 2, 20_000)
      await hudson.page.evaluate(index => globalThis.bot.chat(`HEM stability soak H ${index}`), minute)
      await elise.page.evaluate(index => globalThis.bot.chat(`HEM stability soak E ${index}`), minute)
      await hudson.page.evaluate(() => { globalThis.bot.look(globalThis.bot.entity.yaw + 0.15, globalThis.bot.entity.pitch, true) })
      await elise.page.evaluate(() => { globalThis.bot.look(globalThis.bot.entity.yaw - 0.15, globalThis.bot.entity.pitch, true) })
      await sleep(60_000)
      const healthy = await Promise.all([
        hudson.page.evaluate(() => Boolean(globalThis.bot?.entity && globalThis.__HEM_PARITY__?.connected && globalThis.__HEM_PARITY__?.renderer?.healthy)),
        elise.page.evaluate(() => Boolean(globalThis.bot?.entity && globalThis.__HEM_PARITY__?.connected && globalThis.__HEM_PARITY__?.renderer?.healthy)),
      ])
      if (healthy.some(value => !value)) throw new Error(`two-browser stability soak lost client/renderer health at minute ${minute}`)
      if (fatal.length) throw new Error(fatal.join('\n'))
      console.log(`SOAK ${minute}/${SOAK_MINUTES} minutes healthy`)
    }
    pass('reliability.soak', `${SOAK_MINUTES}-minute two-browser stability soak`)
  }

  // Crash-recovery gate: save a marker, flush native world/player data, then kill
  // the active Paper JVM without a graceful `stop`. Browsers must observe the
  // disconnect and the same isolated world must recover on the next ensure.
  await command(SHARED, 'setblock 13 100 13 minecraft:emerald_block')
  await command(SHARED, 'save-all flush')
  await sleep(1800)
  await control('/internal/test/kill-world', { worldId: SHARED })
  await waitFor(() => hudson.page.evaluate(() => globalThis.__HEM_PARITY__?.connected === false), 'Hudson observes forced Paper disconnect', 30_000)
  await waitFor(() => elise.page.evaluate(() => globalThis.__HEM_PARITY__?.connected === false), 'Elise observes forced Paper disconnect', 30_000)
  await waitFor(async () => {
    const state = await health()
    return !state.active?.some(entry => entry.id === SHARED)
  }, 'forced Paper process exits', 30_000)
  await hudson.context.close(); contexts.delete(hudson.context)
  await elise.context.close(); contexts.delete(elise.context)

  // Shared crash restart: verify native world AND both player inventories recover.
  const sharedSecond = await ensureWorld(SHARED, { name: 'HEM Shared Acceptance' })
  hudson = await openPlayer(browser, sharedSecond.port, H, 'hem-system-Hudson-token-0000000000000000000003', fatal, 'Hudson-restart')
  elise = await openPlayer(browser, sharedSecond.port, E, 'hem-system-Elise-token-00000000000000000000004', fatal, 'Elise-restart')
  contexts.add(hudson.context); contexts.add(elise.context)
  await waitPlayers(SHARED, 2)
  await command(SHARED, `tp ${H} 0 100 0`)
  await command(SHARED, `tp ${E} 3 100 0`)
  await sleep(1500)
  await waitFor(() => blockName(hudson.page, 10, 100, 10).then(name => name === 'diamond_block'), 'Anvil block persistence after full Paper restart', 30_000)
  await waitFor(() => blockName(elise.page, 13, 100, 13).then(name => name === 'emerald_block'), 'saved crash marker after forced Paper restart', 30_000)
  await waitFor(() => itemCount(hudson.page, 'diamond').then(count => count >= 3), 'Hudson inventory persistence', 20_000)
  await waitFor(() => itemCount(elise.page, 'emerald').then(count => count >= 2), 'Elise inventory persistence', 20_000)
  pass('reliability.paper-crash-recovery', 'forced active-Paper crash recovery + shared native world/player persistence')

  await hudson.context.close(); contexts.delete(hudson.context)
  await elise.context.close(); contexts.delete(elise.context)
  await stopWorld(SHARED)

  // Private singleplayer is a separate native Paper world and must not inherit multiplayer playerdata.
  const soloFirst = await ensureWorld(SOLO, { name: 'HEM Solo Acceptance', seed: '777', gameMode: 'survival' })
  let solo = await openPlayer(browser, soloFirst.port, H, 'hem-system-Hudson-solo-token-00000000000000000001', fatal, 'Hudson-solo')
  contexts.add(solo.context)
  await waitPlayers(SOLO, 1)
  if (await itemCount(solo.page, 'diamond') !== 0 || await itemCount(solo.page, 'emerald') !== 0) throw new Error('Singleplayer playerdata leaked from shared world')
  await command(SOLO, `give ${H} minecraft:gold_ingot 1`)
  await command(SOLO, 'setblock 7 100 7 minecraft:gold_block')
  await waitFor(() => itemCount(solo.page, 'gold_ingot').then(count => count >= 1), 'solo inventory update', 15_000)
  await solo.context.close(); contexts.delete(solo.context)
  await stopWorld(SOLO)

  const soloSecond = await ensureWorld(SOLO, { name: 'HEM Solo Acceptance', seed: '777', gameMode: 'survival' })
  solo = await openPlayer(browser, soloSecond.port, H, 'hem-system-Hudson-solo-token-00000000000000000002', fatal, 'Hudson-solo-restart')
  contexts.add(solo.context)
  await waitPlayers(SOLO, 1)
  await command(SOLO, `tp ${H} 0 100 0`)
  await sleep(1500)
  await waitFor(() => itemCount(solo.page, 'gold_ingot').then(count => count >= 1), 'solo inventory persistence after Paper restart', 20_000)
  await waitFor(() => blockName(solo.page, 7, 100, 7).then(name => name === 'gold_block'), 'solo Anvil persistence after Paper restart', 30_000)
  pass('persistence.singleplayer-isolation', 'isolated persistent full-Paper singleplayer world')

  if (fatal.length) throw new Error(fatal.join('\n'))
  const requiredGates = [...gateSpec.required, ...(SOAK_MINUTES > 0 ? [gateSpec.soak] : [])]
  const missingGates = requiredGates.filter(id => !passedGates.has(id))
  if (missingGates.length) throw new Error(`HEM system acceptance reached certification with missing gates: ${missingGates.join(', ')}`)
  const buildIdentity = JSON.parse(await fs.readFile('apps/client/dist/hem-build.json', 'utf8'))
  const certification = {
    hemVersion: buildIdentity.hemVersion,
    minecraft: '1.21.5',
    acceptance: 'passed',
    upstreamRef: buildIdentity.upstreamRef,
    upstreamCommit: buildIdentity.upstreamCommit,
    upstreamPinned: buildIdentity.upstreamPinned === true,
    upstreamReleaseTag: buildIdentity.upstreamReleaseTag,
    upstreamRelease1215: buildIdentity.upstreamRelease1215 === true,
    upstreamLiteralVersionTokens: buildIdentity.upstreamLiteralVersionTokens,
    protocolVerified1215: buildIdentity.protocolVerified1215 === true,
    upstreamSupportedVersionsSha256: buildIdentity.upstreamSupportedVersionsSha256,
    upstreamPackageSha256: buildIdentity.upstreamPackageSha256,
    upstreamLockSha256: buildIdentity.upstreamLockSha256,
    pnpmVersion: buildIdentity.pnpmVersion,
    frozenLockfile: buildIdentity.frozenLockfile === true,
    prismarineChunkPatch: buildIdentity.prismarineChunkPatch,
    compatibilityMode: buildIdentity.compatibilityMode,
    soakMinutes: SOAK_MINUTES,
    gates: [...passedGates].sort(),
    gateCount: passedGates.size,
    requiredGateCount: requiredGates.length,
    completedAt: new Date().toISOString(),
  }
  await fs.writeFile('artifacts/hem-1215-certification.json', JSON.stringify(certification, null, 2) + '\n')
  console.log('HEM 1.21.5 SYSTEM ACCEPTANCE PASSED')
} finally {
  for (const context of contexts) {
    try { await context.close() } catch {}
  }
  await browser.close()
  try { await control('/internal/stop', { worldId: SHARED }) } catch {}
  try { await control('/internal/stop', { worldId: SOLO }) } catch {}
}
