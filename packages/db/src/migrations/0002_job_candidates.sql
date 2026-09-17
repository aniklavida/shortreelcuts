ALTER TABLE jobs ADD COLUMN candidates jsonb NOT NULL DEFAULT '{}'::jsonb;
