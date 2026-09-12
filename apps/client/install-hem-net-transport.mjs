import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const TRANSPORT_ID = 'hem-raw-tcp-v1'
const here = path.dirname(fileURLToPath(import.meta.url))
const sha256 = value => createHash('sha256').update(value).digest('hex')

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
    throw new Error(`${TRANSPORT_ID}: minecraft-web-client cannot resolve net-browserify: ${error.message}`)
  }
  const root = packageRootFromResolved(resolved)
  if (!root) throw new Error(`${TRANSPORT_ID}: runtime-resolved net-browserify package root could not be identified`)
  return fs.realpathSync(root)
}

export async function installPackageRoot (packageRoot, adapterPath = path.join(here, 'hem-net-socket.cjs')) {
  const pkgPath = path.join(packageRoot, 'package.json')
  const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf8'))
  if (pkg.name !== 'net-browserify') throw new Error(`${TRANSPORT_ID}: expected net-browserify package, found ${pkg.name || 'unknown'}`)
  const browserFile = typeof pkg.browser === 'string' ? pkg.browser : 'browser.js'
  const browserPath = path.join(packageRoot, browserFile)
  if (!fs.existsSync(browserPath)) throw new Error(`${TRANSPORT_ID}: missing runtime browser entry ${browserPath}`)

  const before = await fsp.readFile(browserPath, 'utf8')
  if (!/Socket\.prototype\._connectWebSocket|WebSocket\(/.test(before) && !before.includes(TRANSPORT_ID)) {
    throw new Error(`${TRANSPORT_ID}: installed net-browserify browser source shape is not the reviewed historical transport`)
  }
  const adapter = await fsp.readFile(adapterPath, 'utf8')
  if (!adapter.includes(TRANSPORT_ID) || !adapter.includes("module.exports")) {
    throw new Error(`${TRANSPORT_ID}: HEM adapter source is missing required identity/API markers`)
  }
  await fsp.writeFile(browserPath, adapter)
  execFileSync(process.execPath, ['--check', browserPath], { stdio: 'pipe' })

  const after = await fsp.readFile(browserPath, 'utf8')
  if (!after.includes(TRANSPORT_ID) || after.includes('FileReader')) {
    throw new Error(`${TRANSPORT_ID}: installed browser entrypoint did not become the dedicated HEM transport`)
  }
  return {
    transportId: TRANSPORT_ID,
    packageVersion: pkg.version || 'unknown',
    browserFile,
    runtimeResolved: true,
    netBrowserifyProductionTransport: false,
    orderedBinaryDelivery: true,
    singleWebSocketTcpTunnel: true,
    beforeSha256: sha256(before),
    adapterSha256: sha256(adapter),
    afterSha256: sha256(after),
    changed: before !== after,
  }
}

export async function main (upstreamRoot = process.argv[2] || process.cwd()) {
  const absolute = path.resolve(upstreamRoot)
  const root = findRuntimeNetBrowserifyRoot(absolute)
  const installed = await installPackageRoot(root)
  const report = {
    minecraft: '1.21.5',
    root: path.relative(absolute, root) || '.',
    ...installed,
  }
  const reportPath = path.join(absolute, '.hem-net-transport.json')
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(`HEM ${TRANSPORT_ID} installed into runtime-resolved net browser entry (${report.packageVersion})`)
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1) })
}
