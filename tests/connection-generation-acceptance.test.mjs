import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const system = fs.readFileSync('tests/system/browser-1215.mjs', 'utf8')

test('live keepalive acceptance requires one unchanged physical connection generation', () => {
  assert.match(system, /async function sustainGeneration\s*\(/)
  assert.match(system, /activeGenerationId/)
  assert.match(system, /physical connection generation changed or ended during keepalive gate/)
  assert.match(system, /same physical generations survive sustained Paper 1\.21\.5 keepalive round trips/i)
  assert.doesNotMatch(system, /t\.keepAliveSeen >= 3 && t\.keepAliveResponses >= t\.keepAliveSeen/)
})

test('refresh and proxy recovery require fresh resume-authenticated generations', () => {
  assert.match(system, /hudsonPreRefreshGeneration/)
  assert.match(system, /authorization\?\.mode === 'resume'/)
  assert.match(system, /refresh creates a new resume-authenticated physical generation/i)
  assert.match(system, /preOutageGeneration/)
  assert.match(system, /proxy outage ends both physical generations/i)
  assert.match(system, /proxy restart creates fresh resume-authenticated generations/i)
})
