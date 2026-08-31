import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const upstream = path.join(here, 'upstream')
const dist = path.join(here, 'dist')
const repo = process.env.MWC_REPO || 'https://github.com/zardoy/minecraft-web-client.git'
const ref = process.env.MWC_REF || 'cdd8c31a0e9261ee57fb66ff8ca5af0e074bff78'
const requirePinnedRef = process.env.HEM_REQUIRE_PINNED_MWC === 'true'
const exactCommitRef = /^[0-9a-f]{40}$/i.test(ref)
if (requirePinnedRef && !exactCommitRef) {
  throw new Error('HEM final certification requires MWC_REF to be an exact 40-character upstream commit SHA')
}
const run = (cmd, args, cwd = here) => {
  console.log('+', cmd, ...args)
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: process.env })
}

await fsp.rm(upstream, { recursive: true, force: true })
await fsp.rm(dist, { recursive: true, force: true })
run('git', ['clone', '--filter=blob:none', '--no-checkout', repo, upstream])
run('git', ['fetch', '--depth', '1', 'origin', ref], upstream)
run('git', ['checkout', '--detach', 'FETCH_HEAD'], upstream)
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim()
if (exactCommitRef && sha.toLowerCase() !== ref.toLowerCase()) {
  throw new Error(`HEM upstream checkout mismatch: requested ${ref}, resolved ${sha}`)
}

// The web client is an upstream dependency, so HEM makes the user-facing feature
// surface it relies on explicit. These are source-contract signals rather than a
// substitute for live browser acceptance: if upstream removes/renames one, the
// build stops and the integration must be reviewed instead of silently regressing.
async function collectText(dir) {
  const chunks = []
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) chunks.push(await collectText(target))
    else if (/\.(?:[cm]?[jt]sx?|json|md|html|css)$/i.test(entry.name)) chunks.push(await fsp.readFile(target, 'utf8').catch(() => ''))
  }
  return chunks.join('\n')
}
const upstreamCorpus = [
  await collectText(path.join(upstream, 'src')),
  await fsp.readFile(path.join(upstream, 'README.MD'), 'utf8').catch(() => ''),
  await fsp.readFile(path.join(upstream, 'README.md'), 'utf8').catch(() => ''),
].join('\n')
const capabilityPatterns = {
  keybindings: /keybind/i,
  renderDistanceSetting: /renderDistance/,
  rawMouseInput: /raw.?input|pointer.?lock/i,
  resourcePackTextures: /resource.?pack/i,
  creativeInventory: /\bJEI\b|creative.?inventory/i,
  debugOverlay: /debug.?overlay|\bF3\b/i,
  thirdPerson: /third.?person|perspective|\bF5\b/i,
  sounds: /\bsounds?\b/i,
}
const capabilities = Object.fromEntries(Object.entries(capabilityPatterns).map(([name, pattern]) => [name, pattern.test(upstreamCorpus)]))
const missingCapabilities = Object.entries(capabilities).filter(([, present]) => !present).map(([name]) => name)
if (missingCapabilities.length) throw new Error(`HEM upstream capability contract missing: ${missingCapabilities.join(', ')}`)

const pkgPath = path.join(upstream, 'package.json')
const lockPath = path.join(upstream, 'pnpm-lock.yaml')
const pkgSource = await fsp.readFile(pkgPath, 'utf8')
const lockSource = await fsp.readFile(lockPath, 'utf8')
const pkg = JSON.parse(pkgSource)
const upstreamPackageSha256 = createHash('sha256').update(pkgSource).digest('hex')
const upstreamLockSha256 = createHash('sha256').update(lockSource).digest('hex')

// IMPORTANT: do not rewrite dependency overrides for this historical release.
// RC13 used an unfrozen install after injecting newer Prismarine versions. That
// caused pnpm to re-resolve minecraft-protocol#master to a 2026 commit while the
// v0.1.98 patch still targeted its original 2025 snapshot, producing
// ERR_PNPM_PATCH_FAILED. The release's checked-in lockfile is part of the pinned
// build provenance and must stay authoritative.
if (!/minecraft-protocol/.test(lockSource)) throw new Error('Pinned v0.1.98 lockfile no longer contains minecraft-protocol; review HEM build provenance')

// HEM intentionally exposes one protocol target. Historical minecraft-web-client
// releases derive their supported-version surface dynamically, so grepping literal
// strings from supportedVersions.mjs is NOT a valid support detector (v0.1.98 contains
// a literal 1.7 token even though its release includes the 1.21.5 protocol update).
// Preserve the pristine source hash for provenance, pin the known 1.21.5 release, then
// prove the installed protocol/data stack below before emitting hem-build.json.
const supportedVersions = path.join(upstream, 'src', 'supportedVersions.mjs')
if (!fs.existsSync(supportedVersions)) throw new Error('Upstream supportedVersions.mjs moved; review HEM client patch before release')
const upstreamSupportedVersionsSource = await fsp.readFile(supportedVersions, 'utf8')
const upstreamSupportedVersionsSha256 = createHash('sha256').update(upstreamSupportedVersionsSource).digest('hex')
const upstreamLiteralVersionTokens = [...new Set([...upstreamSupportedVersionsSource.matchAll(/[\"'](\d+\.\d+(?:\.\d+)?)[\"']/g)].map(match => match[1]))]
const known1215ReleaseCommit = 'cdd8c31a0e9261ee57fb66ff8ca5af0e074bff78'
const upstreamReleaseTag = sha.toLowerCase() === known1215ReleaseCommit ? 'v0.1.98' : ''
const upstreamRelease1215 = upstreamReleaseTag === 'v0.1.98'
if (requirePinnedRef && !upstreamRelease1215) {
  throw new Error(`HEM pinned certification currently requires minecraft-web-client v0.1.98 (${known1215ReleaseCommit}); resolved ${sha}`)
}
console.log(`HEM upstream provenance: ${upstreamReleaseTag || 'unrecognized exact commit'} @ ${sha}; literal supportedVersions tokens are informational only: ${upstreamLiteralVersionTokens.join(', ') || '(none)'}`)
// Narrow the launcher to HEM's single certified target. The post-install verification
// below is the authoritative protocol/data check for the patched HEM integration.
await fsp.writeFile(supportedVersions, "export default ['1.21.5']\n")

const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager || '')?.[1] || '10.32.1'
const pnpm = args => run('npx', ['--yes', `pnpm@${pnpmVersion}`, ...args], upstream)
process.env.CYPRESS_INSTALL_BINARY ??= '0'
pnpm(['install', '--frozen-lockfile'])

// A frozen install is only useful if nothing rewrote the lock/package metadata.
// Re-hash both files immediately after install so dependency drift fails closed.
const installedPackageSha256 = createHash('sha256').update(await fsp.readFile(pkgPath)).digest('hex')
const installedLockSha256 = createHash('sha256').update(await fsp.readFile(lockPath)).digest('hex')
if (installedPackageSha256 !== upstreamPackageSha256) throw new Error('Pinned upstream package.json changed during dependency install')
if (installedLockSha256 !== upstreamLockSha256) throw new Error('Pinned upstream pnpm-lock.yaml changed during dependency install')

// Fail the build before bundling if the installed protocol/data stack is not truly
// 1.21.5-aware. This does not prove renderer parity, but it prevents an older
// registry silently masquerading as HEM 1.21.5.
const dataCheck = path.join(upstream, '.hem-verify-1215.cjs')
await fsp.writeFile(dataCheck, String.raw`
const mcData = require('minecraft-data')('1.21.5')
if (!mcData) throw new Error('minecraft-data cannot load 1.21.5')
const need = (map, names, label) => {
  const missing = names.filter(name => !map?.[name])
  if (missing.length) throw new Error('HEM 1.21.5 ' + label + ' registry missing: ' + missing.join(', '))
}
const roundTrip = (array, byName, byId, label) => {
  if (!Array.isArray(array) || array.length === 0) throw new Error('HEM 1.21.5 ' + label + ' array is empty')
  for (const entry of array) {
    if (!entry || typeof entry.name !== 'string' || !Number.isInteger(entry.id)) throw new Error('HEM 1.21.5 malformed ' + label + ' registry entry')
    if (byName?.[entry.name]?.id !== entry.id) throw new Error('HEM 1.21.5 ' + label + ' name mapping mismatch: ' + entry.name)
    if (byId?.[entry.id]?.name !== entry.name) throw new Error('HEM 1.21.5 ' + label + ' id mapping mismatch: ' + entry.id)
  }
}
need(mcData.itemsByName, ['mace','wind_charge','brown_egg','blue_egg','firefly_bush','leaf_litter','wildflowers','bush','short_dry_grass','tall_dry_grass','cactus_flower'], 'item')
need(mcData.blocksByName, ['crafter','trial_spawner','vault','copper_bulb','firefly_bush','leaf_litter','wildflowers','bush','short_dry_grass','tall_dry_grass','cactus_flower'], 'block')
need(mcData.entitiesByName, ['pig','cow','chicken','sheep','wolf'], 'entity')
roundTrip(mcData.itemsArray, mcData.itemsByName, mcData.items, 'item')
roundTrip(mcData.blocksArray, mcData.blocksByName, mcData.blocks, 'block')
roundTrip(mcData.entitiesArray, mcData.entitiesByName, mcData.entities, 'entity')
if (mcData.version?.minecraftVersion !== '1.21.5') throw new Error('HEM data resolved to ' + mcData.version?.minecraftVersion)
if (mcData.version?.version !== 770) throw new Error('HEM 1.21.5 protocol id resolved to ' + mcData.version?.version + ', expected 770')
if (mcData.version?.dataVersion != null && mcData.version.dataVersion !== 4325) throw new Error('HEM 1.21.5 data version resolved to ' + mcData.version.dataVersion + ', expected 4325')

const assetsPackage = require('mc-assets/package.json')
const itemDefinitions = require('mc-assets/dist/itemDefinitions.json')
if (!Object.prototype.hasOwnProperty.call(itemDefinitions, '1.21.5')) throw new Error('Pinned v0.1.98 mc-assets does not advertise a 1.21.5 item-definition layer')
for (const name of ['mace','wind_charge','brown_egg','blue_egg','firefly_bush','leaf_litter','wildflowers','bush','short_dry_grass','tall_dry_grass','cactus_flower']) {
  if (!itemDefinitions.latest?.[name]) throw new Error('HEM mc-assets missing 1.21.5-era item definition: ' + name)
}
const spawnEggs = mcData.itemsArray.filter(entry => entry.name.endsWith('_spawn_egg')).map(entry => entry.name)
if (spawnEggs.length < 50) throw new Error('HEM 1.21.5 spawn-egg registry unexpectedly small: ' + spawnEggs.length)
for (const name of spawnEggs) {
  if (!itemDefinitions.latest?.[name]) throw new Error('HEM mc-assets missing native 1.21.5 spawn-egg item definition: ' + name)
}
const versions = {
  minecraftData: require('minecraft-data/package.json').version,
  minecraftRenderer: require('minecraft-renderer/package.json').version,
  minecraftInventory: require('minecraft-inventory/package.json').version,
  mineflayerConnector: require('mcraft-fun-mineflayer/package.json').version,
  mcAssets: assetsPackage.version,
}
console.log('HEM 1.21.5 data + item-definition check passed', mcData.version.minecraftVersion, 'protocol', mcData.version.version, versions)
require('fs').writeFileSync('.hem-dependency-versions.json', JSON.stringify(versions))
`)
run('node', [dataCheck], upstream)
const dependencyVersionsPath = path.join(upstream, '.hem-dependency-versions.json')
const dependencyVersions = JSON.parse(await fsp.readFile(dependencyVersionsPath, 'utf8'))
const protocolVerified1215 = true
const compatibilityMode = upstreamRelease1215 ? 'pinned-v0.1.98-lockfile-1215-verified' : 'pinned-lockfile-1215-data-verified'
console.log(`HEM client compatibility mode: ${compatibilityMode}; protocol/data verification passed`)
await fsp.rm(dataCheck, { force: true })
await fsp.rm(dependencyVersionsPath, { force: true })

pnpm(['prepare-project'])
pnpm(['build'])

const built = path.join(upstream, 'dist')
if (!fs.existsSync(path.join(built, 'index.html'))) throw new Error('minecraft-web-client build did not create dist/index.html')
await fsp.cp(built, dist, { recursive: true })
await fsp.copyFile(path.join(here, 'hem-bridge.js'), path.join(dist, 'hem-bridge.js'))

let html = await fsp.readFile(path.join(dist, 'index.html'), 'utf8')
html = html.replace(/<title>[\s\S]*?<\/title>/i, '<title>HEM — Minecraft 1.21.5</title>')
if (!html.includes('hem-bridge.js')) html = html.replace(/<\/body>/i, '<script src="./hem-bridge.js"></script></body>')
await fsp.writeFile(path.join(dist, 'index.html'), html)

// autoConnect=true is ignored by upstream unless this config flag is enabled.
const configPath = path.join(dist, 'config.json')
let config = {}
try { config = JSON.parse(await fsp.readFile(configPath, 'utf8')) } catch {}
config.allowAutoConnect = true
config.promoteServers = []
config.pauseLinks = []
config.rightSideText = 'HEM — Hudson · Elise · Minecraft'
config.splashText = '1.21.5'
config.splashTextFallback = 'HEM 1.21.5'
config.defaultUsername = 'HEMPlayer'
delete config.defaultProxy
await fsp.writeFile(configPath, JSON.stringify(config, null, 2) + '\n')

await fsp.writeFile(path.join(dist, 'hem-build.json'), JSON.stringify({
  hemVersion: '1.0.0-rc.14',
  minecraft: '1.21.5',
  upstreamRepo: repo,
  upstreamRef: ref,
  upstreamCommit: sha,
  upstreamPinned: exactCommitRef && sha.toLowerCase() === ref.toLowerCase(),
  upstreamReleaseTag,
  upstreamRelease1215,
  upstreamLiteralVersionTokens,
  upstreamSupportedVersionsSha256,
  upstreamPackageSha256,
  upstreamLockSha256,
  pnpmVersion,
  frozenLockfile: true,
  protocolVerified1215,
  compatibilityMode,
  ...dependencyVersions,
  capabilities,
  builtAt: new Date().toISOString(),
}, null, 2) + '\n')
console.log(`HEM client built from ${sha}`)
