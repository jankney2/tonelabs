// Mostlyanswered daily files -> raw_mostlyanswered_files (the listing) and raw_mostlyanswered_messages (one row per CSV line).
// The listing is a complete list, so files are landed as a snapshot. A file is downloaded when it is new, when its
// last-modified/size in the listing changed, or on --full. A message has no id: source_id = "<file>:<data row number>";
// payload = the CSV columns as written plus `file` and `line`. A full sync flags message rows that are no longer in
// their file (an incremental sync never does).
import {
  rawMostlyansweredFiles as files, rawMostlyansweredFilesHistory as filesHistory,
  rawMostlyansweredMessages as messages, rawMostlyansweredMessagesHistory as messagesHistory,
} from '../../db/hp-schema.js';
import { landRows, flagMissing } from '../landRaw.js';
import { contentHash } from '../hash.js';
import { FILE_NAME } from './MostlyansweredApiService.js';

const newStats = () => ({ fetched: 0, new: 0, changed: 0, unchanged: 0, missing: 0 });

/**
 * @param {{api: import('./MostlyansweredApiService.js').MostlyansweredApiService, db: any,
 *          mode?: 'full'|'incremental', maxFiles?: number}} opts   maxFiles: download at most this many files (testing)
 */
export async function syncMostlyanswered({ api, db, mode = 'incremental', maxFiles = Infinity }) {
  const stats = { mode, files: newStats(), messages: newStats(), downloaded: 0, skippedNames: [] };
  const runStarted = new Date();
  await api.startRun(`mostlyanswered sync (${mode})`);
  try {
    const listing = await api.listFiles();
    const csvs = listing.filter((f) => FILE_NAME.test(f.name));
    stats.skippedNames = listing.filter((f) => !FILE_NAME.test(f.name)).map((f) => f.name);

    // Which files to read: all on --full, otherwise those whose listing entry is new or different from what we hold.
    const held = new Map((await db.select().from(files)).map((r) => [r.sourceId, r.contentHash]));
    const wanted = [];
    for (const f of csvs) if (mode === 'full' || held.get(f.name) !== (await contentHash(f))) wanted.push(f);
    const todo = wanted.slice(0, maxFiles);
    const complete = todo.length === wanted.length;

    for (const f of todo) {
      const rows = await api.getFile(f.name);
      stats.downloaded++;
      const items = rows.map((r, i) => ({ ...r, file: f.name, line: i + 1 }));
      await landRows(db, messages, messagesHistory, items, stats.messages, (m) => `${m.file}:${m.line}`);
    }
    // Land the listing entries last, so a file whose download was skipped or failed is retried next run.
    const landable = csvs.filter((f) => !wanted.includes(f) || todo.includes(f));
    await landRows(db, files, filesHistory, landable, stats.files, (f) => f.name);
    if (mode === 'full' && complete) {
      stats.files.missing = await flagMissing(db, files, runStarted);
      stats.messages.missing = await flagMissing(db, messages, runStarted);
    }
    await api.finishRun(stats);
    return stats;
  } catch (err) {
    await api.finishRun(stats, { error: err });
    throw err;
  }
}
