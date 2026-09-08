import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const PATCH_ID = 'hem-net-browserify-arraybuffer-ordering-v1'
const MARKER = `HEM ${PATCH_ID}: preserve WebSocket binary frame order for the Minecraft TCP byte stream`
const sha256 = value => createHash('sha256').update(value).digest('hex')

export function patchBrowserSource (input) {
  let source = String(input).replace(/\r\n/g, '\n')
  if (source.includes(MARKER)) return source

  const wsPattern = /(this\._ws\s*=\s*new WebSocket\([^\n]+\);?\n)(\s*this\._handleWebsocket\(\);?)/
  if (!wsPattern.test(source)) {
    throw new Error(`${PATCH_ID}: cannot locate net-browserify WebSocket construction; installed browser transport source shape is not recognized`)
  }
  source = source.replace(wsPattern, (_match, createLine, nextLine) => {
    const indent = /^\s*/.exec(nextLine)?.[0] || '\t'
    return `${createLine}${indent}// ${MARKER}\n${indent}this._ws.binaryType = 'arraybuffer';\n${nextLine}`
  })

  const blobBranch = /\}\s*else if \(window\.Blob && contents instanceof Blob\) \{/
  if (!blobBranch.test(source)) {
    throw new Error(`${PATCH_ID}: cannot locate asynchronous Blob receive branch; installed browser transport source shape is not recognized`)
  }
  source = source.replace(blobBranch, `} else if (typeof ArrayBuffer !== 'undefined' && contents instanceof ArrayBuffer) {\n\t\t\t// WebSocket message events are ordered. ArrayBuffer delivery keeps TCP bytes in that order\n\t\t\t// and avoids independent FileReader callbacks racing one another.\n\t\t\tprocessBuffer(new Buffer(new Uint8Array(contents)));\n\t\t} else if (window.Blob && contents instanceof Blob) {`)

  if (!source.includes(MARKER) || !/binaryType\s*=\s*'arraybuffer'/.test(source) || !/contents instanceof ArrayBuffer/.test(source)) {
    throw new Error(`${PATCH_ID}: patch attestation markers are missing after replacement`)
  }
  return source
}

function packageRootFromResolved (resolved, expectedName = 'net-browserify') {
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

export function findRuntimeNetBrowserifyRoot (upstreamRoot) {
  const absolute = path.resolve(upstreamRoot)
  const req = createRequire(path.join(absolute, 'package.json'))
  let resolved
  try { resolved = req.resolve('net-browserify') } catch (error) {
    throw new Error(`${PATCH_ID}: minecraft-web-client cannot resolve net-browserify: ${error.message}`)
  }
  const root = packageRootFromResolved(resolved)
  if (!root) throw new Error(`${PATCH_ID}: resolved net-browserify package root could not be identified`)
  return fs.realpathSync(root)
}

export async function patchPackageRoot (packageRoot) {
  const pkgPath = path.join(packageRoot, 'package.json')
  const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf8'))
  const browserFile = typeof pkg.browser === 'string' ? pkg.browser : 'browser.js'
  const file = path.join(packageRoot, browserFile)
  if (!fs.existsSync(file)) throw new Error(`${PATCH_ID}: missing ${file}`)
  const before = await fsp.readFile(file, 'utf8')
  const after = patchBrowserSource(before)
  await fsp.writeFile(file, after)
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  return {
    patchId: PATCH_ID,
    packageVersion: pkg.version || 'unknown',
    browserFile,
    binaryType: 'arraybuffer',
    orderedBinaryDelivery: true,
    avoidsAsyncBlobPath: true,
    beforeSha256: sha256(before),
    afterSha256: sha256(after),
    changed: before !== after,
  }
}

export async function main (upstreamRoot = process.argv[2] || process.cwd()) {
  const absolute = path.resolve(upstreamRoot)
  const root = findRuntimeNetBrowserifyRoot(absolute)
  const patched = await patchPackageRoot(root)
  const report = {
    patchId: PATCH_ID,
    minecraft: '1.21.5',
    reason: 'The historical browser TCP shim converts WebSocket Blob frames with independent FileReaders. Minecraft requires strict TCP byte ordering, so HEM requests ArrayBuffer frames and processes them synchronously in message-event order.',
    runtimeResolved: true,
    root: path.relative(absolute, root) || '.',
    ...patched,
  }
  const reportPath = path.join(absolute, '.hem-net-browserify-ordering.json')
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(`HEM ${PATCH_ID} applied to runtime-resolved net-browserify ${report.packageVersion}; binary WebSocket frames use ordered ArrayBuffer delivery`)
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1) })
}
