import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = file => fs.readFileSync(file, 'utf8')

test('client build installs and attests the dedicated HEM raw TCP transport', () => {
  const build = read('apps/client/build-client.mjs')
  assert.match(build, /install-hem-net-transport\.mjs/)
  assert.match(build, /\.hem-net-transport\.json/)
  assert.match(build, /hem-raw-tcp-v1/)
  assert.match(build, /netBrowserifyProductionTransport:\s*false/)
  assert.match(build, /singleWebSocketTcpTunnel:\s*true/)
  assert.match(build, /orderedBinaryDelivery:\s*true/)
  assert.doesNotMatch(build, /run\('node', \[netBrowserifyPatchScript, upstream\]\)/)
})

test('proxy package uses ws directly and has no net-browserify dependency', () => {
  const pkg = JSON.parse(read('apps/proxy/package.json'))
  assert.equal(pkg.dependencies['net-browserify'], undefined)
  assert.match(pkg.dependencies.ws, /^\^?8\./)
  const server = read('apps/proxy/server.cjs')
  assert.match(server, /\/hem-tcp/)
  assert.match(server, /WebSocketServer/)
  assert.doesNotMatch(server, /require\(['"]net-browserify['"]\)/)
})

test('release verifier requires raw tunnel attestation instead of active ordering patch', () => {
  const verify = read('scripts/verify.mjs')
  assert.match(verify, /hem-raw-tcp-v1/)
  assert.match(verify, /netBrowserifyProductionTransport/)
  assert.match(verify, /singleWebSocketTcpTunnel/)
  assert.match(verify, /orderedBinaryDelivery/)
  assert.doesNotMatch(verify, /\['net-browserify ordered binary transport patch'/)
})

test('doctor and deployment reject a build without dedicated HEM transport attestation', () => {
  for (const source of [read('scripts/doctor.mjs'), read('.github/workflows/deploy-cloudflare.yml')]) {
    assert.match(source, /hem-raw-tcp-v1/)
    assert.match(source, /netBrowserifyProductionTransport/)
    assert.match(source, /singleWebSocketTcpTunnel/)
    assert.match(source, /orderedBinaryDelivery/)
  }
})
