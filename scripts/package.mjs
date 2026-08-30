import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version
const label=version==='1.0.0'?'HEM_v1.0.0_SOURCE.zip':`HEM_v1.0.0_RC${version.match(/-rc\.(\d+)$/i)?.[1] || 'X'}_SOURCE.zip`
const out=path.resolve(root,'..',label)
execFileSync(process.execPath,[path.join(root,'scripts/source-manifest.mjs')],{cwd:root,stdio:'inherit'})
try{execFileSync('rm',['-f',out])}catch{}
execFileSync('zip',['-qr',out,path.basename(root),'-x','*/node_modules/*','*/upstream/*','*/dist/*','*/.git/*','*/artifacts/*'],{cwd:path.dirname(root),stdio:'inherit'})
console.log(out)
