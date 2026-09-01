import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const next = process.argv[2]
if (!/^1\.0\.0(?:-rc\.\d+)?$/.test(next || '')) throw new Error('Usage: node scripts/set-version.mjs 1.0.0[-rc.N]')
const pkgPath = path.join(root, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const current = pkg.version
if (!/^1\.0\.0(?:-rc\.\d+)?$/.test(current)) throw new Error(`Unexpected current HEM version ${current}`)
if (current === next) { console.log(`HEM already ${next}`); process.exit(0) }

const skip = new Set(['SOURCE_MANIFEST.sha256'])
const skipDirs = new Set(['node_modules', '.git', 'upstream', 'dist', 'artifacts'])
const touched = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) { walk(target); continue }
    if (skip.has(entry.name)) continue
    let text
    try { text = fs.readFileSync(target, 'utf8') } catch { continue }
    if (!text.includes(current)) continue
    fs.writeFileSync(target, text.split(current).join(next))
    touched.push(path.relative(root, target))
  }
}
walk(root)

// Human-facing release identity lines do not use the hyphenated semver string.
if (next === '1.0.0') {
  for (const rel of ['README.md','VERIFICATION.md','docs/GO_LIVE.md']) {
    const target = path.join(root, rel)
    if (!fs.existsSync(target)) continue
    let text = fs.readFileSync(target, 'utf8')
    text = text.replace(/HEM 1\.0\.0 RC\d+/g, 'HEM 1.0.0')
      .replace(/^# HEM RC\d+ — go live$/m, '# HEM 1.0.0 — go live')
      .replace(/^# HEM RC\d+ verification record$/m, '# HEM 1.0.0 verification record')
    fs.writeFileSync(target, text)
  }
}
execFileSync(process.execPath, [path.join(root, 'scripts/source-manifest.mjs'), '--write'], { cwd: root, stdio: 'inherit' })
console.log(`HEM version ${current} -> ${next}; updated ${touched.length} embedded version file(s) and regenerated SOURCE_MANIFEST.sha256.`)
