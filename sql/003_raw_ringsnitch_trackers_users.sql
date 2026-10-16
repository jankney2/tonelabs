-- Raw Ringsnitch trackers (tracking numbers) and users (logins), exactly as the API returned them.
-- Small lists, re-pulled in full every run. Same shape as raw_ringsnitch_calls: one row per id,
-- a changed payload moves the old version into the matching *_history table (never edited or deleted),
-- and an id that stops being returned is flagged not_in_latest_pull, never deleted.
CREATE TABLE IF NOT EXISTS hp.raw_ringsnitch_trackers (
  source_id          text PRIMARY KEY,   -- TRK...
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_ringsnitch_trackers_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_ringsnitch_trackers_history_source_idx ON hp.raw_ringsnitch_trackers_history (source_id);

CREATE TABLE IF NOT EXISTS hp.raw_ringsnitch_users (
  source_id          text PRIMARY KEY,   -- USR...
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_ringsnitch_users_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_ringsnitch_users_history_source_idx ON hp.raw_ringsnitch_users_history (source_id)
