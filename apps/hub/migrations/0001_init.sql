PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  mc_username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES identities(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('solo','shared')),
  seed TEXT NOT NULL,
  game_mode TEXT NOT NULL CHECK(game_mode IN ('survival','creative')),
  difficulty TEXT NOT NULL CHECK(difficulty IN ('peaceful','easy','normal','hard')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE IF NOT EXISTS memberships (
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner','member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY(world_id, identity_id)
);

CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES identities(id),
  expires_at INTEGER NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS launch_sessions (
  token_hash TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  mc_username TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memberships_identity ON memberships(identity_id);
CREATE INDEX IF NOT EXISTS idx_launch_expiry ON launch_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_invites_expiry ON invites(expires_at);
