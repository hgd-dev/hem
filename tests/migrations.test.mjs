import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'apps/hub/migrations')

function migratedDb() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const files = fs.readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort()
  for (const file of files) db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  return db
}

test('D1 migration chain preserves old game_mode constraint while supporting Hardcore safely', () => {
  const db = migratedDb()
  db.prepare('INSERT INTO identities(id,display_name,mc_username,secret_hash,created_at) VALUES(?,?,?,?,?)')
    .run('u_00000000000000000001', 'Hudson', 'HEM_1234567890', 'x'.repeat(64), 1)

  const insert = db.prepare(`INSERT INTO worlds(
    id,owner_id,name,kind,seed,game_mode,hardcore,difficulty,allow_commands,world_type,generate_structures,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  insert.run('w_00000000000000000001','u_00000000000000000001','Hardcore','solo','','survival',1,'hard',1,'amplified',1,1,1)

  const row = db.prepare('SELECT game_mode,hardcore,difficulty,world_type,generate_structures FROM worlds WHERE id=?')
    .get('w_00000000000000000001')
  assert.deepEqual({ ...row }, { game_mode:'survival', hardcore:1, difficulty:'hard', world_type:'amplified', generate_structures:1 })

  assert.throws(() => insert.run('w_00000000000000000002','u_00000000000000000001','Bad','solo','','hardcore',1,'hard',1,'normal',1,1,1), /CHECK constraint failed/)
  db.close()
})

test('all current hub migrations apply cleanly to an empty database', () => {
  const db = migratedDb()
  const cols = db.prepare("PRAGMA table_info('worlds')").all().map(r => r.name)
  for (const name of ['allow_commands','world_type','generate_structures','hardcore']) assert.ok(cols.includes(name), `missing ${name}`)
  db.close()
})
