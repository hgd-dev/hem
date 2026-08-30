import { renderSkinPreview3D } from './skin-preview-3d.js'
const KEY = 'hem.device.v1'
const SETTINGS_KEY = 'hem.settings.v1'
const state = { identity: null, credential: '', worlds: [], selected: null, editingWorldId: null, listKind: 'solo', create: { kind: 'solo', mode: 'survival', difficulty: 'normal', allowCommands: true, worldType: 'normal', generateStructures: true }, launchAbort: false, regSkinModel: 'classic', regSkinPng: null, profileSkinModel: 'classic', profileSkinPng: null }
const $ = id => document.getElementById(id)
const screens = [...document.querySelectorAll('.screen')]

function show(id) { screens.forEach(x => x.classList.toggle('active', x.id === id)) }
function toast(message, timeout = 3000) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), timeout) }
function loadDevice() { try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null } }
function saveDevice(data) { localStorage.setItem(KEY, JSON.stringify(data)) }
function authHeaders(extra = {}) { return { ...extra, authorization: `Bearer ${state.credential}` } }
async function api(path, init = {}) {
  const headers = authHeaders(init.headers || {})
  if (init.body && typeof init.body !== 'string') { headers['content-type'] = 'application/json'; init.body = JSON.stringify(init.body) }
  const response = await fetch(path, { ...init, headers })
  const data = await response.json().catch(() => ({ message: `HTTP ${response.status}` }))
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`)
  return { response, data }
}


function defaultSkinData(model='classic') {
  const c=document.createElement('canvas'); c.width=64; c.height=64; const x=c.getContext('2d'); x.imageSmoothingEnabled=false
  // Original HEM skin atlas. Fill every base cuboid face so the dependency-free
  // 3D preview never has transparent/missing sides before a custom skin is chosen.
  x.fillStyle='#c58f68'; x.fillRect(0,0,32,16)
  x.fillStyle='#4c6fae'; x.fillRect(16,16,24,16); x.fillRect(40,16,16,16); x.fillRect(32,48,16,16)
  x.fillStyle='#303d55'; x.fillRect(0,16,16,16); x.fillRect(16,48,16,16)
  // Hair and a tiny face detail on the head-front region (8,8 → 16,16).
  x.fillStyle='#3b241d'; x.fillRect(0,0,32,5); x.fillRect(8,8,8,3)
  x.fillStyle='#202020'; x.fillRect(10,12,1,1); x.fillRect(13,12,1,1)
  x.fillStyle='#7b4438'; x.fillRect(11,14,2,1)
  // A subtle translucent outer layer makes the default atlas exercise jacket/hat
  // rendering without borrowing any Mojang texture.
  x.fillStyle='rgba(28,42,70,.22)'; x.fillRect(16,32,24,16); x.fillRect(40,32,16,16); x.fillRect(48,48,16,16); x.fillRect(0,32,16,32)
  x.fillStyle='rgba(58,36,29,.35)'; x.fillRect(32,0,32,16)
  return c.toDataURL('image/png')
}
function copySkinFaceMirrored(ctx, sx, sy, sw, sh, dx, dy) {
  ctx.save(); ctx.translate(dx + sw, dy); ctx.scale(-1,1); ctx.drawImage(ctx.canvas,sx,sy,sw,sh,0,0,sw,sh); ctx.restore()
}
function normalizeLegacySkin(ctx) {
  // Legacy 64×32 skins contain only right-arm/right-leg textures. Java mirrors
  // those onto the left limbs. Recreate the modern 64×64 left-limb base regions
  // face-by-face so front/back and inside/outside orientation stay correct.
  const limb=(srcX,srcY,dstX,dstY)=>{
    copySkinFaceMirrored(ctx,srcX+4,srcY,4,4,dstX+4,dstY)       // top
    copySkinFaceMirrored(ctx,srcX+8,srcY,4,4,dstX+8,dstY)       // bottom
    copySkinFaceMirrored(ctx,srcX+8,srcY+4,4,12,dstX,dstY+4)    // right <- source left
    copySkinFaceMirrored(ctx,srcX+4,srcY+4,4,12,dstX+4,dstY+4)  // front
    copySkinFaceMirrored(ctx,srcX,srcY+4,4,12,dstX+8,dstY+4)    // left <- source right
    copySkinFaceMirrored(ctx,srcX+12,srcY+4,4,12,dstX+12,dstY+4)// back
  }
  limb(0,16,16,48)   // right leg -> left leg
  limb(40,16,32,48)  // right arm -> left arm
}
async function fileToSkinData(file) {
  if (!file) return null
  if (file.type !== 'image/png') throw new Error('Skin must be a PNG file')
  if (file.size > 135000) throw new Error('Skin PNG must be under 135 KB')
  const url=URL.createObjectURL(file)
  try {
    const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('Could not read skin PNG'));i.src=url})
    if (!((img.width===64&&img.height===64)||(img.width===64&&img.height===32))) throw new Error('Skin must be 64×64 (or legacy 64×32) PNG')
    const legacy=img.height===32
    const c=document.createElement('canvas'); c.width=64;c.height=64;const x=c.getContext('2d');x.imageSmoothingEnabled=false;x.clearRect(0,0,64,64);x.drawImage(img,0,0)
    if(legacy) normalizeLegacySkin(x)
    return {dataUrl:c.toDataURL('image/png'),legacy}
  } finally { URL.revokeObjectURL(url) }
}
function drawSkinPreview(canvas, dataUrl, model='classic') {
  if (!canvas) return
  const resolved = dataUrl || defaultSkinData(model)
  if (renderSkinPreview3D(canvas, resolved, model)) return
  const ctx=canvas.getContext('2d'); ctx.imageSmoothingEnabled=false; ctx.clearRect(0,0,canvas.width,canvas.height)
  // Keep the preview intentionally HEM-original while honoring the standard
  // Java skin sheet.  Outer hat/jacket/sleeve/pants layers are composited too.
  const img=new Image(); img.onload=()=>{
    const S=Math.floor(Math.min(canvas.width/19,canvas.height/28)); const ox=Math.floor((canvas.width-16*S)/2), oy=Math.floor((canvas.height-24*S)/2)
    ctx.save(); ctx.globalAlpha=.22; ctx.fillStyle='#000'; ctx.beginPath(); ctx.ellipse(canvas.width/2,oy+24*S,7*S,1.5*S,0,0,Math.PI*2);ctx.fill();ctx.restore()
    const part=(sx,sy,sw,sh,dx,dy,dw,dh)=>ctx.drawImage(img,sx,sy,sw,sh,ox+dx*S,oy+dy*S,dw*S,dh*S)
    const armW=model==='slim'?3:4
    // Base body.
    part(8,8,8,8,4,0,8,8); part(20,20,8,12,4,8,8,12)
    part(44,20,armW,12,4-armW,8,armW,12); part(36,52,armW,12,12,8,armW,12)
    part(4,20,4,12,4,20,4,12); part(20,52,4,12,8,20,4,12)
    // Second skin layer. Transparent pixels naturally leave the base visible.
    part(40,8,8,8,4,0,8,8); part(20,36,8,12,4,8,8,12)
    part(44,36,armW,12,4-armW,8,armW,12); part(52,52,armW,12,12,8,armW,12)
    part(4,36,4,12,4,20,4,12); part(4,52,4,12,8,20,4,12)
  }; img.src=resolved
}
async function setSkinFromFile(target, file) {
  const converted=await fileToSkinData(file)
  if(!converted)return
  if(target==='register') { state.regSkinPng=converted.dataUrl; if(converted.legacy) state.regSkinModel='classic' }
  else { state.profileSkinPng=converted.dataUrl; if(converted.legacy) state.profileSkinModel='classic' }
  syncSkinButtons()
  if(converted.legacy) toast('Legacy 64×32 skin normalized to the Classic 64×64 layout.')
}
function enableSkinDrop(canvasId, inputId, target) {
  const canvas=$(canvasId), input=$(inputId)
  if(!canvas||!input)return
  canvas.tabIndex=0; canvas.setAttribute('role','button'); canvas.setAttribute('aria-label','Upload or drop a HEM skin PNG')
  const choose=()=>input.click()
  canvas.addEventListener('click',()=>{
    if(canvas.__hemPreviewDragged){ canvas.__hemPreviewDragged=false; return }
    choose()
  })
  canvas.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}})
  for(const event of ['dragenter','dragover']) canvas.addEventListener(event,e=>{e.preventDefault();canvas.classList.add('dragover')})
  for(const event of ['dragleave','drop']) canvas.addEventListener(event,e=>{e.preventDefault();canvas.classList.remove('dragover')})
  canvas.addEventListener('drop',async e=>{try{const file=e.dataTransfer?.files?.[0];if(file)await setSkinFromFile(target,file)}catch(err){toast(err.message,5000)}})
}
function syncSkinButtons(){
  if($('regSkinModel')) $('regSkinModel').textContent=`Model: ${state.regSkinModel==='slim'?'Slim':'Classic'}`
  if($('profileSkinModel')) $('profileSkinModel').textContent=`Model: ${state.profileSkinModel==='slim'?'Slim':'Classic'}`
  drawSkinPreview($('regSkinPreview'), state.regSkinPng, state.regSkinModel)
  drawSkinPreview($('profileSkinPreview'), state.profileSkinPng, state.profileSkinModel)
}
async function loadProfileEditor(){
  const {data}=await api('/api/me'); state.identity=data.identity
  state.profileSkinModel=data.identity.skinModel||'classic'; state.profileSkinPng=data.identity.hasSkin?`/api/skins/${data.identity.id}.png?${Date.now()}`:null
  $('profileName').value=data.identity.displayName
  $('profileInfo').innerHTML=`<strong>${esc(data.identity.displayName)}</strong><br>Private game login: ${esc(data.identity.mcUsername)}<br>HEM identity: ${esc(data.identity.id)}<br>Version: 1.21.5`
  syncSkinButtons(); show('profile')
}
async function saveProfile(){
  const body={displayName:$('profileName').value.trim(),skinModel:state.profileSkinModel,skinPng:state.profileSkinPng?.startsWith('data:')?state.profileSkinPng:(state.identity.hasSkin?await fetch(`/api/skins/${state.identity.id}.png`).then(r=>r.ok?r.blob():null).then(async b=>b?await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(b)}):null):null)}
  const {data}=await api('/api/me/profile',{method:'PUT',body}); state.identity=data.identity; saveDevice({...loadDevice(),identity:data.identity,savedAt:Date.now()}); renderWhoami(); toast('Profile saved.'); await loadProfileEditor()
}

function loadSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } catch { return {} } }
function saveSettings(settings) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) }
function applySettings() {
  const s = loadSettings()
  const scale = Number(s.scale || 1); document.documentElement.style.setProperty('--scale', String(Math.min(1.25, Math.max(.8, scale))))
  document.body.classList.toggle('reduce-motion', !!s.reducedMotion)
  $('uiScale').value = String(s.scale || 1)
  $('reducedMotion').checked = !!s.reducedMotion
  $('renderDistance').value = String(Math.min(16, Math.max(4, Number(s.renderDistance || 8))))
  $('fov').value = String(Math.min(110, Math.max(30, Number(s.fov || 70))))
  $('mouseSensitivity').value = String(Math.min(2, Math.max(.1, Number(s.mouseSensitivity || 1))))
  $('masterVolume').value = String(Math.min(1, Math.max(0, Number(s.masterVolume ?? 1))))
  $('musicVolume').value = String(Math.min(1, Math.max(0, Number(s.musicVolume ?? .5))))
  $('viewBobbing').checked = s.viewBobbing !== false
  $('smoothLighting').checked = s.smoothLighting !== false
  $('skyEnabled').checked = s.skyEnabled !== false
  $('rawMouseInput').checked = s.rawMouseInput !== false
  $('highContrast').checked = !!s.highContrast
  $('openControls').checked = !!s.openControls
  document.body.classList.toggle('high-contrast', !!s.highContrast)
  $('fovValue').textContent = $('fov').value
  $('mouseSensitivityValue').textContent = Number($('mouseSensitivity').value).toFixed(2)
  $('masterVolumeValue').textContent = `${Math.round(Number($('masterVolume').value) * 100)}%`
  $('musicVolumeValue').textContent = `${Math.round(Number($('musicVolume').value) * 100)}%`
}
function withClientSettings(rawUrl) {
  const s = loadSettings()
  const url = new URL(rawUrl, location.href)
  const renderDistance = Math.min(16, Math.max(4, Number(s.renderDistance || 8)))
  const settings = [
    ['renderDistance', renderDistance],
    ['fov', Math.min(110, Math.max(30, Number(s.fov || 70)))],
    ['mouseSensitivity', Math.min(2, Math.max(.1, Number(s.mouseSensitivity || 1)))],
    ['masterVolume', Math.min(1, Math.max(0, Number(s.masterVolume ?? 1)))],
    ['musicVolume', Math.min(1, Math.max(0, Number(s.musicVolume ?? .5)))],
    ['viewBobbing', s.viewBobbing !== false],
    ['smoothLighting', s.smoothLighting !== false],
    ['skyEnabled', s.skyEnabled !== false],
    ['rawMouseInput', s.rawMouseInput !== false],
    ['reducedMotion', !!s.reducedMotion],
  ]
  url.searchParams.delete('setting')
  for (const [key, value] of settings) url.searchParams.append('setting', `${key}:${value}`)
  if (s.openControls) {
    url.searchParams.set('modal', 'keybindings')
    saveSettings({ ...s, openControls: false })
  }
  return url.toString()
}

async function boot() {
  applySettings()
  const device = loadDevice()
  if (!device?.credential) { show('register'); return }
  state.credential = device.credential
  try {
    const { data } = await api('/api/me')
    state.identity = data.identity
    renderWhoami(); await handlePendingInvite(); show('menu')
  } catch {
    localStorage.removeItem(KEY); state.credential = ''; show('register'); toast('This device credential is no longer valid.')
  }
}

function renderWhoami() { $('whoami').textContent = state.identity ? `${state.identity.displayName} · HEM 1.21.5` : '' }
async function register() {
  const displayName = $('regName').value.trim(), householdCode = $('regCode').value
  const response = await fetch('/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName, householdCode }) })
  const data = await response.json(); if (!response.ok) throw new Error(data.message)
  state.identity = data.identity; state.credential = data.credential
  saveDevice({ version: 1, credential: data.credential, identity: data.identity, savedAt: Date.now() })
  renderWhoami(); if(state.regSkinPng){ await api('/api/me/profile',{method:'PUT',body:{displayName:data.identity.displayName,skinModel:state.regSkinModel,skinPng:state.regSkinPng}}); const me=await api('/api/me'); state.identity=me.data.identity; saveDevice({version:1,credential:data.credential,identity:state.identity,savedAt:Date.now()}) } await handlePendingInvite(); show('menu'); toast(`Welcome to HEM, ${state.identity.displayName}.`)
}

async function loadWorlds(kind) {
  state.listKind = kind; state.selected = null
  const { data } = await api('/api/worlds'); state.worlds = data.worlds || []
  $('worldTitle').textContent = kind === 'solo' ? 'Select World' : 'Multiplayer'
  renderWorldList(); show('worlds')
}
function visibleWorlds() { return state.worlds.filter(w => state.listKind === 'solo' ? w.kind === 'solo' : w.kind === 'shared') }
function renderWorldList() {
  const root = $('worldList'), worlds = visibleWorlds(); root.textContent = ''
  if (!worlds.length) { const e = document.createElement('div'); e.className='empty'; e.textContent = state.listKind === 'solo' ? 'No singleplayer worlds yet.' : 'No multiplayer worlds yet.'; root.append(e); return }
  for (const w of worlds) {
    const card = document.createElement('div'); card.className = `world-card${state.selected === w.id ? ' selected' : ''}`; card.dataset.worldId = w.id
    const icon = document.createElement('div'); icon.className='world-icon'
    const info = document.createElement('div'); const name=document.createElement('div'); name.className='world-name'; name.textContent=w.name
    const meta=document.createElement('div'); meta.className='world-meta'; const typeLabel={normal:'Default',flat:'Superflat',large_biomes:'Large Biomes',amplified:'Amplified'}[w.world_type]||'Default'; const modeLabel=w.game_mode==='hardcore'?'Hardcore':cap(w.game_mode); meta.textContent=`${modeLabel} · ${cap(w.difficulty)} · ${typeLabel}${w.generate_structures===0?' · No Structures':''} · Minecraft 1.21.5`
    info.append(name,meta); const role=document.createElement('div'); role.className='world-role'; role.textContent=w.role
    card.append(icon,info,role); card.onclick=()=>{state.selected=w.id;renderWorldList()}; card.ondblclick=()=>launchSelected(); root.append(card)
  }
}
function selectedWorld() { return state.worlds.find(w => w.id === state.selected) }

function openWorldEdit() {
  const w=selectedWorld(); if(!w) return toast('Select a world first.')
  if(w.role!=='owner') return toast('Only the owner can edit this world.')
  state.editingWorldId=w.id
  $('editWorldName').value=w.name
  const typeLabel={normal:'Default',flat:'Superflat',large_biomes:'Large Biomes',amplified:'Amplified'}[w.world_type]||'Default'
  $('editWorldMeta').textContent=`${w.game_mode==='hardcore'?'Hardcore':cap(w.game_mode)} · ${cap(w.difficulty)} · ${typeLabel} · ${w.generate_structures===0?'Structures Off':'Structures On'} · ${w.allow_commands===0?'Commands Off':'Commands On'}`
  show('edit-world')
}

async function saveWorldEdit() {
  if(!state.editingWorldId) return show('worlds')
  const {data}=await api(`/api/worlds/${encodeURIComponent(state.editingWorldId)}`,{method:'PUT',body:{name:$('editWorldName').value}})
  const world=state.worlds.find(w=>w.id===state.editingWorldId); if(world) world.name=data.world.name
  toast('World renamed.'); state.editingWorldId=null; renderWorldList(); show('worlds')
}

function openCreate() {
  state.create = { kind: state.listKind === 'shared' ? 'shared' : 'solo', mode:'survival', difficulty:'normal', allowCommands:true, worldType:'normal', generateStructures:true }
  $('worldName').value = state.create.kind === 'shared' ? 'Our World' : 'New World'; $('worldSeed').value=''; syncCreateButtons(); show('create')
}
function syncCreateButtons() {
  const hardcore=state.create.mode==='hardcore'
  if(hardcore) state.create.difficulty='hard'
  $('modeBtn').textContent=`Game Mode: ${cap(state.create.mode)}`; $('difficultyBtn').textContent=`Difficulty: ${cap(state.create.difficulty)}`
  $('difficultyBtn').disabled=hardcore
  const worldTypeLabels={normal:'Default',flat:'Superflat',large_biomes:'Large Biomes',amplified:'Amplified'}
  $('worldTypeBtn').textContent=`World Type: ${worldTypeLabels[state.create.worldType]||'Default'}`
  $('structuresBtn').textContent=`Generate Structures: ${state.create.generateStructures?'On':'Off'}`
  $('worldKindBtn').textContent=state.create.kind==='solo'?'Access: Singleplayer (Private)':'Access: Multiplayer (Private)'
  $('commandsBtn').textContent=`Allow Commands: ${state.create.allowCommands?'On':'Off'}`
  $('modeNote').textContent=state.create.mode==='survival'?'Search for resources, craft, gain levels, health and hunger.':state.create.mode==='hardcore'?'Survival locked to Hard. Death leaves the player in spectator mode.':'Unlimited blocks, instant breaking, flight and commands.'
}
const cap = s => s[0].toUpperCase()+s.slice(1)
async function createWorld() {
  const body={name:$('worldName').value,seed:$('worldSeed').value,kind:state.create.kind,gameMode:state.create.mode,difficulty:state.create.difficulty,allowCommands:state.create.allowCommands,worldType:state.create.worldType,generateStructures:state.create.generateStructures}
  const {data}=await api('/api/worlds',{method:'POST',body}); toast(`Created ${data.world.name}.`); await loadWorlds(state.create.kind)
  state.selected=data.world.id; renderWorldList()
}

async function inviteSelected() {
  const w=selectedWorld(); if(!w) return toast('Select a world first.')
  if(w.kind!=='shared') return toast('Singleplayer worlds are private. Create a multiplayer world to invite someone.')
  if(w.role!=='owner') return toast('Only the owner can create new invites.')
  const {data}=await api(`/api/worlds/${encodeURIComponent(w.id)}/invite`,{method:'POST'})
  const link=`${location.origin}/#invite=${encodeURIComponent(data.invite)}`
  await navigator.clipboard?.writeText(link).catch(()=>{})
  prompt('Private HEM invitation (copied when clipboard access is allowed):',link)
}
async function redeemInvite(raw=$('inviteCode').value.trim()) {
  if(!raw) throw new Error('Paste an invite code first.')
  const {data}=await api('/api/invites/redeem',{method:'POST',body:{invite:raw}})
  history.replaceState(null,'',location.pathname+location.search); toast('World joined. It will remain in Multiplayer.'); await loadWorlds('shared'); state.selected=data.worldId; renderWorldList()
}
async function handlePendingInvite() {
  const hash=new URLSearchParams(location.hash.slice(1)); const invite=hash.get('invite'); if(!invite) return
  history.replaceState(null,'',location.pathname+location.search)
  try { await redeemInvite(invite) } catch(e) { toast(e.message,5000) }
}

async function launchSelected() {
  const w=selectedWorld(); if(!w) return toast('Select a world first.')
  state.launchAbort=false; show('loading'); $('loadStatus').textContent='Starting Paper 1.21.5…'
  for(let attempt=0;attempt<150&&!state.launchAbort;attempt++) {
    try {
      const response=await fetch(`/api/worlds/${encodeURIComponent(w.id)}/launch`,{method:'POST',headers:authHeaders()})
      const data=await response.json(); if(!response.ok && response.status!==202) throw new Error(data.message||`HTTP ${response.status}`)
      if(response.status===202){$('loadStatus').textContent=data.message||'Generating world…';await delay(1000);continue}
      if(data.status==='ready'&&data.launchUrl){$('loadStatus').textContent='Loading terrain…';location.assign(withClientSettings(data.launchUrl));return}
      await delay(1000)
    } catch(e){ if(state.launchAbort) break; $('loadStatus').textContent=`Retrying game host… ${e.message}`; await delay(1500) }
  }
  if(!state.launchAbort) toast('The game server did not become ready. Check the HEM game host.',5000)
  show('worlds')
}
const delay=ms=>new Promise(r=>setTimeout(r,ms))

async function archiveSelected(){const w=selectedWorld();if(!w)return toast('Select a world first.');if(w.role!=='owner')return toast('Only the owner can archive this world.');if(!confirm(`Archive “${w.name}”? The server files are kept for recovery.`))return;await api(`/api/worlds/${encodeURIComponent(w.id)}`,{method:'DELETE'});await loadWorlds(state.listKind);toast('World archived. Server files were not deleted.')}
function exportBackup(){const payload={format:'HEM-device-backup',version:1,createdAt:new Date().toISOString(),device:loadDevice(),settings:JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`HEM-${state.identity?.displayName||'device'}-backup.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function restoreBackup(file){const reader=new FileReader();reader.onload=async()=>{try{const p=JSON.parse(reader.result);if(p.format!=='HEM-device-backup'||!p.device?.credential)throw new Error('Not a HEM device backup');saveDevice(p.device);if(p.settings)localStorage.setItem(SETTINGS_KEY,JSON.stringify(p.settings));location.reload()}catch(e){toast(e.message,5000)}};reader.readAsText(file)}

for (const btn of document.querySelectorAll('[data-action]')) {
  btn.addEventListener('click', async () => {
    try {
      switch (btn.dataset.action) {
        case 'register': await register(); break
        case 'restore': $('restoreFile').click(); break
        case 'singleplayer': await loadWorlds('solo'); break
        case 'multiplayer': await loadWorlds('shared'); break
        case 'join': show('join'); break
        case 'options': show('options'); break
        case 'profile': await loadProfileEditor(); break
        case 'toggle-reg-skin-model': state.regSkinModel=state.regSkinModel==='classic'?'slim':'classic'; syncSkinButtons(); break
        case 'toggle-profile-skin-model': state.profileSkinModel=state.profileSkinModel==='classic'?'slim':'classic'; syncSkinButtons(); break
        case 'save-profile': await saveProfile(); break
        case 'clear-skin': state.profileSkinPng=null; syncSkinButtons(); break
        case 'play-selected': await launchSelected(); break
        case 'create': openCreate(); break
        case 'edit-selected': openWorldEdit(); break
        case 'save-world-edit': await saveWorldEdit(); break
        case 'cancel-world-edit': state.editingWorldId=null; show('worlds'); break
        case 'invite-selected': await inviteSelected(); break
        case 'archive-selected': await archiveSelected(); break
        case 'back-menu': show('menu'); break
        case 'cycle-mode':
          { const modes=['survival','creative','hardcore']; state.create.mode = modes[(modes.indexOf(state.create.mode)+1)%modes.length] }
          syncCreateButtons()
          break
        case 'cycle-difficulty': {
          const a = ['peaceful', 'easy', 'normal', 'hard']
          state.create.difficulty = a[(a.indexOf(state.create.difficulty) + 1) % a.length]
          syncCreateButtons()
          break
        }
        case 'cycle-world-type': {
          const types=['normal','flat','large_biomes','amplified']
          state.create.worldType=types[(types.indexOf(state.create.worldType)+1)%types.length]
          syncCreateButtons()
          break
        }
        case 'toggle-structures':
          state.create.generateStructures=!state.create.generateStructures
          syncCreateButtons()
          break
        case 'toggle-kind':
          state.create.kind = state.create.kind === 'solo' ? 'shared' : 'solo'
          syncCreateButtons()
          break
        case 'toggle-commands':
          state.create.allowCommands = !state.create.allowCommands
          syncCreateButtons()
          break
        case 'confirm-create': await createWorld(); break
        case 'cancel-create': show('worlds'); break
        case 'redeem': await redeemInvite(); break
        case 'save-options':
          saveSettings({
            scale: Number($('uiScale').value), reducedMotion: $('reducedMotion').checked, renderDistance: Number($('renderDistance').value),
            fov: Number($('fov').value), mouseSensitivity: Number($('mouseSensitivity').value), masterVolume: Number($('masterVolume').value),
            musicVolume: Number($('musicVolume').value), viewBobbing: $('viewBobbing').checked, smoothLighting: $('smoothLighting').checked,
            skyEnabled: $('skyEnabled').checked, rawMouseInput: $('rawMouseInput').checked, highContrast: $('highContrast').checked, openControls: $('openControls').checked,
          })
          applySettings(); show('menu'); break
        case 'backup': exportBackup(); break
        case 'forget-device':
          if (confirm('Forget this HEM player on this browser? Export a backup first if you want to recover it.')) {
            localStorage.removeItem(KEY); location.reload()
          }
          break
        case 'cancel-launch': state.launchAbort = true; show('worlds'); break
      }
    } catch (e) {
      toast(e.message || String(e), 5000)
    }
  })
}
$('regSkin').addEventListener('change',async()=>{try{await setSkinFromFile('register',$('regSkin').files?.[0])}catch(e){toast(e.message,5000)}})
$('fov').addEventListener('input',()=>{$('fovValue').textContent=$('fov').value})
$('mouseSensitivity').addEventListener('input',()=>{$('mouseSensitivityValue').textContent=Number($('mouseSensitivity').value).toFixed(2)})
$('masterVolume').addEventListener('input',()=>{$('masterVolumeValue').textContent=`${Math.round(Number($('masterVolume').value)*100)}%`})
$('musicVolume').addEventListener('input',()=>{$('musicVolumeValue').textContent=`${Math.round(Number($('musicVolume').value)*100)}%`})
$('profileSkin').addEventListener('change',async()=>{try{await setSkinFromFile('profile',$('profileSkin').files?.[0])}catch(e){toast(e.message,5000)}})
enableSkinDrop('regSkinPreview','regSkin','register')
enableSkinDrop('profileSkinPreview','profileSkin','profile')
syncSkinButtons()
$('restoreFile').addEventListener('change',()=>{const f=$('restoreFile').files?.[0];if(f)restoreBackup(f)})
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{})
boot()
