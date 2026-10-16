-- Reporting views over the identity tables (sql/008). Plain views, so every number is computed when the dashboard asks,
-- from rows the resolver already settled; nothing here is stored. Reads only hp tables.
-- Apply with: npm run db:apply -- sql/009_lost_opportunities.sql

-- One row per real person (robocalls excluded): where they are in the funnel and how the firm treated them.
CREATE OR REPLACE VIEW hp.person_summary AS
WITH lead AS (
  SELECT l.person_id,
    r.source_id AS lead_id,
    (r.payload->'attributes'->>'status_id')::int AS status_id,
    st.payload->'attributes'->>'name' AS status_name,
    st.payload->'attributes'->>'stage' AS status_stage,                 -- open | won | lost
    lower(r.payload->'attributes'->>'lost_reason') AS lost_reason,
    (r.payload->'attributes'->>'estimated_value')::numeric AS estimated_value,
    r.payload->'attributes'->>'source' AS lead_source,
    (r.payload->'attributes'->>'created_at')::timestamptz AS lead_created_at,
    row_number() OVER (PARTITION BY l.person_id ORDER BY (r.payload->'attributes'->>'created_at')::timestamptz DESC) AS rn
  FROM hp.person_links l
  JOIN hp.raw_lawllama_leads r ON l.source_table = 'raw_lawllama_leads' AND l.source_id = r.source_id
  LEFT JOIN hp.raw_lawllama_lead_statuses st ON st.source_id = r.payload->'attributes'->>'status_id'
  WHERE l.person_id IS NOT NULL
),
ev AS (
  SELECT person_id,
    min(occurred_at) AS first_contact_at,
    count(*) FILTER (WHERE source_table = 'raw_jigglewire_call_log' AND kind = 'call_in') AS inbound_calls,
    -- an inbound call nobody at the firm picked up: it rang out, went to voicemail, or was forwarded to the answering service
    count(*) FILTER (WHERE source_table = 'raw_jigglewire_call_log' AND kind = 'call_in' AND handled_by IN ('missed', 'answering_service', 'voicemail')) AS failed_inbound,
    max(occurred_at) FILTER (WHERE source_table = 'raw_jigglewire_call_log' AND kind = 'call_in' AND handled_by IN ('missed', 'answering_service', 'voicemail')) AS last_failed_inbound_at,
    count(*) FILTER (WHERE handled_by = 'employee') AS employee_touches,
    max(occurred_at) FILTER (WHERE handled_by = 'employee') AS last_employee_touch_at,
    count(*) FILTER (WHERE kind = 'call_out') AS outbound_attempts,           -- times an employee dialled them, answered or not
    bool_or(kind = 'voicemail') AS left_voicemail,
    coalesce(sum(amount_usd) FILTER (WHERE kind = 'ad_charge'), 0) AS ad_spend
  FROM hp.contact_events WHERE person_id IS NOT NULL GROUP BY person_id
)
SELECT p.person_id, p.display_name, p.primary_phone, p.stage, p.shared_phone,
  lead.lead_id, lead.status_id, lead.status_name, lead.status_stage, lead.lost_reason, lead.estimated_value, lead.lead_source, lead.lead_created_at,
  ev.first_contact_at, ev.inbound_calls, ev.failed_inbound, ev.last_failed_inbound_at, ev.employee_touches, ev.last_employee_touch_at, coalesce(ev.outbound_attempts, 0) AS outbound_attempts,
  coalesce(ev.left_voicemail, false) AS left_voicemail, coalesce(ev.ad_spend, 0) AS ad_spend
FROM hp.people p
LEFT JOIN ev ON ev.person_id = p.person_id
LEFT JOIN lead ON lead.person_id = p.person_id AND lead.rn = 1
WHERE NOT p.is_automated;

-- People who could have become clients and did not. One row per person, one loss_type:
--   lead_lost         Lawllama says the lead is lost (any lost status: the same reasons appear under all three, so the text is what matters)
--   unreturned_call   called, no one at the firm spoke to them, and no employee has contacted them since the last failed call
--   lead_not_called   an open lead no employee has contacted at all (web form leads, mostly)
-- reason_bucket groups Lawllama's 61 free-text lost reasons; `recoverable` marks the ones the firm's own handling could have changed.
CREATE OR REPLACE VIEW hp.lost_opportunities AS
SELECT * FROM (
  SELECT s.*,
    CASE
      WHEN s.status_stage = 'lost' THEN 'lead_lost'
      WHEN s.failed_inbound > 0 AND s.last_failed_inbound_at > coalesce(s.last_employee_touch_at, '-infinity'::timestamptz) THEN 'unreturned_call'
      WHEN s.status_stage = 'open' AND s.employee_touches = 0 THEN 'lead_not_called'
    END AS loss_type,
    CASE
      WHEN s.status_stage IS DISTINCT FROM 'lost' THEN NULL
      WHEN s.lost_reason ~ '(called them back first|no call back|no response|never reached|vm full|hear back|never picked|ghosted|stopped responding|went quiet|never called back|never got a consult|before we got back|never followed up|next step|phone disconnected)' THEN 'slow_or_unreachable'
      WHEN s.lost_reason ~ '(payment plan|budget|fee too high|too expensive|pro bono|can.t pay|afford|no \$)' THEN 'price'
      WHEN s.lost_reason ~ '(another firm|different firm|hired|another office|signed w|representation|elsewhere|another attorney)' THEN 'went_elsewhere'
      ELSE 'not_a_fit'
    END AS reason_bucket
  FROM hp.person_summary s
  WHERE s.stage <> 'client' AND coalesce(s.status_stage, '') <> 'won'
) x
WHERE loss_type IS NOT NULL;

-- One row per inbound call on the intake phones: who dealt with it and how long until anyone at the firm spoke to the caller.
CREATE OR REPLACE VIEW hp.inbound_calls AS
SELECT e.id AS event_id, e.person_id, e.occurred_at,
  e.occurred_at AT TIME ZONE 'America/Chicago' AS local_time,
  e.office_hours, e.handled_by, e.employee_id, emp.name AS employee_name, e.duration_s,
  (SELECT l.employee_id FROM hp.call_legs l WHERE l.event_id = e.id AND l.ring_order = 1) AS first_rung_employee_id,
  (SELECT min(o.occurred_at) FROM hp.contact_events o
     WHERE o.person_id = e.person_id AND o.handled_by = 'employee' AND o.occurred_at > e.occurred_at) AS next_employee_touch_at
FROM hp.contact_events e
LEFT JOIN hp.employees emp ON emp.employee_id = e.employee_id
WHERE e.source_table = 'raw_jigglewire_call_log' AND e.kind = 'call_in'
