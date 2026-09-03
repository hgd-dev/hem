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

test('browser requests an initial lease only after fresh authorization and retries at a bounded low rate', () => {
  assert.match(bridge, /requestResumeLease/)
  assert.match(bridge, /bot\.chat\('\/hem lease'\)/)
  assert.match(bridge, /leaseRequests/)
  assert.match(bridge, /leaseRequestTimer/)
  assert.match(bridge, /HEM:\\s\+connected\\s\+to\\b/)
  assert.match(bridge, /requestResumeLease\(bot\)/)
  assert.doesNotMatch(bridge, /bot\.chat\(`\/hem auth \$\{token\}`\)\s*\n\s*requestResumeLease\(bot\)/)
  assert.doesNotMatch(bridge, /bot\.chat\(`\/hem resume \$\{resume\}`\)\s*\n\s*requestResumeLease\(bot\)/)
  assert.match(bridge, /setInterval\(request, 1500\)/)
  assert.match(bridge, /attempts >= 6/)
})

test('server makes repeated lease requests idempotent and keeps one active token per player', () => {
  assert.match(plugin, /activeResumeTokens/)
  assert.match(plugin, /resumeSessions\.get\(existingToken\)/)
  assert.match(plugin, /activeResumeTokens\.put\(playerKey, token\)/)
})

test('server emits secret-free channel/lease diagnostics for live acceptance failures', () => {
  assert.match(plugin, /PlayerRegisterChannelEvent/)
  assert.match(plugin, /Resume channel registered by/)
  assert.match(plugin, /Resume lease request waiting for channel registration from/)
  assert.match(plugin, /Resume lease issued to/)
})

test('locked command filter permits only auth, resume, and lease handshake commands', () => {
  assert.match(plugin, /message\.equals\("\/hem lease"\)/)
})

test('authorization ownership is connection-scoped so an old quit cannot deauthorize a refreshed connection sharing the same UUID', () => {
  assert.match(plugin, /IdentityHashMap/)
  assert.match(plugin, /Set<Player> authenticated/)
  assert.match(plugin, /authenticated\.contains\(p\)/)
  assert.match(plugin, /authenticated\.remove\(player\)/)
})

test('live acceptance isolates initial private lease delivery from reconnect lease reuse', () => {
  const acceptance = fs.readFileSync('tests/system/browser-1215.mjs', 'utf8')
  assert.match(acceptance, /Hudson refresh attempts stored lease/)
  assert.match(acceptance, /Hudson refresh reuses short-lived reconnect lease/)
  assert.match(acceptance, /Hudson refresh resume diagnostics/)
  assert.match(acceptance, /Hudson initial resume lease diagnostics/)
})

test('short-lived reconnect lease survives a successful resume and fresh auth revokes the old lease', () => {
  assert.match(plugin, /SessionLease lease = resumeSessions\.get\(token\)/)
  assert.doesNotMatch(plugin, /SessionLease lease = resumeSessions\.remove\(token\)/)
  assert.doesNotMatch(plugin, /activeResumeTokens\.remove\(playerKey, token\)/)
  assert.match(plugin, /revokeActiveResumeSession\(player\)/)
  assert.match(plugin, /if \(verb\.equals\("connected"\)\)/)
})

test('browser reuses the stored reconnect lease after resume without requiring another plugin payload', () => {
  assert.match(bridge, /HEM:\\s\+connected\\s\+to\\b/i)
  assert.match(bridge, /HEM:\\s\+resumed\\s\+to\\b/i)
  assert.match(bridge, /parity\.resume\.stored\s*=\s*Boolean\(readResume\(\)\)/)
  const resumedBranch = bridge.match(/if \(\/HEM:\\\\s\+resumed[\s\S]*?\n\s*\}/)?.[0] || ''
  assert.doesNotMatch(resumedBranch, /requestResumeLease\(bot\)/)
})

test('live acceptance proves reconnect authorization using the retained lease instead of requiring rotated payload delivery', () => {
  const acceptance = fs.readFileSync('tests/system/browser-1215.mjs', 'utf8')
  assert.match(acceptance, /Hudson refresh reuses short-lived reconnect lease/)
  assert.doesNotMatch(acceptance, /Hudson refresh receives rotated lease/)
})
