ALTER TABLE identities ADD COLUMN skin_model TEXT NOT NULL DEFAULT 'classic' CHECK(skin_model IN ('classic','slim'));
ALTER TABLE identities ADD COLUMN skin_png TEXT;
ALTER TABLE identities ADD COLUMN profile_updated_at INTEGER;
