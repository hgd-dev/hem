import fsp from 'node:fs/promises'
import path from 'node:path'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'

const gunzipAsync = promisify(gunzip)
export const HEM_TARGET_DATA_VERSION = 4325

function nbtDataVersion(buffer) {
  let off = 0
  let found = null
  const need = n => { if (off + n > buffer.length) throw new Error('truncated NBT') }
  const u8 = () => { need(1); return buffer[off++] }
  const i32 = () => { need(4); const v = buffer.readInt32BE(off); off += 4; return v }
  const str = () => { need(2); const n = buffer.readUInt16BE(off); off += 2; need(n); const v = buffer.toString('utf8', off, off+n); off += n; return v }
  const boundedCount = (n, kind) => { if (n < 0 || n > 10_000_000) throw new Error(`invalid ${kind} length ${n}`); return n }

  function payload(type, name = '') {
    switch (type) {
      case 0: return
      case 1: need(1); off += 1; return
      case 2: need(2); off += 2; return
      case 3: {
        const value = i32()
        if (name === 'DataVersion' && found === null) found = value
        return
      }
      case 4: need(8); off += 8; return
      case 5: need(4); off += 4; return
      case 6: need(8); off += 8; return
      case 7: { const n=boundedCount(i32(),'byte-array'); need(n); off += n; return }
      case 8: str(); return
      case 9: {
        const child = u8(); const n = boundedCount(i32(),'list')
        for (let i=0;i<n;i++) payload(child)
        return
      }
      case 10:
        while (true) {
          const child = u8(); if (child === 0) break
          const childName = str(); payload(child, childName)
        }
        return
      case 11: { const n=boundedCount(i32(),'int-array'); need(n*4); off += n*4; return }
      case 12: { const n=boundedCount(i32(),'long-array'); need(n*8); off += n*8; return }
      default: throw new Error(`unsupported NBT tag ${type}`)
    }
  }

  const rootType = u8()
  if (rootType !== 10) throw new Error(`expected root compound tag, got ${rootType}`)
  str()
  payload(10)
  if (!Number.isInteger(found)) throw new Error('DataVersion tag missing')
  return found
}

export async function readWorldDataVersion(worldRoot) {
  const file = path.join(worldRoot, 'world', 'level.dat')
  let compressed
  try { compressed = await fsp.readFile(file) }
  catch (e) { if (e?.code === 'ENOENT') return null; throw e }
  let raw
  try { raw = await gunzipAsync(compressed) }
  catch (e) { throw new Error(`Cannot read ${file}: invalid gzip (${e.message})`) }
  try { return nbtDataVersion(raw) }
  catch (e) { throw new Error(`Cannot read ${file}: invalid NBT (${e.message})`) }
}

export async function assertWorldCompatible(worldRoot, targetDataVersion = HEM_TARGET_DATA_VERSION) {
  const actual = await readWorldDataVersion(worldRoot)
  if (actual !== null && actual > targetDataVersion) {
    throw new Error(`World DataVersion ${actual} is newer than HEM 1.21.5 (${targetDataVersion}); refusing unsafe downgrade. Restore a 1.21.5-or-older backup instead.`)
  }
  return actual
}
