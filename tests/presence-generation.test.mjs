import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPresenceUpdate } from '../apps/orchestrator/presence.mjs'

test('stale disconnect from pre-refresh generation cannot erase refreshed connection', () => {
  const state = new Map()
  applyPresenceUpdate(state, { player: 'hudson', generation: 1, connected: true, at: 100 })
  applyPresenceUpdate(state, { player: 'hudson', generation: 2, connected: true, at: 200 })
  const result = applyPresenceUpdate(state, { player: 'hudson', generation: 1, connected: false, at: 300 })
  assert.equal(result.applied, false)
  assert.equal(state.get('hudson').connected, true)
  assert.equal(state.get('hudson').generation, 2)
})

test('disconnect for current physical generation clears presence', () => {
  const state = new Map()
  applyPresenceUpdate(state, { player: 'hudson', generation: 7, connected: true, at: 100 })
  const result = applyPresenceUpdate(state, { player: 'hudson', generation: 7, connected: false, at: 200 })
  assert.equal(result.applied, true)
  assert.equal(state.get('hudson').connected, false)
})

test('newer connection generation wins even when webhook timestamps arrive out of order', () => {
  const state = new Map()
  applyPresenceUpdate(state, { player: 'hudson', generation: 1, connected: false, at: 300 })
  const result = applyPresenceUpdate(state, { player: 'hudson', generation: 2, connected: true, at: 200 })
  assert.equal(result.applied, true)
  assert.equal(state.get('hudson').connected, true)
  assert.equal(state.get('hudson').generation, 2)
})

test('older generation can never replace a newer physical connection', () => {
  const state = new Map()
  applyPresenceUpdate(state, { player: 'hudson', generation: 2, connected: true, at: 200 })
  const result = applyPresenceUpdate(state, { player: 'hudson', generation: 1, connected: true, at: 999 })
  assert.equal(result.applied, false)
  assert.equal(state.get('hudson').generation, 2)
})
