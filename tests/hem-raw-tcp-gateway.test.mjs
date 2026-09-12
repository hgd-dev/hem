import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

const require = createRequire(import.meta.url)
const gateway = require('../apps/proxy/server.cjs')

class FakeWs extends EventEmitter {
  static OPEN = 1
  constructor () {
    super()
    this.readyState = FakeWs.OPEN
    this.sent = []
    this.closeCalls = []
    this.bufferedAmount = 0
  }
  send (data, options, cb) {
    this.sent.push(Buffer.from(data))
    cb?.()
  }
  close (code, reason) {
    this.closeCalls.push({ code, reason })
    this.readyState = 3
    this.emit('close', code, Buffer.from(reason || ''))
  }
}

class FakeTcp extends EventEmitter {
  constructor () {
    super()
    this.writes = []
    this.writeResults = []
    this.destroyCalls = 0
    this.endCalls = 0
    this.setTimeoutCalls = []
    this.connecting = true
    this.destroyed = false
  }
  setTimeout (value) { this.setTimeoutCalls.push(value) }
  write (data) {
    this.writes.push(Buffer.from(data))
    return this.writeResults.length ? this.writeResults.shift() : true
  }
  destroy () { this.destroyCalls++; this.destroyed = true }
  end () { this.endCalls++ }
  connectNow () { this.connecting = false; this.emit('connect') }
}

test('gateway validates origin and world port range', () => {
  assert.equal(gateway.validatePort('31008', 31000, 31009), 31008)
  assert.throws(() => gateway.validatePort('30999', 31000, 31009), /port/i)
  assert.throws(() => gateway.validatePort('not-a-port', 31000, 31009), /port/i)
  assert.equal(gateway.isAllowedOrigin('http://127.0.0.1:4173', 'http://127.0.0.1:4173'), true)
  assert.equal(gateway.isAllowedOrigin('https://evil.example', 'http://127.0.0.1:4173'), false)
  assert.equal(gateway.isAllowedOrigin('https://anything', '*'), true)
})

test('gateway target selection always uses configured MC_HOST', () => {
  const target = gateway.resolveTarget({ requestedPort: '31008', host: 'orchestrator', start: 31000, end: 31009 })
  assert.deepEqual(target, { host: 'orchestrator', port: 31008 })
  assert.equal(Object.hasOwn(target, 'requestedHost'), false)
})

test('browser frames are forwarded byte-for-byte to TCP in order', () => {
  const ws = new FakeWs()
  const tcp = new FakeTcp()
  const state = gateway.createDiagnosticState({ id: 'c1', port: 31008 })
  gateway.bridgeHemConnection({ ws, tcp, state, WebSocketOpen: FakeWs.OPEN })
  ws.emit('message', Buffer.from([1, 2]), true)
  ws.emit('message', Buffer.from([3, 4]), true)
  assert.equal(tcp.writes.length, 0, 'frames wait for TCP connect')
  tcp.connectNow()
  assert.deepEqual(tcp.writes, [Buffer.from([1, 2]), Buffer.from([3, 4])])
  assert.equal(state.wsFramesReceived, 2)
  assert.equal(state.wsBytesReceived, 4)
  assert.equal(state.tcpWriteCalls, 2)
  assert.equal(state.tcpBytesWritten, 4)
  assert.ok(tcp.setTimeoutCalls.length >= 1); assert.ok(tcp.setTimeoutCalls.every(value => value === 0))
})

test('TCP backpressure pauses later browser frames until drain', () => {
  const ws = new FakeWs()
  const tcp = new FakeTcp()
  tcp.writeResults = [false, true]
  const state = gateway.createDiagnosticState({ id: 'c2', port: 31008 })
  gateway.bridgeHemConnection({ ws, tcp, state, WebSocketOpen: FakeWs.OPEN })
  tcp.connectNow()
  ws.emit('message', Buffer.from([1]), true)
  ws.emit('message', Buffer.from([2]), true)
  assert.deepEqual(tcp.writes, [Buffer.from([1])])
  assert.equal(state.tcpBackpressureCount, 1)
  tcp.emit('drain')
  assert.deepEqual(tcp.writes, [Buffer.from([1]), Buffer.from([2])])
  assert.equal(state.tcpDrainCount, 1)
})

test('TCP data is forwarded byte-for-byte to websocket in stream order', () => {
  const ws = new FakeWs()
  const tcp = new FakeTcp()
  const state = gateway.createDiagnosticState({ id: 'c3', port: 31008 })
  gateway.bridgeHemConnection({ ws, tcp, state, WebSocketOpen: FakeWs.OPEN })
  tcp.connectNow()
  tcp.emit('data', Buffer.from([9, 8]))
  tcp.emit('data', Buffer.from([7, 6]))
  assert.deepEqual(ws.sent, [Buffer.from([9, 8]), Buffer.from([7, 6])])
  assert.equal(state.tcpBytesReceived, 4)
  assert.equal(state.wsFramesSent, 2)
  assert.equal(state.wsBytesSent, 4)
})

test('websocket close destroys TCP exactly once', () => {
  const ws = new FakeWs()
  const tcp = new FakeTcp()
  const state = gateway.createDiagnosticState({ id: 'c4', port: 31008 })
  gateway.bridgeHemConnection({ ws, tcp, state, WebSocketOpen: FakeWs.OPEN })
  tcp.connectNow()
  ws.emit('close', 1000, Buffer.from('client-end'))
  ws.emit('close', 1000, Buffer.from('again'))
  assert.equal(tcp.destroyCalls, 1)
})

test('TCP close closes websocket exactly once with a non-secret reason', () => {
  const ws = new FakeWs()
  const tcp = new FakeTcp()
  const state = gateway.createDiagnosticState({ id: 'c5', port: 31008 })
  gateway.bridgeHemConnection({ ws, tcp, state, WebSocketOpen: FakeWs.OPEN })
  tcp.connectNow()
  tcp.emit('close', false)
  tcp.emit('close', false)
  assert.equal(ws.closeCalls.length, 1)
  assert.match(ws.closeCalls[0].reason, /tcp/i)
})

test('diagnostics count transport metadata without payload content', () => {
  const state = gateway.createDiagnosticState({ id: 'safe-id1', port: 31008 })
  assert.equal(state.id, 'safe-id1')
  assert.equal(state.port, 31008)
  assert.equal(Object.values(state).some(value => Buffer.isBuffer(value)), false)
  assert.equal(JSON.stringify(state).includes('payload'), false)
})

function playKeepAliveFrame ({ direction, idBytes, compressedEnvelope = true }) {
  const packetId = direction === 'clientbound' ? 0x26 : 0x1a
  const id = Buffer.from(idBytes)
  assert.equal(id.length, 8)
  const payload = compressedEnvelope
    ? Buffer.concat([Buffer.from([0x00, packetId]), id])
    : Buffer.concat([Buffer.from([packetId]), id])
  assert.ok(payload.length < 128)
  return Buffer.concat([Buffer.from([payload.length]), payload])
}

test('gateway fast-path replies to a Paper 1.21.5 play keepalive before the browser can run', () => {
  const ws = new FakeWs()
  const tcp = new FakeTcp()
  const state = gateway.createDiagnosticState({ id: 'keepalive-fast', port: 31008 })
  gateway.bridgeHemConnection({ ws, tcp, state, WebSocketOpen: FakeWs.OPEN })
  tcp.connectNow()

  const keepAliveId = Buffer.from('0102030405060708', 'hex')
  const challenge = playKeepAliveFrame({ direction: 'clientbound', idBytes: keepAliveId })
  const expectedReply = playKeepAliveFrame({ direction: 'serverbound', idBytes: keepAliveId })

  tcp.emit('data', challenge)

  assert.deepEqual(tcp.writes, [expectedReply])
  assert.deepEqual(ws.sent, [challenge], 'challenge still reaches the browser unchanged')
  assert.equal(state.keepAliveFastPathSeen, 1)
  assert.equal(state.keepAliveFastPathResponses, 1)
  assert.equal(state.keepAliveDuplicateDrops, 0)
})

test('gateway keepalive fast-path recognizes a challenge split across TCP chunks exactly once', () => {
  const ws = new FakeWs()
  const tcp = new FakeTcp()
  const state = gateway.createDiagnosticState({ id: 'keepalive-split', port: 31008 })
  gateway.bridgeHemConnection({ ws, tcp, state, WebSocketOpen: FakeWs.OPEN })
  tcp.connectNow()

  const keepAliveId = Buffer.from('1122334455667788', 'hex')
  const challenge = playKeepAliveFrame({ direction: 'clientbound', idBytes: keepAliveId })
  const expectedReply = playKeepAliveFrame({ direction: 'serverbound', idBytes: keepAliveId })

  tcp.emit('data', challenge.subarray(0, 4))
  assert.equal(tcp.writes.length, 0)
  tcp.emit('data', challenge.subarray(4))

  assert.deepEqual(tcp.writes, [expectedReply])
  assert.equal(state.keepAliveFastPathResponses, 1)
  assert.deepEqual(Buffer.concat(ws.sent), challenge, 'TCP bytes remain byte-for-byte visible to the browser')
})

test('browser keepalive duplicate is dropped after gateway already answered the same challenge', () => {
  const ws = new FakeWs()
  const tcp = new FakeTcp()
  const state = gateway.createDiagnosticState({ id: 'keepalive-dedupe', port: 31008 })
  gateway.bridgeHemConnection({ ws, tcp, state, WebSocketOpen: FakeWs.OPEN })
  tcp.connectNow()

  const keepAliveId = Buffer.from('7f6e5d4c3b2a1908', 'hex')
  const challenge = playKeepAliveFrame({ direction: 'clientbound', idBytes: keepAliveId })
  const browserReply = playKeepAliveFrame({ direction: 'serverbound', idBytes: keepAliveId })

  tcp.emit('data', challenge)
  assert.deepEqual(tcp.writes, [browserReply], 'gateway writes the first valid response')

  ws.emit('message', browserReply, true)
  assert.deepEqual(tcp.writes, [browserReply], 'late browser duplicate is not sent to Paper')
  assert.equal(state.keepAliveDuplicateDrops, 1)
})

test('gateway does not mistake ordinary play packets for keepalives', () => {
  const ws = new FakeWs()
  const tcp = new FakeTcp()
  const state = gateway.createDiagnosticState({ id: 'keepalive-negative', port: 31008 })
  gateway.bridgeHemConnection({ ws, tcp, state, WebSocketOpen: FakeWs.OPEN })
  tcp.connectNow()

  const ordinaryServerFrame = Buffer.from([0x0a, 0x00, 0x27, 1, 2, 3, 4, 5, 6, 7, 8])
  const ordinaryClientFrame = Buffer.from([0x0a, 0x00, 0x1b, 1, 2, 3, 4, 5, 6, 7, 8])
  tcp.emit('data', ordinaryServerFrame)
  ws.emit('message', ordinaryClientFrame, true)

  assert.deepEqual(tcp.writes, [ordinaryClientFrame])
  assert.deepEqual(ws.sent, [ordinaryServerFrame])
  assert.equal(state.keepAliveFastPathResponses, 0)
  assert.equal(state.keepAliveDuplicateDrops, 0)
})
