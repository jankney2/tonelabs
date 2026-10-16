-- Earlier versions of a Ringsnitch call, kept when a re-pull returns a different payload.
-- Shows a system changing its story over time. Never edited or deleted.
CREATE TABLE IF NOT EXISTS hp.raw_ringsnitch_calls_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,   -- when this version was first seen
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_ringsnitch_calls_history_source_idx ON hp.raw_ringsnitch_calls_history (source_id)
