-- Enable pgvector for the future knowledge index (Phase 2 email ingestion)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  slug TEXT UNIQUE NOT NULL,  -- e.g. 'vladimir' -> vladimir.digital-selfx.com
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Interview answers: one row per question key
CREATE TABLE IF NOT EXISTS profile_answers (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Big Five scores, one row per trait
CREATE TABLE IF NOT EXISTS personality (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  trait TEXT NOT NULL,       -- O, C, E, A, N
  score NUMERIC NOT NULL,    -- 1.0 - 5.0
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, trait)
);

-- Chat history with the clone
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,        -- 'user' or 'assistant'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Phase 2+: knowledge chunks from email/document ingestion.
-- Raw source content is NOT stored here on purpose (per retention decision) -
-- only the processed chunk and its embedding survive ingestion.
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  source TEXT,                -- e.g. 'email', 'whatsapp_export'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_user ON knowledge_chunks(user_id);
