import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const PATCH_ID = 'hem-minecraft-protocol-register-no-trailing-nul-v1'
const MARKER = `HEM ${PATCH_ID}: modern REGISTER payloads use NUL separators without a trailing empty identifier`
const sha256 = value => createHash('sha256').update(value).digest('hex')

export function encodeRegisterChannels (channels) {
  if (!Array.isArray(channels) || channels.length < 1) throw new Error(`${PATCH_ID}: registration channel list must be non-empty`)
  for (const channel of channels) {
    if (typeof channel !== 'string' || !channel || channel.includes('\0')) throw new Error(`${PATCH_ID}: invalid plugin channel ${JSON.stringify(channel)}`)
  }
  return Buffer.from(channels.join('\0'), 'utf8')
}

export function patchPluginChannelsSource (input) {
  const source = String(input).replace(/\r\n/g, '\n')
  if (source.includes(MARKER)) return source

  const pattern = /  function writeDumbArr \(value, buf, offset\) \{[\s\S]*?\n  \}\n\n  function sizeOfDumbArr \(value\) \{[\s\S]*?\n  \}/
  const match = source.match(pattern)
  if (!match) throw new Error(`${PATCH_ID}: cannot locate registerarr serializer; installed minecraft-protocol source shape is not recognized`)
  if (!/proto\.write\(v, buf, offset, 'cstring'\)/.test(match[0]) || !/this\.sizeOf\(v, 'cstring'/.test(match[0])) {
    throw new Error(`${PATCH_ID}: registerarr serializer no longer matches the historical trailing-NUL implementation`)
  }

  const replacement = `  function writeDumbArr (value, buf, offset) {\n    // ${MARKER}\n    const payload = Buffer.from(value.join('\\0'), 'utf8')\n    payload.copy(buf, offset)\n    return offset + payload.length\n  }\n\n  function sizeOfDumbArr (value) {\n    return Buffer.byteLength(value.join('\\0'), 'utf8')\n  }`
  const patched = source.replace(pattern, replacement)
  if (patched === source) throw new Error(`${PATCH_ID}: serializer replacement made no change`)
  if (!patched.includes(MARKER)) throw new Error(`${PATCH_ID}: patch marker missing after replacement`)
  return patched
}

function packageRootFromResolved (resolved, expectedName = 'minecraft-protocol') {
  let cursor = path.dirname(fs.realpathSync(resolved))
  while (cursor !== path.dirname(cursor)) {
    const pkgPath = path.join(cursor, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        if (pkg.name === expectedName) return cursor
      } catch {}
    }
    cursor = path.dirname(cursor)
  }
  return null
}

export function findRuntimeMinecraftProtocolRoot (upstreamRoot) {
  const absolute = path.resolve(upstreamRoot)
  const req = createRequire(path.join(absolute, 'package.json'))
  let resolved
  try { resolved = req.resolve('minecraft-protocol') } catch (error) {
    throw new Error(`${PATCH_ID}: minecraft-web-client cannot resolve minecraft-protocol: ${error.message}`)
  }
  const root = packageRootFromResolved(resolved)
  if (!root) throw new Error(`${PATCH_ID}: resolved minecraft-protocol package root could not be identified`)
  return fs.realpathSync(root)
}

export async function patchPackageRoot (packageRoot) {
  const file = path.join(packageRoot, 'src', 'client', 'pluginChannels.js')
  if (!fs.existsSync(file)) throw new Error(`${PATCH_ID}: missing ${file}`)
  const before = await fsp.readFile(file, 'utf8')
  const after = patchPluginChannelsSource(before)
  await fsp.writeFile(file, after)
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  let packageVersion = 'unknown'
  try { packageVersion = JSON.parse(await fsp.readFile(path.join(packageRoot, 'package.json'), 'utf8')).version || packageVersion } catch {}
  return {
    patchId: PATCH_ID,
    packageVersion,
    exactRegistration: true,
    trailingNulRemoved: true,
    file: 'src/client/pluginChannels.js',
    beforeSha256: sha256(before),
    afterSha256: sha256(after),
    changed: before !== after,
  }
}

export async function main (upstreamRoot = process.argv[2] || process.cwd()) {
  const absolute = path.resolve(upstreamRoot)
  const root = findRuntimeMinecraftProtocolRoot(absolute)
  const patched = await patchPackageRoot(root)
  const report = {
    patchId: PATCH_ID,
    minecraft: '1.21.5',
    reason: 'node-minecraft-protocol registerarr historically emits a trailing NUL, which modern Paper/proxy channel parsing can treat as an empty identifier.',
    runtimeResolved: true,
    root: path.relative(absolute, root) || '.',
    ...patched,
  }
  const reportPath = path.join(absolute, '.hem-minecraft-protocol-register.json')
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(`HEM ${PATCH_ID} applied to runtime-resolved minecraft-protocol ${report.packageVersion}; REGISTER payloads now omit the trailing NUL`)
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1) })
}
