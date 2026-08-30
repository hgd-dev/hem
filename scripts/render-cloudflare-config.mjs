import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const source=path.join(root,'apps/hub/wrangler.jsonc')
const output=path.join(root,'apps/hub/wrangler.production.jsonc')

function required(name){
  const value=String(process.env[name]||'').trim()
  if(!value) throw new Error(`Missing required deployment variable ${name}`)
  return value
}
function httpsUrl(name){
  const value=required(name)
  const u=new URL(value)
  if(u.protocol!=='https:') throw new Error(`${name} must use https:// in production`)
  return value.replace(/\/$/,'')
}
const databaseId=required('HEM_D1_DATABASE_ID')
if(!/^[a-f0-9-]{20,}$/i.test(databaseId)) throw new Error('HEM_D1_DATABASE_ID does not look like a Cloudflare D1 database ID')

let config=fs.readFileSync(source,'utf8')
config=config
  .replace('REPLACE_WITH_D1_DATABASE_ID',databaseId)
  .replace('https://hem-client.REPLACE.workers.dev/',`${httpsUrl('HEM_CLIENT_URL')}/`)
  .replace('https://play.REPLACE.example',httpsUrl('HEM_PROXY_URL'))
  .replace('https://play-api.REPLACE.example',httpsUrl('HEM_ORCHESTRATOR_URL'))

if(config.includes('REPLACE')) throw new Error('Generated Cloudflare config still contains a REPLACE placeholder')
fs.writeFileSync(output,config)
console.log(output)
