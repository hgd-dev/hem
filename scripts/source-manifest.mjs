import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(root, 'SOURCE_MANIFEST.sha256')
const excludedDirs = new Set(['node_modules', '.git', 'upstream', 'dist', 'artifacts'])
const excludedFiles = new Set(['SOURCE_MANIFEST.sha256'])

const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && excludedDirs.has(entry.name)) continue
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(target)
    else if (!excludedFiles.has(entry.name)) files.push(target)
  }
}
walk(root)
files.sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b)))

const lines = files.map(file => {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const rel = path.relative(root, file).split(path.sep).join('/')
  return `${hash}  ./${rel}`
})
const expected = `${lines.join('\n')}\n`

if (process.argv.includes('--write')) {
  fs.writeFileSync(manifestPath, expected)
  console.log(`Wrote SOURCE_MANIFEST.sha256 for ${files.length} shipped source files.`)
  process.exit(0)
}

if (!fs.existsSync(manifestPath)) throw new Error('SOURCE_MANIFEST.sha256 is missing; run npm run manifest:write')
const actual = fs.readFileSync(manifestPath, 'utf8').replace(/\r\n/g, '\n')
if (actual !== expected) {
  const actualLines = new Set(actual.trimEnd().split('\n'))
  const expectedLines = new Set(expected.trimEnd().split('\n'))
  const missing = [...expectedLines].filter(line => !actualLines.has(line)).slice(0, 5)
  const stale = [...actualLines].filter(line => !expectedLines.has(line)).slice(0, 5)
  throw new Error(`SOURCE_MANIFEST.sha256 is stale. Run npm run manifest:write. Missing/new entries: ${missing.join(' | ') || 'none'}; stale entries: ${stale.join(' | ') || 'none'}`)
}
console.log(`Verified SOURCE_MANIFEST.sha256 for ${files.length} shipped source files.`)
