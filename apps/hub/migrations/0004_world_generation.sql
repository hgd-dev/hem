ALTER TABLE worlds ADD COLUMN world_type TEXT NOT NULL DEFAULT 'normal' CHECK(world_type IN ('normal','flat','large_biomes','amplified'));
ALTER TABLE worlds ADD COLUMN generate_structures INTEGER NOT NULL DEFAULT 1 CHECK(generate_structures IN (0,1));
