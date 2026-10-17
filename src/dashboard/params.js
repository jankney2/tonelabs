// Dashboard filters, parsed once from the query string so every endpoint reads the same thing.
// Dates are Chicago calendar days (the office's clock), both ends inclusive. No dates given = month to date.

export const STAGES = ['caller', 'lead', 'client'];
export const LOSS_TYPES = ['lead_lost', 'unreturned_call', 'lead_not_called', 'chat_lead_unanswered'];
export const HOURS = ['any', 'in', 'out']; // any time, office hours only, outside office hours only
// Only the drill-down endpoints use these: they narrow a list to the records behind one number.
export const REASONS = ['slow_or_unreachable', 'price', 'went_elsewhere', 'not_a_fit'];
export const HANDLED_BY = ['employee', 'answering_service', 'missed', 'voicemail', 'failed']; // failed = anything but employee
export const STEPS = ['leads', 'contacted', 'retained'];
const LEG_RESULTS = { rung: null, accepted: 'Accepted', missed: 'Missed' }; // what the phone system did when it rang an employee
const MAX_DAYS = 366;

/** Today's date in Chicago as YYYY-MM-DD. */
export function chicagoToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const days = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;

/**
 * @param {URLSearchParams} q
 * @returns {{ok: true, params: object} | {ok: false, error: string}}
 */
export function parseParams(q, now = new Date()) {
  const today = chicagoToday(now);
  const from = q.get('from') || `${today.slice(0, 8)}01`;
  const to = q.get('to') || today;
  if (!isDate(from) || !isDate(to)) return { ok: false, error: 'from and to must be dates like 2026-10-01' };
  if (from > to) return { ok: false, error: 'from must not be after to' };
  if (days(from, to) > MAX_DAYS) return { ok: false, error: `range is limited to ${MAX_DAYS} days` };

  const hours = q.get('hours') || 'any';
  if (!HOURS.includes(hours)) return { ok: false, error: `hours must be one of ${HOURS.join(', ')}` };

  const stage = q.get('stage') || null;
  if (stage && !STAGES.includes(stage)) return { ok: false, error: `stage must be one of ${STAGES.join(', ')}` };

  const lossType = q.get('loss_type') || null;
  if (lossType && !LOSS_TYPES.includes(lossType)) return { ok: false, error: `loss_type must be one of ${LOSS_TYPES.join(', ')}` };

  const source = q.get('source') || null;
  if (source && source.length > 100) return { ok: false, error: 'source is too long' };

  // employee=6,7 -> [6, 7]; null means everyone
  let employees = null;
  if (q.get('employee')) {
    employees = q.get('employee').split(',').map((s) => Number(s));
    if (employees.length > 20 || employees.some((n) => !Number.isInteger(n) || n < 1)) return { ok: false, error: 'employee must be a comma-separated list of ids' };
  }

  const reason = q.get('reason') || null;
  if (reason && !REASONS.includes(reason)) return { ok: false, error: `reason must be one of ${REASONS.join(', ')}` };

  const handledBy = q.get('handled_by') || null;
  if (handledBy && !HANDLED_BY.includes(handledBy)) return { ok: false, error: `handled_by must be one of ${HANDLED_BY.join(', ')}` };

  const step = q.get('step') || null;
  if (step && !STEPS.includes(step)) return { ok: false, error: `step must be one of ${STEPS.join(', ')}` };

  const leg = q.get('leg') || null;
  if (leg && !(leg in LEG_RESULTS)) return { ok: false, error: `leg must be one of ${Object.keys(LEG_RESULTS).join(', ')}` };

  const slot = (name, max) => {
    const v = q.get(name);
    if (v === null || v === '') return { value: null };
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= max ? { value: n } : { error: `${name} must be a whole number from 0 to ${max}` };
  };
  const dow = slot('dow', 6), hour = slot('hour', 23);
  if (dow.error || hour.error) return { ok: false, error: dow.error || hour.error };

  return {
    ok: true,
    params: { from, to, hours, stage, lossType, source, employees, reason, handledBy, step, legResult: leg ? LEG_RESULTS[leg] : null, dow: dow.value, hour: hour.value },
  };
}
