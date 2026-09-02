import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const build = fs.readFileSync('apps/client/build-client.mjs', 'utf8')

test('HEM disables the pinned upstream service worker so live reloads cannot be superseded by PWA takeover', () => {
  assert.match(build, /process\.env\.DISABLE_SERVICE_WORKER\s*=\s*['"]true['"]/, 'client build must disable the upstream service worker before bundling')
  assert.match(build, /serviceWorkerDisabled:\s*true/, 'build identity must attest that service workers are disabled')
})
