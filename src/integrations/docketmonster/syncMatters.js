// Docketmonster matters -> raw_docketmonster_matters (source_id = MatterNumber).
// The service has no paging: one GetMattersOpened call returns every matter opened in a date range.
// A full sync asks for everything (FULL_FROM to tomorrow) and flags matters the service no longer returns.
// An incremental sync asks from (newest OpenedDate - 30 days), NOT the usual 2: the window is by *opened* date,
// so a matter whose Status changes later (Open -> Closed) is only re-read while it is inside the window.
// The firm opens ~100 matters a month, so a 30-day window is a few dozen rows and one call.
// Payload = the Matter's fields as strings, exactly as returned (EstimatedFee "2400.0000", OpenedDate firm-local, no zone).
import { sql } from 'drizzle-orm';
import { rawDocketmonsterMatters as matters, rawDocketmonsterMattersHistory as history } from '../../db/hp-schema.js';
import { landRows, flagMissing } from '../landRaw.js';

const OVERLAP_DAYS = 30;
const FULL_FROM = '2000-01-01';
const day = (d) => d.toISOString().slice(0, 10);
const newStats = () => ({ fetched: 0, new: 0, changed: 0, unchanged: 0, missing: 0 });

/** yyyy-MM-dd to start an incremental sync from, or undefined if the table is empty. */
export async function incrementalFrom(db, overlapDays = OVERLAP_DAYS) {
  const [row] = await db.select({ t: sql`max(${matters.payload}->>'OpenedDate')` }).from(matters);
  if (!row?.t) return undefined;
  // OpenedDate has no zone; read it as UTC only to subtract days.
  return day(new Date(new Date(`${row.t.slice(0, 10)}T00:00:00Z`).getTime() - overlapDays * 86400000));
}

/** @param {{api: import('./DocketmonsterApiService.js').DocketmonsterApiService, db: any, mode?: 'full'|'incremental', now?: Date}} opts */
export async function syncDocketmonsterMatters({ api, db, mode = 'incremental', now = new Date() }) {
  const from = mode === 'incremental' ? await incrementalFrom(db) : undefined;
  const effectiveMode = mode === 'incremental' && from === undefined ? 'full' : mode;
  // Ask up to tomorrow so a matter opened late today (firm time may be ahead of UTC) is never cut off.
  const to = day(new Date(now.getTime() + 86400000));
  const stats = { mode: effectiveMode, from: from ?? FULL_FROM, to, matters: newStats() };
  const runStarted = new Date();

  await api.startRun(`matters sync (${effectiveMode}, ${stats.from} to ${to})`);
  try {
    const rows = await api.getMattersOpened(stats.from, to);
    await landRows(db, matters, history, rows, stats.matters, (m) => m.MatterNumber);
    if (effectiveMode === 'full') stats.matters.missing = await flagMissing(db, matters, runStarted);
    await api.finishRun(stats);
    return stats;
  } catch (err) {
    await api.finishRun(stats, { error: err });
    throw err;
  }
}
