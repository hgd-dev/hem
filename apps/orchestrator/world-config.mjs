function clean(value) {
  return String(value ?? '').replace(/[\r\n]/g, '')
}

export const WORLD_TYPES = new Set(['normal','flat','large_biomes','amplified'])
export const GAME_MODES = new Set(['survival','creative','hardcore'])
export const DIFFICULTIES = new Set(['peaceful','easy','normal','hard'])

export function buildServerProperties(cfg = {}, port = 25565, id = 'hem-world') {
  const hardcore = cfg.gameMode === 'hardcore'
  const gameMode = hardcore ? 'survival' : (GAME_MODES.has(cfg.gameMode) ? cfg.gameMode : 'survival')
  const difficulty = hardcore ? 'hard' : (DIFFICULTIES.has(cfg.difficulty) ? cfg.difficulty : 'normal')
  const worldType = WORLD_TYPES.has(cfg.worldType) ? cfg.worldType : 'normal'
  const properties = {
    'accepts-transfers':'false',
    'allow-flight':'false',
    'allow-nether':'true',
    'broadcast-console-to-ops':'true',
    'difficulty':difficulty,
    'enable-command-block':cfg.allowCommands === false ? 'false' : 'true',
    'enable-query':'false',
    'enable-rcon':'false',
    'enable-status':'true',
    'enforce-secure-profile':'false',
    'force-gamemode':'false',
    'gamemode':gameMode,
    'generate-structures':cfg.generateStructures === false ? 'false' : 'true',
    'hardcore':hardcore ? 'true' : 'false',
    'level-name':'world',
    'level-type':`minecraft:${worldType}`,
    'max-players':'4',
    'motd':`HEM — ${clean(cfg.name || id)}`,
    'network-compression-threshold':'256',
    'online-mode':'false',
    'player-idle-timeout':'0',
    'pvp':'true',
    'server-ip':'0.0.0.0',
    'server-port':String(port),
    'simulation-distance':'8',
    'spawn-protection':'0',
    'sync-chunk-writes':'true',
    'view-distance':'10',
    'white-list':'false',
  }
  if (cfg.seed) properties['level-seed'] = clean(cfg.seed)
  return properties
}

export function serializeServerProperties(properties) {
  return Object.entries(properties).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
}
