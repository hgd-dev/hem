import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
if (!/-rc\.\d+$/.test(pkg.version)) throw new Error(`Promotion expects an RC source tree; current version is ${pkg.version}`)
const run = (script, args = [], env = {}) => execFileSync(process.execPath, [path.join(root, script), ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })

// Reconcile machine-verifiable blockers from the exact-pinned certification artifacts first.
run('scripts/reconcile-release-blockers.mjs')
// Production R2 and household/manual blockers must still have explicit evidence/sign-off.
run('scripts/release-readiness.mjs', ['--final'])
// The RC itself must have passed exact-pinned, full-duration system acceptance.
run('scripts/verify-certification.mjs', [], { HEM_REQUIRE_PINNED_CERT: 'true', HEM_EXPECT_SOAK_MINUTES: '60' })
run('scripts/set-version.mjs', ['1.0.0'])
console.log('HEM source promoted to 1.0.0. Rebuild the browser client with the same exact upstream SHA, rerun final System Acceptance, then run npm run release:guard before tagging.')
