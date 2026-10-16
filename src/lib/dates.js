// Turn a source timestamp into a UTC instant (ISO string). Only used when building identity/events, never on the raw tables.
// Sources differ: Ringsnitch and Lawllama send UTC ("...Z"), Jigglewire sends an offset ("-07:00", which matches the real
// instant: 2,991 calls paired with Ringsnitch differ by 0 minutes), and Blankety and Docketmonster send local time with no zone.

// Zone each zone-less source writes in. Blankety is exactly 4 hours behind UTC on all 454 submissions (Aug to Oct 2026),
// which is US Eastern daylight time; a fixed UTC-4 account would look identical until the clocks change on 1 Nov, so recheck then.
export const SOURCE_ZONES = {
  raw_blankety_submissions: 'America/New_York',
  raw_docketmonster_matters: 'America/Chicago', // firm local time (assumed, see docs/todo.md)
};

/** Offset in minutes of `zone` from UTC at the instant `utcMs`. */
function offsetMinutes(utcMs, zone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/**
 * "2026-10-14 08:50:01" or "2026-10-01T09:43:09" written in `zone` -> ISO UTC string. Handles daylight saving.
 * A time that does not exist (spring forward) or happens twice (fall back) resolves to the first matching instant.
 */
export function zonedToUtc(local, zone) {
  const m = String(local).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const naive = Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6] ?? 0);
  let guess = naive - offsetMinutes(naive, zone) * 60000;
  guess = naive - offsetMinutes(guess, zone) * 60000; // second pass fixes guesses that land across a DST change
  return new Date(guess).toISOString();
}

/** Any source timestamp -> ISO UTC. Strings with Z or an offset are trusted; zone-less strings use SOURCE_ZONES[sourceTable]. */
export function toUtc(value, sourceTable) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value);
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const zone = SOURCE_ZONES[sourceTable];
  return zone ? zonedToUtc(s, zone) : null; // an unknown zone is an error to fix, not a guess
}
