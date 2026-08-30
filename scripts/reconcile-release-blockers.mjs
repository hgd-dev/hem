import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'artifacts')
fs.mkdirSync(outDir, { recursive: true })
const result = spawnSync(process.execPath, [path.join(root, 'scripts/release-readiness.mjs'), '--json'], {
  cwd: root,
  encoding: 'utf8',
  env: process.env
})
if (result.error) throw result.error
if (result.status !== 0) throw new Error(result.stderr || `release readiness exited ${result.status}`)
process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
const marker = result.stdout.indexOf('{')
if (marker < 0) throw new Error('Release readiness did not emit JSON')
const report = JSON.parse(result.stdout.slice(marker))
report.generatedAt = new Date().toISOString()
report.hemVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const out = path.join(outDir, 'hem-release-readiness.json')
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
console.log(`Wrote ${path.relative(root, out)}. Automated blockers are evidence-derived; production R2 and household acceptance remain explicit sign-offs.`)
