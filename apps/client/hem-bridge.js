(() => {
  const hash = new URLSearchParams(location.hash.slice(1))
  const query = new URLSearchParams(location.search)
  const token = hash.get('hemToken')
  const username = query.get('username') || ''
  const destination = query.get('ip') || ''
  const resumeKey = `hem.resume.1:${username}:${destination}`

  // Expose a tiny read-only diagnostics surface for HEM's automated acceptance
  // runner. It deliberately contains no launch/resume secrets or profile credentials.
  const parity = {
    hemVersion: '1.0.0-rc.14',
    target: '1.21.5',
    connected: false,
    build: { checked: false, ok: false, compatibilityMode: '', upstreamRelease1215: null, protocolVerified1215: null, upstreamCommit: '' },
    authorization: { mode: '', attempted: false, authenticated: false, failed: false },
    registry: { checked: false, ok: false, missing: [] },
    windowsOpened: 0,
    entitiesSeen: new Set(),
    dimensionsSeen: new Set(),
    renderer: { checked: false, healthy: false, sections: 0 },
    resume: { available: false, attempted: false, stored: false, received: 0 },
    settingsRequested: {},
    packetsSeen: new Set(),
    presentation: { damageFlashes: 0, audioEvents: 0 },
    multiplayerEvents: { joined: 0, left: 0 },
    recentMessages: [],
  }
  Object.defineProperty(globalThis, '__HEM_PARITY__', { value: parity, configurable: false, writable: false })

  let fatalShown = false
  const showFatal = (code, message) => {
    if (fatalShown) return
    fatalShown = true
    const panel = document.createElement('div')
    panel.id = 'hem-compatibility-error'
    panel.dataset.code = code
    Object.assign(panel.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', display: 'grid', placeItems: 'center',
      padding: '24px', background: 'rgba(6,8,12,.94)', color: '#fff', fontFamily: 'system-ui, sans-serif'
    })
    const card = document.createElement('div')
    Object.assign(card.style, { maxWidth: '620px', padding: '26px', border: '1px solid rgba(255,255,255,.24)', borderRadius: '16px', background: '#111722', boxShadow: '0 18px 60px rgba(0,0,0,.45)' })
    const title = document.createElement('h1'); title.textContent = 'HEM could not start this 1.21.5 session'; Object.assign(title.style, { margin: '0 0 12px', fontSize: '22px' })
    const body = document.createElement('p'); body.textContent = message; Object.assign(body.style, { margin: '0 0 18px', lineHeight: '1.5', opacity: '.9' })
    const actions = document.createElement('div'); Object.assign(actions.style, { display: 'flex', gap: '10px', flexWrap: 'wrap' })
    const back = document.createElement('button'); back.type = 'button'; back.textContent = 'Back to HEM'; back.onclick = () => history.back()
    const reload = document.createElement('button'); reload.type = 'button'; reload.textContent = 'Retry client'; reload.onclick = () => location.reload()
    for (const button of [back, reload]) Object.assign(button.style, { padding: '10px 14px', borderRadius: '9px', border: '1px solid rgba(255,255,255,.28)', background: '#1d2737', color: '#fff', cursor: 'pointer' })
    actions.append(back, reload); card.append(title, body, actions); panel.append(card); document.documentElement.append(panel)
    console.error(`HEM fatal ${code}: ${message}`)
  }

  fetch('./hem-build.json', { cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const build = await response.json()
    parity.build.checked = true
    parity.build.compatibilityMode = String(build.compatibilityMode || '')
    parity.build.upstreamRelease1215 = build.upstreamRelease1215 === true
    parity.build.protocolVerified1215 = build.protocolVerified1215 === true
    parity.build.upstreamCommit = /^[0-9a-f]{40}$/i.test(build.upstreamCommit || '') ? build.upstreamCommit : ''
    parity.build.ok = build.minecraft === '1.21.5' && build.hemVersion === parity.hemVersion && build.compatibilityMode === 'pinned-v0.1.98-lockfile-1215-verified' && build.upstreamReleaseTag === 'v0.1.98' && build.upstreamRelease1215 === true && build.protocolVerified1215 === true && build.frozenLockfile === true && /^[0-9a-f]{64}$/i.test(build.upstreamLockSha256 || '')
    if (!parity.build.ok) showFatal('build-identity', 'The browser bundle identity does not match this HEM 1.21.5 release. Return to the HEM launcher and redeploy the matching client build.')
  }).catch(error => {
    parity.build.checked = true
    parity.build.ok = false
    console.error('HEM could not verify client build identity:', error)
    showFatal('build-identity', 'HEM could not verify this browser client build. Return to the launcher and try again after the client deployment is healthy.')
  })

  for (const entry of query.getAll('setting')) {
    const split = entry.indexOf(':')
    if (split <= 0) continue
    const key = entry.slice(0, split)
    const raw = entry.slice(split + 1)
    const value = raw === 'true' ? true : raw === 'false' ? false : (Number.isFinite(Number(raw)) ? Number(raw) : raw)
    parity.settingsRequested[key] = value
  }

  // Original HEM feedback layer. It uses synthesized WebAudio tones and CSS only;
  // no Mojang audio or visual assets are copied. Upstream remains responsible for
  // its native presentation, while this layer guarantees basic private HEM feedback
  // even when a particular upstream sound/overlay path is missing.
  let audioContext = null
  const audioVolume = () => Math.max(0, Math.min(1, Number(parity.settingsRequested.masterVolume ?? 1)))
  const tone = (frequency, duration = .08, gain = .035) => {
    if (audioVolume() <= 0) return
    try {
      audioContext ||= new (globalThis.AudioContext || globalThis.webkitAudioContext)()
      const osc = audioContext.createOscillator()
      const amp = audioContext.createGain()
      osc.type = 'triangle'; osc.frequency.value = frequency
      amp.gain.setValueAtTime(gain * audioVolume(), audioContext.currentTime)
      amp.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration)
      osc.connect(amp); amp.connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + duration)
      parity.presentation.audioEvents++
    } catch {}
  }
  const damageOverlay = document.createElement('div')
  Object.assign(damageOverlay.style, { position:'fixed', inset:'0', pointerEvents:'none', zIndex:'2147483646', opacity:'0', boxShadow:'inset 0 0 80px 18px rgba(160,0,0,.72)' })
  const reducedMotion = parity.settingsRequested.reducedMotion === true
  damageOverlay.style.transition = reducedMotion ? 'none' : 'opacity 160ms ease-out'
  document.documentElement.appendChild(damageOverlay)
  const flashDamage = () => {
    damageOverlay.style.opacity = '1'; parity.presentation.damageFlashes++; tone(130, .11, .05)
    setTimeout(() => { damageOverlay.style.opacity = '0' }, reducedMotion ? 40 : 180)
  }

  const checkRegistry = bot => {
    const requirements = [
      ['item', bot.registry?.itemsByName, ['mace', 'wind_charge', 'brown_egg', 'blue_egg', 'cactus_flower']],
      ['block', bot.registry?.blocksByName, ['crafter', 'trial_spawner', 'vault', 'firefly_bush', 'leaf_litter', 'wildflowers', 'bush', 'short_dry_grass', 'tall_dry_grass', 'cactus_flower']],
      ['entity', bot.registry?.entitiesByName, ['pig', 'cow', 'chicken', 'sheep', 'wolf']],
    ]
    const missing = []
    for (const [kind, map, names] of requirements) {
      for (const name of names) if (!map?.[name]) missing.push(`${kind}:${name}`)
    }
    parity.registry.checked = true
    parity.registry.missing = missing
    parity.registry.ok = missing.length === 0
    if (missing.length) {
      console.error('HEM 1.21.5 registry mismatch:', missing.join(', '))
      showFatal('registry-1215', `The client is missing required Minecraft 1.21.5 registry data (${missing.join(', ')}). This build is not safe to play.`)
    }
  }

  const sampleRenderer = () => {
    const sections = globalThis.world?.sectionObjects
    const count = sections && typeof sections === 'object' ? Object.keys(sections).length : 0
    parity.renderer.checked = Boolean(globalThis.world)
    parity.renderer.sections = count
    parity.renderer.healthy = count > 0
  }

  const decodePayload = value => {
    try {
      if (typeof value === 'string') return value
      if (value instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(value))
      if (ArrayBuffer.isView(value)) return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      if (Array.isArray(value?.data)) return new TextDecoder().decode(Uint8Array.from(value.data))
      if (typeof value?.toString === 'function') {
        const text = value.toString('utf8')
        if (text && text !== '[object Object]') return text
      }
    } catch {}
    return ''
  }

  const readResume = () => {
    try {
      const value = sessionStorage.getItem(resumeKey) || ''
      parity.resume.available = /^[A-Za-z0-9_-]{32,256}$/.test(value)
      return parity.resume.available ? value : ''
    } catch {
      parity.resume.available = false
      return ''
    }
  }

  let lastResumeToken = ''
  const captureResumePacket = packet => {
    const channel = packet?.channel || packet?.channelName || packet?.tag || ''
    if (channel !== 'hem:session') return
    const value = decodePayload(packet?.data ?? packet?.payload ?? packet?.value).trim()
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(value) || value === lastResumeToken) return
    try {
      sessionStorage.setItem(resumeKey, value)
      lastResumeToken = value
      parity.resume.available = true
      parity.resume.stored = true
      parity.resume.received++
      parity.authorization.authenticated = true
      parity.authorization.failed = false
    } catch (error) {
      console.error('HEM could not store the short-lived resume session:', error)
    }
  }

  const attachDiagnostics = bot => {
    if (bot.__hemDiagnosticsAttached) return
    bot.__hemDiagnosticsAttached = true
    parity.connected = Boolean(bot.entity)
    checkRegistry(bot)
    readResume()
    const noteDimension = () => parity.dimensionsSeen.add(String(bot.game?.dimension || 'unknown'))
    noteDimension()
    bot.on?.('spawn', () => {
      parity.connected = true; noteDimension(); setTimeout(sampleRenderer, 750)
      setTimeout(() => {
        sampleRenderer()
        if (parity.connected && parity.registry.ok && !parity.renderer.healthy) {
          showFatal('renderer-1215', 'The 1.21.5 world connected, but no rendered chunk sections appeared. This client build failed the HEM renderer health check.')
        }
      }, 50_000)
    })
    bot.on?.('respawn', () => { noteDimension(); setTimeout(sampleRenderer, 750) })
    bot.on?.('windowOpen', () => { parity.windowsOpened++ })
    bot.on?.('entitySpawn', entity => { if (entity?.name) parity.entitiesSeen.add(entity.name) })
    let lastHealth = Number(bot.health ?? 20)
    bot.on?.('health', () => {
      const health = Number(bot.health ?? lastHealth)
      if (health < lastHealth) flashDamage()
      lastHealth = health
    })
    bot.on?.('message', message => {
      tone(520, .045, .012)
      const text = typeof message?.toString === 'function' ? message.toString() : String(message || '')
      parity.recentMessages.push(text); if (parity.recentMessages.length > 50) parity.recentMessages.shift()
    })
    bot.on?.('playerJoined', () => { parity.multiplayerEvents.joined++ })
    bot.on?.('playerLeft', () => { parity.multiplayerEvents.left++ })
    bot._client?.on?.('packet', (_data, meta) => { if (meta?.name) parity.packetsSeen.add(meta.name) })
    bot.on?.('kicked', reason => {
      parity.connected = false
      if (parity.authorization.attempted && !parity.authorization.authenticated) {
        parity.authorization.failed = true
        const detail = typeof reason?.toString === 'function' ? reason.toString() : String(reason || '')
        showFatal('authorization', `The Paper server rejected or expired this HEM launch session${detail ? `: ${detail.slice(0, 240)}` : '.'}`)
      }
    })
    bot.on?.('end', () => {
      parity.connected = false
      if (parity.authorization.attempted && !parity.authorization.authenticated) {
        parity.authorization.failed = true
        showFatal('authorization', 'The connection ended before HEM authorization completed. Return to the HEM world menu and launch again.')
      }
    })
    bot._client?.on?.('custom_payload', captureResumePacket)
    bot._client?.on?.('packet', (data, meta) => { if (meta?.name === 'custom_payload') captureResumePacket(data) })
    bot.on?.('customPayload', captureResumePacket)
  }

  let sent = false
  let tries = 0
  const timer = setInterval(() => {
    tries++
    const bot = globalThis.bot
    if (bot?.entity) { attachDiagnostics(bot); sampleRenderer() }
    if (!sent && bot?.entity && typeof bot.chat === 'function') {
      if (token) {
        sent = true
        parity.authorization.mode = 'launch'
        parity.authorization.attempted = true
        // A fresh launch supersedes any old short-lived resume lease for this tab.
        try { sessionStorage.removeItem(resumeKey) } catch {}
        // Browser URL fragments never reach Cloudflare/the proxy, and we erase it
        // only when the bot is ready to consume it. The token is never copied into
        // diagnostics, localStorage, query parameters, or logs.
        history.replaceState(null, '', location.pathname + location.search)
        bot.chat(`/hem auth ${token}`)
      } else {
        const resume = readResume()
        if (resume) {
          sent = true
          parity.resume.attempted = true
          parity.authorization.mode = 'resume'
          parity.authorization.attempted = true
          bot.chat(`/hem resume ${resume}`)
        }
      }
    }
    const hasCredential = Boolean(token || readResume())
    if (tries > 600 || (!hasCredential && bot?.entity)) clearInterval(timer)
    if (tries > 600 && !sent) console.error('HEM authorization bridge timed out waiting for a launch or resume session')
  }, 100)
})()
