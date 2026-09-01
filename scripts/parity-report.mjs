import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, 'docs/PARITY_1_21_5.md')
const text = fs.readFileSync(file, 'utf8')
const entries = []
for (const [index, line] of text.split(/\r?\n/).entries()) {
  const match = /^- (PASS|PARTIAL|TODO)\s+(.+)$/.exec(line)
  if (match) entries.push({ status: match[1], text: match[2], line: index + 1 })
}
if (!entries.length) throw new Error('HEM parity ledger has no parseable status entries')
const counts = Object.fromEntries(['PASS','PARTIAL','TODO'].map(status => [status, entries.filter(entry => entry.status === status).length]))
console.log(`HEM 1.21.5 parity ledger: PASS=${counts.PASS} PARTIAL=${counts.PARTIAL} TODO=${counts.TODO} TOTAL=${entries.length}`)
if (process.argv.includes('--json')) console.log(JSON.stringify({ minecraft: '1.21.5', counts, entries }, null, 2))
if (process.argv.includes('--final') && (counts.PARTIAL > 0 || counts.TODO > 0)) {
  const blockers = entries.filter(entry => entry.status !== 'PASS')
  console.error(`Final release blocked by ${blockers.length} unresolved parity entries.`)
  for (const entry of blockers.slice(0, 20)) console.error(`${entry.status} line ${entry.line}: ${entry.text}`)
  if (blockers.length > 20) console.error(`...and ${blockers.length - 20} more blockers.`)
  process.exit(1)
}
