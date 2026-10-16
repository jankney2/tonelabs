// Pure rules for identity resolution (no database), so each decision can be tested and explained.

// Names a phone system makes up when it has no real name. They say nothing about who is calling.
const GENERIC_NAMES = new Set(['wireless caller', 'auto notify', 'unknown', 'unavailable', 'anonymous', 'harlow & pike', 'harlow and pike', 'intake', 'private', 'no name given']);

/** "LAST, FIRST" or "First Last" in any case -> "First Last"; null for generic or empty names. */
export function displayName(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().replace(/\s+/g, ' ');
  if (!s || GENERIC_NAMES.has(s.toLowerCase())) return null;
  const comma = s.match(/^([^,]+),\s*(.+)$/);
  if (comma) s = `${comma[2]} ${comma[1]}`;
  return s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

/** Order-free key so "Thompson, Diego" and "diego thompson" compare equal. Null when there is no real name. */
export function nameKey(raw) {
  const d = displayName(raw);
  if (!d) return null;
  const tokens = d.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
  return tokens.length ? tokens.sort().join(' ') : null;
}

// Ringsnitch writes an AI summary per call. These phrases only appear for recorded or automated callers.
export const AUTOMATED_SUMMARY_SQL = '(automated|robocall|recorded voice|no caller on the line)';
export const AUTOMATED_SUMMARY_RE = new RegExp(AUTOMATED_SUMMARY_SQL, 'i');

/**
 * Who a Jigglewire call rang. Each leg's `to` is the person rung; the call's own `extension` is who answered.
 * @param {object} payload   raw Jigglewire call-log record
 * @param {(ext:string)=>number|null} employeeFor  extension number -> employee id
 */
export function callLegs(payload, employeeFor) {
  return (payload.legs ?? []).map((leg, i) => {
    const to = Array.isArray(leg.to) ? leg.to[0] : leg.to;
    const extension = to?.extensionNumber ?? null;
    return {
      ringOrder: i + 1,
      extension,
      employeeId: extension ? employeeFor(String(extension)) : null,
      result: leg.result ?? null,
      durationS: leg.duration ?? null,
    };
  });
}

/** Who took (inbound) or made (outbound) a Jigglewire call; null for missed calls and voicemail. */
export function callEmployee(payload, employeeFor) {
  const ext = payload.extension?.extensionNumber;
  return ext ? employeeFor(String(ext)) : null;
}

/**
 * Who actually dealt with a Jigglewire call. "Call connected" with no extension is not a person at the firm:
 * the call rang the intake phones, nobody picked up, and it was forwarded (leg type Forwarded, action FindMe) to the
 * after-hours answering service, 1,217 calls of which 322 came in during office hours.
 */
export function handledBy(payload, employeeId) {
  if (payload.direction === 'Outbound') return isAnsweredResult(payload.result) ? 'employee' : 'no_answer';
  if (payload.result === 'Voicemail') return 'voicemail';
  if (employeeId) return 'employee';
  const forwarded = (payload.legs ?? []).some((l) => l.legType === 'Forwarded' || l.action === 'FindMe');
  return forwarded && isAnsweredResult(payload.result) ? 'answering_service' : 'missed';
}

const ANSWERED = new Set(['Accepted', 'Call connected']);
export const isAnsweredResult = (result) => ANSWERED.has(result);

// Answering-service messages (Mostlyanswered). The operator types one of a few message shapes; classify by the text.
//   new_matter / existing_client   a real person asked for a callback (the service promises one within 24 hrs)
//   chat_lead_recording            a robot rings the service and reads out a website-chat lead: "new chat lead", a name, an issue and the
//                                  LEAD's number, then "press 1". The callback number on the message is the robot's, so the person is the lead.
//   robocall / sales_call          nobody to call back
export function messageCategory(message) {
  const m = String(message ?? '');
  if (/^New matter/i.test(m)) return 'new_matter';
  if (/^Existing client/i.test(m)) return 'existing_client';
  if (/new chat lead/i.test(m)) return 'chat_lead_recording';
  if (/^Recorded message about/i.test(m)) return 'robocall';
  if (/^Sales call/i.test(m)) return 'sales_call';
  return 'other';
}

// The same patterns in SQL (Postgres regex) for the source query, so the number and name are read where the data is selected.
export const CHAT_LEAD_PHONE_SQL = 'number, ([0-9]{3}-[0-9]{3}-[0-9]{4})';
export const CHAT_LEAD_NAME_SQL = 'name \\(([^)?]*)';

/** Lead name and phone read out in a "new chat lead" recording, or null. Mirrors the SQL patterns above. */
export function chatLead(message) {
  const m = String(message ?? '');
  if (messageCategory(m) !== 'chat_lead_recording') return null;
  return { name: m.match(/name \(([^)?]*)/)?.[1] ?? null, phone: m.match(/number, (\d{3}-\d{3}-\d{4})/)?.[1] ?? null };
}

/** A callback is expected for these; the 24 hours is the service's promise (the Promised column), assumed for chat leads. */
export const CALLBACK_CATEGORIES = ['new_matter', 'existing_client', 'chat_lead_recording'];
