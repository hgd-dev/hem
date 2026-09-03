export function applyPresenceUpdate(worldPresence, { player, generation, connected, at }) {
  const previous = worldPresence.get(player)
  const next = { generation, connected, at }

  if (!previous) {
    worldPresence.set(player, next)
    return { applied: true, players: countConnected(worldPresence) }
  }

  if (generation < previous.generation) {
    return { applied: false, players: countConnected(worldPresence) }
  }

  if (generation === previous.generation && at < previous.at) {
    return { applied: false, players: countConnected(worldPresence) }
  }

  worldPresence.set(player, next)
  return { applied: true, players: countConnected(worldPresence) }
}

export function countConnected(worldPresence) {
  return [...worldPresence.values()].filter(entry => entry.connected).length
}
