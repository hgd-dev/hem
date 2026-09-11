import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { TextDecoder, TextEncoder } from 'node:util'

const bridgeSource = fs.readFileSync('apps/client/hem-bridge.js', 'utf8')

const registryMap = names => Object.fromEntries(names.map(name => [name, { name }]))

function createClient () {
  const client = new EventEmitter()
  client.registeredChannels = []
  client.registerChannel = function (name) { this.registeredChannels.push(name) }
  client.write = () => {}
  client.serializer = { writable: true }
  return client
}

function createBot (client, chats = []) {
  const bot = new EventEmitter()
  bot._client = client
  bot.entity = { id: 1, position: { x: 0, y: 64, z: 0 } }
  bot.username = 'HEM_Test'
  bot.game = { dimension: 'minecraft:overworld' }
  bot.health = 20
  bot.registry = {
    itemsByName: registryMap(['mace', 'wind_charge', 'brown_egg', 'blue_egg', 'cactus_flower']),
    blocksByName: registryMap(['crafter', 'trial_spawner', 'vault', 'firefly_bush', 'leaf_litter', 'wildflowers', 'bush', 'short_dry_grass', 'tall_dry_grass', 'cactus_flower']),
    entitiesByName: registryMap(['pig', 'cow', 'chicken', 'sheep', 'wolf']),
  }
  bot.chat = command => chats.push(command)
  return bot
}

function createHarness ({ token = '', resume = '', sharedStorage = null } = {}) {
  const intervalCallbacks = new Map()
  let nextIntervalId = 1
  const storage = sharedStorage || new Map()
  const search = '?ip=orchestrator%3A31008&version=1.21.5&proxy=http%3A%2F%2F127.0.0.1%3A8080&username=HEM_Test&setting=fov%3A92&setting=rawMouseInput%3Atrue'
  const resumeKey = 'hem.resume.1:HEM_Test:orchestrator:31008'
  if (resume) storage.set(resumeKey, resume)
  const historyCalls = []

  const element = () => ({
    style: {}, dataset: {}, append () {}, appendChild () {},
    set textContent (value) { this._textContent = value },
    get textContent () { return this._textContent || '' },
  })

  const context = {
    console,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    ArrayBuffer,
    Uint8Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    Date,
    Math,
    Set,
    WeakMap,
    Promise,
    location: {
      hash: token ? `#hemToken=${encodeURIComponent(token)}` : '',
      search,
      pathname: '/',
      reload () {},
    },
    history: {
      replaceState (...args) { historyCalls.push(args) },
      back () {},
    },
    sessionStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    document: {
      createElement: element,
      documentElement: { append () {}, appendChild () {} },
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        minecraft: '1.21.5',
        hemVersion: '1.0.0-rc.38',
        compatibilityMode: 'pinned-v0.1.99-lockfile-1215-verified',
        upstreamReleaseTag: 'v0.1.99',
        upstreamRelease1215: true,
        protocolVerified1215: true,
        frozenLockfile: true,
        upstreamLockSha256: 'a'.repeat(64),
        upstreamCommit: 'b'.repeat(40),
      }),
    }),
    setInterval: callback => {
      const id = nextIntervalId++
      intervalCallbacks.set(id, callback)
      return id
    },
    clearInterval: id => intervalCallbacks.delete(id),
    setTimeout: () => 0,
    clearTimeout: () => {},
    HEMKeepAliveGuard: {
      attachHemKeepAliveGuard: client => client.keepAliveState || ({ seen: 0, responses: 0, fallbacks: 0 }),
    },
    world: { sectionObjects: { one: {} } },
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(bridgeSource, context, { filename: 'hem-bridge.js' })

  const tick = () => {
    for (const callback of [...intervalCallbacks.values()]) callback()
  }

  return { context, tick, storage, resumeKey, historyCalls }
}

test('bridge tracks distinct physical client generations and reattach is idempotent', async () => {
  const harness = createHarness({ token: 'launch-token-0123456789abcdef0123456789abcdef' })
  const clientA = createClient()
  const clientB = createClient()
  const botA = createBot(clientA)
  const botB = createBot(clientB)

  harness.context.bot = botA
  harness.tick()

  const parity = harness.context.__HEM_PARITY__
  assert.equal(parity.connection.activeGenerationId, 1)
  assert.equal(parity.connection.generations.length, 1)
  assert.equal(parity.connection.generations[0].connected, true)

  harness.tick()
  assert.equal(parity.connection.activeGenerationId, 1)
  assert.equal(parity.connection.generations.length, 1)

  harness.context.bot = botB
  harness.tick()

  assert.equal(parity.connection.activeGenerationId, 2)
  assert.equal(parity.connection.generations.length, 2)
  assert.equal(parity.connection.generations[0].connected, false)
  assert.ok(parity.connection.generations[0].endedAt > 0)
  assert.equal(parity.connection.generations[1].connected, true)
})

test('bridge authorizes exactly once per physical generation and resumes every replacement connection', () => {
  const launchToken = 'launch-token-0123456789abcdef0123456789abcdef'
  const resumeToken = 'resume-token-0123456789abcdef0123456789abcdef'
  const harness = createHarness({ token: launchToken })
  const chatsA = []
  const chatsB = []
  const chatsC = []
  const botA = createBot(createClient(), chatsA)
  const botB = createBot(createClient(), chatsB)
  const botC = createBot(createClient(), chatsC)

  harness.context.bot = botA
  harness.tick()
  harness.tick()
  assert.deepEqual(chatsA.filter(value => value.startsWith('/hem auth ')), [`/hem auth ${launchToken}`])

  botA.emit('message', 'HEM: connected to world')
  const parity = harness.context.__HEM_PARITY__
  assert.equal(parity.connection.generations[0].authorization.authenticated, true)

  harness.storage.set(harness.resumeKey, resumeToken)
  harness.context.bot = botB
  harness.tick()
  harness.tick()
  assert.deepEqual(chatsB, [`/hem resume ${resumeToken}`])
  assert.equal(parity.connection.generations[1].authorization.mode, 'resume')
  assert.equal(parity.connection.generations[1].authorization.attempted, true)
  assert.equal(parity.connection.generations[1].authorization.authenticated, false)

  botB.emit('message', 'HEM: resumed to world')
  assert.equal(parity.connection.generations[1].authorization.authenticated, true)

  harness.context.bot = botC
  harness.tick()
  harness.tick()
  assert.deepEqual(chatsC, [`/hem resume ${resumeToken}`])
  assert.equal(parity.connection.generations[2].authorization.mode, 'resume')
  assert.equal(parity.connection.generations[2].authorization.attempted, true)
  assert.equal(parity.connection.generations[2].authorization.authenticated, false)
})

test('bridge preserves the complete non-secret launch query as its recovery URL', () => {
  const token = 'launch-token-abcdef0123456789abcdef0123456789'
  const harness = createHarness({ token })
  harness.context.bot = createBot(createClient())
  harness.tick()

  assert.equal(harness.context.__HEM_PARITY__.resume.recoveryUrlReady, true)
  assert.equal(harness.historyCalls.length, 1)
  const recoveryUrl = harness.historyCalls[0][2]
  assert.match(recoveryUrl, /^\/\?ip=orchestrator%3A31008/)
  assert.match(recoveryUrl, /version=1\.21\.5/)
  assert.match(recoveryUrl, /username=HEM_Test/)
  assert.equal((recoveryUrl.match(/setting=/g) || []).length, 2)
  assert.doesNotMatch(recoveryUrl, /hemToken|resume-token/i)
  assert.doesNotMatch(recoveryUrl, /#/) 
})

test('keepalive counters and resume-channel registration are isolated per physical generation', () => {
  const harness = createHarness({ token: 'launch-token-0123456789abcdef0123456789abcdef' })
  const clientA = createClient()
  clientA.keepAliveState = { seen: 3, responses: 3, fallbacks: 1 }
  const clientB = createClient()
  clientB.keepAliveState = { seen: 0, responses: 0, fallbacks: 0 }

  harness.context.bot = createBot(clientA)
  harness.tick()
  const parity = harness.context.__HEM_PARITY__
  const generationA = parity.connection.generations[0]
  assert.equal(generationA.keepAliveSeen, 3)
  assert.equal(generationA.keepAliveResponses, 3)
  assert.equal(generationA.keepAliveFallbacks, 1)
  assert.equal(generationA.resumeChannelRegistered, true)
  assert.deepEqual(clientA.registeredChannels, ['hem:session'])

  harness.context.bot = createBot(clientB)
  harness.tick()
  const generationB = parity.connection.generations[1]
  assert.equal(generationB.keepAliveSeen, 0)
  assert.equal(generationB.keepAliveResponses, 0)
  assert.equal(generationB.keepAliveFallbacks, 0)
  assert.equal(generationB.resumeChannelRegistered, true)
  assert.deepEqual(clientB.registeredChannels, ['hem:session'])
  assert.equal(parity.transport.keepAliveSeen, 0)
  assert.equal(parity.transport.keepAliveResponses, 0)
})

test('same-tab reload keeps physical generation IDs monotonic and resumes with the retained lease', () => {
  const storage = new Map()
  const launchToken = 'launch-token-0123456789abcdef0123456789abcdef'
  const resumeToken = 'resume-token-0123456789abcdef0123456789abcdef'
  const first = createHarness({ token: launchToken, sharedStorage: storage })
  first.context.bot = createBot(createClient())
  first.tick()
  assert.equal(first.context.__HEM_PARITY__.connection.activeGenerationId, 1)

  storage.set(first.resumeKey, resumeToken)
  const chats = []
  const second = createHarness({ sharedStorage: storage })
  second.context.bot = createBot(createClient(), chats)
  second.tick()
  assert.equal(second.context.__HEM_PARITY__.connection.activeGenerationId, 2)
  assert.deepEqual(chats, [`/hem resume ${resumeToken}`])
})
