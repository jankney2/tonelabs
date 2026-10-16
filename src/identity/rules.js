// Pure rules for identity resolution (no database), so each decision can be tested and explained.

// Names a phone system makes up when it has no real name. They say nothing about who is calling.
const GENERIC_NAMES = new Set(['wireless caller', 'auto notify', 'unknown', 'unavailable', 'anonymous', 'harlow & pike', 'harlow and pike', 'intake', 'private']);

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
