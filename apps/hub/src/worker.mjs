import {
  buildLaunchUrl,
  deriveAvailableUsername,
  errorJson,
  hashSecret,
  json,
  parseBearer,
  parseIdentityCredential,
  randomIdentityId,
  randomToken,
  randomWorldId,
  safeEqualText,
  sanitizeDisplayName,
  sanitizeWorldName,
  sha256Hex,
  validateWorldCreate,
  WORLD_ID_RE,
} from './lib.mjs'

const now = () => Date.now()

function validateRuntimeEnv(env) {
  const missing = []
  if (!env.DB) missing.push('DB')
  for (const key of ['HOUSEHOLD_CODE','IDENTITY_PEPPER','SERVER_SERVICE_KEY','ORCHESTRATOR_KEY','GAME_CLIENT_URL','PROXY_URL','ORCHESTRATOR_URL']) {
    if (!env[key] || String(env[key]).includes('REPLACE')) missing.push(key)
  }
  if (missing.length) throw Object.assign(new Error(`HEM runtime is not configured: ${missing.join(', ')}`), { status: 503 })
  if (String(env.IDENTITY_PEPPER).length < 32 || String(env.SERVER_SERVICE_KEY).length < 32 || String(env.ORCHESTRATOR_KEY).length < 32) {
    throw Object.assign(new Error('HEM server secrets must be at least 32 characters'), { status: 503 })
  }
  for (const key of ['GAME_CLIENT_URL','PROXY_URL','ORCHESTRATOR_URL']) {
    let url
    try { url = new URL(env[key]) } catch { throw Object.assign(new Error(`${key} is not a valid URL`), { status: 503 }) }
    if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw Object.assign(new Error(`${key} must use HTTPS in production`), { status: 503 })
  }
}


async function readJson(request) {
  const type = request.headers.get('content-type') || ''
  if (!type.includes('application/json')) throw new Error('Expected application/json')
  return request.json()
}

async function authenticate(request, env) {
  const parsed = parseIdentityCredential(parseBearer(request))
  if (!parsed) return null
  const identity = await env.DB.prepare('SELECT id, display_name, mc_username, secret_hash, skin_model, skin_png FROM identities WHERE id=?')
    .bind(parsed.id).first()
  if (!identity) return null
  const actual = await hashSecret(parsed.secret, env.IDENTITY_PEPPER)
  if (!safeEqualText(actual, identity.secret_hash)) return null
  return identity
}

async function requireIdentity(request, env) {
  const identity = await authenticate(request, env)
  if (!identity) throw Object.assign(new Error('Authentication required'), { status: 401 })
  return identity
}

async function requireMembership(env, worldId, identityId) {
  const row = await env.DB.prepare(`
    SELECT w.*, m.role FROM worlds w
    JOIN memberships m ON m.world_id=w.id
    WHERE w.id=? AND m.identity_id=? AND w.archived_at IS NULL
  `).bind(worldId, identityId).first()
  if (!row) throw Object.assign(new Error('World not found or access denied'), { status: 404 })
  return row
}

async function orchestratorEnsure(env, world) {
  const response = await fetch(`${env.ORCHESTRATOR_URL.replace(/\/$/, '')}/internal/worlds/${encodeURIComponent(world.id)}/ensure`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hem-service-key': env.ORCHESTRATOR_KEY,
    },
    body: JSON.stringify({
      seed: world.seed,
      gameMode: world.hardcore === 1 ? 'hardcore' : world.game_mode,
      difficulty: world.difficulty,
      allowCommands: world.allow_commands !== 0,
      worldType: world.world_type || 'normal',
      generateStructures: world.generate_structures !== 0,
      name: world.name,
      paperVersion: '1.21.5',
    }),
  })
  if (!response.ok) throw Object.assign(new Error(`Game host unavailable (${response.status})`), { status: 503 })
  return response.json()
}

async function register(request, env) {
  const body = await readJson(request)
  if (!env.HOUSEHOLD_CODE || !safeEqualText(body.householdCode, env.HOUSEHOLD_CODE)) {
    return errorJson(403, 'Incorrect household access code', 'bad_household_code')
  }
  const displayName = sanitizeDisplayName(body.displayName)
  const username = await deriveAvailableUsername(displayName, async candidate => {
    return !!(await env.DB.prepare('SELECT 1 AS yes FROM identities WHERE mc_username=? COLLATE NOCASE').bind(candidate).first())
  })
  const id = randomIdentityId()
  const secret = randomToken(32)
  const secretHash = await hashSecret(secret, env.IDENTITY_PEPPER)
  await env.DB.prepare('INSERT INTO identities(id,display_name,mc_username,secret_hash,created_at) VALUES(?,?,?,?,?)')
    .bind(id, displayName, username, secretHash, now()).run()
  return json({ ok: true, identity: { id, displayName, mcUsername: username, skinModel: 'classic', hasSkin: false }, credential: `${id}.${secret}` }, { status: 201 })
}

async function me(request, env) {
  const identity = await requireIdentity(request, env)
  return json({ ok: true, identity: { id: identity.id, displayName: identity.display_name, mcUsername: identity.mc_username, skinModel: identity.skin_model || 'classic', hasSkin: !!identity.skin_png } })
}

function validateSkinDataUrl(value) {
  if (value == null || value === '') return null
  const s = String(value)
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)) throw Object.assign(new Error('Skin must be a PNG image'), { status: 400 })
  if (s.length > 180000) throw Object.assign(new Error('Skin PNG is too large'), { status: 413 })
  return s
}

async function updateProfile(request, env) {
  const identity = await requireIdentity(request, env)
  const body = await readJson(request)
  const displayName = sanitizeDisplayName(body.displayName ?? identity.display_name)
  const skinModel = body.skinModel === 'slim' ? 'slim' : 'classic'
  const skinPng = validateSkinDataUrl(body.skinPng)
  await env.DB.prepare('UPDATE identities SET display_name=?,skin_model=?,skin_png=?,profile_updated_at=? WHERE id=?')
    .bind(displayName, skinModel, skinPng, now(), identity.id).run()
  return json({ ok: true, identity: { id: identity.id, displayName, mcUsername: identity.mc_username, skinModel, hasSkin: !!skinPng } })
}

async function getSkin(request, env, identityId) {
  if (!/^u_[a-f0-9]{20}$/.test(identityId)) return new Response('Not found', { status: 404 })
  const row = await env.DB.prepare('SELECT skin_png FROM identities WHERE id=?').bind(identityId).first()
  if (!row?.skin_png) return new Response('Not found', { status: 404 })
  const m = /^data:image\/png;base64,(.+)$/.exec(row.skin_png)
  if (!m) return new Response('Not found', { status: 404 })
  const raw = atob(m[1]); const bytes = new Uint8Array(raw.length)
  for (let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i)
  return new Response(bytes, { headers: { 'content-type':'image/png', 'cache-control':'public, max-age=300, stale-while-revalidate=60', 'access-control-allow-origin':'*', 'cross-origin-resource-policy':'cross-origin', 'x-content-type-options':'nosniff' } })
}

async function listWorlds(request, env) {
  const identity = await requireIdentity(request, env)
  const rows = await env.DB.prepare(`
    SELECT w.id,w.name,w.kind,w.seed,CASE WHEN w.hardcore=1 THEN 'hardcore' ELSE w.game_mode END AS game_mode,w.hardcore,w.difficulty,w.allow_commands,w.world_type,w.generate_structures,w.owner_id,w.created_at,w.updated_at,m.role
    FROM worlds w JOIN memberships m ON m.world_id=w.id
    WHERE m.identity_id=? AND w.archived_at IS NULL
    ORDER BY w.updated_at DESC
  `).bind(identity.id).all()
  return json({ ok: true, worlds: rows.results || [] })
}

async function createWorld(request, env) {
  const identity = await requireIdentity(request, env)
  const body = validateWorldCreate(await readJson(request))
  const id = randomWorldId()
  const stamp = now()
  const hardcore = body.gameMode === 'hardcore'
  const storedGameMode = hardcore ? 'survival' : body.gameMode
  await env.DB.batch([
    env.DB.prepare('INSERT INTO worlds(id,owner_id,name,kind,seed,game_mode,hardcore,difficulty,allow_commands,world_type,generate_structures,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, identity.id, body.name, body.kind, body.seed, storedGameMode, hardcore ? 1 : 0, body.difficulty, body.allowCommands ? 1 : 0, body.worldType, body.generateStructures ? 1 : 0, stamp, stamp),
    env.DB.prepare('INSERT INTO memberships(world_id,identity_id,role,joined_at) VALUES(?,?,?,?)')
      .bind(id, identity.id, 'owner', stamp),
  ])
  return json({ ok: true, world: { id, ...body, ownerId: identity.id } }, { status: 201 })
}

async function renameWorld(request, env, worldId) {
  const identity = await requireIdentity(request, env)
  const world = await requireMembership(env, worldId, identity.id)
  if (world.owner_id !== identity.id) return errorJson(403, 'Only the world owner can rename this world')
  const body = await readJson(request)
  const name = sanitizeWorldName(body.name)
  await env.DB.prepare('UPDATE worlds SET name=?,updated_at=? WHERE id=?').bind(name, now(), worldId).run()
  return json({ ok: true, world: { id: worldId, name } })
}

async function createInvite(request, env, worldId) {
  const identity = await requireIdentity(request, env)
  const world = await requireMembership(env, worldId, identity.id)
  if (world.owner_id !== identity.id) return errorJson(403, 'Only the world owner can invite players')
  if (world.kind !== 'shared') return errorJson(409, 'Solo worlds cannot be invited to until converted to shared')
  const raw = randomToken(18)
  const hash = await sha256Hex(raw)
  const expiresAt = now() + 7 * 24 * 60 * 60 * 1000
  await env.DB.prepare('INSERT INTO invites(token_hash,world_id,created_by,expires_at,max_uses,uses,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(hash, worldId, identity.id, expiresAt, 1, 0, now()).run()
  return json({ ok: true, invite: raw, expiresAt })
}

async function redeemInvite(request, env) {
  const identity = await requireIdentity(request, env)
  const body = await readJson(request)
  const raw = String(body.invite || '').trim()
  if (raw.length < 16 || raw.length > 128) return errorJson(400, 'Invalid invite')
  const hash = await sha256Hex(raw)
  const invite = await env.DB.prepare(`
    UPDATE invites SET uses=uses+1
    WHERE token_hash=? AND uses < max_uses AND expires_at > ?
    RETURNING world_id
  `).bind(hash, now()).first()
  if (!invite) return errorJson(404, 'Invite is invalid, expired, or already used')
  const world = await env.DB.prepare('SELECT id,kind FROM worlds WHERE id=? AND archived_at IS NULL').bind(invite.world_id).first()
  if (!world || world.kind !== 'shared') return errorJson(409, 'World is no longer joinable')
  await env.DB.prepare('INSERT OR IGNORE INTO memberships(world_id,identity_id,role,joined_at) VALUES(?,?,?,?)')
    .bind(world.id, identity.id, 'member', now()).run()
  return json({ ok: true, worldId: world.id })
}

async function launchWorld(request, env, worldId) {
  const identity = await requireIdentity(request, env)
  const world = await requireMembership(env, worldId, identity.id)
  const host = await orchestratorEnsure(env, world)
  if (host.status !== 'ready') {
    return json({ ok: true, status: host.status || 'starting', message: host.message || 'Starting Paper 1.21.5…' }, { status: 202 })
  }
  const raw = randomToken(32)
  const hash = await sha256Hex(raw)
  const stamp = now()
  const expiresAt = stamp + 90_000
  await env.DB.prepare('INSERT INTO launch_sessions(token_hash,world_id,identity_id,mc_username,expires_at,created_at) VALUES(?,?,?,?,?,?)')
    .bind(hash, worldId, identity.id, identity.mc_username, expiresAt, stamp).run()
  await env.DB.prepare('UPDATE worlds SET updated_at=? WHERE id=?').bind(stamp, worldId).run()
  const launchUrl = buildLaunchUrl({
    gameClientUrl: env.GAME_CLIENT_URL,
    proxyUrl: env.PROXY_URL,
    destinationHost: env.GAME_DESTINATION_HOST || 'orchestrator',
    port: Number(host.port),
    username: identity.mc_username,
    token: raw,
  })
  return json({ ok: true, status: 'ready', launchUrl, expiresAt })
}

async function archiveWorld(request, env, worldId) {
  const identity = await requireIdentity(request, env)
  const world = await requireMembership(env, worldId, identity.id)
  if (world.owner_id !== identity.id) return errorJson(403, 'Only the owner can archive this world')
  await env.DB.prepare('UPDATE worlds SET archived_at=?,updated_at=? WHERE id=?').bind(now(), now(), worldId).run()
  return json({ ok: true })
}

async function consumeLaunch(request, env) {
  if (!safeEqualText(request.headers.get('x-hem-service-key'), env.SERVER_SERVICE_KEY)) return new Response('DENY\tservice', { status: 403 })
  const token = (await request.text()).trim()
  if (token.length < 32 || token.length > 256) return new Response('DENY\ttoken', { status: 400 })
  const worldId = request.headers.get('x-hem-world-id') || ''
  const username = request.headers.get('x-hem-player') || ''
  if (!WORLD_ID_RE.test(worldId)) return new Response('DENY\tworld', { status: 400 })
  const hash = await sha256Hex(token)
  const row = await env.DB.prepare(`
    UPDATE launch_sessions SET consumed_at=?
    WHERE token_hash=? AND world_id=? AND mc_username=? COLLATE NOCASE
      AND consumed_at IS NULL AND expires_at>?
    RETURNING identity_id,world_id,mc_username
  `).bind(now(), hash, worldId, username, now()).first()
  if (!row) return new Response('DENY\texpired', { status: 403 })
  const identity = await env.DB.prepare(`
    SELECT i.id,i.display_name,i.skin_model,i.skin_png,i.profile_updated_at,w.allow_commands
    FROM identities i JOIN memberships m ON m.identity_id=i.id
    JOIN worlds w ON w.id=m.world_id
    WHERE i.id=? AND w.id=? AND w.archived_at IS NULL
  `).bind(row.identity_id, row.world_id).first()
  if (!identity) return new Response('DENY\tidentity', { status: 403 })
  const safeName = String(identity.display_name).replace(/[\t\r\n]/g, ' ').slice(0, 32)
  const skinModel = identity.skin_model === 'slim' ? 'slim' : 'classic'
  let skinUrl = ''
  if (identity.skin_png) {
    const origin = new URL(request.url).origin
    const revision = Number(identity.profile_updated_at || 0)
    skinUrl = `${origin}/api/skins/${encodeURIComponent(identity.id)}.png?v=${revision}`
  }
  // Tab-separated, deliberately tiny protocol consumed by HEMGate.  Keep fields
  // free of tabs/newlines so malformed profile data can never alter framing.
  const allowCommands = identity.allow_commands !== 0 ? '1' : '0'
  return new Response(`OK\t${safeName}\t${skinModel}\t${skinUrl}\t${allowCommands}`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}

function routeMatch(pathname, re) {
  const match = re.exec(pathname)
  return match ? match.slice(1).map(decodeURIComponent) : null
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url)
      const p = url.pathname
      if (p.startsWith('/api/')) validateRuntimeEnv(env)
      if (request.method === 'GET' && p === '/api/health') return json({ ok: true, minecraft: '1.21.5', hem: '1.0.0-rc.24' })
      if (request.method === 'POST' && p === '/api/register') return register(request, env)
      if (request.method === 'GET' && p === '/api/me') return me(request, env)
      if (request.method === 'PUT' && p === '/api/me/profile') return updateProfile(request, env)
      let skinMatch
      if (request.method === 'GET' && (skinMatch = routeMatch(p, /^\/api\/skins\/([^/]+)\.png$/))) return getSkin(request, env, skinMatch[0])
      if (request.method === 'GET' && p === '/api/worlds') return listWorlds(request, env)
      let m
      if (request.method === 'POST' && p === '/api/worlds') return createWorld(request, env)
      if (request.method === 'PUT' && (m = routeMatch(p, /^\/api\/worlds\/([^/]+)$/))) return renameWorld(request, env, m[0])
      if (request.method === 'POST' && p === '/api/invites/redeem') return redeemInvite(request, env)
      if (request.method === 'POST' && p === '/api/server/consume-launch') return consumeLaunch(request, env)
      if (request.method === 'POST' && (m = routeMatch(p, /^\/api\/worlds\/([^/]+)\/invite$/))) return createInvite(request, env, m[0])
      if (request.method === 'POST' && (m = routeMatch(p, /^\/api\/worlds\/([^/]+)\/launch$/))) return launchWorld(request, env, m[0])
      if (request.method === 'DELETE' && (m = routeMatch(p, /^\/api\/worlds\/([^/]+)$/))) return archiveWorld(request, env, m[0])
      if (p.startsWith('/api/')) return errorJson(404, 'API route not found')
      return env.ASSETS.fetch(request)
    } catch (error) {
      console.error(error)
      return errorJson(error.status || 400, error.message || 'Request failed')
    }
  },
}
