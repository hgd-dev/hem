import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../apps/client/dist')
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2'}
http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');let file=path.normalize(decodeURIComponent(u.pathname)).replace(/^([.][.][/\\])+/, '')
  if(file==='/'||file==='.')file='/index.html'
  const target=path.join(root,file)
  if(!target.startsWith(root)){res.writeHead(403);return res.end()}
  let actual=target;try{if(!fs.statSync(actual).isFile())actual=path.join(root,'index.html')}catch{actual=path.join(root,'index.html')}
  const h={'content-type':types[path.extname(actual)]||'application/octet-stream','referrer-policy':'no-referrer','cache-control':'no-store'}
  res.writeHead(200,h);fs.createReadStream(actual).pipe(res)
}).listen(4173,'127.0.0.1',()=>console.log('[HEM test] client http://127.0.0.1:4173'))
