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
      fileReader.addEventListener('load', function () {
        var arr = new Uint8Array(fileReader.result)
        processBuffer(new Buffer(arr))
      })
      fileReader.readAsArrayBuffer(contents)
    }
  })
}
`

test('historical RC37 ordering patch remains reproducible for provenance only', async () => {
  assert.equal(fs.existsSync(patchPath), true)
  const { PATCH_ID, patchBrowserSource } = await import(pathToFileURL(patchPath))
  assert.equal(PATCH_ID, 'hem-net-browserify-arraybuffer-ordering-v1')
  const patched = patchBrowserSource(legacy)
  assert.match(patched, /binaryType = 'arraybuffer'/)
  assert.match(patched, /contents instanceof ArrayBuffer/)
})

test('RC39 build no longer executes the historical ordering patch', () => {
  const build = fs.readFileSync('apps/client/build-client.mjs', 'utf8')
  assert.doesNotMatch(build, /run\('node', \[netBrowserifyPatchScript, upstream\]\)/)
  assert.doesNotMatch(build, /\.hem-net-browserify-ordering\.json/)
  assert.match(build, /install-hem-net-transport\.mjs/)
  assert.match(build, /hem-raw-tcp-v1/)
})

test('browser diagnostics still record protocol-client error and end reason', () => {
  const bridge = fs.readFileSync('apps/client/hem-bridge.js', 'utf8')
  assert.match(bridge, /clientEndReason/)
  assert.match(bridge, /clientErrors/)
})
