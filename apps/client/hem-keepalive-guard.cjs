;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.HEMKeepAliveGuard = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const idKey = value => {
    if (typeof value === 'bigint') return `bigint:${value.toString()}`
    if (typeof value === 'number') return `number:${value}`
    return `${typeof value}:${String(value)}`
  }

  function attachHemKeepAliveGuard (client) {
    if (!client || typeof client.on !== 'function' || typeof client.write !== 'function') return null
    if (client.__hemKeepAliveGuardState) return client.__hemKeepAliveGuardState

    const state = { seen: 0, responses: 0, fallbacks: 0 }
    const pending = []
    const originalWrite = client.write

    client.write = function hemGuardedWrite (name, params) {
      if (name === 'keep_alive' && params && Object.prototype.hasOwnProperty.call(params, 'keepAliveId')) {
        const key = idKey(params.keepAliveId)
        for (let i = pending.length - 1; i >= 0; i--) {
          const ticket = pending[i]
          if (ticket.key !== key) continue
          if (ticket.responded) {
            // HEM answers in the generic packet event before node-minecraft-protocol
            // emits its named keep_alive event. Suppress that later native duplicate.
            if (ticket.countedFallback) {
              ticket.countedFallback = false
              state.fallbacks--
            }
            ticket.nativeDuplicateSuppressed = true
            return
          }
          ticket.responded = true
          state.responses++
          break
        }
      }
      return originalWrite.apply(this, arguments)
    }

    client.on('packet', (data, meta) => {
      if (meta?.name !== 'keep_alive' || !data || !Object.prototype.hasOwnProperty.call(data, 'keepAliveId')) return
      state.seen++
      const ticket = { key: idKey(data.keepAliveId), responded: true, countedFallback: true, nativeDuplicateSuppressed: false }
      pending.push(ticket)

      // Reply in the same JavaScript turn in which the challenge is parsed. Renderer
      // work and timer scheduling therefore cannot delay the critical Paper response.
      state.responses++
      state.fallbacks++
      try {
        originalWrite.call(client, 'keep_alive', { keepAliveId: data.keepAliveId })
      } catch (error) {
        ticket.responded = false
        ticket.countedFallback = false
        state.responses--
        state.fallbacks--
        throw error
      }

      // node-minecraft-protocol emits its named keep_alive event synchronously after
      // the generic packet event. Keep the ticket through the rest of this turn so
      // the wrapped write can suppress that duplicate, then forget the challenge.
      setTimeout(() => {
        const index = pending.indexOf(ticket)
        if (index !== -1) pending.splice(index, 1)
      }, 0)
    })

    Object.defineProperty(client, '__hemKeepAliveGuardState', { value: state, configurable: false, writable: false })
    return state
  }

  return { attachHemKeepAliveGuard }
})
