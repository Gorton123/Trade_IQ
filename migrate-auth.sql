-- TradeIQ — Render Database Migration
-- Run ONCE after your PostgreSQL database is created on Render
-- Safe to run on an existing database (all statements use IF NOT EXISTS / IF EXISTS)

-- 1. Sessions table (required for express-session + connect-pg-simple)
CREATE TABLE IF NOT EXISTS sessions (
  sid VARCHAR PRIMARY KEY,
  sess JSONB NOT NULL,
  expire TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions (expire);

-- 2. Add password_hash to users (new JWT auth column)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 3. Verify key tables exist (Drizzle will create these via db:push)
-- Run `npm run db:push` after this script to create all app tables.
