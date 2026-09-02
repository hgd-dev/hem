import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { buildServerProperties, serializeServerProperties } from './world-config.mjs'
import { assertWorldCompatible } from './world-version.mjs'

const PORT = Number(process.env.PORT || 3000)
const ROOT = path.resolve(process.env.WORLD_ROOT || '/data/worlds')
const PAPER_VERSION = process.env.PAPER_VERSION || '1.21.5'
const PAPER_BUILD = String(process.env.PAPER_BUILD || '114')
const PAPER_SHA256 = String(process.env.PAPER_SHA256 || '2ae6ae22adf417699746e0f89fc2ef6cb6ee050a5f6608cee58f0535d60b509e')
const PAPER_JAR = path.resolve(process.env.PAPER_JAR || '/opt/hem/paper.jar')
const PLUGIN_JAR = path.resolve(process.env.HEM_PLUGIN_JAR || '/opt/hem/HEMGate.jar')
const SERVICE_KEY = process.env.ORCHESTRATOR_KEY || ''
const HUB_URL = process.env.HEM_HUB_URL || ''
const HUB_SERVICE_KEY = process.env.SERVER_SERVICE_KEY || ''
const START_PORT = Number(process.env.WORLD_PORT_START || 31000)
const END_PORT = Number(process.env.WORLD_PORT_END || 31099)
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_WORLDS || 4)
const XMS = process.env.WORLD_XMS || '512M'
const XMX = process.env.WORLD_XMX || '3G'
const IDLE_MS = Number(process.env.IDLE_STOP_MINUTES || 15) * 60_000
const START_TIMEOUT_MS = Number(process.env.WORLD_START_TIMEOUT_SECONDS || 180) * 1000
const ENABLE_ADMIN_COMMANDS = process.env.HEM_ENABLE_ADMIN_COMMANDS === 'true'
const ENABLE_TEST_FAULTS = process.env.HEM_ENABLE_TEST_FAULTS === 'true'
const EULA_ACCEPTED = String(process.env.ACCEPT_MINECRAFT_EULA || '').toUpperCase() === 'TRUE'
const WORLD_RE = /^w_[a-f0-9]{20}$/
const worlds = new Map()
const presenceClock = new Map()
let paperDownloadPromise

function runtimeConfigErrors(){
  const errors=[]
  const span=END_PORT-START_PORT+1
  if(!Number.isInteger(PORT)||PORT<1||PORT>65535)errors.push('PORT must be an integer from 1 to 65535')
  if(PAPER_VERSION!=='1.21.5'||PAPER_BUILD!=='114')errors.push(`HEM 1.0 is pinned to Paper 1.21.5 build 114; got ${PAPER_VERSION} build ${PAPER_BUILD}`)
  if(!/^[0-9a-f]{64}$/i.test(PAPER_SHA256))errors.push('PAPER_SHA256 must be a 64-character SHA-256 digest')
  if(!Number.isInteger(START_PORT)||!Number.isInteger(END_PORT)||START_PORT<1||END_PORT>65535||START_PORT>END_PORT)errors.push('WORLD_PORT_START/WORLD_PORT_END must define a valid TCP port range')
  if(!Number.isInteger(MAX_ACTIVE)||MAX_ACTIVE<1)errors.push('MAX_ACTIVE_WORLDS must be a positive integer')
  else if(Number.isInteger(span)&&span>0&&MAX_ACTIVE>span)errors.push(`MAX_ACTIVE_WORLDS ${MAX_ACTIVE} exceeds world port capacity ${span}`)
  if(!Number.isFinite(IDLE_MS)||IDLE_MS<=0)errors.push('IDLE_STOP_MINUTES must be greater than zero')
  if(!Number.isFinite(START_TIMEOUT_MS)||START_TIMEOUT_MS<30_000)errors.push('WORLD_START_TIMEOUT_SECONDS must be at least 30')
  if(SERVICE_KEY.length<32)errors.push('ORCHESTRATOR_KEY must be >=32 characters')
  if(HUB_SERVICE_KEY.length<32)errors.push('SERVER_SERVICE_KEY must be >=32 characters')
  try{const u=new URL(HUB_URL);if(!['http:','https:'].includes(u.protocol))throw new Error()}catch{errors.push('HEM_HUB_URL must be an absolute http(s) URL')}
  if(!EULA_ACCEPTED)errors.push('Minecraft EULA not accepted: set ACCEPT_MINECRAFT_EULA=TRUE only after reviewing the Minecraft EULA')
  return errors
}

function worldConfigFingerprint(id,cfg){
  const properties={...buildServerProperties(cfg,25565,id)}
  delete properties['server-port']
  delete properties.motd
  return createHash('sha256').update(serializeServerProperties(properties)).digest('hex')
}

function safeEqual(a,b){a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
function response(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(body)}
async function readBody(req){let body='';for await(const c of req){body+=c;if(body.length>65536)throw new Error('Body too large')}return body?JSON.parse(body):{}}
function validPort(p){return Number.isInteger(p)&&p>=START_PORT&&p<=END_PORT}
function yamlQuote(s){return `'${String(s).replaceAll("'","''")}'`}
function activePorts(){return new Set([...worlds.values()].filter(w=>w.child&&!w.exited).map(w=>w.port))}
function portFor(id){const ports=activePorts();const span=END_PORT-START_PORT+1;let n=parseInt(createHash('sha256').update(id).digest('hex').slice(0,8),16)%span;for(let i=0;i<span;i++){const p=START_PORT+((n+i)%span);if(!ports.has(p))return p}throw new Error('No free HEM world ports')}

async function sha256File(file){
  const data=await fsp.readFile(file)
  return createHash('sha256').update(data).digest('hex')
}

async function ensurePaperJar(){
  try{
    const st=await fsp.stat(PAPER_JAR)
    if(st.size>10_000_000){
      const digest=await sha256File(PAPER_JAR)
      if(safeEqual(digest,PAPER_SHA256))return PAPER_JAR
      console.warn(`[HEM] cached Paper checksum mismatch (${digest}); replacing it`)
      await fsp.rm(PAPER_JAR,{force:true})
    }
  }catch{}
  if(paperDownloadPromise)return paperDownloadPromise
  paperDownloadPromise=(async()=>{
    if(PAPER_VERSION!=='1.21.5'||PAPER_BUILD!=='114')throw new Error(`HEM 1.0 is pinned to Paper 1.21.5 build 114; got ${PAPER_VERSION} build ${PAPER_BUILD}`)
    await fsp.mkdir(path.dirname(PAPER_JAR),{recursive:true})
    const ua='HEM/1.0.0-rc.32 (Hudson-Elise-Minecraft; private deployment)'
    const url=`https://fill-data.papermc.io/v1/objects/${PAPER_SHA256}/paper-${PAPER_VERSION}-${PAPER_BUILD}.jar`
    const jar=await fetch(url,{headers:{'user-agent':ua}})
    if(!jar.ok)throw new Error(`Paper jar HTTP ${jar.status}`)
    const data=Buffer.from(await jar.arrayBuffer())
    const digest=createHash('sha256').update(data).digest('hex')
    if(!safeEqual(digest,PAPER_SHA256))throw new Error(`Paper checksum mismatch: expected ${PAPER_SHA256}, got ${digest}`)
    const tmp=`${PAPER_JAR}.tmp`
    await fsp.writeFile(tmp,data)
    await fsp.rename(tmp,PAPER_JAR)
    console.log(`[HEM] downloaded verified Paper ${PAPER_VERSION} build ${PAPER_BUILD}`)
    return PAPER_JAR
  })().catch(e=>{paperDownloadPromise=null;throw e})
  return paperDownloadPromise
}

async function prepareWorld(id, cfg, port){
  if(!EULA_ACCEPTED)throw new Error('Minecraft EULA not accepted: set ACCEPT_MINECRAFT_EULA=TRUE after reviewing https://aka.ms/MinecraftEULA')
  const dir=path.join(ROOT,id);await fsp.mkdir(path.join(dir,'plugins','HEMGate'),{recursive:true})
  const existingDataVersion = await assertWorldCompatible(dir)
  if (existingDataVersion !== null) console.log(`[HEM] ${id} existing world DataVersion=${existingDataVersion} accepted for 1.21.5`)
  await fsp.writeFile(path.join(dir,'eula.txt'),'eula=true\n')
  const properties=buildServerProperties(cfg,port,id)
  await fsp.writeFile(path.join(dir,'server.properties'),serializeServerProperties(properties))
  await fsp.copyFile(PLUGIN_JAR,path.join(dir,'plugins','HEMGate.jar'))
  const pluginCfg=[`world-id: ${yamlQuote(id)}`,`hub-url: ${yamlQuote(HUB_URL)}`,`service-key: ${yamlQuote(HUB_SERVICE_KEY)}`,`orchestrator-url: ${yamlQuote(`http://127.0.0.1:${PORT}`)}`,`orchestrator-key: ${yamlQuote(SERVICE_KEY)}`,'auth-timeout-seconds: 45',`allow-commands: ${cfg.allowCommands===false?'false':'true'}`].join('\n')+'\n'
  await fsp.writeFile(path.join(dir,'plugins','HEMGate','config.yml'),pluginCfg)
  return dir
}

function spawnWorld(id, cfg){
  if(worlds.size>=MAX_ACTIVE)throw Object.assign(new Error('Maximum active HEM worlds reached'),{status:503})
  const port=portFor(id);const state={id,port,status:'starting',players:0,lastZero:Date.now(),startedAt:Date.now(),child:null,exited:false,failedAt:0,configFingerprint:worldConfigFingerprint(id,cfg),log:[]};worlds.set(id,state)
  ;(async()=>{
    try{
      await ensurePaperJar();const dir=await prepareWorld(id,cfg,port)
      const args=[`-Xms${XMS}`,`-Xmx${XMX}`,'-XX:+UseG1GC','-XX:+ParallelRefProcEnabled','-XX:MaxGCPauseMillis=200','-jar',PAPER_JAR,'--nogui']
      const child=spawn('java',args,{cwd:dir,stdio:['pipe','pipe','pipe'],env:{...process.env}});state.child=child
      const onData=data=>{const text=data.toString();for(const line of text.split(/\r?\n/)){if(!line)continue;state.log.push(line);if(state.log.length>400)state.log.shift();console.log(`[${id}] ${line}`);if(/Done \([^)]+\)! For help/.test(line)||/Done \([^)]+\)!/.test(line))state.status='ready'}}
      child.stdout.on('data',onData);child.stderr.on('data',onData)
      child.on('exit',(code,signal)=>{
        const intentional=state.status==='stopping'
        const neverReady=state.status==='starting'||state.status==='error'
        state.exited=true;state.child=null;presenceClock.delete(id)
        if(neverReady&&!intentional){
          state.status='error';state.failedAt=Date.now();state.log.push(`Paper exited before ready (code=${code}, signal=${signal})`)
          console.error(`[HEM] ${id} Paper exited before ready code=${code} signal=${signal}`)
          return
        }
        state.status='stopped';worlds.delete(id);console.log(`[HEM] ${id} stopped code=${code} signal=${signal}`)
      })
      child.on('error',e=>{state.status='error';state.failedAt=Date.now();state.log.push(String(e));console.error(`[HEM] ${id} process error`,e)})
    }catch(e){state.status='error';state.failedAt=Date.now();state.log.push(String(e));console.error(`[HEM] ${id} failed`,e)}
  })()
  return state
}

function stopWorld(state,reason='idle'){
  if(!state?.child||state.exited)return;state.status='stopping';console.log(`[HEM] stopping ${state.id}: ${reason}`);try{state.child.stdin.write('save-all flush\n');setTimeout(()=>{try{state.child?.stdin.write('stop\n')}catch{}},1500)}catch{}
}
setInterval(()=>{const t=Date.now();for(const s of worlds.values())if(s.status==='ready'&&s.players===0&&t-s.lastZero>=IDLE_MS)stopWorld(s,'idle timeout')},30_000).unref()

const server=http.createServer(async(req,res)=>{
  try{
    if(req.url==='/healthz'){return response(res,200,{ok:true,paperVersion:PAPER_VERSION,paperBuild:PAPER_BUILD,active:[...worlds.values()].map(x=>({id:x.id,status:x.status,players:x.players,port:x.port}))})}
    if(!safeEqual(req.headers['x-hem-service-key'],SERVICE_KEY))return response(res,403,{ok:false,error:'forbidden'})
    const url=new URL(req.url,'http://localhost')
    const ensure=/^\/internal\/worlds\/(w_[a-f0-9]{20})\/ensure$/.exec(url.pathname)
    if(req.method==='POST'&&ensure){
      const id=ensure[1];if(!WORLD_RE.test(id))return response(res,400,{ok:false,error:'bad world id'})
      const body=await readBody(req);if(body.paperVersion&&body.paperVersion!==PAPER_VERSION)return response(res,409,{ok:false,error:`Host is Paper ${PAPER_VERSION}`})
      let state=worlds.get(id)
      if(state?.status==='error'&&!state.child&&state.failedAt&&Date.now()-state.failedAt>=15_000){worlds.delete(id);state=null}
      if(state&&state.configFingerprint!==worldConfigFingerprint(id,body))return response(res,409,{ok:false,status:'config-changed',message:'World settings changed while this Paper process is active. Stop the world and launch it again.'})
      if(!state)state=spawnWorld(id,body)
      if(state.status==='starting'&&Date.now()-state.startedAt>START_TIMEOUT_MS){
        if(state.child)stopWorld(state,'startup timeout');else{state.status='error';state.failedAt=Date.now();state.log.push('Paper startup timed out before Java spawned')}
        return response(res,504,{ok:false,status:'error',message:'Paper did not become ready before the startup timeout'})
      }
      if(state.status==='error')return response(res,500,{ok:false,status:'error',message:state.log.at(-1)||'Paper failed to start'})
      return response(res,state.status==='ready'?200:202,{ok:true,status:state.status,port:state.port,message:state.status==='ready'?'Ready':'Starting Paper 1.21.5…'})
    }
    if(req.method==='POST'&&url.pathname==='/internal/presence'){
      const body=await readBody(req);const state=worlds.get(body.worldId);if(!state)return response(res,404,{ok:false,error:'world not active'})
      const player=String(body.player||'').toLowerCase();const at=Number(body.at||0);const connected=body.connected===true
      if(!/^[a-z0-9_]{3,16}$/.test(player)||!Number.isFinite(at)||at<=0)return response(res,400,{ok:false,error:'invalid presence'})
      const worldPresence=presenceClock.get(body.worldId)||new Map();presenceClock.set(body.worldId,worldPresence)
      const previous=worldPresence.get(player);if(!previous||at>=previous.at)worldPresence.set(player,{at,connected})
      state.players=[...worldPresence.values()].filter(x=>x.connected).length;if(state.players===0)state.lastZero=Date.now()
      return response(res,200,{ok:true,players:state.players})
    }
    if(req.method==='POST'&&url.pathname==='/internal/stop'){
      const body=await readBody(req);const state=worlds.get(body.worldId)
      if(state?.child)stopWorld(state,'requested');else if(state){worlds.delete(body.worldId);presenceClock.delete(body.worldId)}
      return response(res,200,{ok:true})
    }
    if(req.method==='POST'&&url.pathname==='/internal/command'){
      if(!ENABLE_ADMIN_COMMANDS)return response(res,404,{ok:false,error:'not found'})
      const body=await readBody(req);const state=worlds.get(body.worldId)
      if(!state||state.status!=='ready'||!state.child)return response(res,409,{ok:false,error:'world not ready'})
      const command=String(body.command||'').replace(/[\r\n]/g,'').trim()
      if(!command||command.length>1000)return response(res,400,{ok:false,error:'invalid command'})
      state.child.stdin.write(command+'\n');return response(res,200,{ok:true})
    }
    if(req.method==='POST'&&url.pathname==='/internal/test/logs'){
      if(!ENABLE_TEST_FAULTS)return response(res,404,{ok:false,error:'not found'})
      const body=await readBody(req);const state=worlds.get(body.worldId)
      if(!state)return response(res,404,{ok:false,error:'world not active'})
      return response(res,200,{ok:true,lines:state.log.slice(-Math.max(1,Math.min(400,Number(body.limit)||200)))})
    }
    if(req.method==='POST'&&url.pathname==='/internal/test/kill-world'){
      if(!ENABLE_TEST_FAULTS)return response(res,404,{ok:false,error:'not found'})
      const body=await readBody(req);const state=worlds.get(body.worldId)
      if(!state||!state.child||state.exited)return response(res,409,{ok:false,error:'world not active'})
      console.warn(`[HEM test] force-killing ${state.id} Paper process for recovery acceptance`)
      state.child.kill('SIGKILL')
      return response(res,200,{ok:true,status:'killing'})
    }
    response(res,404,{ok:false,error:'not found'})
  }catch(e){console.error(e);response(res,e.status||500,{ok:false,error:e.message||'server error'})}
})

const runtimeErrors=runtimeConfigErrors()
if(runtimeErrors.length)throw new Error(`HEM orchestrator configuration invalid:\n- ${runtimeErrors.join('\n- ')}`)
await fsp.access(PLUGIN_JAR,fs.constants.R_OK).catch(()=>{throw new Error(`HEMGate plugin jar is missing or unreadable: ${PLUGIN_JAR}`)})
await fsp.mkdir(ROOT,{recursive:true})
server.listen(PORT,'0.0.0.0',()=>console.log(`[HEM] orchestrator listening :${PORT}; Paper=${PAPER_VERSION} build=${PAPER_BUILD}; ports=${START_PORT}-${END_PORT}; maxActive=${MAX_ACTIVE}`))

let shuttingDown=false
async function gracefulShutdown(signal){
  if(shuttingDown)return
  shuttingDown=true
  console.log(`[HEM] ${signal}: gracefully stopping ${worlds.size} active world(s)`)
  server.close()
  for(const state of worlds.values())stopWorld(state,'orchestrator shutdown')
  const deadline=Date.now()+45_000
  while(Date.now()<deadline){
    if([...worlds.values()].every(state=>!state.child||state.exited))break
    await new Promise(resolve=>setTimeout(resolve,250))
  }
  const remaining=[...worlds.values()].filter(state=>state.child&&!state.exited)
  for(const state of remaining){
    console.error(`[HEM] ${state.id} did not stop cleanly before shutdown deadline; sending SIGTERM`)
    try{state.child.kill('SIGTERM')}catch{}
  }
  process.exit(remaining.length?1:0)
}
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{gracefulShutdown(sig).catch(error=>{console.error(error);process.exit(1)})})

export { validPort, WORLD_RE }
