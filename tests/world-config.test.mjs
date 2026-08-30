import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServerProperties, serializeServerProperties } from '../apps/orchestrator/world-config.mjs'

test('Paper world properties map HEM Hardcore to native survival+hard+hardcore semantics', () => {
  const p = buildServerProperties({
    name:'Hardcore Test', gameMode:'hardcore', difficulty:'peaceful', allowCommands:false,
    worldType:'amplified', generateStructures:false, seed:'-12345',
  }, 31042, 'w_test')
  assert.equal(p.hardcore, 'true')
  assert.equal(p.gamemode, 'survival')
  assert.equal(p.difficulty, 'hard')
  assert.equal(p['enable-command-block'], 'false')
  assert.equal(p['generate-structures'], 'false')
  assert.equal(p['level-type'], 'minecraft:amplified')
  assert.equal(p['level-seed'], '-12345')
  assert.equal(p['server-port'], '31042')
  assert.equal(p['allow-nether'], 'true')
  assert.equal(p['online-mode'], 'false')
})

test('Paper world property serialization strips newline injection from name and seed', () => {
  const p = buildServerProperties({ name:'Our World\nwhite-list=true', seed:'abc\nserver-port=1', gameMode:'creative' }, 31000, 'w_test')
  const text = serializeServerProperties(p)
  assert.equal(p.gamemode, 'creative')
  assert.equal(p.hardcore, 'false')
  assert.equal(p['level-type'], 'minecraft:normal')
  assert.equal(p['generate-structures'], 'true')
  assert.ok(text.includes('motd=HEM — Our Worldwhite-list=true\n'))
  assert.ok(text.includes('level-seed=abcserver-port=1\n'))
  assert.equal((text.match(/server-port=/g) || []).length, 2) // real key + sanitized seed text
  assert.ok(text.includes('server-port=31000\n'))
})
