import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const label = version === '1.0.0'
  ? 'HEM_v1.0.0_REPO_ROOT.zip'
  : `HEM_v1.0.0_RC${version.match(/-rc\.(\d+)$/i)?.[1] || 'X'}_REPO_ROOT.zip`
const out = path.resolve(root, '..', label)

execFileSync(process.execPath, [path.join(root, 'scripts/source-manifest.mjs')], { cwd: root, stdio: 'inherit' })
try { execFileSync('rm', ['-f', out]) } catch {}
execFileSync('zip', [
  '-qr', out, '.',
  '-x', './node_modules/*', './apps/client/upstream/*', './apps/client/dist/*', './.git/*', './artifacts/*', '*.zip'
], { cwd: root, stdio: 'inherit' })
console.log(out)
