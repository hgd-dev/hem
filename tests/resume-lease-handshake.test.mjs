import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const bridge = fs.readFileSync('apps/client/hem-bridge.js', 'utf8')
const plugin = fs.readFileSync('apps/server-plugin/src/main/java/com/hemcraft/gate/HEMGatePlugin.java', 'utf8')
const pluginYml = fs.readFileSync('apps/server-plugin/src/main/resources/plugin.yml', 'utf8')

test('resume lease issuance is client-requested instead of tied to authorization timing', () => {
  assert.match(plugin, /args\[0\]\.equalsIgnoreCase\("lease"\)/)
  assert.match(plugin, /requestResumeSession\(p\)/)
  const complete = plugin.match(/private void completeAuthorization[\s\S]*?\n    \}/)?.[0] || ''
  assert.doesNotMatch(complete, /issueResumeSession/)
  assert.match(pluginYml, /\/hem lease/)
})

test('browser retries a secret-free lease request until a rotated lease is received', () => {
  assert.match(bridge, /requestResumeLease/)
  assert.match(bridge, /bot\.chat\('\/hem lease'\)/)
  assert.match(bridge, /leaseRequests/)
  assert.match(bridge, /leaseRequestTimer/)
})

test('server makes repeated lease requests idempotent and keeps one active token per player', () => {
  assert.match(plugin, /activeResumeTokens/)
  assert.match(plugin, /resumeSessions\.get\(existingToken\)/)
  assert.match(plugin, /activeResumeTokens\.remove\(playerKey, token\)/)
})

test('locked command filter permits only auth, resume, and lease handshake commands', () => {
  assert.match(plugin, /message\.equals\("\/hem lease"\)/)
})

test('authorization ownership is connection-scoped so an old quit cannot deauthorize a refreshed connection sharing the same UUID', () => {
  assert.match(plugin, /IdentityHashMap/)
  assert.match(plugin, /Set<Player> authenticated/)
  assert.match(plugin, /authenticated\.contains\(p\)/)
  assert.match(plugin, /authenticated\.remove\(e\.getPlayer\(\)\)/)
})

test('live acceptance isolates resume-attempt failure from rotated-lease delivery failure', () => {
  const acceptance = fs.readFileSync('tests/system/browser-1215.mjs', 'utf8')
  assert.match(acceptance, /Hudson refresh attempts stored lease/)
  assert.match(acceptance, /Hudson refresh receives rotated lease/)
  assert.match(acceptance, /Hudson refresh resume diagnostics/)
})
