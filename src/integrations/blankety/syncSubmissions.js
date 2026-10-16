// Blankety form submissions -> raw_blankety_submissions (source_id = submission id).
// Windowed by created_after (account-zone 'YYYY-MM-DD HH:MM:SS'). Incremental syncs start 2 days before the
// newest submission we hold; a full sync starts at the beginning, and if it reaches the last page it flags
// submissions the API no longer returns (an incremental sync never does).
// Paging is by offset on a newest-first list, so a submission arriving mid-run shifts later pages by one; the
// 2-day overlap on the next incremental run (and landRows dedup) repairs that.
// BUDGET: 1,000 calls/day account-wide. One call per 1,000 submissions per form, plus 1 + 1 per form for forms/questions.
import { sql } from 'drizzle-orm';
import { rawBlanketySubmissions as submissions, rawBlanketySubmissionsHistory as history } from '../../db/hp-schema.js';
import { landRows, flagMissing } from '../landRaw.js';

const OVERLAP_DAYS = 2;
const PAGE = 1000;
const newStats = () => ({ fetched: 0, new: 0, changed: 0, unchanged: 0, missing: 0 });
const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

/** 'YYYY-MM-DD HH:MM:SS' to start an incremental sync from, or undefined if the table is empty. */
export async function incrementalCreatedAfter(db, overlapDays = OVERLAP_DAYS) {
  const [row] = await db.select({ t: sql`max(${submissions.payload}->>'created_at')` }).from(submissions);
  if (!row?.t) return undefined;
  // Zone-agnostic: treat the account-zone string as if it were UTC just to subtract days.
  return fmt(new Date(new Date(row.t.replace(' ', 'T') + 'Z').getTime() - overlapDays * 86400000));
}

/**
 * @param {{api: import('./BlanketyApiService.js').BlanketyApiService, db: any, formIds: string[],
 *          mode?: 'full'|'incremental', maxPages?: number}} opts   maxPages is per form
 */
export async function syncBlanketySubmissions({ api, db, formIds, mode = 'incremental', maxPages = Infinity }) {
  const createdAfter = mode === 'incremental' ? await incrementalCreatedAfter(db) : undefined;
  const effectiveMode = mode === 'incremental' && createdAfter === undefined ? 'full' : mode;
  const stats = { mode: effectiveMode, createdAfter: createdAfter ?? null, pages: 0, submissions: newStats() };
  const runStarted = new Date();

  await api.startRun(`submissions sync (${effectiveMode}${createdAfter ? ` after ${createdAfter}` : ''})`);
  try {
    let complete = true;
    for (const formId of formIds) {
      let pages = 0;
      for await (const body of api.paginate((offset) => api.getSubmissionsPage(formId, { offset, limit: PAGE, createdAfter }), PAGE)) {
        pages++; stats.pages++;
        await landRows(db, submissions, history, body.content ?? [], stats.submissions);
        const n = body.resultSet?.count ?? 0;
        if (pages >= maxPages && n >= PAGE) { complete = false; break; }
      }
    }
    if (effectiveMode === 'full' && complete) stats.submissions.missing = await flagMissing(db, submissions, runStarted);
    stats.rateLimit = api.rateLimit;
    await api.finishRun(stats);
    return stats;
  } catch (err) {
    await api.finishRun(stats, { error: err });
    throw err;
  }
}
