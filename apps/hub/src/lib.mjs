const te = new TextEncoder()

export const WORLD_ID_RE = /^w_[a-f0-9]{20}$/
export const MC_USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/
export const MODES = new Set(['survival', 'creative', 'hardcore'])
export const WORLD_TYPES = new Set(['normal', 'flat', 'large_biomes', 'amplified'])
export const DIFFICULTIES = new Set(['peaceful', 'easy', 'normal', 'hard'])

export function base64url(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function randomToken(bytes = 32, cryptoImpl = crypto) {
  const data = new Uint8Array(bytes)
  cryptoImpl.getRandomValues(data)
  return base64url(data)
}

export function randomWorldId(cryptoImpl = crypto) {
  const data = new Uint8Array(10)
  cryptoImpl.getRandomValues(data)
  return `w_${[...data].map(x => x.toString(16).padStart(2, '0')).join('')}`
}

export async function sha256Hex(value, cryptoImpl = crypto) {
  const hash = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', te.encode(value)))
  return [...hash].map(x => x.toString(16).padStart(2, '0')).join('')
}

export async function hashSecret(secret, pepper, cryptoImpl = crypto) {
  return sha256Hex(`${pepper}:${secret}`, cryptoImpl)
}

export function sanitizeDisplayName(input) {
  const value = String(input ?? '').trim().replace(/\s+/g, ' ')
  if (value.length < 1 || value.length > 32) throw new Error('Display name must be 1-32 characters')
  if (/[^\p{L}\p{N} _.-]/u.test(value)) throw new Error('Display name contains unsupported characters')
  return value
}

export function baseMcUsername(displayName) {
  let value = displayName.normalize('NFKD').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_')
  value = value.replace(/^_+|_+$/g, '')
  if (value.length < 3) value = `HEM_${value || 'Player'}`
  return value.slice(0, 16)
}

export async function deriveAvailableUsername(displayName, existsFn, cryptoImpl = crypto) {
  // Paper runs in offline mode so the browser can connect. Never use the public
  // display name as the actual login name: an unguessable suffix prevents a
  // stranger who merely knows “Hudson” or “Elise” from pre-empting that login.
  const base = baseMcUsername(displayName).slice(0, 5)
  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = (await sha256Hex(`${displayName}:${randomToken(12, cryptoImpl)}`, cryptoImpl)).slice(0, 10)
    const candidate = `${base}_${suffix}`.slice(0, 16)
    if (!(await existsFn(candidate))) return candidate
  }
  throw new Error('Unable to allocate Minecraft username')
}

export function normalizeSeed(input) {
  const seed = String(input ?? '').trim()
  if (!seed) return ''
  if (seed.length > 100) throw new Error('Seed is too long')
  if (/^[+-]?\d+$/.test(seed)) {
    const n = BigInt(seed)
    const min = -(2n ** 63n)
    const max = (2n ** 63n) - 1n
    if (n < min || n > max) throw new Error('Numeric seed must fit signed 64-bit range')
    return n.toString()
  }
  if (/[^\x20-\x7E]/.test(seed)) throw new Error('Text seed must use printable ASCII')
  return seed
}

export function sanitizeWorldName(input) {
  const raw = String(input ?? '')
  if (/[\u0000-\u001F\u007F]/.test(raw)) throw new Error('World name contains unsupported control characters')
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name.length < 1 || name.length > 64) throw new Error('World name must be 1-64 characters')
  return name
}

export function validateWorldCreate(body) {
  const name = sanitizeWorldName(body?.name)
  const kind = body?.kind === 'shared' ? 'shared' : 'solo'
  const gameMode = MODES.has(body?.gameMode) ? body.gameMode : 'survival'
  const requestedDifficulty = DIFFICULTIES.has(body?.difficulty) ? body.difficulty : 'normal'
  const difficulty = gameMode === 'hardcore' ? 'hard' : requestedDifficulty
  const allowCommands = body?.allowCommands !== false
  const worldType = WORLD_TYPES.has(body?.worldType) ? body.worldType : 'normal'
  const generateStructures = body?.generateStructures !== false
  return { name, kind, gameMode, difficulty, allowCommands, worldType, generateStructures, seed: normalizeSeed(body?.seed) }
}

export function safeEqualText(a, b) {
  a = String(a ?? '')
  b = String(b ?? '')
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {})
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function errorJson(status, message, code = 'error') {
  return json({ ok: false, code, message }, { status })
}

export function parseBearer(request) {
  const h = request.headers.get('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(h)
  return match?.[1] || ''
}

export function parseIdentityCredential(value) {
  const dot = value.indexOf('.')
  if (dot < 2) return null
  const id = value.slice(0, dot)
  const secret = value.slice(dot + 1)
  if (!/^u_[a-f0-9]{20}$/.test(id) || secret.length < 32) return null
  return { id, secret }
}

export function randomIdentityId(cryptoImpl = crypto) {
  const w = randomWorldId(cryptoImpl)
  return `u_${w.slice(2)}`
}

export function buildLaunchUrl({ gameClientUrl, proxyUrl, destinationHost, port, username, token }) {
  const url = new URL(gameClientUrl)
  url.searchParams.set('ip', `${destinationHost}:${port}`)
  url.searchParams.set('version', '1.21.5')
  url.searchParams.set('proxy', proxyUrl)
  url.searchParams.set('username', username)
  url.searchParams.set('autoConnect', 'true')
  url.searchParams.set('lockConnect', 'true')
  url.searchParams.set('name', 'HEM')
  url.hash = new URLSearchParams({ hemToken: token }).toString()
  return url.toString()
}
