// Phone numbers differ by system ("(206) 555-0103", "206.555.0131", "+12065550103", ...). Reconciliation
// matches people on phone first, so every number is normalised to E.164 ("+12065550103") before it is
// compared or stored in a people/contacts table. Never applied to the raw_* tables, which keep the source value.
// North American numbers only (the firm's calls are US); anything else comes back null, not guessed.

/**
 * @param {unknown} value  phone as a source system wrote it
 * @returns {string|null}  E.164 (+1NXXNXXXXXX), or null when it is not a valid 10-digit NANP number
 */
export function normalizePhone(value) {
  if (value === null || value === undefined) return null;
  // Drop an extension ("x123", "ext. 123", "#123") so the main number still matches.
  const main = String(value).replace(/\s*(?:ext\.?|extension|x|#)\s*\d+\s*$/i, '');
  let digits = main.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  // NANP: area code and exchange start 2-9. Rejects 000..., 555-less junk, and short/long values.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

/** True when two source values are the same number once normalised (both must be valid). */
export function samePhone(a, b) {
  const x = normalizePhone(a);
  return x !== null && x === normalizePhone(b);
}
