import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expectedVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const certPath = path.resolve(root, process.argv[2] || 'artifacts/hem-1215-certification.json')
const specPath = path.join(root, 'tests/system/required-gates-1215.json')
const launcherPath = path.join(root, 'artifacts/hem-launcher-certification.json')
const restorePath = path.join(root, 'artifacts/hem-restore-certification.json')
const expectedSoak = Math.max(0, Number.parseInt(process.env.HEM_EXPECT_SOAK_MINUTES || '0', 10) || 0)
const requirePinned = process.env.HEM_REQUIRE_PINNED_CERT === 'true'

if (!fs.existsSync(certPath)) throw new Error(`Missing HEM certification artifact: ${path.relative(root, certPath)}`)
const cert = JSON.parse(fs.readFileSync(certPath, 'utf8'))
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
if (!fs.existsSync(launcherPath)) throw new Error('Missing HEM launcher 3D certification artifact')
const launcher = JSON.parse(fs.readFileSync(launcherPath, 'utf8'))
if (!fs.existsSync(restorePath)) throw new Error('Missing HEM backup/restore certification artifact')
const restore = JSON.parse(fs.readFileSync(restorePath, 'utf8'))

if (cert.hemVersion !== expectedVersion) throw new Error(`Certification is for ${cert.hemVersion}, expected ${expectedVersion}`)
if (launcher.hemVersion !== cert.hemVersion || launcher.preview !== 'webgl-3d' || launcher.classic !== true || launcher.slim !== true || launcher.dragRotate !== true || launcher.legacyNormalized !== true || launcher.settingsPersisted !== true) {
  throw new Error('Launcher 3D certification is incomplete or belongs to a different HEM build')
}
if (restore.hemVersion !== cert.hemVersion || restore.transport !== 'rclone-local-filesystem' || restore.goodRestore !== true || restore.postBackupMutationRemoved !== true || restore.invalidArchiveRejectedAfterMutation !== true || restore.automaticRollback !== true) {
  throw new Error('Backup/restore certification is incomplete or belongs to a different HEM build')
}
if (!/^[0-9]{8}T[0-9]{6}Z$/.test(restore.backupStamp || '')) throw new Error('Backup/restore certification has an invalid backup stamp')
if (!Number.isFinite(Date.parse(restore.completedAt))) throw new Error('Backup/restore certification completion timestamp is invalid')
if (cert.minecraft !== '1.21.5' || spec.minecraft !== '1.21.5') throw new Error('Certification/spec Minecraft version mismatch')
if (cert.acceptance !== 'passed') throw new Error(`Certification acceptance=${cert.acceptance}`)
if (!/^[0-9a-f]{40}$/i.test(cert.upstreamCommit || '')) throw new Error('Certification is missing a 40-character upstream commit')
if (requirePinned && (cert.upstreamPinned !== true || cert.upstreamRef !== cert.upstreamCommit)) {
  throw new Error('Final certification is not pinned to the exact resolved upstream commit')
}
if (!Array.isArray(cert.upstreamAdvertisedVersions) || !cert.upstreamAdvertisedVersions.length || cert.upstreamAdvertisedVersions.some(version => typeof version !== 'string')) {
  throw new Error('Certification is missing the preserved upstream advertised-version list')
}
if (!/^[0-9a-f]{64}$/i.test(cert.upstreamSupportedVersionsSha256 || '')) throw new Error('Certification is missing the upstream supportedVersions source hash')
if (cert.compatibilityMode !== 'native-upstream-1215' || cert.upstreamAdvertised1215 !== true) throw new Error(`Certification requires native upstream 1.21.5 support; mode=${cert.compatibilityMode}`)
if ((cert.upstreamAdvertised1215 === true) !== cert.upstreamAdvertisedVersions.includes('1.21.5')) throw new Error('Certification upstream advertised-version fields disagree')
if (!Array.isArray(cert.gates) || cert.gates.some(id => typeof id !== 'string')) throw new Error('Certification gates are malformed')
if (new Set(cert.gates).size !== cert.gates.length) throw new Error('Certification contains duplicate gate IDs')

const required = [...spec.required, ...(expectedSoak > 0 ? [spec.soak] : [])]
const missing = required.filter(id => !cert.gates.includes(id))
if (missing.length) throw new Error(`Certification missing required gates: ${missing.join(', ')}`)
if (cert.gateCount !== cert.gates.length) throw new Error(`gateCount=${cert.gateCount} but certificate lists ${cert.gates.length} gates`)
if (cert.requiredGateCount !== required.length) throw new Error(`requiredGateCount=${cert.requiredGateCount} but verifier expects ${required.length}`)
if (!Number.isFinite(cert.soakMinutes) || cert.soakMinutes < expectedSoak) throw new Error(`Certification soak ${cert.soakMinutes}m is below expected ${expectedSoak}m`)
const completed = Date.parse(cert.completedAt)
if (!Number.isFinite(completed)) throw new Error('Certification completion timestamp is invalid')

console.log(`HEM certification verified: ${cert.hemVersion} / ${cert.minecraft} / ${cert.upstreamCommit} / ${cert.compatibilityMode}`)
console.log(`Verified ${required.length} required live gates; soak=${cert.soakMinutes}m; pinned=${cert.upstreamPinned === true}`)
console.log(`Verified launcher WebGL acceptance and backup/restore rollback drill (${restore.transport})`)
