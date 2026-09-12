import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../apps/proxy/server.cjs', import.meta.url), 'utf8')

test('HEM raw TCP gateway delegates connection establishment to net.connect and disables established idle timeout', () => {
  assert.match(source, /tcpConnect\(target\)/)
  assert.match(source, /tcp\.setTimeout\?\.\(0\)/)
  assert.doesNotMatch(source, /connectionTimeout\s*:/)
  assert.doesNotMatch(source, /connectTimeout\s*:/)
})
