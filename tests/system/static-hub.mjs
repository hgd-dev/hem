import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/hub/public')
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' }

http.createServer((req,res) => {
  const url = new URL(req.url, 'http://localhost')
  let file = path.normalize(decodeURIComponent(url.pathname)).replace(/^([.][.][/\\])+/, '')
  if (file === '/' || file === '.') file = '/index.html'
  const target = path.join(root, file)
  if (!target.startsWith(root)) { res.writeHead(403); return res.end() }
  let actual = target
  try { if (!fs.statSync(actual).isFile()) actual = path.join(root, 'index.html') } catch { actual = path.join(root, 'index.html') }
  res.writeHead(200, { 'content-type': types[path.extname(actual)] || 'application/octet-stream', 'referrer-policy':'no-referrer', 'cache-control':'no-store' })
  fs.createReadStream(actual).pipe(res)
}).listen(4174, '127.0.0.1', () => console.log('[HEM test] launcher http://127.0.0.1:4174'))
