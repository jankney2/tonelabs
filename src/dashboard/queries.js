// SQL behind the dashboard endpoints. Read-only, over the views in sql/009-012; values are always bound parameters.
// Every range is in Chicago calendar days: `col AT TIME ZONE 'America/Chicago'` is the local clock time, and the range is
// [from, to + 1 day), so the last day is included whole.
// A row is described above each query. Counts come back from Postgres as strings, so `num` converts them.

const CHI = `'America/Chicago'`;
const num = (v) => (v === null || v === undefined ? null : Number(v));
const run = (sql, text, values) => sql.query(text, values);

/** Calls whose local time falls in [$1, $2], and (with $3) in / out of office hours. `t` is the table alias. */
const callRange = (t, ts = `${t}.local_time`) => `${ts} >= $1::date AND ${ts} < $2::date + 1 AND ($3::text = 'any' OR ($3::text = 'in') = ${t}.office_hours)`;

/** Filter lists for the filter bar, plus when the data was last rebuilt. */
export async function getFilters(sql) {
  const [employees, sources, run_] = await Promise.all([
    run(sql, `SELECT employee_id, name, role, is_intake FROM hp.employees ORDER BY is_intake DESC, name`, []),
    run(sql, `SELECT DISTINCT coalesce(lead_source, 'No lead') AS source FROM hp.person_summary ORDER BY 1`, []),
    run(sql, `SELECT (SELECT max(finished_at) FROM hp.identity_runs WHERE status = 'ok') AS rebuilt_at,
                     (SELECT max(occurred_at) FROM hp.contact_events) AS newest_event_at`, []),
  ]);
  return {
    employees: employees.map((e) => ({ id: num(e.employee_id), name: e.name, role: e.role, isIntake: e.is_intake })),
    sources: sources.map((s) => s.source),
    dataAsOf: { rebuiltAt: run_[0].rebuilt_at, newestEventAt: run_[0].newest_event_at },
  };
}

/**
 * One row = one inbound call on the intake phones (hp.inbound_calls). Answered = an employee spoke to the caller;
 * the rest went to the answering service, rang out (missed) or reached voicemail.
 */
export async function getCallTotals(sql, p) {
  const [r] = await run(sql, `
    SELECT count(*) AS inbound,
      count(*) FILTER (WHERE i.handled_by = 'employee') AS answered,
      count(*) FILTER (WHERE i.handled_by = 'answering_service') AS answering_service,
      count(*) FILTER (WHERE i.handled_by = 'missed') AS missed,
      count(*) FILTER (WHERE i.handled_by = 'voicemail') AS voicemail,
      count(*) FILTER (WHERE i.handled_by <> 'employee' AND i.office_hours) AS failed_in_hours
    FROM hp.inbound_calls i WHERE ${callRange('i')}`, [p.from, p.to, p.hours]);
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)]));
}

// Leads created in the range ($1-$2) that match the stage ($3) and source ($4) filters. The funnel and its drill-down share it.
const LEADS_IN_RANGE = `lead_id IS NOT NULL
  AND (lead_created_at AT TIME ZONE ${CHI}) >= $1::date AND (lead_created_at AT TIME ZONE ${CHI}) < $2::date + 1
  AND ($3::text IS NULL OR stage = $3) AND ($4::text IS NULL OR coalesce(lead_source, 'No lead') = $4)`;
const CONTACTED = `(employee_touches > 0 OR outbound_attempts > 0)`;

/**
 * One row = one lead created in the range (hp.person_summary, newest Lawllama lead per person).
 * Contacted = an employee has handled a call with them or dialled them; retained = Lawllama status is a "won" one.
 */
export async function getFunnel(sql, p) {
  const [r] = await run(sql, `
    SELECT count(*) AS leads,
      count(*) FILTER (WHERE ${CONTACTED}) AS contacted,
      count(*) FILTER (WHERE status_stage = 'won') AS retained,
      coalesce(sum(estimated_value), 0) AS lead_value,
      coalesce(sum(estimated_value) FILTER (WHERE status_stage = 'won'), 0) AS retained_value
    FROM hp.person_summary
    WHERE ${LEADS_IN_RANGE}`, [p.from, p.to, p.stage, p.source]);
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)]));
}

// hp.lost_opportunities with the date that places each person in a period: when the failed call happened, when the chat
// lead was first read out, or (for lost and never-called leads) when the lead was created. Lawllama does not say when a
// lead was marked lost, so lead_lost people are dated by creation.
const LOST = `
  WITH lost AS (
    SELECT lo.*, CASE lo.loss_type WHEN 'unreturned_call' THEN lo.last_failed_inbound_at
      WHEN 'chat_lead_unanswered' THEN lo.chat_lead_first_at ELSE lo.lead_created_at END AS event_at
    FROM hp.lost_opportunities lo)
  SELECT * FROM lost WHERE (event_at AT TIME ZONE ${CHI}) >= $1::date AND (event_at AT TIME ZONE ${CHI}) < $2::date + 1
    AND ($3::text IS NULL OR stage = $3) AND ($4::text IS NULL OR coalesce(lead_source, 'No lead') = $4) AND ($5::text IS NULL OR loss_type = $5)
    AND ($6::text IS NULL OR reason_bucket = $6)`;
const lostArgs = (p) => [p.from, p.to, p.stage, p.source, p.lossType, p.reason];

/**
 * One row = one person who could have become a client and did not (hp.lost_opportunities has one row per person).
 * Returns the totals by loss type, by Lawllama's lost reason (lead_lost only) and by lead source.
 */
export async function getLostSummary(sql, p) {
  const [byType, byReason, bySource] = await Promise.all([
    run(sql, `WITH x AS (${LOST}) SELECT loss_type, count(*) AS people, coalesce(sum(estimated_value), 0) AS est_value FROM x GROUP BY 1 ORDER BY 2 DESC`, lostArgs(p)),
    run(sql, `WITH x AS (${LOST}) SELECT reason_bucket, count(*) AS people, coalesce(sum(estimated_value), 0) AS est_value FROM x WHERE reason_bucket IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`, lostArgs(p)),
    run(sql, `WITH x AS (${LOST}) SELECT coalesce(lead_source, 'No lead') AS source, count(*) AS people, coalesce(sum(estimated_value), 0) AS est_value,
        count(*) FILTER (WHERE loss_type = 'lead_lost') AS lead_lost, count(*) FILTER (WHERE loss_type = 'unreturned_call') AS unreturned_call,
        count(*) FILTER (WHERE loss_type = 'lead_not_called') AS lead_not_called, count(*) FILTER (WHERE loss_type = 'chat_lead_unanswered') AS chat_lead_unanswered
      FROM x GROUP BY 1 ORDER BY 2 DESC`, lostArgs(p)),
  ]);
  const clean = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, /^(people|est_value|lead_lost|unreturned_call|lead_not_called|chat_lead_unanswered)$/.test(k) ? num(v) : v])));
  return { byType: clean(byType), byReason: clean(byReason), bySource: clean(bySource) };
}

/**
 * The call-back list: people the firm can still reach. Without a loss_type filter it leaves out lead_lost (those are
 * already decided). Newest first, because a caller from yesterday is recoverable and one from last month mostly is not.
 */
export async function getLostPeople(sql, p, limit = 100) {
  return (await lostList(sql, p, limit, true)).rows;
}

/**
 * Drill-down behind a lost-opportunity number: the same people, including lead_lost, with the total before the row cap.
 */
export const getLostDrill = (sql, p, limit = 200) => lostList(sql, p, limit, false);

async function lostList(sql, p, limit, hideLeadLost) {
  const rows = await run(sql, `WITH x AS (${LOST}) SELECT person_id, display_name, primary_phone, loss_type, coalesce(lead_source, 'No lead') AS source,
      status_name, reason_bucket, estimated_value, failed_inbound, shared_phone, event_at,
      extract(epoch FROM (now() - event_at)) / 3600 AS hours_waiting, count(*) OVER () AS total
    FROM x WHERE (NOT $7::boolean OR $5::text IS NOT NULL OR loss_type <> 'lead_lost') ORDER BY event_at DESC LIMIT ${Number(limit)}`, [...lostArgs(p), hideLeadLost]);
  const clean = rows.map(({ total, ...r }) => ({ ...r, person_id: num(r.person_id), estimated_value: num(r.estimated_value), failed_inbound: num(r.failed_inbound), hours_waiting: Math.round(num(r.hours_waiting)) }));
  return { total: num(rows[0]?.total) ?? 0, rows: clean };
}

/**
 * Drill-down behind a funnel bar: one row = one lead created in the range, narrowed by `step`
 * (leads = all, contacted = an employee has reached them, retained = Lawllama "won"). Newest lead first.
 */
export async function getLeadDrill(sql, p, limit = 200) {
  const rows = await run(sql, `
    SELECT person_id, display_name, primary_phone, coalesce(lead_source, 'No lead') AS source, status_name, estimated_value,
      lead_created_at, employee_touches, outbound_attempts, count(*) OVER () AS total
    FROM hp.person_summary
    WHERE ${LEADS_IN_RANGE}
      AND ($5::text IS NULL OR $5::text = 'leads' OR ($5::text = 'contacted' AND ${CONTACTED}) OR ($5::text = 'retained' AND status_stage = 'won'))
    ORDER BY lead_created_at DESC LIMIT ${Number(limit)}`, [p.from, p.to, p.stage, p.source, p.step]);
  return {
    total: num(rows[0]?.total) ?? 0,
    rows: rows.map(({ total, ...r }) => ({ ...r, person_id: num(r.person_id), estimated_value: num(r.estimated_value), employee_touches: num(r.employee_touches), outbound_attempts: num(r.outbound_attempts) })),
  };
}

/**
 * Drill-down behind a call number: one row = one inbound call (hp.inbound_calls), newest first, with the caller when we know who.
 * Filters: handled_by (failed = anything but an employee), heatmap slot (dow, hour), and an employee whose phone was rung
 * (narrowed to the legs they accepted or missed by `legResult`). Same date and hours rule as the call totals.
 */
export async function getCallDrill(sql, p, limit = 200) {
  const rows = await run(sql, `
    SELECT i.event_id, i.person_id, pe.display_name, pe.primary_phone, i.occurred_at, i.office_hours, i.handled_by, i.employee_name, i.duration_s,
      count(*) OVER () AS total
    FROM hp.inbound_calls i LEFT JOIN hp.people pe ON pe.person_id = i.person_id
    WHERE ${callRange('i')}
      AND ($4::text IS NULL OR CASE $4 WHEN 'failed' THEN i.handled_by <> 'employee' ELSE i.handled_by = $4 END)
      AND ($5::int IS NULL OR extract(dow FROM i.local_time) = $5) AND ($6::int IS NULL OR extract(hour FROM i.local_time) = $6)
      AND ($7::int[] IS NULL OR EXISTS (SELECT 1 FROM hp.call_legs l WHERE l.event_id = i.event_id AND l.employee_id = ANY($7::int[])
            AND ($8::text IS NULL OR l.result = $8)))
    ORDER BY i.occurred_at DESC LIMIT ${Number(limit)}`, [p.from, p.to, p.hours, p.handledBy, p.dow, p.hour, p.employees, p.legResult]);
  return {
    total: num(rows[0]?.total) ?? 0,
    rows: rows.map(({ total, ...r }) => ({ ...r, event_id: num(r.event_id), person_id: num(r.person_id), duration_s: num(r.duration_s) })),
  };
}

/**
 * One row = one intake employee, over inbound calls in the range (hp.inbound_calls + hp.call_legs) and their outbound calls.
 *   rung / accepted / missed   legs: each time the phone system rang this person, and what they did
 *   first_rung                 calls that rang them first (ring order is set by ops.staff.ring_order)
 *   answered / talk_minutes    inbound calls they spoke on
 *   outbound / connected       calls they dialled, and how many connected
 *   callbacks / within_24h     failed inbound calls (answering service, missed, voicemail) where this person was the first
 *                              employee to call or speak to that caller afterwards, and how many of those were within 24 hours
 */
export async function getEmployees(sql, p) {
  const rows = await run(sql, `
    WITH calls AS (SELECT i.* FROM hp.inbound_calls i WHERE ${callRange('i')}),
    legs AS (
      SELECT l.employee_id, count(*) AS rung, count(*) FILTER (WHERE l.result = 'Accepted') AS accepted,
        count(*) FILTER (WHERE l.result = 'Missed') AS missed, count(*) FILTER (WHERE l.ring_order = 1) AS first_rung,
        count(*) FILTER (WHERE l.ring_order = 1 AND l.result = 'Accepted') AS first_rung_accepted
      FROM hp.call_legs l JOIN calls c ON c.event_id = l.event_id WHERE l.employee_id IS NOT NULL GROUP BY 1),
    inbound AS (SELECT employee_id, count(*) AS answered, coalesce(sum(duration_s), 0) / 60.0 AS talk_minutes FROM calls WHERE handled_by = 'employee' GROUP BY 1),
    outb AS (
      SELECT e.employee_id, count(*) AS outbound, count(*) FILTER (WHERE e.answered) AS connected
      FROM hp.contact_events e WHERE e.kind = 'call_out' AND e.employee_id IS NOT NULL
        AND ${callRange('e', `(e.occurred_at AT TIME ZONE ${CHI})`)} GROUP BY 1),
    recov AS (
      SELECT t.employee_id, count(*) AS callbacks, count(*) FILTER (WHERE t.hours <= 24) AS within_24h,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY t.hours) AS median_hours
      FROM (SELECT nxt.employee_id, extract(epoch FROM (nxt.occurred_at - c.occurred_at)) / 3600 AS hours
            FROM calls c JOIN LATERAL (
              SELECT e.employee_id, e.occurred_at FROM hp.contact_events e
              WHERE e.person_id = c.person_id AND e.occurred_at > c.occurred_at AND e.employee_id IS NOT NULL
                AND (e.kind = 'call_out' OR e.handled_by = 'employee') ORDER BY e.occurred_at LIMIT 1) nxt ON true
            WHERE c.handled_by <> 'employee' AND c.person_id IS NOT NULL) t GROUP BY 1)
    SELECT emp.employee_id, emp.name, emp.role, coalesce(legs.rung, 0) AS rung, coalesce(legs.accepted, 0) AS accepted, coalesce(legs.missed, 0) AS missed,
      coalesce(legs.first_rung, 0) AS first_rung, coalesce(legs.first_rung_accepted, 0) AS first_rung_accepted,
      coalesce(inbound.answered, 0) AS answered, round(coalesce(inbound.talk_minutes, 0)) AS talk_minutes,
      coalesce(outb.outbound, 0) AS outbound, coalesce(outb.connected, 0) AS connected,
      coalesce(recov.callbacks, 0) AS callbacks, coalesce(recov.within_24h, 0) AS within_24h, round(recov.median_hours::numeric, 1) AS median_hours
    FROM hp.employees emp
    LEFT JOIN legs USING (employee_id) LEFT JOIN inbound USING (employee_id) LEFT JOIN outb USING (employee_id) LEFT JOIN recov USING (employee_id)
    WHERE emp.is_intake AND ($4::int[] IS NULL OR emp.employee_id = ANY($4::int[]))
    ORDER BY emp.name`, [p.from, p.to, p.hours, p.employees]);
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'name' || k === 'role' ? v : num(v)])));
}

/**
 * One row = one weekday/hour slot (Chicago time) with the inbound calls that came in then (hp.inbound_calls).
 * `failed` = no person at the firm spoke to the caller (answering service, rang out, voicemail). dow: 0 = Sunday.
 */
export async function getCallHeatmap(sql, p) {
  const rows = await run(sql, `
    SELECT extract(dow FROM i.local_time)::int AS dow, extract(hour FROM i.local_time)::int AS hour,
      count(*) AS inbound, count(*) FILTER (WHERE i.handled_by <> 'employee') AS failed
    FROM hp.inbound_calls i WHERE ${callRange('i')} GROUP BY 1, 2 ORDER BY 1, 2`, [p.from, p.to, p.hours]);
  return rows.map((r) => ({ dow: num(r.dow), hour: num(r.hour), inbound: num(r.inbound), failed: num(r.failed) }));
}

/**
 * One person across every system: who they are, each contact event (hp.contact_events, newest first, 300 max) and
 * why each source record was attached to them (hp.person_links: method, confidence, reason). Raw payloads are not returned.
 * Returns null when the id does not exist.
 */
export async function getPersonTimeline(sql, id) {
  const [person] = await run(sql, `SELECT person_id, display_name, primary_phone, stage, first_contact_at, last_contact_at, is_automated, shared_phone
    FROM hp.people WHERE person_id = $1`, [id]);
  if (!person) return null;
  const [events, links] = await Promise.all([
    run(sql, `SELECT e.occurred_at, e.kind, e.source_table, e.outcome, e.handled_by, e.answered, e.duration_s, e.channel, e.office_hours, e.amount_usd, emp.name AS employee
      FROM hp.contact_events e LEFT JOIN hp.employees emp ON emp.employee_id = e.employee_id
      WHERE e.person_id = $1 ORDER BY e.occurred_at DESC LIMIT 300`, [id]),
    run(sql, `SELECT source_table, method, confidence, reason, name_seen FROM hp.person_links WHERE person_id = $1 ORDER BY source_table, id LIMIT 300`, [id]),
  ]);
  return {
    person: { ...person, person_id: num(person.person_id) },
    events: events.map((e) => ({ ...e, duration_s: num(e.duration_s), amount_usd: num(e.amount_usd) })),
    links: links.map((l) => ({ ...l, confidence: num(l.confidence) })),
  };
}
