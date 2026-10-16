// Ringsnitch trackers and users -> hp.raw_ringsnitch_trackers / hp.raw_ringsnitch_users.
// Both are short lists (well under one page), so every run re-reads the whole list. Same rules as
// the calls sync (syncCalls.js), and idempotent:
//  - new id               -> inserted
//  - same id, same data   -> only last_seen_at moves
//  - same id, changed     -> old version copied to the *_history table, row updated
//  - id no longer listed  -> not_in_latest_pull = true (never deleted)
import { inArray, lt, sql } from 'drizzle-orm';
import {
  rawRingsnitchTrackers, rawRingsnitchTrackersHistory, rawRingsnitchUsers, rawRingsnitchUsersHistory,
} from '../../db/hp-schema.js';
import { contentHash } from '../hash.js';

/**
 * Land a complete list into one raw table (with its history table).
 * @returns {Promise<{fetched:number, new:number, changed:number, unchanged:number, missing:number}>}
 */
export async function landSnapshot(db, raw, history, items) {
  const stats = { fetched: 0, new: 0, changed: 0, unchanged: 0, missing: 0 };
  const runStarted = new Date();
  const byId = new Map(items.map((i) => [i.id, i]));
  stats.fetched = byId.size;

  if (byId.size) {
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
      },
    });
    await db.batch(superseded.length ? [db.insert(history).values(superseded), upsert] : [upsert]);
  }

  // Safe because the whole list was read: anything not touched this run is no longer returned.
  const gone = await db.update(raw).set({ notInLatestPull: true })
    .where(lt(raw.lastSeenAt, runStarted.toISOString())).returning({ id: raw.sourceId });
  stats.missing = gone.length;
  return stats;
}

/** Read every page of a list endpoint. Throws if it doesn't fit in maxPages (we never treat a partial list as complete). */
async function readAll(api, fetchPage, key, maxPages = 10) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = await fetchPage(page);
    items.push(...(body[key] ?? []));
    if (page >= (body.total_pages ?? 1)) return items;
  }
  throw new Error(`${key}: more than ${maxPages} pages, refusing to treat a partial list as complete`);
}

/** @returns {Promise<{trackers: object, users: object}>} stats per table */
export async function syncRingsnitchReference({ api, db }) {
  await api.startRun('trackers + users sync');
  const stats = {};
  try {
    const trackers = await readAll(api, (page) => api.getTrackers({ page }), 'trackers');
    stats.trackers = await landSnapshot(db, rawRingsnitchTrackers, rawRingsnitchTrackersHistory, trackers);
    const users = await readAll(api, (page) => api.getUsers({ page }), 'users');
    stats.users = await landSnapshot(db, rawRingsnitchUsers, rawRingsnitchUsersHistory, users);
    await api.finishRun(stats);
    return stats;
  } catch (err) {
    await api.finishRun(stats, { error: err });
    throw err;
  }
}
