// What identity resolution reads from each source. One entry per record type: a query for records not yet linked
// (anti-join on hp.person_links) and a mapper to the common event shape. Raw payloads are read, never changed.
//   table  = the source_table name stored in person_links / contact_events
//   query  = SQL returning source_id, phone, name, occurred_at (text) and anything `map` needs; {LIMIT} is filled in
//   map    = row -> { kind, direction?, answered, outcome, durationS, channel, amountUsd, employeeId, legs }
import { callEmployee, callLegs, handledBy, isAnsweredResult } from './rules.js';

const unlinked = (table) => `LEFT JOIN hp.person_links l ON l.source_table = '${table}' AND l.source_id = r.source_id WHERE l.id IS NULL`;

export const SOURCES = [
  {
    table: 'raw_ringsnitch_calls',
    query: `SELECT r.source_id, r.payload->>'customer_phone_number' AS phone, r.payload->>'customer_name' AS name,
      r.payload->>'start_time' AS occurred_at, r.payload->>'direction' AS direction, r.payload->>'answered' AS answered,
      r.payload->>'duration' AS duration_s, r.payload->>'source' AS channel, r.payload->>'voicemail' AS voicemail
      FROM hp.raw_ringsnitch_calls r ${unlinked('raw_ringsnitch_calls')} ORDER BY r.source_id LIMIT {LIMIT}`,
    // Ringsnitch has no user field, so no employee. "answered" is the tracking number's view (it connected), not Jigglewire's.
    map: (r) => ({
      kind: r.direction === 'outbound' ? 'call_out' : 'call_in',
      answered: r.answered === 'true',
      outcome: r.voicemail === 'true' ? 'voicemail' : r.answered === 'true' ? 'answered' : 'unanswered',
      durationS: r.duration_s === null ? null : Number(r.duration_s),
      channel: r.channel,
    }),
  },
  {
    table: 'raw_jigglewire_call_log',
    // The customer is the far end: the caller on inbound calls, the number dialled on outbound ones.
    query: `SELECT r.source_id, r.payload,
      CASE WHEN r.payload->>'direction' = 'Inbound' THEN r.payload->'from'->>'phoneNumber' ELSE r.payload->'to'->>'phoneNumber' END AS phone,
      CASE WHEN r.payload->>'direction' = 'Inbound' THEN r.payload->'from'->>'name' ELSE r.payload->'to'->>'name' END AS name,
      r.payload->>'startTime' AS occurred_at
      FROM hp.raw_jigglewire_call_log r ${unlinked('raw_jigglewire_call_log')} ORDER BY r.source_id LIMIT {LIMIT}`,
    map: (r, { employeeFor }) => {
      const p = r.payload;
      const employeeId = callEmployee(p, employeeFor);
      return {
        kind: p.direction === 'Outbound' ? 'call_out' : 'call_in',
        answered: isAnsweredResult(p.result),
        outcome: p.result,
        durationS: p.duration ?? null,
        channel: null,
        employeeId,
        handledBy: handledBy(p, employeeId),
        legs: callLegs(p, employeeFor),
      };
    },
  },
  {
    // The same 36 calls also appear in the call log with result "Voicemail"; this row adds the message itself. Count calls from the call log.
    table: 'raw_jigglewire_voicemails',
    query: `SELECT r.source_id, r.payload->'from'->>'phoneNumber' AS phone, r.payload->'from'->>'name' AS name,
      r.payload->>'creationTime' AS occurred_at, r.payload->>'vmDuration' AS duration_s, r.payload->>'readStatus' AS read_status
      FROM hp.raw_jigglewire_voicemails r ${unlinked('raw_jigglewire_voicemails')} ORDER BY r.source_id LIMIT {LIMIT}`,
    map: (r) => ({ kind: 'voicemail', answered: false, outcome: r.read_status, durationS: r.duration_s === null ? null : Number(r.duration_s) }),
  },
  {
    table: 'raw_lawllama_leads',
    query: `SELECT r.source_id, c.payload->'attributes'->>'phone' AS phone,
      concat_ws(' ', c.payload->'attributes'->>'first_name', c.payload->'attributes'->>'last_name') AS name,
      r.payload->'attributes'->>'created_at' AS occurred_at, r.payload->'attributes'->>'source' AS channel,
      r.payload->'attributes'->>'estimated_value' AS amount
      FROM hp.raw_lawllama_leads r
      LEFT JOIN hp.raw_lawllama_contacts c ON c.source_id = r.payload->'relationships'->'contact'->'data'->>'id'
      LEFT JOIN hp.person_links l ON l.source_table = 'raw_lawllama_leads' AND l.source_id = r.source_id
      WHERE l.id IS NULL ORDER BY r.source_id LIMIT {LIMIT}`,
    // Outcome is read live from the raw lead (status_id) when reporting, so a status change needs no re-link.
    map: (r) => ({ kind: 'lead_created', channel: r.channel, amountUsd: r.amount === null ? null : Number(r.amount) }),
  },
  {
    // Created in the account's zone with no zone label; see SOURCE_ZONES in src/lib/dates.js.
    table: 'raw_blankety_submissions',
    query: `SELECT r.source_id, r.payload->'answers'->'4'->'answer'->>'full' AS phone, r.payload->'answers'->'3'->>'prettyFormat' AS name,
      r.payload->>'created_at' AS occurred_at, r.payload->'answers'->'6'->>'answer' AS channel
      FROM hp.raw_blankety_submissions r ${unlinked('raw_blankety_submissions')} ORDER BY r.source_id LIMIT {LIMIT}`,
    map: (r) => ({ kind: 'form', channel: 'Web form' }),
  },
  {
    table: 'raw_docketmonster_matters',
    query: `SELECT r.source_id, r.payload->>'ClientPhone' AS phone, r.payload->>'ClientName' AS name,
      r.payload->>'OpenedDate' AS occurred_at, r.payload->>'ReferralSource' AS channel, r.payload->>'EstimatedFee' AS amount
      FROM hp.raw_docketmonster_matters r ${unlinked('raw_docketmonster_matters')} ORDER BY r.source_id LIMIT {LIMIT}`,
    map: (r) => ({ kind: 'matter_opened', channel: r.channel, amountUsd: r.amount === null ? null : Number(r.amount) }),
  },
  {
    // Firm data, read-only. What Google charged for each Local Services lead; the caller may also be in the phone systems.
    table: 'ops_lsa_charges',
    query: `SELECT r.lead_id AS source_id, r.caller_phone AS phone, NULL AS name,
      to_char(r.lead_received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS occurred_at,
      r.charge_usd AS amount, r.charge_status AS outcome
      FROM ops.lsa_charges r LEFT JOIN hp.person_links l ON l.source_table = 'ops_lsa_charges' AND l.source_id = r.lead_id
      WHERE l.id IS NULL ORDER BY r.lead_id LIMIT {LIMIT}`,
    map: (r) => ({ kind: 'ad_charge', channel: 'Google Local Services', outcome: r.outcome, amountUsd: r.amount === null ? null : Number(r.amount) }),
  },
];
