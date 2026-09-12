'use strict'

const crypto = require('crypto')
const net = require('net')

const MAX_CLIENT_QUEUE_BYTES = 8 * 1024 * 1024
const MAX_WS_BUFFERED_BYTES = 8 * 1024 * 1024
const MAX_INSPECT_FRAME_BYTES = 16 * 1024 * 1024
const KEEPALIVE_DEDUPE_MS = 60_000
// Minecraft Java 1.21.5 play IDs from the pinned minecraft-data protocol: server->client 0x26, client->server 0x1a.
// HEM pins Paper network-compression-threshold=256, so the 10-byte keepalive packet is carried with dataLength=0.
const PLAY_CLIENTBOUND_KEEP_ALIVE_ID = 0x26
const PLAY_SERVERBOUND_KEEP_ALIVE_ID = 0x1a

function validatePort (value, start, end) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < start || port > end) {
    throw new Error(`Port must be an integer in the HEM world range ${start}-${end}`)
  }
  return port
}

function isAllowedOrigin (requested, allowed) {
  if (allowed === '*' || !allowed) return true
  return String(requested || '') === String(allowed)
}

function resolveTarget ({ requestedPort, host, start, end }) {
  return { host, port: validatePort(requestedPort, start, end) }
}

function safeConnectionId (candidate) {
  const value = String(candidate || '')
  if (/^[A-Za-z0-9_-]{8,80}$/.test(value)) return value
  return crypto.randomBytes(12).toString('hex')
}

function createDiagnosticState ({ id, port }) {
  return {
    id: safeConnectionId(id),
    port: Number(port),
    openedAt: Date.now(),
    tcpConnectedAt: 0,
    closedAt: 0,
    closeReason: '',
    wsFramesReceived: 0,
    wsBytesReceived: 0,
    tcpWriteCalls: 0,
    tcpBytesWritten: 0,
    tcpBackpressureCount: 0,
    tcpDrainCount: 0,
    tcpBytesReceived: 0,
    wsFramesSent: 0,
    wsBytesSent: 0,
    maxWsBufferedAmount: 0,
    queuedClientFrames: 0,
    queuedClientBytes: 0,
    keepAliveFastPathSeen: 0,
    keepAliveFastPathResponses: 0,
    keepAliveDuplicateDrops: 0,
    keepAliveFastPathLastAt: 0,
    errors: [],
  }
}

function recordError (state, error) {
  const text = error instanceof Error ? error.message : String(error || 'transport error')
  state.errors.push(text.slice(0, 240))
  if (state.errors.length > 8) state.errors.shift()
}

function readVarIntPrefix (buffer) {
  let value = 0
  let shift = 0
  const limit = Math.min(buffer.length, 5)
  for (let index = 0; index < limit; index++) {
    const byte = buffer[index]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: value >>> 0, bytes: index + 1 }
    shift += 7
  }
  if (buffer.length >= 5) return { invalid: true }
  return null
}

function parsePlayKeepAliveFrame (frame, packetId) {
  const prefix = readVarIntPrefix(frame)
  if (!prefix || prefix.invalid) return null
  const payloadLength = prefix.value
  if (prefix.bytes + payloadLength !== frame.length) return null
  const payload = frame.subarray(prefix.bytes)

  if (payload.length === 10 && payload[0] === 0x00 && payload[1] === packetId) {
    return { idBytes: Buffer.from(payload.subarray(2, 10)), compressedEnvelope: true }
  }
  return null
}

function encodePlayKeepAliveFrame ({ idBytes, packetId, compressedEnvelope }) {
  const id = Buffer.from(idBytes)
  if (id.length !== 8) throw new Error('Minecraft keepalive id must be 8 bytes')
  const payload = compressedEnvelope
    ? Buffer.concat([Buffer.from([0x00, packetId]), id])
    : Buffer.concat([Buffer.from([packetId]), id])
  if (payload.length >= 128) throw new Error('Unexpected keepalive frame length')
  return Buffer.concat([Buffer.from([payload.length]), payload])
}

function bridgeHemConnection ({ ws, tcp, state, WebSocketOpen = 1 }) {
  const clientQueue = []
  let clientQueueBytes = 0
  let tcpConnected = !tcp.connecting
  let tcpBlocked = false
  let wsClosed = false
  let tcpClosed = false
  let terminated = false
  let serverInspectBuffer = Buffer.alloc(0)
  const fastAnsweredKeepAlives = new Map()

  const updateQueueState = () => {
    state.queuedClientFrames = clientQueue.length
    state.queuedClientBytes = clientQueueBytes
  }

  const destroyTcpOnce = () => {
    if (tcpClosed) return
    tcpClosed = true
    try { tcp.destroy() } catch (error) { recordError(state, error) }
  }

  const closeWsOnce = (code, reason) => {
    if (wsClosed) return
    wsClosed = true
    if (!state.closeReason) state.closeReason = reason || `ws-close-${code}`
    try {
      if (ws.readyState === WebSocketOpen || ws.readyState === 0) ws.close(code, String(reason || '').slice(0, 120))
    } catch (error) { recordError(state, error) }
  }

  const terminate = (reason, code = 1011) => {
    if (terminated) return
    terminated = true
    if (!state.closedAt) state.closedAt = Date.now()
    if (!state.closeReason) state.closeReason = reason
    closeWsOnce(code, reason)
    destroyTcpOnce()
  }

  const cleanupFastAnsweredKeepAlives = () => {
    const now = Date.now()
    for (const [key, expiresAt] of fastAnsweredKeepAlives) {
      if (expiresAt <= now) fastAnsweredKeepAlives.delete(key)
    }
  }

  const queueTcpWrite = buffer => {
    clientQueue.push(Buffer.from(buffer))
    clientQueueBytes += buffer.length
    updateQueueState()
    if (clientQueueBytes > MAX_CLIENT_QUEUE_BYTES) {
      terminate('client-queue-overflow', 1013)
      return false
    }
    return true
  }

  const inspectServerFrames = chunk => {
    if (terminated) return
    serverInspectBuffer = serverInspectBuffer.length
      ? Buffer.concat([serverInspectBuffer, chunk])
      : Buffer.from(chunk)

    while (serverInspectBuffer.length) {
      const prefix = readVarIntPrefix(serverInspectBuffer)
      if (!prefix) return
      if (prefix.invalid || prefix.value > MAX_INSPECT_FRAME_BYTES) {
        recordError(state, 'minecraft-frame-inspection-reset')
        serverInspectBuffer = Buffer.alloc(0)
        return
      }
      const frameLength = prefix.bytes + prefix.value
      if (serverInspectBuffer.length < frameLength) return
      const frame = serverInspectBuffer.subarray(0, frameLength)
      serverInspectBuffer = serverInspectBuffer.subarray(frameLength)

      const keepAlive = parsePlayKeepAliveFrame(frame, PLAY_CLIENTBOUND_KEEP_ALIVE_ID)
      if (!keepAlive) continue

      state.keepAliveFastPathSeen++
      state.keepAliveFastPathLastAt = Date.now()
      cleanupFastAnsweredKeepAlives()
      const key = keepAlive.idBytes.toString('hex')
      fastAnsweredKeepAlives.set(key, Date.now() + KEEPALIVE_DEDUPE_MS)
      const reply = encodePlayKeepAliveFrame({
        idBytes: keepAlive.idBytes,
        packetId: PLAY_SERVERBOUND_KEEP_ALIVE_ID,
        compressedEnvelope: keepAlive.compressedEnvelope,
      })
      if (!queueTcpWrite(reply)) return
      state.keepAliveFastPathResponses++
      flushClientQueue()
    }
  }

  const flushClientQueue = () => {
    if (!tcpConnected || tcpBlocked || terminated) return
    while (clientQueue.length && !tcpBlocked && !terminated) {
      const buffer = clientQueue.shift()
      clientQueueBytes -= buffer.length
      updateQueueState()
      let accepted
      try {
        accepted = tcp.write(buffer)
      } catch (error) {
        recordError(state, error)
        terminate('tcp-write-error')
        return
      }
      state.tcpWriteCalls++
      state.tcpBytesWritten += buffer.length
      if (!accepted) {
        tcpBlocked = true
        state.tcpBackpressureCount++
      }
    }
  }

  tcp.setTimeout?.(0)
  tcp.on('connect', () => {
    if (terminated) return
    tcpConnected = true
    state.tcpConnectedAt = Date.now()
    tcp.setTimeout?.(0)
    flushClientQueue()
  })
  if (tcpConnected) {
    state.tcpConnectedAt = Date.now()
    tcp.setTimeout?.(0)
  }

  tcp.on('drain', () => {
    if (terminated) return
    tcpBlocked = false
    state.tcpDrainCount++
    flushClientQueue()
  })

  ws.on('message', (data, isBinary = true) => {
    if (terminated) return
    if (isBinary === false || typeof data === 'string') {
      terminate('non-binary-client-frame', 1003)
      return
    }
    const buffer = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data)
    state.wsFramesReceived++
    state.wsBytesReceived += buffer.length

    const browserKeepAlive = parsePlayKeepAliveFrame(buffer, PLAY_SERVERBOUND_KEEP_ALIVE_ID)
    if (browserKeepAlive) {
      cleanupFastAnsweredKeepAlives()
      const key = browserKeepAlive.idBytes.toString('hex')
      if (fastAnsweredKeepAlives.has(key)) {
        state.keepAliveDuplicateDrops++
        return
      }
    }

    if (!queueTcpWrite(buffer)) return
    flushClientQueue()
  })

  tcp.on('data', chunk => {
    if (terminated) return
    if (ws.readyState !== WebSocketOpen) {
      terminate('websocket-not-open')
      return
    }
    const buffer = Buffer.from(chunk)
    inspectServerFrames(buffer)
    if (terminated) return
    state.tcpBytesReceived += buffer.length
    const bufferedAmount = Number(ws.bufferedAmount || 0)
    state.maxWsBufferedAmount = Math.max(state.maxWsBufferedAmount, bufferedAmount)
    if (bufferedAmount > MAX_WS_BUFFERED_BYTES) {
      terminate('websocket-buffer-overflow', 1013)
      return
    }
    try {
      ws.send(buffer, { binary: true }, error => {
        if (error && !terminated) {
          recordError(state, error)
          terminate('websocket-send-error')
        }
      })
      state.wsFramesSent++
      state.wsBytesSent += buffer.length
    } catch (error) {
      recordError(state, error)
      terminate('websocket-send-error')
    }
  })

  tcp.on('error', error => {
    recordError(state, error)
    terminate('tcp-error')
  })

  tcp.on('end', () => {
    if (!terminated) terminate('tcp-end', 1000)
  })

  tcp.on('close', () => {
    if (!state.closedAt) state.closedAt = Date.now()
    if (terminated) return
    tcpClosed = true
    terminated = true
    if (!state.closeReason) state.closeReason = 'tcp-close'
    closeWsOnce(1000, 'tcp-close')
  })

  ws.on('error', error => {
    recordError(state, error)
    terminate('websocket-error')
  })

  ws.on('close', (code, reasonBuffer) => {
    if (!state.closedAt) state.closedAt = Date.now()
    if (!wsClosed) wsClosed = true
    const reason = Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString('utf8') : String(reasonBuffer || '')
    if (!state.closeReason) state.closeReason = reason || `websocket-close-${code || 0}`
    if (!terminated) terminated = true
    destroyTcpOnce()
  })

  return { flushClientQueue, terminate }
}

function createHemGateway ({
  port = Number(process.env.PORT || 8080),
  host = process.env.MC_HOST || 'orchestrator',
  start = Number(process.env.WORLD_PORT_START || 31000),
  end = Number(process.env.WORLD_PORT_END || 31099),
  origin = process.env.CLIENT_ORIGIN || '*',
  diagnosticsEnabled = process.env.HEM_ENABLE_TEST_DIAGNOSTICS === 'true',
  tcpConnect = options => net.connect(options),
} = {}) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1024 || end < start || end - start > 500) {
    throw new Error('Invalid HEM port range')
  }
  const express = require('express')
  const http = require('http')
  const { WebSocketServer, WebSocket } = require('ws')
  const app = express()
  const server = http.createServer(app)
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false })
  const connections = new Map()

  app.disable('x-powered-by')
  app.get('/healthz', (_req, res) => res.json({ ok: true, transport: 'hem-raw-tcp-v1', targetHost: host, portRange: [start, end] }))
  if (diagnosticsEnabled) {
    app.get('/debug/connections', (_req, res) => res.json({ ok: true, connections: [...connections.values()].map(state => ({ ...state, errors: [...state.errors] })) }))
  }

  server.on('upgrade', (req, socket, head) => {
    let url
    try { url = new URL(req.url || '/', 'http://hem.invalid') } catch { socket.destroy(); return }
    if (url.pathname !== '/hem-tcp') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    if (!isAllowedOrigin(req.headers.origin, origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    let target
    try { target = resolveTarget({ requestedPort: url.searchParams.get('port'), host, start, end }) } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const requestedId = url.searchParams.get('id')
    wss.handleUpgrade(req, socket, head, ws => {
      const state = createDiagnosticState({ id: requestedId, port: target.port })
      connections.set(state.id, state)
      let tcp
      try { tcp = tcpConnect(target) } catch (error) {
        recordError(state, error)
        state.closedAt = Date.now()
        state.closeReason = 'tcp-connect-error'
        try { ws.close(1011, 'tcp-connect-error') } catch {}
        return
      }
      bridgeHemConnection({ ws, tcp, state, WebSocketOpen: WebSocket.OPEN })
      ws.once('close', () => {
        // Keep closed diagnostic records briefly so a failing acceptance check can
        // still retrieve the exact final counters without payload data.
        setTimeout(() => connections.delete(state.id), 120_000).unref?.()
      })
    })
  })

  return {
    app,
    server,
    wss,
    connections,
    listen: (listenPort = port, listenHost = '0.0.0.0', cb) => server.listen(listenPort, listenHost, cb),
    close: cb => server.close(cb),
  }
}

if (require.main === module) {
  const gateway = createHemGateway()
  const listenPort = Number(process.env.PORT || 8080)
  gateway.listen(listenPort, '0.0.0.0', () => {
    console.log(`[HEM] raw websocket TCP gateway :${listenPort} -> ${process.env.MC_HOST || 'orchestrator'}:${process.env.WORLD_PORT_START || 31000}-${process.env.WORLD_PORT_END || 31099}`)
  })
}

module.exports = {
  validatePort,
  isAllowedOrigin,
  resolveTarget,
  createDiagnosticState,
  bridgeHemConnection,
  createHemGateway,
}
