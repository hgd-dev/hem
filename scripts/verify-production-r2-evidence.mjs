import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifactPath = path.resolve(root, process.argv[2] || 'artifacts/hem-production-r2-restore.json')
const expectedVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
if (!fs.existsSync(artifactPath)) throw new Error(`Missing production R2 evidence: ${path.relative(root, artifactPath)}`)
const evidence = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
const versionCompatible = evidence.hemVersion === expectedVersion || (expectedVersion === '1.0.0' && /^1\.0\.0-rc\.\d+$/.test(evidence.hemVersion || ''))
if (!versionCompatible) throw new Error(`Production R2 evidence is for ${evidence.hemVersion}, expected ${expectedVersion} or its immediately promoted 1.0.0 RC evidence`)
if (evidence.transport !== 'cloudflare-r2' || evidence.rcloneBackend !== 's3-cloudflare-r2') throw new Error('Production R2 evidence did not verify a Cloudflare R2 S3 backend')
if (!/^[0-9]{8}T[0-9]{6}Z$/.test(evidence.backupStamp || '')) throw new Error('Production R2 evidence has an invalid backup stamp')
if (!Number.isInteger(evidence.nativeLevelDatFiles) || evidence.nativeLevelDatFiles < 1) throw new Error('Production R2 evidence did not restore native Paper level.dat data')
if (!Number.isInteger(evidence.nativePlayerDataFiles) || evidence.nativePlayerDataFiles < 1) throw new Error('Production R2 evidence did not restore native Paper playerdata')
for (const key of ['remoteCopyVerified','emptyVolumeRestore','nativeHashesMatch','invalidArchiveRejectedAfterMutation','automaticRollback','rollbackHashesMatch']) {
  if (evidence[key] !== true) throw new Error(`Production R2 evidence missing required proof: ${key}`)
}
if (!Number.isFinite(Date.parse(evidence.completedAt))) throw new Error('Production R2 evidence completion timestamp is invalid')
if (typeof evidence.remoteAlias !== 'string' || !/^[A-Za-z0-9._-]+$/.test(evidence.remoteAlias)) throw new Error('Production R2 evidence remote alias is invalid')
console.log(`HEM production R2 restore verified: ${evidence.backupStamp} / level.dat=${evidence.nativeLevelDatFiles} / playerdata=${evidence.nativePlayerDataFiles}`)
