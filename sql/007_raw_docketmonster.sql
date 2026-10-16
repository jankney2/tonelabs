-- Raw Docketmonster data, as the SOAP service returned it. Same shape as the other raw_* tables: one row per source id,
-- a changed payload moves the old version into the *_history table, an id that stops being returned is flagged
-- not_in_latest_pull, never deleted.

-- Matters (a case, after signing). source_id = MatterNumber (e.g. HP-2026-1035). payload = the Matter's child elements as
-- strings (ClientName, ClientPhone, PracticeArea, MatterDescription, OpenedDate [firm local time, no zone], EstimatedFee,
-- ReferralSource, Status). Never flagged missing by an incremental sync.
CREATE TABLE IF NOT EXISTS hp.raw_docketmonster_matters (
  source_id          text PRIMARY KEY,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  not_in_latest_pull boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hp.raw_docketmonster_matters_history (
  id            bigserial PRIMARY KEY,
  source_id     text NOT NULL,
  payload       jsonb NOT NULL,
  content_hash  text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_docketmonster_matters_history_source_idx ON hp.raw_docketmonster_matters_history (source_id);
