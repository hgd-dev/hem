import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const run = (script, args = [], env = {}) => execFileSync(process.execPath, [path.join(root, script), ...args], { stdio: 'inherit', env: { ...process.env, ...env } })

run('scripts/parity-report.mjs')
run('scripts/release-readiness.mjs')

const isRc = /-rc\.\d+$/i.test(pkg.version)
if (isRc) {
  console.log(`HEM ${pkg.version} is release-bound: parity TODO/PARTIAL entries remain a roadmap, while docs/RELEASE_BLOCKERS.md defines the finite promotion gate.`)
  process.exit(0)
}
if (pkg.version !== '1.0.0') throw new Error(`Unexpected non-RC release version ${pkg.version}; review HEM release policy`)
run('scripts/release-readiness.mjs', ['--final'])
run('scripts/verify-certification.mjs', [], { HEM_REQUIRE_PINNED_CERT: 'true', HEM_EXPECT_SOAK_MINUTES: '60' })
console.log('HEM 1.0.0 release guard passed: finite production blockers are closed and pinned 60-minute certification is valid.')
