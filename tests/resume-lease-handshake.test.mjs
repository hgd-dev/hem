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

test('browser requests a lease only after Paper confirms authorization and retries at a bounded low rate', () => {
  assert.match(bridge, /requestResumeLease/)
  assert.match(bridge, /bot\.chat\('\/hem lease'\)/)
  assert.match(bridge, /leaseRequests/)
  assert.match(bridge, /leaseRequestTimer/)
  assert.match(bridge, /HEM:\\s\+\(\?:connected\|resumed\)/)
  assert.match(bridge, /requestResumeLease\(bot\)/)
  assert.doesNotMatch(bridge, /bot\.chat\(`\/hem auth \$\{token\}`\)\s*\n\s*requestResumeLease\(bot\)/)
  assert.doesNotMatch(bridge, /bot\.chat\(`\/hem resume \$\{resume\}`\)\s*\n\s*requestResumeLease\(bot\)/)
  assert.match(bridge, /setInterval\(request, 1500\)/)
  assert.match(bridge, /attempts >= 6/)
})

test('server makes repeated lease requests idempotent and keeps one active token per player', () => {
  assert.match(plugin, /activeResumeTokens/)
  assert.match(plugin, /resumeSessions\.get\(existingToken\)/)
  assert.match(plugin, /activeResumeTokens\.remove\(playerKey, token\)/)
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

test('live acceptance isolates resume-attempt failure from rotated-lease delivery failure', () => {
  const acceptance = fs.readFileSync('tests/system/browser-1215.mjs', 'utf8')
  assert.match(acceptance, /Hudson refresh attempts stored lease/)
  assert.match(acceptance, /Hudson refresh receives rotated lease/)
  assert.match(acceptance, /Hudson refresh resume diagnostics/)
  assert.match(acceptance, /Hudson initial resume lease diagnostics/)
})
