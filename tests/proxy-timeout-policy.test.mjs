import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../apps/proxy/server.cjs', import.meta.url), 'utf8')

test('HEM proxy keeps a short connect timeout but disables established TCP idle timeout', () => {
  assert.match(source, /connectTimeout\s*:\s*5000/)
  assert.match(source, /connectionTimeout\s*:\s*0/)
})
