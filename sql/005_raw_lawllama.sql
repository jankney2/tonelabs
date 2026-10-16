-- Raw Lawllama data, as the API returned it, with one deliberate exception: contact SSN, date_of_birth and
-- immigration_status are stripped before landing (src/integrations/lawllama/redact.js) and never stored.
-- Same shape as the raw_jigglewire_* tables: one row per source id, a changed payload moves the old version into
-- the *_history table, an id that stops being returned is flagged not_in_latest_pull, never deleted.

-- Leads, most recently updated first, windowed by updated_since. source_id = lead id. Never flagged missing by an incremental sync.
CREATE TABLE IF NOT EXISTS hp.raw_lawllama_leads (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_lawllama_leads_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_lawllama_leads_history_source_idx ON hp.raw_lawllama_leads_history (source_id);

-- Contacts, only available through include=contact on the leads list (no list endpoint). source_id = contact id. SSN, date of birth and immigration status are REMOVED before landing (see redact.js); they are never stored.
CREATE TABLE IF NOT EXISTS hp.raw_lawllama_contacts (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_lawllama_contacts_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_lawllama_contacts_history_source_idx ON hp.raw_lawllama_contacts_history (source_id);

-- The 7 lead statuses. source_id = status id. Re-read in full each run.
CREATE TABLE IF NOT EXISTS hp.raw_lawllama_lead_statuses (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_lawllama_lead_statuses_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_lawllama_lead_statuses_history_source_idx ON hp.raw_lawllama_lead_statuses_history (source_id);

-- Intake users on the account. source_id = user id. Re-read in full each run.
CREATE TABLE IF NOT EXISTS hp.raw_lawllama_users (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_lawllama_users_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_lawllama_users_history_source_idx ON hp.raw_lawllama_users_history (source_id);
