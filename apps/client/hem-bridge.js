(() => {
  const hash = new URLSearchParams(location.hash.slice(1))
  const query = new URLSearchParams(location.search)
  const token = hash.get('hemToken')
  const username = query.get('username') || ''
  const destination = query.get('ip') || ''
  const resumeKey = `hem.resume.1:${username}:${destination}`
  const generationKey = `hem.connection-generation.1:${username}:${destination}`
  const canonicalRecoveryUrl = `${location.pathname}${location.search}`
  let initialGenerationId = 1
  try {
    const storedGenerationId = Number.parseInt(sessionStorage.getItem(generationKey) || '0', 10)
    if (Number.isSafeInteger(storedGenerationId) && storedGenerationId >= 0) initialGenerationId = storedGenerationId + 1
  } catch {}

  // Expose a tiny read-only diagnostics surface for HEM's automated acceptance
  // runner. It deliberately contains no launch/resume secrets or profile credentials.
  const parity = {
    hemVersion: '1.0.0-rc.42',
    target: '1.21.5',
    connected: false,
    build: { checked: false, ok: false, compatibilityMode: '', upstreamRelease1215: null, protocolVerified1215: null, upstreamCommit: '' },
    authorization: { mode: '', attempted: false, authenticated: false, failed: false },
    registry: { checked: false, ok: false, missing: [] },
    windowsOpened: 0,
    entitiesSeen: new Set(),
    dimensionsSeen: new Set(),
    renderer: { checked: false, healthy: false, sections: 0 },
    resume: { available: false, attempted: false, stored: false, received: 0, leaseRequests: 0, channelRegistered: false, channelRegistrationFailed: false, recoveryUrlReady: Boolean(canonicalRecoveryUrl) },
    settingsRequested: {},
    packetsSeen: new Set(),
    transport: { keepAliveSeen: 0, keepAliveResponses: 0, keepAliveFallbacks: 0, keepAliveGuardAttached: false, clientEndReason: '', clientErrors: [], eventLoopLag: { lastMs: 0, maxMs: 0, samplesOver100ms: 0, samplesOver1000ms: 0 }, rawTransport: { implementation: '', connectionId: '', framesSent: 0, framesReceived: 0, bytesSent: 0, bytesReceived: 0, maxBufferedAmount: 0, queuedWrites: 0, queuedBytes: 0, closeReason: '', errors: [] } },
    presentation: { damageFlashes: 0, audioEvents: 0 },
    multiplayerEvents: { joined: 0, left: 0 },
    recentMessages: [],
    connection: { nextGenerationId: initialGenerationId, activeGenerationId: null, generations: [] },
  }
  Object.defineProperty(globalThis, '__HEM_PARITY__', { value: parity, configurable: false, writable: false })

  const connection = parity.connection
  const generationByClient = new WeakMap()
  const currentGeneration = () => connection.generations.find(entry => entry.id === connection.activeGenerationId) || null
  const isActiveGeneration = generation => connection.activeGenerationId === generation?.id
  const endGeneration = generation => {
    if (!generation) return
    generation.connected = false
    if (!generation.endedAt) generation.endedAt = Date.now()
    if (generation.__rawTransportTimer) { clearInterval(generation.__rawTransportTimer); generation.__rawTransportTimer = null }
    if (generation.__eventLoopLagTimer) { clearInterval(generation.__eventLoopLagTimer); generation.__eventLoopLagTimer = null }
    if (isActiveGeneration(generation)) parity.connected = false
  }
  const beginGeneration = client => {
    if (!client || (typeof client !== 'object' && typeof client !== 'function')) return null
    const existing = generationByClient.get(client)
    if (existing) return existing
    const prior = currentGeneration()
    if (prior && !prior.endedAt) endGeneration(prior)
    const generation = {
      id: connection.nextGenerationId++,
      startedAt: Date.now(),
      endedAt: 0,
      connected: false,
      keepAliveSeen: 0,
      keepAliveResponses: 0,
      keepAliveFallbacks: 0,
      keepAliveGuardAttached: false,
      clientEndReason: '',
      clientErrors: [],
      eventLoopLag: { lastMs: 0, maxMs: 0, samplesOver100ms: 0, samplesOver1000ms: 0 },
      authorization: { mode: '', attempted: false, authenticated: false, failed: false },
      resumeChannelRegistered: false,
      rawTransport: { implementation: '', connectionId: '', framesSent: 0, framesReceived: 0, bytesSent: 0, bytesReceived: 0, maxBufferedAmount: 0, queuedWrites: 0, queuedBytes: 0, closeReason: '', errors: [] },
    }
    generationByClient.set(client, generation)
    try { sessionStorage.setItem(generationKey, String(generation.id)) } catch {}
    connection.generations.push(generation)
    if (connection.generations.length > 8) connection.generations.shift()
    connection.activeGenerationId = generation.id
    return generation
  }
  const mirrorAuthorization = generation => {
    if (!isActiveGeneration(generation)) return
    Object.assign(parity.authorization, generation.authorization)
  }
  const mirrorTransport = generation => {
    if (!isActiveGeneration(generation)) return
    parity.transport.keepAliveSeen = generation.keepAliveSeen
    parity.transport.keepAliveResponses = generation.keepAliveResponses
    parity.transport.keepAliveFallbacks = generation.keepAliveFallbacks
    parity.transport.keepAliveGuardAttached = generation.keepAliveGuardAttached === true
    parity.transport.clientEndReason = generation.clientEndReason
    parity.transport.clientErrors = [...generation.clientErrors]
    parity.transport.eventLoopLag = { ...generation.eventLoopLag }
    parity.transport.rawTransport = { ...generation.rawTransport, errors: [...(generation.rawTransport?.errors || [])] }
  }

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
    parity.build.ok = build.minecraft === '1.21.5' && build.hemVersion === parity.hemVersion && build.compatibilityMode === 'pinned-v0.1.99-lockfile-1215-verified' && build.upstreamReleaseTag === 'v0.1.99' && build.upstreamRelease1215 === true && build.protocolVerified1215 === true && build.frozenLockfile === true && build.transport === 'hem-raw-tcp-v1' && build.netBrowserifyProductionTransport === false && build.orderedBinaryDelivery === true && build.singleWebSocketTcpTunnel === true && /^[0-9a-f]{64}$/i.test(build.upstreamLockSha256 || '')
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
  let leaseRequestTimer = null
  const captureResumePacket = (packet, generation = currentGeneration()) => {
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
      if (leaseRequestTimer) { clearInterval(leaseRequestTimer); leaseRequestTimer = null }
      if (generation) {
        generation.authorization.authenticated = true
        generation.authorization.failed = false
        mirrorAuthorization(generation)
      }
    } catch (error) {
      console.error('HEM could not store the short-lived resume session:', error)
    }
  }

  const requestResumeLease = bot => {
    if (leaseRequestTimer || parity.resume.stored || !bot?.entity || typeof bot.chat !== 'function') return
    let attempts = 0
    const request = () => {
      if (parity.resume.stored || !globalThis.bot?.entity) {
        if (leaseRequestTimer) clearInterval(leaseRequestTimer)
        leaseRequestTimer = null
        return
      }
      attempts++
      parity.resume.leaseRequests++
      bot.chat('/hem lease')
      if (attempts >= 6) {
        if (leaseRequestTimer) clearInterval(leaseRequestTimer)
        leaseRequestTimer = null
        console.error('HEM resume lease request timed out after confirmed authorization')
      }
    }
    request()
    if (!parity.resume.stored && attempts < 6) leaseRequestTimer = setInterval(request, 1500)
  }

  const attachDiagnostics = bot => {
    const client = bot?._client
    const generation = beginGeneration(client)
    if (!generation) return null
    generation.connected = Boolean(bot.entity)
    if (isActiveGeneration(generation)) {
      parity.connected = generation.connected
      mirrorAuthorization(generation)
      mirrorTransport(generation)
      parity.resume.channelRegistered = generation.resumeChannelRegistered === true
      parity.resume.channelRegistrationFailed = false
    }
    if (bot.__hemDiagnosticsClient === client) return generation
    bot.__hemDiagnosticsClient = client
    bot.__hemDiagnosticsAttached = true
    checkRegistry(bot)
    readResume()
    const noteDimension = () => parity.dimensionsSeen.add(String(bot.game?.dimension || 'unknown'))
    noteDimension()
    bot.on?.('spawn', () => {
      generation.connected = true
      if (isActiveGeneration(generation)) parity.connected = true
      noteDimension(); setTimeout(sampleRenderer, 750)
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
      // Paper sends these only after the credential has been accepted on the
      // current physical connection. A fresh launch needs one private plugin-channel
      // delivery to seed sessionStorage. A resume deliberately keeps the existing
      // short-lived reconnect lease, so reconnect correctness no longer depends on
      // Paper -> browser custom-payload delivery working a second time.
      if (/HEM:\s+connected\s+to\b/i.test(text)) {
        generation.authorization.authenticated = true
        generation.authorization.failed = false
        mirrorAuthorization(generation)
        requestResumeLease(bot)
      } else if (/HEM:\s+resumed\s+to\b/i.test(text)) {
        generation.authorization.authenticated = true
        generation.authorization.failed = false
        mirrorAuthorization(generation)
        parity.resume.stored = Boolean(readResume())
      }
    })
    bot.on?.('playerJoined', () => { parity.multiplayerEvents.joined++ })
    bot.on?.('playerLeft', () => { parity.multiplayerEvents.left++ })
    bot._client?.on?.('packet', (_data, meta) => { if (meta?.name) parity.packetsSeen.add(meta.name) })
    bot.on?.('kicked', reason => {
      endGeneration(generation)
      if (generation.authorization.attempted && !generation.authorization.authenticated) {
        generation.authorization.failed = true
        mirrorAuthorization(generation)
        const detail = typeof reason?.toString === 'function' ? reason.toString() : String(reason || '')
        showFatal('authorization', `The Paper server rejected or expired this HEM launch session${detail ? `: ${detail.slice(0, 240)}` : '.'}`)
      }
    })
    bot.on?.('end', () => {
      endGeneration(generation)
      if (leaseRequestTimer) { clearInterval(leaseRequestTimer); leaseRequestTimer = null }
      if (generation.authorization.attempted && !generation.authorization.authenticated) {
        generation.authorization.failed = true
        mirrorAuthorization(generation)
        showFatal('authorization', 'The connection ended before HEM authorization completed. Return to the HEM world menu and launch again.')
      }
    })
    client?.on?.('error', error => {
      const text = typeof error?.message === 'string' ? error.message : String(error || 'unknown client error')
      generation.clientErrors.push(text.slice(0, 300))
      if (generation.clientErrors.length > 8) generation.clientErrors.shift()
      mirrorTransport(generation)
    })
    client?.on?.('end', reason => {
      const text = typeof reason === 'string' ? reason : String(reason || '')
      generation.clientEndReason = text
      endGeneration(generation)
      mirrorTransport(generation)
    })
    const syncRawTransport = () => {
      const raw = client?.socket?.__hemTransportState
      if (!raw || raw.implementation !== 'hem-raw-tcp-v1') return
      generation.rawTransport = {
        implementation: 'hem-raw-tcp-v1',
        connectionId: String(raw.connectionId || ''),
        framesSent: Number(raw.framesSent || 0),
        framesReceived: Number(raw.framesReceived || 0),
        bytesSent: Number(raw.bytesSent || 0),
        bytesReceived: Number(raw.bytesReceived || 0),
        maxBufferedAmount: Number(raw.maxBufferedAmount || 0),
        queuedWrites: Number(raw.queuedWrites || 0),
        queuedBytes: Number(raw.queuedBytes || 0),
        closeReason: String(raw.closeReason || ''),
        errors: Array.isArray(raw.errors) ? raw.errors.slice(-8).map(value => String(value).slice(0, 240)) : [],
      }
      mirrorTransport(generation)
    }
    syncRawTransport()
    Object.defineProperty(generation, '__rawTransportTimer', { value: setInterval(syncRawTransport, 250), writable: true, configurable: true, enumerable: false })

    // Keepalive parsing and rendering share Chromium's main event loop. Record
    // scheduling stalls per physical generation so a Paper timeout can be
    // distinguished from a malformed or dropped network response.
    const EVENT_LOOP_SAMPLE_MS = 100
    const eventLoopNow = () => globalThis.performance?.now?.() ?? Date.now()
    let eventLoopExpectedAt = eventLoopNow() + EVENT_LOOP_SAMPLE_MS
    const sampleEventLoopLag = () => {
      const now = eventLoopNow()
      const lag = Math.max(0, now - eventLoopExpectedAt)
      generation.eventLoopLag.lastMs = Math.round(lag)
      generation.eventLoopLag.maxMs = Math.max(generation.eventLoopLag.maxMs, Math.round(lag))
      if (lag >= 100) generation.eventLoopLag.samplesOver100ms++
      if (lag >= 1000) generation.eventLoopLag.samplesOver1000ms++
      eventLoopExpectedAt = now + EVENT_LOOP_SAMPLE_MS
      mirrorTransport(generation)
    }
    Object.defineProperty(generation, '__eventLoopLagTimer', { value: setInterval(sampleEventLoopLag, EVENT_LOOP_SAMPLE_MS), writable: true, configurable: true, enumerable: false })

    const keepAliveState = globalThis.HEMKeepAliveGuard?.attachHemKeepAliveGuard?.(client)
    if (keepAliveState) {
      generation.keepAliveGuardAttached = true
      const syncKeepAliveState = () => {
        generation.keepAliveSeen = keepAliveState.seen
        generation.keepAliveResponses = keepAliveState.responses
        generation.keepAliveFallbacks = keepAliveState.fallbacks
        mirrorTransport(generation)
      }
      client?.on?.('packet', (_data, meta) => {
        if (meta?.name === 'keep_alive') setTimeout(syncKeepAliveState, 5)
      })
      syncKeepAliveState()
    }
    if (client && !client.__hemResumeChannelRegistered && typeof client.registerChannel === 'function') {
      try {
        // Bukkit only considers a player to be listening to a custom plugin channel
        // after the client sends minecraft:register. node-minecraft-protocol's
        // registerChannel(..., true) performs that registration and also gives us a
        // named raw-payload event, which is much more reliable than depending on the
        // generic custom_payload event shape across historical protocol builds.
        client.registerChannel('hem:session', ['restBuffer', []], true)
        client.__hemResumeChannelRegistered = true
        generation.resumeChannelRegistered = true
        if (isActiveGeneration(generation)) parity.resume.channelRegistered = true
        client.on?.('hem:session', data => captureResumePacket({ channel: 'hem:session', data }, generation))
      } catch (error) {
        if (isActiveGeneration(generation)) parity.resume.channelRegistrationFailed = true
        console.error('HEM could not register the resume plugin channel:', error)
      }
    }
    client?.on?.('custom_payload', packet => captureResumePacket(packet, generation))
    client?.on?.('packet', (data, meta) => { if (meta?.name === 'custom_payload') captureResumePacket(data, generation) })
    bot.on?.('customPayload', packet => captureResumePacket(packet, generation))
    return generation
  }

  let launchTokenConsumed = false
  const authorizeGeneration = (bot, generation) => {
    if (!generation || !bot?.entity || typeof bot.chat !== 'function' || generation.authorization.attempted) return false
    if (token && !launchTokenConsumed) {
      launchTokenConsumed = true
      generation.authorization.mode = 'launch'
      generation.authorization.attempted = true
      generation.authorization.authenticated = false
      generation.authorization.failed = false
      mirrorAuthorization(generation)
      // A fresh launch supersedes any old short-lived resume lease for this tab.
      try { sessionStorage.removeItem(resumeKey) } catch {}
      // Browser URL fragments never reach Cloudflare/the proxy, and we erase it
      // only when the bot is ready to consume it. The token is never copied into
      // diagnostics, localStorage, query parameters, or logs.
      history.replaceState(null, '', canonicalRecoveryUrl)
      bot.chat(`/hem auth ${token}`)
      return true
    }
    const resume = readResume()
    if (!resume) return false
    generation.authorization.mode = 'resume'
    generation.authorization.attempted = true
    generation.authorization.authenticated = false
    generation.authorization.failed = false
    parity.resume.attempted = true
    mirrorAuthorization(generation)
    bot.chat(`/hem resume ${resume}`)
    return true
  }

  const timer = setInterval(() => {
    const bot = globalThis.bot
    if (bot?.entity) {
      const generation = attachDiagnostics(bot)
      sampleRenderer()
      authorizeGeneration(bot, generation)
    }
    if (!token && !readResume() && bot?.entity) clearInterval(timer)
  }, 100)
})()
