// Ringsnitch trackers and users -> hp.raw_ringsnitch_trackers / hp.raw_ringsnitch_users.
// Both are short lists (well under one page), so every run re-reads the whole list. Same rules as
// the calls sync (syncCalls.js), and idempotent:
//  - new id               -> inserted
//  - same id, same data   -> only last_seen_at moves
//  - same id, changed     -> old version copied to the *_history table, row updated
//  - id no longer listed  -> not_in_latest_pull = true (never deleted)
import {
  rawRingsnitchTrackers, rawRingsnitchTrackersHistory, rawRingsnitchUsers, rawRingsnitchUsersHistory,
} from '../../db/hp-schema.js';
import { landSnapshot } from '../landRaw.js';

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
