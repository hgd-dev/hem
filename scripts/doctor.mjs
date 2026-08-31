import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const systemMode = process.argv.includes('--system')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const artifactPath = path.join(root, 'artifacts', 'hem-doctor.json')
const checks = []

function add(id, ok, detail, required = false) {
  checks.push({ id, ok: Boolean(ok), required: Boolean(required), detail: String(detail || '') })
  console.log(`${ok ? 'PASS' : required ? 'FAIL' : 'WARN'} ${id} - ${detail}`)
}
function command(name, args = []) {
  const result = spawnSync(name, args, { encoding: 'utf8' })
  return { ok: result.status === 0, status: result.status, text: `${result.stdout || ''}${result.stderr || ''}`.trim() }
}
function major(version) {
  const match = /v?(\d+)/.exec(version || '')
  return match ? Number(match[1]) : 0
}
async function probe(url) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 7000)
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal, headers: { 'user-agent': `HEM/${pkg.version} doctor` } })
    clearTimeout(timer)
    return { ok: response.ok || (response.status >= 300 && response.status < 500), detail: `HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, detail: error?.cause?.code || error?.name || error?.message || 'network error' }
  }
}

add('source.version', /^1\.0\.0(?:-rc\.\d+)?$/.test(pkg.version), pkg.version, true)
add('runtime.node22', major(process.version) >= 22, process.version, true)
const git = command('git', ['--version'])
add('tool.git', git.ok, git.text || 'git unavailable', systemMode)
const java = command('java', ['-version'])
add('tool.java21', java.ok && /version "(?:21|2[2-9]|[3-9]\d)/.test(java.text), java.text.split(/\r?\n/)[0] || 'Java unavailable', false)
const docker = command('docker', ['compose', 'version'])
add('tool.docker-compose', docker.ok, docker.text.split(/\r?\n/)[0] || 'Docker Compose unavailable', systemMode)
const chromiumCandidates = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']
const browser = chromiumCandidates.map(name => [name, command(name, ['--version'])]).find(([, result]) => result.ok)
add('tool.browser', Boolean(browser), browser ? `${browser[0]}: ${browser[1].text.split(/\r?\n/)[0]}` : 'No system Chromium/Chrome command found', false)

const manifest = path.join(root, 'SOURCE_MANIFEST.sha256')
add('source.manifest-present', fs.existsSync(manifest), fs.existsSync(manifest) ? 'SOURCE_MANIFEST.sha256 present' : 'missing SOURCE_MANIFEST.sha256', true)
const pluginSource = path.join(root, 'apps/server-plugin/src/main/java/com/hemcraft/gate/HEMGatePlugin.java')
add('source.gate-plugin', fs.existsSync(pluginSource), fs.existsSync(pluginSource) ? 'HEMGate source present' : 'HEMGate source missing', true)

const clientIdentityPath = path.join(root, 'apps/client/dist/hem-build.json')
if (fs.existsSync(clientIdentityPath)) {
  try {
    const identity = JSON.parse(fs.readFileSync(clientIdentityPath, 'utf8'))
    const ok = identity.hemVersion === pkg.version && identity.minecraft === '1.21.5' && /^[0-9a-f]{40}$/i.test(identity.upstreamCommit || '') &&
      identity.upstreamReleaseTag === 'v0.1.98' && identity.upstreamRelease1215 === true &&
      Array.isArray(identity.upstreamLiteralVersionTokens) &&
      /^[0-9a-f]{64}$/i.test(identity.upstreamSupportedVersionsSha256 || '') &&
      identity.compatibilityMode === 'pinned-v0.1.98-lockfile-1215-verified' && identity.protocolVerified1215 === true && identity.frozenLockfile === true && /^[0-9a-f]{64}$/i.test(identity.upstreamLockSha256 || '')
    add('client.identity', ok, ok ? `${identity.compatibilityMode} @ ${identity.upstreamCommit}` : 'hem-build.json is incomplete or for another HEM version', systemMode)
  } catch (error) {
    add('client.identity', false, `invalid hem-build.json: ${error.message}`, systemMode)
  }
} else {
  add('client.identity', false, 'client dist not built in this checkout', systemMode)
}

const paperSha = '2ae6ae22adf417699746e0f89fc2ef6cb6ee050a5f6608cee58f0535d60b509e'
const [githubProbe, paperProbe] = await Promise.all([
  probe('https://github.com/zardoy/minecraft-web-client'),
  probe(`https://fill-data.papermc.io/v1/objects/${paperSha}/paper-1.21.5-114.jar`),
])
add('network.github-upstream', githubProbe.ok, githubProbe.detail, systemMode)
add('network.paper-1215', paperProbe.ok, paperProbe.detail, systemMode)

const requiredFailures = checks.filter(check => check.required && !check.ok)
const report = {
  hemVersion: pkg.version,
  minecraft: '1.21.5',
  mode: systemMode ? 'system' : 'local',
  ready: requiredFailures.length === 0,
  requiredFailureCount: requiredFailures.length,
  checks,
  generatedAt: new Date().toISOString(),
}
await fsp.mkdir(path.dirname(artifactPath), { recursive: true })
await fsp.writeFile(artifactPath, JSON.stringify(report, null, 2) + '\n')
console.log(`HEM doctor: ${report.ready ? 'READY' : 'BLOCKED'} (${requiredFailures.length} required failure(s)); ${path.relative(root, artifactPath)}`)
if (systemMode && requiredFailures.length) process.exit(1)
