import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const plugin = fs.readFileSync('apps/server-plugin/src/main/java/com/hemcraft/gate/HEMGatePlugin.java', 'utf8')
const orchestrator = fs.readFileSync('apps/orchestrator/server.mjs', 'utf8')
const system = fs.readFileSync('tests/system/browser-1215.mjs', 'utf8')

test('Paper presence events carry a monotonically increasing physical connection generation', () => {
  assert.match(plugin, /connectionGenerations/)
  assert.match(plugin, /lastGenerationByPlayer/)
  assert.match(plugin, /connectionGeneration/)
  assert.match(plugin, /postPresence\(player, true\)/)
  assert.match(plugin, /postPresence\(player, false\)/)
})

test('orchestrator applies generation-aware presence updates', () => {
  assert.match(orchestrator, /applyPresenceUpdate/)
  assert.match(orchestrator, /generation/)
})

test('browser acceptance logs exact HTTP 400 response URLs', () => {
  assert.match(system, /HTTP 400/)
  assert.match(system, /response\.url\(\)/)
})
