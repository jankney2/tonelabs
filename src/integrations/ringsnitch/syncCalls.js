// Ringsnitch calls -> hp.raw_ringsnitch_calls. Safe to run any number of times (idempotent):
//  - new call            -> inserted
//  - same call, same data -> only last_seen_at moves
//  - same call, changed   -> old version copied to raw_ringsnitch_calls_history, row updated
//  - full sync only: rows not returned this time get not_in_latest_pull = true (never deleted)
// Every run is audited in hp.integration_logs (run_start, one row per request, run_end).
import { sql } from 'drizzle-orm';
import { rawRingsnitchCalls as raw, rawRingsnitchCallsHistory as history } from '../../db/hp-schema.js';
import { landRows, flagMissing } from '../landRaw.js';

const OVERLAP_DAYS = 2; // incremental syncs re-read this much history to catch late edits

/** Date (YYYY-MM-DD) to start an incremental sync from, or undefined if the table is empty. */
export async function incrementalStartDate(db, overlapDays = OVERLAP_DAYS) {
  const [row] = await db.select({ t: sql`max(${raw.payload}->>'start_time')` }).from(raw);
  if (!row?.t) return undefined;
  const d = new Date(row.t);
  d.setUTCDate(d.getUTCDate() - overlapDays);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {{api: import('./RingSnitchApiService.js').RingSnitchApiService, db: any,
 *          mode?: 'full'|'incremental', maxPages?: number, perPage?: number}} opts
 * @returns {Promise<{mode:string, pages:number, fetched:number, new:number, changed:number, unchanged:number, missing:number}>}
 */
export async function syncRingsnitchCalls({ api, db, mode = 'incremental', maxPages = Infinity, perPage = 100 }) {
  const startDate = mode === 'incremental' ? await incrementalStartDate(db) : undefined;
  const effectiveMode = mode === 'incremental' && !startDate ? 'full' : mode; // empty table: nothing to be incremental from
  const stats = { mode: effectiveMode, startDate: startDate ?? null, pages: 0, fetched: 0, new: 0, changed: 0, unchanged: 0, missing: 0 };
  const runStarted = new Date();

  await api.startRun(`calls sync (${effectiveMode}${startDate ? ` from ${startDate}` : ''})`);
  try {
    let complete = false;
    for (let page = 1; page <= maxPages; page++) {
      const body = await api.getCallsPage({ page, perPage, startDate });
      stats.pages++;
      await landRows(db, raw, history, body.calls ?? [], stats);
      if (page >= (body.total_pages ?? 1)) { complete = true; break; }
    }
    if (effectiveMode === 'full' && complete) {
      stats.missing = await flagMissing(db, raw, runStarted);
    }
    await api.finishRun(stats);
    return stats;
  } catch (err) {
    await api.finishRun(stats, { error: err });
    throw err;
  }
}
