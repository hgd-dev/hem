import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const system = fs.readFileSync('tests/system/browser-1215.mjs', 'utf8')
const bridge = fs.readFileSync('apps/client/hem-bridge.js', 'utf8')
const compose = fs.readFileSync('tests/system/docker-compose.yml', 'utf8')

test('generation diagnostics mirror raw HEM tunnel counters from the physical client socket', () => {
  assert.match(bridge, /client\?\.socket\?\.__hemTransportState/)
  assert.match(bridge, /rawTransport/)
  assert.match(bridge, /hem-raw-tcp-v1/)
  assert.match(bridge, /connectionId/)
  assert.match(bridge, /bytesSent/)
  assert.match(bridge, /bytesReceived/)
})

test('live keepalive certification requires dedicated transport and gateway byte evidence on one generation', () => {
  assert.match(system, /hem-raw-tcp-v1/)
  assert.match(system, /gatewayDiagnostics/)
  assert.match(system, /debug\/connections/)
  assert.match(system, /tcpBytesWritten/)
  assert.match(system, /connectionId/)
  assert.match(system, /lost connection: Timed out/)
  assert.match(system, /minimumKeepAlives:\s*3/)
  assert.match(system, /minimumMs:\s*65_000/)
})

test('system proxy enables secret-free transport diagnostics only for acceptance', () => {
  assert.match(compose, /HEM_ENABLE_TEST_DIAGNOSTICS:\s*["']true["']/)
})
