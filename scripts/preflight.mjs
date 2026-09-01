import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const production=process.argv.includes('--production')
const generated=path.join(root,'apps/hub/wrangler.production.jsonc')
const source=production?generated:path.join(root,'apps/hub/wrangler.jsonc')
const failures=[]
const pass=x=>console.log(`PASS ${x}`)
const fail=x=>{console.error(`FAIL ${x}`);failures.push(x)}

const major=Number(process.versions.node.split('.')[0])
major>=22?pass(`Node ${process.versions.node}`):fail(`Node >=22 required; got ${process.versions.node}`)
fs.existsSync(source)?pass(path.relative(root,source)):fail(`missing ${path.relative(root,source)}`)
if(fs.existsSync(source)){
  const text=fs.readFileSync(source,'utf8')
  if(production){
    !text.includes('REPLACE')?pass('production Cloudflare config has no placeholders'):fail('production Cloudflare config contains placeholders')
    for(const needle of ['"database_id"','"GAME_CLIENT_URL"','"PROXY_URL"','"ORCHESTRATOR_URL"']) text.includes(needle)?pass(`config contains ${needle}`):fail(`config missing ${needle}`)
  }
}
if(production){
  for(const name of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','HOUSEHOLD_CODE','IDENTITY_PEPPER','SERVER_SERVICE_KEY','ORCHESTRATOR_KEY']){
    const value=String(process.env[name]||'')
    if(!value) fail(`missing ${name}`)
    else if(['IDENTITY_PEPPER','SERVER_SERVICE_KEY','ORCHESTRATOR_KEY'].includes(name)&&value.length<32) fail(`${name} must be at least 32 characters`)
    else pass(`${name} present`)
  }
}
if(failures.length){console.error(`\nPreflight failed with ${failures.length} issue(s).`);process.exit(1)}
console.log('\nHEM preflight passed.')
