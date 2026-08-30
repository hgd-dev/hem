import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const worksheetPath = path.resolve(root, process.argv[2] || 'docs/MANUAL_ACCEPTANCE.md')
const artifactPath = path.join(root, 'artifacts/hem-manual-acceptance.json')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
if (!fs.existsSync(worksheetPath)) throw new Error(`Missing manual acceptance worksheet: ${path.relative(root, worksheetPath)}`)
const text = fs.readFileSync(worksheetPath, 'utf8')
const lines = text.split(/\r?\n/)
const unchecked = lines.filter(line => /^- \[ \]/.test(line) || /:\s*\[ \]\s*yes\s*$/i.test(line))
if (unchecked.length) throw new Error(`Manual acceptance still has ${unchecked.length} unchecked required item(s)`)
const checked = lines.filter(line => /^- \[[xX]\]/.test(line) || /:\s*\[[xX]\]\s*yes\s*$/i.test(line))
if (checked.length < 50) throw new Error(`Manual acceptance has only ${checked.length} checked items; expected the complete worksheet`)

const value = label => {
  const line = lines.find(row => row.startsWith(`- ${label}:`))
  if (!line) throw new Error(`Manual acceptance missing header field: ${label}`)
  const result = line.slice(line.indexOf(':') + 1).trim()
  if (!result || /^_+$/.test(result) || result.includes('________________')) throw new Error(`Manual acceptance header field is incomplete: ${label}`)
  return result
}
const buildVersion = value('HEM build/version')
const versionCompatible = buildVersion === pkg.version || (pkg.version === '1.0.0' && /^1\.0\.0-rc\.\d+$/.test(buildVersion))
if (!versionCompatible) throw new Error(`Manual acceptance is for ${buildVersion}, expected ${pkg.version} or its immediately promoted 1.0.0 RC evidence`)
const upstreamCommit = value('Exact minecraft-web-client commit (40-char SHA)')
if (!/^[0-9a-f]{40}$/i.test(upstreamCommit)) throw new Error('Manual acceptance upstream commit is not an exact 40-character SHA')
const backupStamp = value('Cloudflare R2 backup stamp used for restore proof')
if (!/^[0-9]{8}T[0-9]{6}Z$/.test(backupStamp)) throw new Error('Manual acceptance R2 backup stamp is invalid')
for (const label of ['Deployment URL','Game host/VPS identifier','Automated certification completed at','Manual session started at','Manual session ended at','Player 1/operator','Player 2/operator']) value(label)
for (const label of ['Automated certification completed at','Manual session started at','Manual session ended at']) {
  if (!Number.isFinite(Date.parse(value(label)))) throw new Error(`Manual acceptance timestamp is invalid: ${label}`)
}
for (const label of ['Player 1 sign-off','Player 2 sign-off','Release operator sign-off']) {
  const line = lines.find(row => row.startsWith(`${label}:`))
  if (!line || line.includes('________________')) throw new Error(`Manual acceptance is missing ${label}`)
  const match = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.+?)\\s+Date/time:\\s*(.+?)\\s*$`).exec(line)
  if (!match || !match[1].trim() || !Number.isFinite(Date.parse(match[2].trim()))) throw new Error(`Manual acceptance ${label} or date/time is invalid`)
}
fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
const certification = {
  hemVersion: pkg.version,
  acceptance: 'passed',
  upstreamCommit: upstreamCommit.toLowerCase(),
  backupStamp,
  checkedItems: checked.length,
  worksheetSha256: crypto.createHash('sha256').update(text).digest('hex'),
  completedAt: new Date().toISOString()
}
fs.writeFileSync(artifactPath, JSON.stringify(certification, null, 2) + '\n')
console.log(`HEM household manual acceptance verified: ${checked.length} required confirmations / ${pkg.version}`)
console.log(`Wrote ${path.relative(root, artifactPath)}`)
