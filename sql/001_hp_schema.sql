-- Our own data lives in schema `hp`. Never touches `ops` (firm data, read-only).
-- Statements are separated by ";" at end of line; apply with: npm run db:apply -- sql/001_hp_schema.sql
CREATE SCHEMA IF NOT EXISTS hp;

-- Audit trail of every call we make to an external system, plus run start/finish markers.
CREATE TABLE IF NOT EXISTS hp.integration_logs (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL,            -- e.g. 'ringsnitch'
  run_id      uuid,                     -- groups the rows of one pull
  event       text NOT NULL,            -- 'run_start' | 'request' | 'error' | 'run_end'
  method      text,
  path        text,                     -- credentials removed
  status      integer,                  -- HTTP status
  duration_ms integer,
  message     text,
  details     jsonb
);

CREATE INDEX IF NOT EXISTS integration_logs_source_created_idx ON hp.integration_logs (source, created_at DESC);

CREATE INDEX IF NOT EXISTS integration_logs_run_idx ON hp.integration_logs (run_id);

-- Raw Ringsnitch calls, exactly as the API returned them. One row per call id.
-- Re-pulls update last_seen_at; a changed payload (different content_hash) is a change worth keeping history for.
CREATE TABLE IF NOT EXISTS hp.raw_ringsnitch_calls (
  source_id            text PRIMARY KEY,   -- CAL...
  payload              jsonb NOT NULL,
  content_hash         text NOT NULL,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull   boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS raw_ringsnitch_calls_start_idx ON hp.raw_ringsnitch_calls ((payload->>'start_time'))
