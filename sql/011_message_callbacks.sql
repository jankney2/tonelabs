-- Answering-service messages and what the firm did next. One row per message that expects a callback
-- (new matter, existing client, or a robot-read "new chat lead"): the person, when the callback was due, and the first
-- time an employee then tried to reach them (any outbound call, or any inbound call an employee handled).
-- This is the person-to-employee link for messages: the service's operators are not firm staff, so the employee in
-- question is whoever acted afterwards. Hours are elapsed time; the 24 hours is the service's own promise (Promised column).
-- The first lead of a repeated chat-lead recording is the row to count; repeats within 30 minutes carry repeat_of_earlier = true.
-- Apply with: npm run db:apply -- sql/011_message_callbacks.sql
CREATE OR REPLACE VIEW hp.message_callbacks AS
SELECT m.id AS event_id, m.person_id, p.display_name, p.primary_phone, p.stage,
  m.outcome AS message_type, m.occurred_at AS message_at, m.office_hours,
  m.occurred_at + interval '24 hours' AS callback_due_at,
  nxt.occurred_at AS first_employee_attempt_at, nxt.employee_id, emp.name AS employee_name, nxt.kind AS attempt_kind,
  extract(epoch FROM (nxt.occurred_at - m.occurred_at)) / 3600 AS hours_to_attempt,
  coalesce(nxt.occurred_at <= m.occurred_at + interval '24 hours', false) AS kept_within_24h,
  EXISTS (SELECT 1 FROM hp.contact_events r WHERE r.person_id = m.person_id AND r.kind = 'message'
    AND r.id <> m.id AND r.outcome = m.outcome AND r.occurred_at < m.occurred_at AND r.occurred_at > m.occurred_at - interval '30 minutes') AS repeat_of_earlier
FROM hp.contact_events m
JOIN hp.people p ON p.person_id = m.person_id
LEFT JOIN LATERAL (
  SELECT e.occurred_at, e.employee_id, e.kind FROM hp.contact_events e
  WHERE e.person_id = m.person_id AND e.occurred_at > m.occurred_at AND e.employee_id IS NOT NULL
    AND (e.kind = 'call_out' OR e.handled_by = 'employee')
  ORDER BY e.occurred_at LIMIT 1) nxt ON true
LEFT JOIN hp.employees emp ON emp.employee_id = nxt.employee_id
WHERE m.kind = 'message' AND m.outcome IN ('new_matter', 'existing_client', 'chat_lead_recording') AND NOT p.is_automated;
