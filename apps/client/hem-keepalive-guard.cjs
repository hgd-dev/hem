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
          if (!ticket.responded && ticket.key === key) {
            ticket.responded = true
            state.responses++
            break
          }
        }
      }
      return originalWrite.apply(this, arguments)
    }

    client.on('packet', (data, meta) => {
      if (meta?.name !== 'keep_alive' || !data || !Object.prototype.hasOwnProperty.call(data, 'keepAliveId')) return
      state.seen++
      const ticket = { key: idKey(data.keepAliveId), responded: false }
      pending.push(ticket)

      // node-minecraft-protocol emits the generic `packet` event immediately before
      // the packet-specific `keep_alive` event. Give its normal responder the rest of
      // this turn first. Only send HEM's fallback if no matching write occurred.
      setTimeout(() => {
        if (!ticket.responded && client.ended !== true && client.serializer?.writable !== false) {
          state.fallbacks++
          client.write('keep_alive', { keepAliveId: data.keepAliveId })
        }
        const index = pending.indexOf(ticket)
        if (index !== -1) pending.splice(index, 1)
      }, 0)
    })

    Object.defineProperty(client, '__hemKeepAliveGuardState', { value: state, configurable: false, writable: false })
    return state
  }

  return { attachHemKeepAliveGuard }
})
