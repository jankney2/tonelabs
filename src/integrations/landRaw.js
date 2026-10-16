// Shared by every system's sync: land API records into a raw_<source>_<endpoint> table (+ its _history table).
// Rules, the same for every table so they can be audited the same way:
//  - new id               -> inserted
//  - same id, same data   -> only last_seen_at moves
//  - same id, changed     -> old version copied to the *_history table, row updated
//  - id no longer listed  -> not_in_latest_pull = true (landSnapshot only; never deleted)
import { inArray, lt, sql } from 'drizzle-orm';
import { contentHash } from './hash.js';

const emptyStats = () => ({ fetched: 0, new: 0, changed: 0, unchanged: 0, missing: 0 });

/**
 * Upsert one batch of records. Adds counts to `stats` (fetched/new/changed/unchanged).
 * @param {(item:object)=>string} idOf  source id of a record (default: item.id)
 */
export async function landRows(db, raw, history, items, stats, idOf = (i) => i.id) {
  const byId = new Map();
  for (const item of items) byId.set(String(idOf(item)), item); // a record can't appear twice in one upsert
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
      // a changed row's first_seen_at stays as the first time we ever saw this record
    },
  });
  // History first, then the update, in one batch (one round trip, applied together).
  await db.batch(superseded.length ? [db.insert(history).values(superseded), upsert] : [upsert]);
}

/** Flag rows not touched since `since` as not_in_latest_pull. Only call after reading the COMPLETE list. */
export async function flagMissing(db, raw, since) {
  const gone = await db.update(raw).set({ notInLatestPull: true })
    .where(lt(raw.lastSeenAt, since.toISOString())).returning({ id: raw.sourceId });
  return gone.length;
}

/**
 * Land a complete list into one raw table (with its history table), then flag what disappeared.
 * @returns {Promise<{fetched:number, new:number, changed:number, unchanged:number, missing:number}>}
 */
export async function landSnapshot(db, raw, history, items, idOf) {
  const stats = emptyStats();
  const runStarted = new Date();
  await landRows(db, raw, history, items, stats, idOf);
  stats.missing = await flagMissing(db, raw, runStarted);
  return stats;
}
