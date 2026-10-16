-- Raw Jigglewire data, exactly as the API returned it. Same shape as the raw_ringsnitch_* tables:
-- one row per source id, a changed payload moves the old version into the *_history table (never edited
-- or deleted), and an id that stops being returned is flagged not_in_latest_pull, never deleted.

-- Company call log (view=Detailed, so each call carries its legs). source_id = call id (JICAL...). Pulled by date window; never flagged missing.
CREATE TABLE IF NOT EXISTS hp.raw_jigglewire_call_log (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_jigglewire_call_log_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_jigglewire_call_log_history_source_idx ON hp.raw_jigglewire_call_log_history (source_id);

-- Users and the Intake department on the account. source_id = extension id. Re-read in full each run.
CREATE TABLE IF NOT EXISTS hp.raw_jigglewire_extensions (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_jigglewire_extensions_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_jigglewire_extensions_history_source_idx ON hp.raw_jigglewire_extensions_history (source_id);

-- Voicemail from every extension's message store (the shared Intake mailbox is extension 200). source_id = message id (VMC...). Pulled by date window.
CREATE TABLE IF NOT EXISTS hp.raw_jigglewire_voicemails (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_jigglewire_voicemails_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_jigglewire_voicemails_history_source_idx ON hp.raw_jigglewire_voicemails_history (source_id);

-- Per queue member: whether they take queue calls right now. source_id = "<queue id>:<member id>". The payload has no queue id, so it lives only in source_id. A changed setting lands in the history table, which is how we see when someone opted out of the queue.
CREATE TABLE IF NOT EXISTS hp.raw_jigglewire_queue_presence (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_jigglewire_queue_presence_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_jigglewire_queue_presence_history_source_idx ON hp.raw_jigglewire_queue_presence_history (source_id)
