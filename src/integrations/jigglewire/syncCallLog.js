// Jigglewire call log -> hp.raw_jigglewire_call_log. Idempotent, same rules as landRaw.js.
// The call log is windowed by dateFrom/dateTo (default is only the last 24 hours, so we always pass
// dateFrom). Incremental syncs start 2 days before the newest call we hold to catch late edits;
// a full sync starts at FULL_FROM. A full sync that reaches the last page flags rows the API no
// longer returns (not_in_latest_pull); an incremental sync never does.
import { sql } from 'drizzle-orm';
import { rawJigglewireCallLog as raw, rawJigglewireCallLogHistory as history } from '../../db/hp-schema.js';
import { landRows, flagMissing } from '../landRaw.js';

const OVERLAP_DAYS = 2;
const FULL_FROM = '2020-01-01T00:00:00Z';

/** ISO time to start an incremental sync from, or undefined if the table is empty. */
export async function incrementalDateFrom(db, overlapDays = OVERLAP_DAYS) {
  const [row] = await db.select({ t: sql`max((${raw.payload}->>'startTime')::timestamptz)` }).from(raw);
  if (!row?.t) return undefined;
  const d = new Date(row.t);
  d.setUTCDate(d.getUTCDate() - overlapDays);
  return d.toISOString();
}

/**
 * @param {{api: import('./JigglewireApiService.js').JigglewireApiService, db: any,
 *          mode?: 'full'|'incremental', maxPages?: number}} opts
 */
export async function syncJigglewireCallLog({ api, db, mode = 'incremental', maxPages = Infinity }) {
  const dateFrom = mode === 'incremental' ? await incrementalDateFrom(db) : FULL_FROM;
  const effectiveMode = mode === 'incremental' && !dateFrom ? 'full' : mode;
  const stats = { mode: effectiveMode, dateFrom: dateFrom ?? FULL_FROM, pages: 0, fetched: 0, new: 0, changed: 0, unchanged: 0, missing: 0 };
  const runStarted = new Date();

  await api.startRun(`call log sync (${effectiveMode} from ${stats.dateFrom})`);
  try {
    let complete = true;
    for await (const body of api.paginate(() => api.getCallLogPage({ dateFrom: stats.dateFrom }))) {
      stats.pages++;
      await landRows(db, raw, history, body.records ?? [], stats);
      if (stats.pages >= maxPages && body.navigation?.nextPage) { complete = false; break; }
    }
    if (effectiveMode === 'full' && complete) stats.missing = await flagMissing(db, raw, runStarted);
    await api.finishRun(stats);
    return stats;
  } catch (err) {
    await api.finishRun(stats, { error: err });
    throw err;
  }
}
