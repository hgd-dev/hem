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
