// Dashboard filters, parsed once from the query string so every endpoint reads the same thing.
// Dates are Chicago calendar days (the office's clock), both ends inclusive. No dates given = month to date.

export const STAGES = ['caller', 'lead', 'client'];
export const LOSS_TYPES = ['lead_lost', 'unreturned_call', 'lead_not_called', 'chat_lead_unanswered'];
export const HOURS = ['any', 'in', 'out']; // any time, office hours only, outside office hours only
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

  return { ok: true, params: { from, to, hours, stage, lossType, source, employees } };
}
