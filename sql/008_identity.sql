-- Identity: one row per person (by phone), links from every source record to that person, the employees who
-- handle calls, and one reconciled event timeline. Built by src/identity/resolve.js; raw_* tables are never touched.
-- Cross-source links use a soft key (source_table, source_id) because one foreign key cannot point at many raw tables.
-- Apply with: npm run db:apply -- sql/008_identity.sql

-- One row per real person, keyed by normalised phone (E.164). Phone-only for now.
CREATE TABLE IF NOT EXISTS hp.people (
  person_id        bigserial PRIMARY KEY,
  primary_phone    text NOT NULL UNIQUE,
  display_name     text,                              -- best name seen (see resolve.js for the order)
  stage            text NOT NULL DEFAULT 'caller',    -- caller | lead | client
  first_contact_at timestamptz,
  last_contact_at  timestamptz,
  is_automated     boolean NOT NULL DEFAULT false,    -- robocall / automated message, not a person
  shared_phone     boolean NOT NULL DEFAULT false,    -- several different names use this number
  created_at       timestamptz NOT NULL DEFAULT now(),
  modified_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS people_stage_idx ON hp.people (stage);

-- Why each source record belongs to a person. person_id is null when the record has no usable phone.
CREATE TABLE IF NOT EXISTS hp.person_links (
  id           bigserial PRIMARY KEY,
  source_table text NOT NULL,                         -- e.g. raw_jigglewire_call_log
  source_id    text NOT NULL,
  person_id    bigint REFERENCES hp.people (person_id),
  method       text NOT NULL,                         -- phone | none
  confidence   numeric(3,2) NOT NULL,
  reason       text NOT NULL,
  name_seen    text,                                  -- name as this record spelled it
  name_key     text,                                  -- same name with word order and case removed, for comparing
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id)
);

CREATE INDEX IF NOT EXISTS person_links_person_idx ON hp.person_links (person_id);

-- Things a human should look at instead of us guessing. dedupe_key keeps re-runs from adding the same row twice.
CREATE TABLE IF NOT EXISTS hp.match_review (
  id          bigserial PRIMARY KEY,
  dedupe_key  text NOT NULL UNIQUE,
  kind        text NOT NULL,                          -- shared_phone | automated_caller | no_valid_phone
  person_id   bigint REFERENCES hp.people (person_id),
  phone       text,
  evidence    jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The firm's own people (copied from the read-only staff table by the job).
CREATE TABLE IF NOT EXISTS hp.employees (
  employee_id bigserial PRIMARY KEY,
  name        text NOT NULL,
  role        text,
  email       text UNIQUE,
  is_intake   boolean NOT NULL DEFAULT false,         -- takes intake calls (Marcus, Devin, Katherine, Rosa)
  schedule    text
);

-- How each system names an employee: jigglewire_ext, talkegg_box, lawllama_user, email.
CREATE TABLE IF NOT EXISTS hp.employee_identifiers (
  id          bigserial PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES hp.employees (employee_id),
  system      text NOT NULL,
  external_id  text NOT NULL,
  UNIQUE (system, external_id)
);

-- One row per call, voicemail, form, lead, matter or ad charge, in one shape.
CREATE TABLE IF NOT EXISTS hp.contact_events (
  id           bigserial PRIMARY KEY,
  source_table text NOT NULL,
  source_id    text NOT NULL,
  person_id    bigint REFERENCES hp.people (person_id),
  employee_id  bigint REFERENCES hp.employees (employee_id),   -- who took (or made) the call; null = nobody / unknown
  kind         text NOT NULL,                         -- call_in | call_out | voicemail | form | lead_created | matter_opened | ad_charge
  occurred_at  timestamptz NOT NULL,
  answered     boolean,                               -- the source says the call connected to someone
  handled_by   text,                                  -- employee | answering_service | voicemail | missed | no_answer (calls only)
  outcome      text,                                  -- source wording, e.g. Accepted, Missed, Voicemail
  duration_s   integer,
  channel      text,                                  -- ad / lead source as the source calls it
  office_hours boolean NOT NULL,                      -- Mon-Fri 8-6 Chicago
  amount_usd   numeric,                               -- ad charge or estimated case value
  UNIQUE (source_table, source_id)
);

CREATE INDEX IF NOT EXISTS contact_events_person_idx ON hp.contact_events (person_id, occurred_at);

CREATE INDEX IF NOT EXISTS contact_events_employee_idx ON hp.contact_events (employee_id, occurred_at);

CREATE INDEX IF NOT EXISTS contact_events_kind_idx ON hp.contact_events (kind, occurred_at);

-- Who a call rang, in order. A missed call has a leg per person it rang, so we can say who missed it.
CREATE TABLE IF NOT EXISTS hp.call_legs (
  id          bigserial PRIMARY KEY,
  event_id    bigint NOT NULL REFERENCES hp.contact_events (id),
  ring_order  integer NOT NULL,
  employee_id bigint REFERENCES hp.employees (employee_id),
  extension   text,
  result      text,
  duration_s  integer,
  UNIQUE (event_id, ring_order)
);

CREATE INDEX IF NOT EXISTS call_legs_employee_idx ON hp.call_legs (employee_id);

-- When the job last ran and what it did, for the dashboard's "data as of" line.
CREATE TABLE IF NOT EXISTS hp.identity_runs (
  id          bigserial PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text NOT NULL DEFAULT 'running',
  stats       jsonb
)
