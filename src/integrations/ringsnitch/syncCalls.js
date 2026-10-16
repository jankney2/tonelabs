// Ringsnitch calls -> hp.raw_ringsnitch_calls. Safe to run any number of times (idempotent):
//  - new call            -> inserted
//  - same call, same data -> only last_seen_at moves
//  - same call, changed   -> old version copied to raw_ringsnitch_calls_history, row updated
//  - full sync only: rows not returned this time get not_in_latest_pull = true (never deleted)
// Every run is audited in hp.integration_logs (run_start, one row per request, run_end).
import { desc, inArray, lt, sql } from 'drizzle-orm';
import { rawRingsnitchCalls as raw, rawRingsnitchCallsHistory as history } from '../../db/hp-schema.js';
import { contentHash } from '../hash.js';

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
      await landPage(db, body.calls ?? [], stats);
      if (page >= (body.total_pages ?? 1)) { complete = true; break; }
    }
    if (effectiveMode === 'full' && complete) {
      const gone = await db.update(raw).set({ notInLatestPull: true })
        .where(lt(raw.lastSeenAt, runStarted.toISOString())).returning({ id: raw.sourceId });
      stats.missing = gone.length;
    }
    await api.finishRun(stats);
    return stats;
  } catch (err) {
    await api.finishRun(stats, { error: err });
    throw err;
  }
}

async function landPage(db, calls, stats) {
  const byId = new Map();
  for (const c of calls) byId.set(c.id, c); // a call can't appear twice in one upsert
  stats.fetched += byId.size;
  if (!byId.size) return;

  const existing = await db.select().from(raw).where(inArray(raw.sourceId, [...byId.keys()]));
  const known = new Map(existing.map((r) => [r.sourceId, r]));

  const rows = [];
  const superseded = [];
  for (const [id, payload] of byId) {
    const hash = await contentHash(payload);
    const old = known.get(id);
    if (!old) stats.new++;
    else if (old.contentHash === hash) stats.unchanged++;
    else {
      stats.changed++;
      superseded.push({ sourceId: id, payload: old.payload, contentHash: old.contentHash, firstSeenAt: old.firstSeenAt });
    }
    rows.push({ sourceId: id, payload, contentHash: hash });
  }

  const upsert = db.insert(raw).values(rows).onConflictDoUpdate({
    target: raw.sourceId,
    set: {
      payload: sql`excluded.payload`,
      contentHash: sql`excluded.content_hash`,
      lastSeenAt: sql`now()`,
      notInLatestPull: false,
      // a changed row's first_seen_at stays as the first time we ever saw this call
    },
  });
  // History first, then the update, in one batch (one round trip, applied together).
  await db.batch(superseded.length ? [db.insert(history).values(superseded), upsert] : [upsert]);
}
