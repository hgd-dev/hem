import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'

const require = createRequire(import.meta.url)
const guardPath = fileURLToPath(new URL('../apps/client/hem-keepalive-guard.cjs', import.meta.url))

const tick = () => new Promise(resolve => setTimeout(resolve, 10))

class FakeClient extends EventEmitter {
  constructor ({ upstreamKeepAlive = false } = {}) {
    super()
    this.writes = []
    this.ended = false
    this.serializer = { writable: true }
    this.write = (name, params) => { this.writes.push({ name, params }) }
    if (upstreamKeepAlive) {
      this.on('keep_alive', packet => this.write('keep_alive', { keepAliveId: packet.keepAliveId }))
    }
  }

  receiveKeepAlive (id) {
    const packet = { keepAliveId: id }
    const meta = { name: 'keep_alive' }
    // node-minecraft-protocol emits generic packet first, then the named event.
    this.emit('packet', packet, meta)
    this.emit('keep_alive', packet, meta)
  }
}


test('HEM keepalive guard replies synchronously before the named upstream event and suppresses the duplicate', async () => {
  const { attachHemKeepAliveGuard } = require(guardPath)
  const client = new FakeClient({ upstreamKeepAlive: true })
  const state = attachHemKeepAliveGuard(client)
  const packet = { keepAliveId: 789n }
  const meta = { name: 'keep_alive' }

  client.emit('packet', packet, meta)
  assert.deepEqual(client.writes, [{ name: 'keep_alive', params: { keepAliveId: 789n } }], 'reply must be written in the generic packet turn, before timers')
  assert.equal(state.seen, 1)
  assert.equal(state.responses, 1)

  client.emit('keep_alive', packet, meta)
  await tick()
  assert.deepEqual(client.writes, [{ name: 'keep_alive', params: { keepAliveId: 789n } }], 'normal upstream reply must be suppressed after HEM already answered')
  assert.equal(state.fallbacks, 0)
})

test('HEM keepalive guard falls back exactly once when upstream sends no reply', async () => {
  const { attachHemKeepAliveGuard } = require(guardPath)
  const client = new FakeClient()
  const state = attachHemKeepAliveGuard(client)
  client.receiveKeepAlive(123n)
  await tick()
  assert.deepEqual(client.writes, [{ name: 'keep_alive', params: { keepAliveId: 123n } }])
  assert.equal(state.seen, 1)
  assert.equal(state.responses, 1)
  assert.equal(state.fallbacks, 1)
})

test('HEM keepalive guard never duplicates the normal upstream keepalive reply', async () => {
  const { attachHemKeepAliveGuard } = require(guardPath)
  const client = new FakeClient({ upstreamKeepAlive: true })
  const state = attachHemKeepAliveGuard(client)
  client.receiveKeepAlive(456n)
  await tick()
  assert.deepEqual(client.writes, [{ name: 'keep_alive', params: { keepAliveId: 456n } }])
  assert.equal(state.seen, 1)
  assert.equal(state.responses, 1)
  assert.equal(state.fallbacks, 0)
})

test('HEM keepalive guard is idempotent per physical client', () => {
  const { attachHemKeepAliveGuard } = require(guardPath)
  const client = new FakeClient()
  assert.equal(attachHemKeepAliveGuard(client), attachHemKeepAliveGuard(client))
})

test('client build ships the keepalive guard before the HEM bridge', () => {
  const source = fs.readFileSync(new URL('../apps/client/build-client.mjs', import.meta.url), 'utf8')
  assert.match(source, /hem-keepalive-guard\.cjs/)
  assert.match(source, /hem-keepalive-guard\.js/)
  assert.match(source, /hem-keepalive-guard\.js[\s\S]*hem-bridge\.js/)
})


test('live acceptance requires both browser sessions to prove keepalive round trips', () => {
  const runner = fs.readFileSync(new URL('./system/browser-1215.mjs', import.meta.url), 'utf8')
  const gates = JSON.parse(fs.readFileSync(new URL('./system/required-gates-1215.json', import.meta.url), 'utf8'))
  assert.match(runner, /client\.keepalive-transport/)
  assert.match(runner, /keepAliveGuardAttached/)
  assert.match(runner, /keepAliveSeen/)
  assert.match(runner, /keepAliveResponses/)
  assert.ok(gates.required.includes('client.keepalive-transport'))
})


test('built-client identity attests the HEM keepalive guard', () => {
  const build = fs.readFileSync(new URL('../apps/client/build-client.mjs', import.meta.url), 'utf8')
  const runner = fs.readFileSync(new URL('./system/browser-1215.mjs', import.meta.url), 'utf8')
  assert.match(build, /keepAliveGuard:\s*'hem-keepalive-guard-v2'/)
  assert.match(runner, /liveBuildIdentity\.keepAliveGuard\s*!==\s*'hem-keepalive-guard-v2'/)
})
