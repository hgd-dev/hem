ALTER TABLE worlds ADD COLUMN allow_commands INTEGER NOT NULL DEFAULT 1 CHECK(allow_commands IN (0,1));
