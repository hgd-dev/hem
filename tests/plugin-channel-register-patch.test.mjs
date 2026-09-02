import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const patchPath = path.resolve('apps/client/patch-minecraft-protocol-register.mjs')

test('1.21.5 plugin-channel registration encodes NUL separators without a trailing empty identifier', async () => {
  assert.equal(fs.existsSync(patchPath), true, 'HEM must ship the minecraft-protocol registration patch')
  const { PATCH_ID, encodeRegisterChannels, patchPluginChannelsSource } = await import(pathToFileURL(patchPath))
  assert.equal(PATCH_ID, 'hem-minecraft-protocol-register-no-trailing-nul-v1')
  assert.equal(encodeRegisterChannels(['hem:session']).toString('hex'), Buffer.from('hem:session').toString('hex'))
  assert.equal(encodeRegisterChannels(['hem:one', 'hem:two']).toString('hex'), Buffer.from('hem:one\0hem:two').toString('hex'))
  assert.notEqual(encodeRegisterChannels(['hem:session']).at(-1), 0)

  const legacy = `
  function writeDumbArr (value, buf, offset) {
    // TODO: Remove trailing \\0
    value.forEach(function (v) {
      offset += proto.write(v, buf, offset, 'cstring')
    })
    return offset
  }

  function sizeOfDumbArr (value) {
    return value.reduce((acc, v) => acc + this.sizeOf(v, 'cstring', {}), 0)
  }
`
  const patched = patchPluginChannelsSource(legacy)
  assert.match(patched, /HEM hem-minecraft-protocol-register-no-trailing-nul-v1/)
  assert.match(patched, /Buffer\.from\(value\.join\('\\0'\), 'utf8'\)/)
  assert.match(patched, /Buffer\.byteLength\(value\.join\('\\0'\), 'utf8'\)/)
  assert.doesNotMatch(patched, /proto\.write\(v, buf, offset, 'cstring'\)/)
})

test('client build applies and attests the exact plugin-channel registration patch before bundling', () => {
  const build = fs.readFileSync('apps/client/build-client.mjs', 'utf8')
  assert.match(build, /patch-minecraft-protocol-register\.mjs/)
  assert.match(build, /\.hem-minecraft-protocol-register\.json/)
  assert.match(build, /hem-minecraft-protocol-register-no-trailing-nul-v1/)
  assert.match(build, /minecraftProtocolRegisterPatch/)
})

test('release verification requires the runtime REGISTER patch and its build attestation', () => {
  const verify = fs.readFileSync('scripts/verify.mjs', 'utf8')
  assert.match(verify, /patch-minecraft-protocol-register\.mjs/)
  assert.match(verify, /minecraft-protocol REGISTER framing patch/)
  assert.match(verify, /trailingNulRemoved/)
})

test('release verifier accepts the shipped REGISTER framing patch source', async () => {
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync(process.execPath, ['scripts/verify.mjs'], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})
