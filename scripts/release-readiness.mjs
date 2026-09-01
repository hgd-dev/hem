import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, 'docs/RELEASE_BLOCKERS.md')
const text = fs.readFileSync(file, 'utf8')
const entries = []
for (const [index, line] of text.split(/\r?\n/).entries()) {
  const match = /^- (OPEN|CLOSED)\s+([^—]+?)\s+—\s+(.+)$/.exec(line)
  if (match) entries.push({ declaredStatus: match[1], id: match[2].trim(), text: match[3], line: index + 1 })
}
if (!entries.length) throw new Error('HEM release blocker file has no parseable blocker entries')
if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('HEM release blocker IDs must be unique')

const runEvidenceCheck = (script, env = {}) => spawnSync(process.execPath, [path.join(root, script)], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, ...env }
})
const certCheck = runEvidenceCheck('scripts/verify-certification.mjs', { HEM_REQUIRE_PINNED_CERT: 'true', HEM_EXPECT_SOAK_MINUTES: '60' })
const r2Check = runEvidenceCheck('scripts/verify-production-r2-evidence.mjs')
const manualCheck = runEvidenceCheck('scripts/verify-manual-acceptance.mjs')
const evidence = {
  'pinned-live-acceptance': { valid: certCheck.status === 0, source: 'artifacts/hem-1215-certification.json (+ launcher/restore certificates)' },
  'sixty-minute-soak': { valid: certCheck.status === 0, source: 'artifacts/hem-1215-certification.json (+ launcher/restore certificates)' },
  'production-r2-restore': { valid: r2Check.status === 0, source: 'artifacts/hem-production-r2-restore.json' },
  'household-manual-acceptance': { valid: manualCheck.status === 0, source: 'docs/MANUAL_ACCEPTANCE.md + artifacts/hem-manual-acceptance.json' }
}

const effectiveEntries = entries.map(entry => {
  const proof = evidence[entry.id]
  if (!proof) return { ...entry, status: entry.declaredStatus, evidence: null, evidenceDerived: false }
  return {
    ...entry,
    status: proof.valid ? 'CLOSED' : 'OPEN',
    evidence: proof.valid ? proof.source : null,
    evidenceDerived: true
  }
})
const open = effectiveEntries.filter(entry => entry.status === 'OPEN')
const closed = effectiveEntries.filter(entry => entry.status === 'CLOSED')
console.log(`HEM release readiness: CLOSED=${closed.length} OPEN=${open.length} TOTAL=${effectiveEntries.length}`)
for (const entry of effectiveEntries) {
  if (entry.evidenceDerived) console.log(`${entry.status} ${entry.id}${entry.evidence ? ` <- ${entry.evidence}` : ' (required evidence not yet valid)'}`)
}
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    versionTarget: '1.0.0',
    open,
    closed,
    entries: effectiveEntries
  }, null, 2))
}
if (process.argv.includes('--final') && open.length) {
  console.error(`HEM 1.0.0 release blocked by ${open.length} finite acceptance item(s):`)
  for (const entry of open) console.error(`OPEN ${entry.id}: ${entry.text}`)
  process.exit(1)
}
