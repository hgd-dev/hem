import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/client/dist')
const types = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.wasm':'application/wasm', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.woff2':'font/woff2',
}

function wantsDocument(req, pathname) {
  if (req.headers['sec-fetch-dest'] === 'document') return true
  const accept = String(req.headers.accept || '')
  return !path.extname(pathname) && accept.includes('text/html')
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost')
  let file = path.normalize(decodeURIComponent(u.pathname)).replace(/^([.][.][/\\])+/, '')
  if (file === '/' || file === '.') file = '/index.html'
  const target = path.join(root, file)
  if (!target.startsWith(root)) { res.writeHead(403); return res.end() }

  let actual = target
  try {
    if (!fs.statSync(actual).isFile()) throw new Error('not-file')
  } catch {
    // Only SPA/document navigation gets index.html. Returning index.html for a
    // missing JSON/JS/WASM asset turns a useful 404 into "Unexpected token '<'"
    // inside the browser bundle and hides the real integration failure.
    if (wantsDocument(req, u.pathname)) actual = path.join(root, 'index.html')
    else {
      console.error(`[HEM test] missing client asset ${u.pathname}`)
      res.writeHead(404, { 'content-type':'text/plain; charset=utf-8', 'cache-control':'no-store' })
      return res.end('HEM client asset not found')
    }
  }

  const h = {
    'content-type': types[path.extname(actual)] || 'application/octet-stream',
    'referrer-policy':'no-referrer', 'cache-control':'no-store', 'x-content-type-options':'nosniff',
  }
  res.writeHead(200, h)
  fs.createReadStream(actual).pipe(res)
}).listen(4173, '127.0.0.1', () => console.log('[HEM test] client http://127.0.0.1:4173'))
