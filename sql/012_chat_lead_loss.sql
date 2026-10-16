-- Add loss_type 'chat_lead_unanswered' to hp.lost_opportunities (sql/009).
--   chat_lead_unanswered   a website-chat lead was read out to the answering service (Mostlyanswered "new chat lead" recording)
--                          and no employee has contacted the person since, by phone either way. Checked last, so a person who
--                          already counts as lead_lost / unreturned_call / lead_not_called keeps that type.
-- New columns go at the end (chat_lead_first_at, chat_lead_messages) so the existing column order is unchanged.
-- The lead's number comes from an operator's transcription (link confidence 0.70), see docs/todo.md before quoting a total.
-- Apply with: npm run db:apply -- sql/012_chat_lead_loss.sql
CREATE OR REPLACE VIEW hp.lost_opportunities AS
SELECT * FROM (
  SELECT s.*,
    CASE
      WHEN s.status_stage = 'lost' THEN 'lead_lost'
      WHEN s.failed_inbound > 0 AND s.last_failed_inbound_at > coalesce(s.last_employee_touch_at, '-infinity'::timestamptz) THEN 'unreturned_call'
      WHEN s.status_stage = 'open' AND s.employee_touches = 0 THEN 'lead_not_called'
      WHEN c.first_at IS NOT NULL AND coalesce(s.employee_touches, 0) = 0 AND coalesce(s.outbound_attempts, 0) = 0 THEN 'chat_lead_unanswered'
    END AS loss_type,
    CASE
      WHEN s.status_stage IS DISTINCT FROM 'lost' THEN NULL
      WHEN s.lost_reason ~ '(called them back first|no call back|no response|never reached|vm full|hear back|never picked|ghosted|stopped responding|went quiet|never called back|never got a consult|before we got back|never followed up|next step|phone disconnected)' THEN 'slow_or_unreachable'
      WHEN s.lost_reason ~ '(payment plan|budget|fee too high|too expensive|pro bono|can.t pay|afford|no \$)' THEN 'price'
      WHEN s.lost_reason ~ '(another firm|different firm|hired|another office|signed w|representation|elsewhere|another attorney)' THEN 'went_elsewhere'
      ELSE 'not_a_fit'
    END AS reason_bucket,
    c.first_at AS chat_lead_first_at, c.messages AS chat_lead_messages
  FROM hp.person_summary s
  LEFT JOIN (
    SELECT person_id, min(occurred_at) AS first_at, count(*) AS messages
    FROM hp.contact_events WHERE kind = 'message' AND outcome = 'chat_lead_recording' AND person_id IS NOT NULL GROUP BY person_id
  ) c ON c.person_id = s.person_id
  WHERE s.stage <> 'client' AND coalesce(s.status_stage, '') <> 'won'
) x
WHERE loss_type IS NOT NULL;
