import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT || 9090)
const KEY = process.env.SERVER_SERVICE_KEY || 'system-server-key-0123456789abcdef'
const PUBLIC_SKIN_ORIGIN = String(process.env.PUBLIC_SKIN_ORIGIN || `http://127.0.0.1:${PORT}`).replace(/\/$/, '')
const here = path.dirname(fileURLToPath(import.meta.url))
const skins = {
  Hudson: fs.readFileSync(path.join(here, 'skins', 'hudson.png')),
  Elise: fs.readFileSync(path.join(here, 'skins', 'elise.png')),
}
const used = new Set()

function identityFor(player) {
  if (/Elis/i.test(player)) return { display: 'Elise', model: 'slim' }
  return { display: 'Hudson', model: 'classic' }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const skinMatch = /^\/skins\/(hudson|elise)\.png$/.exec(url.pathname)
  if (req.method === 'GET' && skinMatch) {
    const display = skinMatch[1] === 'elise' ? 'Elise' : 'Hudson'
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(skins[display].length),
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    })
    return res.end(skins[display])
  }

  if (req.method !== 'POST' || url.pathname !== '/api/server/consume-launch') {
    res.writeHead(404)
    return res.end('not found')
  }
  if (req.headers['x-hem-service-key'] !== KEY) {
    res.writeHead(403)
    return res.end('DENY\tservice')
  }

  let token = ''
  for await (const c of req) token += c
  token = token.trim()
  const world = String(req.headers['x-hem-world-id'] || '')
  const player = String(req.headers['x-hem-player'] || '')
  if (!/^w_[a-f0-9]{20}$/.test(world) || !/^HEM_[A-Za-z0-9_]{3,12}$/.test(player) || token.length < 32 || used.has(token)) {
    res.writeHead(403)
    return res.end('DENY\ttoken')
  }
  used.add(token)

  const identity = identityFor(player)
  const skinUrl = `${PUBLIC_SKIN_ORIGIN}/skins/${identity.display.toLowerCase()}.png`
  res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
  res.end(`OK\t${identity.display}\t${identity.model}\t${skinUrl}\t1`)
})

server.listen(PORT, '0.0.0.0', () => console.log(`[HEM test] auth stub :${PORT}`))
