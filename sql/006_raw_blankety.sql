-- Raw Blankety data, as the API returned it. Same shape as the other raw_* tables: one row per source id, a changed
-- payload moves the old version into the *_history table, an id that stops being returned is flagged
-- not_in_latest_pull, never deleted. Submission created_at is in the account's (unnamed) time zone, stored as returned.

-- Forms on the account (each embeds its questions list). source_id = form id. Re-read in full each run.
CREATE TABLE IF NOT EXISTS hp.raw_blankety_forms (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_blankety_forms_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_blankety_forms_history_source_idx ON hp.raw_blankety_forms_history (source_id);

-- Questions per form, as /form/{id}/questions returns them. source_id = "<formId>:<qid>" (question ids are only unique within a form). Re-read in full each run.
CREATE TABLE IF NOT EXISTS hp.raw_blankety_questions (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_blankety_questions_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_blankety_questions_history_source_idx ON hp.raw_blankety_questions_history (source_id);

-- Form submissions, newest first, windowed by created_after. source_id = submission id; answers are keyed by question id. Never flagged missing by an incremental sync.
CREATE TABLE IF NOT EXISTS hp.raw_blankety_submissions (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_blankety_submissions_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_blankety_submissions_history_source_idx ON hp.raw_blankety_submissions_history (source_id);
