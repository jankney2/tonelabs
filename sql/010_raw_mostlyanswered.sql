-- Raw Mostlyanswered data (the answering service). Same shape as the other raw_* tables: one row per source id, a changed
-- payload moves the old version into the *_history table, an id that stops being returned is flagged not_in_latest_pull,
-- never deleted. Message times are the service's own local time, written as returned ("8/21/26 11:00 AM", no zone).

-- The daily files in the directory listing. source_id = file name (Harlow_Pike_Messages_YYYY-MM-DD.csv). Re-read in full each run.
CREATE TABLE IF NOT EXISTS hp.raw_mostlyanswered_files (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_mostlyanswered_files_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_mostlyanswered_files_history_source_idx ON hp.raw_mostlyanswered_files_history (source_id);

-- One row per message line in the daily CSVs. The rows carry no id, so source_id = "<file name>:<data row number>" (1-based).
-- Payload = the six CSV columns as strings plus `file` and `line`.
CREATE TABLE IF NOT EXISTS hp.raw_mostlyanswered_messages (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_mostlyanswered_messages_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_mostlyanswered_messages_history_source_idx ON hp.raw_mostlyanswered_messages_history (source_id);
