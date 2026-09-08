import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const patchPath = path.resolve('apps/client/patch-net-browserify-ordering.mjs')

const legacy = `
Socket.prototype._connectWebSocket = function (token, cb) {
  var self = this
  this._ws = new WebSocket(getProxyOrigin() + getProxy().path + '/socket?token='+token)
  this._handleWebsocket()
}

Socket.prototype._handleWebsocket = function () {
  var self = this
  this._ws.addEventListener('message', function (e) {
    var contents = e.data
    var processBuffer = function (buffer) { self.push(buffer) }
    if (typeof contents == 'string') {
      return
    } else if (window.Blob && contents instanceof Blob) {
      var fileReader = new FileReader()
      fileReader.addEventListener('load', function (e) {
        var buf = fileReader.result
        var arr = new Uint8Array(buf)
        processBuffer(new Buffer(arr))
      })
      fileReader.readAsArrayBuffer(contents)
    } else {
      console.warn('Cannot read TCP stream: unsupported message type', contents)
    }
  })
}
`

test('browser TCP shim forces ordered ArrayBuffer WebSocket delivery instead of asynchronous Blob conversion', async () => {
  assert.equal(fs.existsSync(patchPath), true, 'HEM must ship the net-browserify ordering patch')
  const { PATCH_ID, patchBrowserSource } = await import(pathToFileURL(patchPath))
  assert.equal(PATCH_ID, 'hem-net-browserify-arraybuffer-ordering-v1')
  const patched = patchBrowserSource(legacy)
  assert.match(patched, /binaryType = 'arraybuffer'/)
  assert.match(patched, /contents instanceof ArrayBuffer/)
  assert.match(patched, /new Uint8Array\(contents\)/)
  const patchedAgain = patchBrowserSource(patched)
  assert.equal(patchedAgain, patched, 'patch must be idempotent')
})

test('client build applies and attests the runtime-resolved net-browserify ordering patch before bundling', () => {
  const build = fs.readFileSync('apps/client/build-client.mjs', 'utf8')
  assert.match(build, /patch-net-browserify-ordering\.mjs/)
  assert.match(build, /\.hem-net-browserify-ordering\.json/)
  assert.match(build, /hem-net-browserify-arraybuffer-ordering-v1/)
  assert.match(build, /netBrowserifyOrderingPatch/)
})

test('release verification requires the runtime net-browserify ordering patch and its attestation', () => {
  const verify = fs.readFileSync('scripts/verify.mjs', 'utf8')
  assert.match(verify, /patch-net-browserify-ordering\.mjs/)
  assert.match(verify, /net-browserify ordered binary transport patch/)
  assert.match(verify, /orderedBinaryDelivery/)
  assert.match(verify, /avoidsAsyncBlobPath/)
})

test('live acceptance requires the ordered transport attestation and multiple keepalive round trips', () => {
  const system = fs.readFileSync('tests/system/browser-1215.mjs', 'utf8')
  assert.match(system, /netBrowserifyOrderingPatch/)
  assert.match(system, /hem-net-browserify-arraybuffer-ordering-v1/)
  assert.match(system, /keepAliveSeen >= 3/)
  assert.match(system, /sustained Paper 1\.21\.5 keepalive/)
})

test('system doctor and production deployment reject builds without ordered browser transport attestation', () => {
  const doctor = fs.readFileSync('scripts/doctor.mjs', 'utf8')
  const deploy = fs.readFileSync('.github/workflows/deploy-cloudflare.yml', 'utf8')
  for (const source of [doctor, deploy]) {
    assert.match(source, /netBrowserifyOrderingPatch/)
    assert.match(source, /hem-net-browserify-arraybuffer-ordering-v1/)
    assert.match(source, /orderedBinaryDelivery/)
  }
})

test('browser diagnostics record protocol-client errors and end reason for transport failures', () => {
  const bridge = fs.readFileSync('apps/client/hem-bridge.js', 'utf8')
  assert.match(bridge, /clientEndReason/)
  assert.match(bridge, /clientErrors/)
  assert.match(bridge, /client\?\.on\?\.\('end'/)
  assert.match(bridge, /client\?\.on\?\.\('error'/)
})
