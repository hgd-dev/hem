import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const system = fs.readFileSync('tests/system/browser-1215.mjs', 'utf8')
const bridge = fs.readFileSync('apps/client/hem-bridge.js', 'utf8')
const compose = fs.readFileSync('tests/system/docker-compose.yml', 'utf8')

// RC40 must distinguish a protocol/server keepalive failure from browser scheduling
// starvation before applying any timeout mitigation.
test('system acceptance proves a direct node-minecraft-protocol control client on the same Paper server', () => {
  assert.match(system, /proveDirectProtocolKeepAlive/)
  assert.match(system, /direct-protocol-keepalive/)
  assert.match(system, /apps\/client\/upstream/)
  assert.match(system, /minimumKeepAlives:\s*4/)
  assert.match(system, /minimumMs:\s*75_000/)
  assert.match(compose, /127\.0\.0\.1:31000-31009:31000-31009/)
})

test('browser generation diagnostics measure event-loop stalls around keepalive servicing', () => {
  assert.match(bridge, /eventLoopLag/)
  assert.match(bridge, /maxMs/)
  assert.match(bridge, /samplesOver100ms/)
  assert.match(bridge, /samplesOver1000ms/)
})

test('keepalive failure path preserves connection id and dumps gateway evidence even after page teardown', () => {
  assert.match(system, /lastKnownConnectionId/)
  assert.match(system, /gateway diagnostics after page teardown/i)
  assert.match(system, /client page unavailable/i)
  assert.match(system, /recentLogs\(SHARED/)
})
