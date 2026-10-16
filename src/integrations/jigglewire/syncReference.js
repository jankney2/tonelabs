// Jigglewire extensions, queue presence and voicemail -> their raw_jigglewire_* tables.
//  - extensions: complete list, re-read every run (snapshot; vanished ids are flagged).
//  - queue presence: one request per queue (every non-User extension, i.e. the Intake department),
//    re-read every run (snapshot) so a member opting out of the queue shows up in the history table.
//  - voicemail: one request per extension, by date window like the call log (default is only the last
//    24 hours, so dateFrom is always passed). Never flagged missing.
// The extension list is read first because the other two need its ids.
import { sql } from 'drizzle-orm';
import {
  rawJigglewireExtensions, rawJigglewireExtensionsHistory,
  rawJigglewireQueuePresence, rawJigglewireQueuePresenceHistory,
  rawJigglewireVoicemails, rawJigglewireVoicemailsHistory,
} from '../../db/hp-schema.js';
import { landRows, landSnapshot } from '../landRaw.js';

const OVERLAP_DAYS = 2;
const FULL_FROM = '2020-01-01T00:00:00Z';

async function allRecords(api, firstPage) {
  const records = [];
  for await (const body of api.paginate(firstPage)) records.push(...(body.records ?? []));
  return records;
}

export async function voicemailDateFrom(db, mode, overlapDays = OVERLAP_DAYS) {
  if (mode === 'full') return FULL_FROM;
  const [row] = await db.select({ t: sql`max((${rawJigglewireVoicemails.payload}->>'creationTime')::timestamptz)` }).from(rawJigglewireVoicemails);
  if (!row?.t) return FULL_FROM;
  const d = new Date(row.t);
  d.setUTCDate(d.getUTCDate() - overlapDays);
  return d.toISOString();
}

/** @returns {Promise<{extensions: object, queuePresence: object, voicemails: object}>} stats per table */
export async function syncJigglewireReference({ api, db, mode = 'incremental' }) {
  await api.startRun('extensions + queue presence + voicemail sync');
  const stats = {};
  try {
    const extensions = await allRecords(api, () => api.getExtensionsPage());
    stats.extensions = await landSnapshot(db, rawJigglewireExtensions, rawJigglewireExtensionsHistory, extensions);

    const members = [];
    for (const q of extensions.filter((e) => e.type !== 'User')) {
      const body = await api.getQueuePresence(q.id);
      for (const m of body.records ?? []) members.push({ queueId: q.id, record: m });
    }
    // The payload stays as the API sent it; the queue id is only in source_id.
    const byKey = new Map(members.map(({ queueId, record }) => [`${queueId}:${record.member.id}`, record]));
    const keyOf = new Map([...byKey].map(([k, r]) => [r, k]));
    stats.queuePresence = await landSnapshot(db, rawJigglewireQueuePresence, rawJigglewireQueuePresenceHistory, [...byKey.values()], (r) => keyOf.get(r));

    const dateFrom = await voicemailDateFrom(db, mode);
    stats.voicemails = { dateFrom, fetched: 0, new: 0, changed: 0, unchanged: 0 };
    for (const e of extensions) {
      const vms = await allRecords(api, () => api.getVoicemailPage(e.id, { dateFrom }));
      await landRows(db, rawJigglewireVoicemails, rawJigglewireVoicemailsHistory, vms, stats.voicemails);
    }
    await api.finishRun(stats);
    return stats;
  } catch (err) {
    await api.finishRun(stats, { error: err });
    throw err;
  }
}
