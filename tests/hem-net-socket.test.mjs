import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const modulePath = path.resolve('apps/client/hem-net-socket.cjs')

class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances = []
  constructor (url) {
    this.url = url
    this.readyState = 0
    this.binaryType = ''
    this.bufferedAmount = 0
    this.listeners = new Map()
    this.sent = []
    this.closeCalls = []
    FakeWebSocket.instances.push(this)
  }
  addEventListener (name, fn) {
    const list = this.listeners.get(name) || []
    list.push(fn)
    this.listeners.set(name, list)
  }
  emit (name, event = {}) {
    for (const fn of this.listeners.get(name) || []) fn(event)
  }
  open () { this.readyState = FakeWebSocket.OPEN; this.emit('open') }
  send (data) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('not open')
    this.sent.push(Buffer.from(data))
  }
  close (code = 1000, reason = '') {
    this.closeCalls.push({ code, reason })
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', { code, reason, wasClean: true })
  }
}

function loadAdapter () {
  FakeWebSocket.instances.length = 0
  globalThis.WebSocket = FakeWebSocket
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

async function openedSocket () {
  const net = loadAdapter()
  net.setProxy({ hostname: 'http://127.0.0.1:8080', path: '/hem-tcp' })
  const socket = net.connect({ host: 'orchestrator', port: 31008 })
  assert.equal(FakeWebSocket.instances.length, 1)
  const ws = FakeWebSocket.instances[0]
  assert.match(ws.url, /^ws:\/\/127\.0\.0\.1:8080\/hem-tcp\?port=31008&id=[A-Za-z0-9_-]+$/)
  assert.equal(ws.binaryType, 'arraybuffer')
  ws.open()
  await tick()
  return { net, socket, ws }
}

test('one TCP connection opens exactly one binary HEM websocket', async () => {
  const { socket, ws } = await openedSocket()
  assert.equal(FakeWebSocket.instances.length, 1)
  assert.equal(socket.readyState, 'open')
  assert.equal(socket.__hemTransportState.implementation, 'hem-raw-tcp-v1')
  assert.match(socket.__hemTransportState.connectionId, /^[A-Za-z0-9_-]{8,80}$/)
  assert.equal(socket.__hemTransportState.websocketOpens, 1)
  assert.equal(ws.binaryType, 'arraybuffer')
})

test('outgoing writes preserve byte and callback order', async () => {
  const { socket, ws } = await openedSocket()
  const callbacks = []
  socket.write(Buffer.from([1, 2]), () => callbacks.push('a'))
  socket.write(Buffer.from([3, 4]), () => callbacks.push('b'))
  await tick()
  assert.deepEqual(ws.sent, [Buffer.from([1, 2]), Buffer.from([3, 4])])
  assert.deepEqual(callbacks, ['a', 'b'])
  assert.equal(socket.__hemTransportState.framesSent, 2)
  assert.equal(socket.__hemTransportState.bytesSent, 4)
})

test('high bufferedAmount delays later writes until pressure clears', async () => {
  const { socket, ws } = await openedSocket()
  ws.bufferedAmount = 2 * 1024 * 1024
  let done = false
  socket.write(Buffer.from([7, 8, 9]), () => { done = true })
  await tick(10)
  assert.equal(ws.sent.length, 0)
  assert.equal(done, false)
  assert.equal(socket.__hemTransportState.queuedWrites, 1)
  ws.bufferedAmount = 0
  await tick(30)
  assert.deepEqual(ws.sent, [Buffer.from([7, 8, 9])])
  assert.equal(done, true)
})

test('incoming ArrayBuffers are pushed synchronously in websocket order without FileReader', async () => {
  const { socket, ws } = await openedSocket()
  const chunks = []
  socket.on('data', chunk => chunks.push(Buffer.from(chunk)))
  ws.emit('message', { data: Uint8Array.from([9, 8]).buffer })
  ws.emit('message', { data: Uint8Array.from([7, 6]).buffer })
  await tick()
  assert.deepEqual(chunks, [Buffer.from([9, 8]), Buffer.from([7, 6])])
  assert.equal(socket.__hemTransportState.framesReceived, 2)
  assert.equal(socket.__hemTransportState.bytesReceived, 4)
})


test('websocket transport error terminally closes the HEM socket instead of leaving it open', async () => {
  const { socket, ws } = await openedSocket()
  let closeCount = 0
  socket.on('error', () => {})
  socket.on('close', () => { closeCount++ })

  ws.emit('error', {})
  await tick()

  assert.equal(socket.destroyed, true)
  assert.equal(socket.readyState, 'closed')
  assert.equal(closeCount, 1)
  assert.match(socket.__hemTransportState.closeReason, /websocket-error|transport-error/i)
  assert.ok(socket.__hemTransportState.errors.some(value => /websocket transport error/i.test(value)))
})

test('write after websocket close fails loudly', async () => {
  const { socket, ws } = await openedSocket()
  ws.close(1011, 'test close')
  await tick()
  const error = await new Promise(resolve => socket.write(Buffer.from([1]), err => resolve(err)))
  assert.ok(error instanceof Error)
  assert.match(error.message, /closed|writable|destroyed/i)
})

test('close and destroy are idempotent and record reason once', async () => {
  const { socket, ws } = await openedSocket()
  let closeCount = 0
  socket.on('close', () => { closeCount++ })
  ws.close(1011, 'gateway-failure')
  socket.destroy()
  socket.destroy()
  await tick()
  assert.equal(closeCount, 1)
  assert.equal(socket.__hemTransportState.websocketCloses, 1)
  assert.match(socket.__hemTransportState.closeReason, /gateway-failure|1011/)
})

test('setTimeout(0) disables browser-side idle timeout', async () => {
  const { socket } = await openedSocket()
  let timedOut = false
  socket.setTimeout(5, () => { timedOut = true })
  socket.setTimeout(0)
  await tick(20)
  assert.equal(timedOut, false)
})

test('adapter exports the net surface required by the pinned client', () => {
  const net = loadAdapter()
  for (const name of ['Socket', 'Stream', 'connect', 'createConnection', 'setProxy', 'isIP', 'isIPv4', 'isIPv6']) {
    assert.equal(typeof net[name], 'function', `${name} must be exported`)
  }
})
