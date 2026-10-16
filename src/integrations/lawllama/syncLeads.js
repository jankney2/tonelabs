// Lawllama leads (+ the contacts included with them) -> raw_lawllama_leads / raw_lawllama_contacts.
// Leads are windowed by updated_since (epoch ms). Incremental syncs start 2 days before the newest
// lead we hold; a full sync starts at the beginning. A full sync that reaches the last page flags
// leads the API no longer returns; an incremental sync never does.
// QUOTA: the account has a monthly record quota, so run --full rarely. Every page includes its
// contacts, so contacts cost no extra requests. Contact SSN/DOB/immigration status are already
// removed by the service (redact.js).
import { sql } from 'drizzle-orm';
import {
  rawLawllamaLeads as leads, rawLawllamaLeadsHistory as leadsHistory,
  rawLawllamaContacts as contacts, rawLawllamaContactsHistory as contactsHistory,
} from '../../db/hp-schema.js';
import { landRows, flagMissing } from '../landRaw.js';

const OVERLAP_DAYS = 2;
const newStats = () => ({ fetched: 0, new: 0, changed: 0, unchanged: 0, missing: 0 });

/** Epoch ms to start an incremental sync from, or undefined if the table is empty. */
export async function incrementalUpdatedSince(db, overlapDays = OVERLAP_DAYS) {
  const [row] = await db.select({ t: sql`max((${leads.payload}->'attributes'->>'updated_at')::bigint)` }).from(leads);
  if (!row?.t) return undefined;
  return Number(row.t) - overlapDays * 86400000;
}

/**
 * @param {{api: import('./LawllamaApiService.js').LawllamaApiService, db: any,
 *          mode?: 'full'|'incremental', maxPages?: number}} opts
 */
export async function syncLawllamaLeads({ api, db, mode = 'incremental', maxPages = Infinity }) {
  const updatedSince = mode === 'incremental' ? await incrementalUpdatedSince(db) : undefined;
  const effectiveMode = mode === 'incremental' && updatedSince === undefined ? 'full' : mode;
  const stats = { mode: effectiveMode, updatedSince: updatedSince ?? null, pages: 0, leads: newStats(), contacts: newStats() };
  const runStarted = new Date();

  await api.startRun(`leads sync (${effectiveMode}${updatedSince ? ` since ${new Date(updatedSince).toISOString()}` : ''})`);
  try {
    let complete = true;
    for await (const body of api.paginate((cursor) => api.getLeadsPage({ cursor, updatedSince }))) {
      stats.pages++;
      await landRows(db, leads, leadsHistory, body.data ?? [], stats.leads);
      const included = (body.included ?? []).filter((r) => r.type === 'contacts');
      await landRows(db, contacts, contactsHistory, included, stats.contacts);
      if (stats.pages >= maxPages && body.has_more) { complete = false; break; }
    }
    if (effectiveMode === 'full' && complete) {
      stats.leads.missing = await flagMissing(db, leads, runStarted);
      stats.contacts.missing = await flagMissing(db, contacts, runStarted);
    }
    stats.rateLimit = api.rateLimit;
    await api.finishRun(stats);
    return stats;
  } catch (err) {
    await api.finishRun(stats, { error: err });
    throw err;
  }
}
