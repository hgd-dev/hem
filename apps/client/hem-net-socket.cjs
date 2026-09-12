'use strict'

const stream = require('stream')
const util = require('util')
const { Buffer } = require('buffer')

const TRANSPORT_ID = 'hem-raw-tcp-v1'
const DEFAULT_PATH = '/hem-tcp'
const HIGH_WATER = 1024 * 1024
const LOW_WATER = 256 * 1024
const MAX_PENDING_WRITE = 8 * 1024 * 1024
const POLL_MS = 8

let proxy = {
  protocol: typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:',
  requestProtocol: '',
  hostname: typeof location !== 'undefined' ? location.hostname : '127.0.0.1',
  port: typeof location !== 'undefined' ? location.port : '',
  path: DEFAULT_PATH,
}

function normalizeProxyHostname (value) {
  const raw = String(value || '')
  if (!raw) return null
  try {
    const hasScheme = /^[a-z]+:\/\//i.test(raw)
    const url = new URL(hasScheme ? raw : `http://${raw}`)
    return {
      hostname: url.hostname,
      port: url.port,
      requestProtocol: hasScheme ? url.protocol : '',
    }
  } catch {
    return { hostname: raw, port: '', requestProtocol: '' }
  }
}

function createConnectionId () {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, '')
  } catch {}
  return `hem${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
}

function getProxyOrigin () {
  let protocol = proxy.protocol || 'ws:'
  if (proxy.requestProtocol === 'https:') protocol = 'wss:'
  else if (proxy.requestProtocol === 'http:') protocol = 'ws:'
  if (!protocol.endsWith(':')) protocol += ':'
  const authority = proxy.port ? `${proxy.hostname}:${proxy.port}` : proxy.hostname
  return `${protocol}//${authority}`
}

function setProxy (options = {}) {
  const next = { ...proxy, path: DEFAULT_PATH }
  if (options.hostname) {
    const parsed = normalizeProxyHostname(options.hostname)
    next.hostname = parsed.hostname
    if (parsed.port) next.port = parsed.port
    if (parsed.requestProtocol) next.requestProtocol = parsed.requestProtocol
  }
  if (options.port != null && String(options.port) !== '') next.port = String(options.port)
  if (options.requestProtocol) next.requestProtocol = options.requestProtocol
  if (options.protocol) next.protocol = options.protocol.endsWith(':') ? options.protocol : `${options.protocol}:`
  // RC39 intentionally owns one fixed gateway path. Accept the explicit HEM path
  // for tests/configuration, but never inherit the legacy /api/vm/net endpoint.
  if (options.path === DEFAULT_PATH) next.path = DEFAULT_PATH
  proxy = next
}

function normalizeConnectArgs (args) {
  let options = {}
  if (args[0] && typeof args[0] === 'object') options = { ...args[0] }
  else {
    options.port = args[0]
    if (typeof args[1] === 'string') options.host = args[1]
  }
  const cb = args[args.length - 1]
  return typeof cb === 'function' ? [options, cb] : [options]
}

function Socket (options = {}) {
  if (!(this instanceof Socket)) return new Socket(options)
  stream.Duplex.call(this, options)
  this._connecting = false
  this._host = null
  this._ws = null
  this._pendingWrite = null
  this._flushTimer = null
  this._timeoutTimer = null
  this._timeoutMs = 0
  this._closedByWebSocket = false
  this.readable = false
  this.writable = false
  this.remoteAddress = null
  this.remoteFamily = 'IPv4'
  this.remotePort = null
  this.localAddress = null
  this.localPort = null
  this.bytesRead = 0
  this.bytesWritten = 0
  this.allowHalfOpen = false
  this.__hemTransportState = {
    implementation: TRANSPORT_ID,
    connectionId: createConnectionId(),
    websocketOpens: 0,
    websocketCloses: 0,
    framesSent: 0,
    framesReceived: 0,
    bytesSent: 0,
    bytesReceived: 0,
    maxBufferedAmount: 0,
    queuedWrites: 0,
    queuedBytes: 0,
    closeReason: '',
    errors: [],
  }
}
util.inherits(Socket, stream.Duplex)

Socket.prototype._read = function () {}
Socket.prototype.setNoDelay = function () { return this }
Socket.prototype.setKeepAlive = function () { return this }
Socket.prototype.address = function () {
  return { address: this.remoteAddress, port: this.remotePort, family: this.remoteFamily }
}

Object.defineProperty(Socket.prototype, 'readyState', {
  get () {
    if (this._connecting) return 'opening'
    if (this.readable && this.writable && !this.destroyed) return 'open'
    if (this.readable && !this.writable) return 'readOnly'
    if (!this.readable && this.writable) return 'writeOnly'
    return 'closed'
  },
})

Socket.prototype._recordError = function (error) {
  const text = error instanceof Error ? error.message : String(error || 'transport error')
  this.__hemTransportState.errors.push(text.slice(0, 240))
  if (this.__hemTransportState.errors.length > 8) this.__hemTransportState.errors.shift()
}

Socket.prototype._touchTimeout = function () {
  if (this._timeoutTimer) clearTimeout(this._timeoutTimer)
  this._timeoutTimer = null
  if (!(this._timeoutMs > 0)) return
  this._timeoutTimer = setTimeout(() => this.emit('timeout'), this._timeoutMs)
}

Socket.prototype.setTimeout = function (msecs, callback) {
  const value = Number(msecs)
  this._timeoutMs = Number.isFinite(value) && value > 0 ? value : 0
  if (callback) this.once('timeout', callback)
  this._touchTimeout()
  return this
}

Socket.prototype._scheduleFlush = function () {
  if (this._flushTimer || this.destroyed) return
  this._flushTimer = setTimeout(() => {
    this._flushTimer = null
    this._flushWrite()
  }, POLL_MS)
}

Socket.prototype._flushWrite = function () {
  const pending = this._pendingWrite
  if (!pending || this.destroyed) return
  const ws = this._ws
  const OPEN = globalThis.WebSocket?.OPEN ?? 1
  if (!ws || ws.readyState !== OPEN) {
    if (this._connecting) return this._scheduleFlush()
    this._pendingWrite = null
    this.__hemTransportState.queuedWrites = 0
    this.__hemTransportState.queuedBytes = 0
    pending.cb(new Error('HEM raw TCP websocket is closed'))
    return
  }
  const buffered = Number(ws.bufferedAmount || 0)
  this.__hemTransportState.maxBufferedAmount = Math.max(this.__hemTransportState.maxBufferedAmount, buffered)
  if (buffered > HIGH_WATER) return this._scheduleFlush()
  try {
    ws.send(pending.data)
    this.bytesWritten += pending.data.length
    this.__hemTransportState.framesSent++
    this.__hemTransportState.bytesSent += pending.data.length
    this._pendingWrite = null
    this.__hemTransportState.queuedWrites = 0
    this.__hemTransportState.queuedBytes = 0
    this._touchTimeout()
    pending.cb()
  } catch (error) {
    this._pendingWrite = null
    this.__hemTransportState.queuedWrites = 0
    this.__hemTransportState.queuedBytes = 0
    this._recordError(error)
    pending.cb(error instanceof Error ? error : new Error(String(error)))
    this.destroy(error instanceof Error ? error : new Error(String(error)))
  }
}

Socket.prototype._write = function (data, encoding, cb) {
  let buffer
  try {
    buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding)
  } catch (error) {
    cb(error)
    return
  }
  if (this.destroyed || (!this._connecting && this.readyState === 'closed')) {
    cb(new Error('HEM raw TCP socket is closed'))
    return
  }
  if (buffer.length > MAX_PENDING_WRITE) {
    cb(new Error(`HEM raw TCP write exceeds ${MAX_PENDING_WRITE} byte safety limit`))
    return
  }
  if (this._pendingWrite) {
    cb(new Error('HEM raw TCP internal write ordering violation'))
    return
  }
  this._pendingWrite = { data: buffer, cb }
  this.__hemTransportState.queuedWrites = 1
  this.__hemTransportState.queuedBytes = buffer.length
  this._flushWrite()
}

Socket.prototype._final = function (cb) {
  const ws = this._ws
  const OPEN = globalThis.WebSocket?.OPEN ?? 1
  if (ws && ws.readyState === OPEN) {
    try { ws.close(1000, 'client-end') } catch {}
  }
  cb()
}

Socket.prototype._destroy = function (error, cb) {
  if (this._flushTimer) clearTimeout(this._flushTimer)
  if (this._timeoutTimer) clearTimeout(this._timeoutTimer)
  this._flushTimer = null
  this._timeoutTimer = null
  this._connecting = false
  this.readable = false
  this.writable = false
  const pending = this._pendingWrite
  this._pendingWrite = null
  this.__hemTransportState.queuedWrites = 0
  this.__hemTransportState.queuedBytes = 0
  if (pending) pending.cb(error || new Error('HEM raw TCP socket destroyed'))
  const ws = this._ws
  const OPEN = globalThis.WebSocket?.OPEN ?? 1
  const CONNECTING = globalThis.WebSocket?.CONNECTING ?? 0
  if (ws && (ws.readyState === OPEN || ws.readyState === CONNECTING)) {
    try { ws.close(1000, 'client-destroy') } catch {}
  }
  cb(error || null)
}

Socket.prototype.destroySoon = function () {
  if (this.writable) this.end()
  else this.destroy()
}

Socket.prototype.connect = function (options, cb) {
  if (!options || typeof options !== 'object') {
    const normalized = normalizeConnectArgs(arguments)
    return Socket.prototype.connect.apply(this, normalized)
  }
  if (typeof cb === 'function') this.once('connect', cb)
  const port = Number(options.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.nextTick(() => this.destroy(new Error(`Invalid TCP port: ${options.port}`)))
    return this
  }
  if (this._ws || this._connecting || this.readyState === 'open') return this
  this._connecting = true
  this.writable = true
  this._host = String(options.host || options.hostname || '')
  this.remoteAddress = this._host
  this.remotePort = port

  const url = `${getProxyOrigin()}${proxy.path || DEFAULT_PATH}?port=${encodeURIComponent(String(port))}&id=${encodeURIComponent(this.__hemTransportState.connectionId)}`
  let ws
  try {
    ws = new globalThis.WebSocket(url)
    ws.binaryType = 'arraybuffer'
  } catch (error) {
    this._recordError(error)
    process.nextTick(() => this.destroy(error))
    return this
  }
  this._ws = ws

  ws.addEventListener('open', () => {
    if (this.destroyed) return
    this._connecting = false
    this.readable = true
    this.writable = true
    this.__hemTransportState.websocketOpens++
    this._touchTimeout()
    this.emit('connect')
    this._flushWrite()
    this.read(0)
  })

  ws.addEventListener('message', event => {
    if (this.destroyed) return
    const value = event?.data
    if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) {
      const error = new Error('HEM raw TCP gateway returned non-binary websocket data')
      this._recordError(error)
      this.destroy(error)
      return
    }
    const view = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    const buffer = Buffer.from(view)
    this.bytesRead += buffer.length
    this.__hemTransportState.framesReceived++
    this.__hemTransportState.bytesReceived += buffer.length
    this._touchTimeout()
    this.push(buffer)
  })

  ws.addEventListener('error', () => {
    if (this.destroyed) return
    const error = new Error('HEM raw TCP websocket transport error')
    this._recordError(error)
    this.emit('error', error)
  })

  ws.addEventListener('close', event => {
    if (this._closedByWebSocket) return
    this._closedByWebSocket = true
    this.__hemTransportState.websocketCloses++
    const reason = String(event?.reason || '')
    const code = Number(event?.code || 0)
    this.__hemTransportState.closeReason = reason || (code ? `websocket-close-${code}` : 'websocket-closed')
    this._connecting = false
    this.writable = false
    if (this.readable) {
      this.readable = false
      this.push(null)
    }
    if (!this.destroyed) this.destroy()
  })

  return this
}

function connect () {
  const args = normalizeConnectArgs(arguments)
  const socket = new Socket(args[0])
  return Socket.prototype.connect.apply(socket, args)
}

function isIPv4 (input) {
  const parts = String(input || '').split('.')
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
}
function isIPv6 (input) { return typeof input === 'string' && input.includes(':') && /^[0-9a-f:]+$/i.test(input) }
function isIP (input) { return isIPv4(input) ? 4 : isIPv6(input) ? 6 : 0 }

module.exports = {
  Socket,
  Stream: Socket,
  connect,
  createConnection: connect,
  setProxy,
  getProxy: () => ({ ...proxy }),
  isIP,
  isIPv4,
  isIPv6,
}
