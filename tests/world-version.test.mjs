import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { assertWorldCompatible, readWorldDataVersion, HEM_TARGET_DATA_VERSION } from '../apps/orchestrator/world-version.mjs'

const gzipAsync = promisify(gzip)

function levelNbt(dataVersion) {
  const name = Buffer.from('DataVersion')
  const parts = [
    Buffer.from([10,0,0]),             // root compound, empty name
    Buffer.from([10,0,4]), Buffer.from('Data'), // Data compound
    Buffer.from([3,0,name.length]), name,
    Buffer.alloc(4),
    Buffer.from([0]),                  // end Data
    Buffer.from([0]),                  // end root
  ]
  parts[5].writeInt32BE(dataVersion)
  return Buffer.concat(parts)
}

async function fixture(dataVersion) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(),'hem-world-version-'))
  await fsp.mkdir(path.join(dir,'world'),{recursive:true})
  await fsp.writeFile(path.join(dir,'world','level.dat'), await gzipAsync(levelNbt(dataVersion)))
  return dir
}

test('world version guard accepts a native 1.21.5 level.dat', async()=>{
  const dir=await fixture(HEM_TARGET_DATA_VERSION)
  assert.equal(await readWorldDataVersion(dir),4325)
  assert.equal(await assertWorldCompatible(dir),4325)
})

test('world version guard accepts older worlds for Paper upgrade', async()=>{
  const dir=await fixture(3953)
  assert.equal(await assertWorldCompatible(dir),3953)
})

test('world version guard rejects an unsafe newer-world downgrade', async()=>{
  const dir=await fixture(4671)
  await assert.rejects(()=>assertWorldCompatible(dir),/newer than HEM 1\.21\.5.*refusing unsafe downgrade/i)
})

test('world version guard permits a brand-new world directory', async()=>{
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'hem-world-new-'))
  assert.equal(await assertWorldCompatible(dir),null)
})
