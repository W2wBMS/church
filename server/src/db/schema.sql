-- Church 2.0 — production schema (PostgreSQL 14+)
-- Idempotent: safe to run repeatedly (used as the migration).

CREATE TABLE IF NOT EXISTS branches (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  location    TEXT,
  code        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Canonical campuses are required for account provisioning and scoped records.
-- Preserve any existing branch edits when applying this migration again.
INSERT INTO branches (id, name, location, code) VALUES
  ('b1', 'Accra Main', 'Accra, Ghana', 'ACC'),
  ('b2', 'Kumasi Branch', 'Kumasi, Ghana', 'KUM'),
  ('b3', 'Takoradi Branch', 'Takoradi, Ghana', 'TAK')
ON CONFLICT (id) DO NOTHING;

-- Auth accounts. Roles gate access; branch_id scopes non-HQ users to a campus.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('hq_admin','branch_admin','ministry_leader','member')),
  branch_id     TEXT REFERENCES branches(id) ON DELETE SET NULL,
  mfa_enabled   BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id                  TEXT PRIMARY KEY,
  branch_id           TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  family_id           TEXT,
  family_role         TEXT,
  engagement_score    INTEGER NOT NULL DEFAULT 60,
  volunteer_skills    TEXT[] NOT NULL DEFAULT '{}',
  spiritual_milestones TEXT[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_members_branch ON members(branch_id);

-- Links a login account to its own member profile for ownership checks.
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_member ON users(member_id) WHERE member_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS transactions (
  id             TEXT PRIMARY KEY,
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  member_id      TEXT REFERENCES members(id) ON DELETE SET NULL,
  member_name    TEXT,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category       TEXT NOT NULL,
  date           DATE NOT NULL,
  payment_method TEXT,
  receipt_number TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_branch ON transactions(branch_id);
CREATE INDEX IF NOT EXISTS idx_tx_member ON transactions(member_id);

CREATE TABLE IF NOT EXISTS collection_sessions (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  session_name    TEXT NOT NULL,
  collection_date DATE NOT NULL,
  offering_amount NUMERIC(12,2) NOT NULL CHECK (offering_amount >= 0),
  tithe_amount    NUMERIC(12,2) NOT NULL CHECK (tithe_amount >= 0),
  other_amount    NUMERIC(12,2) NOT NULL CHECK (other_amount >= 0),
  total_amount    NUMERIC(12,2) GENERATED ALWAYS AS (offering_amount + tithe_amount + other_amount) STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (offering_amount + tithe_amount + other_amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_collection_sessions_branch_date
  ON collection_sessions(branch_id, collection_date DESC);

CREATE TABLE IF NOT EXISTS attendance (
  id           TEXT PRIMARY KEY,
  member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  branch_id    TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  present      BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (member_id, service_date)
);
CREATE INDEX IF NOT EXISTS idx_att_branch ON attendance(branch_id);

CREATE TABLE IF NOT EXISTS attendance_headcounts (
  id           TEXT PRIMARY KEY,
  branch_id    TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  total_present INTEGER NOT NULL CHECK (total_present BETWEEN 0 AND 1000000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, service_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_headcounts_branch_date
  ON attendance_headcounts(branch_id, service_date DESC);

CREATE TABLE IF NOT EXISTS events (
  id                  TEXT PRIMARY KEY,
  branch_id           TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  date                DATE,
  time                TEXT,
  roles_required      TEXT[] NOT NULL DEFAULT '{}',
  volunteers_signed_up TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  schedule    TEXT,
  description TEXT,
  member_ids  TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS followups (
  id         TEXT PRIMARY KEY,
  branch_id  TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  stage      TEXT NOT NULL DEFAULT 'New Guest',
  owner      TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcements (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  audience   TEXT NOT NULL DEFAULT 'all',
  channels   TEXT[] NOT NULL DEFAULT '{}',
  recipients INTEGER NOT NULL DEFAULT 0,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prayer_requests (
  id          TEXT PRIMARY KEY,
  member_id   TEXT,
  member_name TEXT,
  branch_name TEXT,
  text        TEXT NOT NULL,
  category    TEXT,
  route       TEXT,
  status      TEXT NOT NULL DEFAULT 'Assigned',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  goal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Funds banked before this system's transaction history begins. Added to the
  -- summed transactions so a months-long appeal shows its true progress.
  raised_offset NUMERIC(12,2) NOT NULL DEFAULT 0,
  fund_category TEXT,
  branch_id     TEXT REFERENCES branches(id) ON DELETE CASCADE
);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS raised_offset NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Detail captured at registration (agreed 17 Aug 2026): who this person is
-- beyond their contact details.
ALTER TABLE members ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS background     TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS expectations   TEXT;

-- How a member travelled to the service.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS arrival_mode TEXT;

-- One active session per account: every issued token carries the value of this
-- counter, and logging in increments it, so any older token stops validating.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS recurring_gifts (
  id          TEXT PRIMARY KEY,
  member_id   TEXT,
  member_name TEXT,
  branch_id   TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL,
  category    TEXT,
  frequency   TEXT NOT NULL,
  method      TEXT,
  next_date   DATE,
  active      BOOLEAN NOT NULL DEFAULT true
);
