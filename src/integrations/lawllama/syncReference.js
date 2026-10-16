// Lawllama lead statuses and users -> their raw tables. Small complete lists, re-read every run
// (snapshot: ids that vanish are flagged, changes go to the history tables).
import {
  rawLawllamaLeadStatuses, rawLawllamaLeadStatusesHistory,
  rawLawllamaUsers, rawLawllamaUsersHistory,
} from '../../db/hp-schema.js';
import { landSnapshot } from '../landRaw.js';

export async function syncLawllamaReference({ api, db }) {
  await api.startRun('lead statuses + users sync');
  const stats = {};
  try {
    const statuses = (await api.getLeadStatuses()).data ?? [];
    stats.leadStatuses = await landSnapshot(db, rawLawllamaLeadStatuses, rawLawllamaLeadStatusesHistory, statuses);

    const users = [];
    for await (const body of api.paginate((cursor) => api.getUsersPage({ cursor }))) users.push(...(body.data ?? []));
    stats.users = await landSnapshot(db, rawLawllamaUsers, rawLawllamaUsersHistory, users);

    await api.finishRun(stats);
    return stats;
  } catch (err) {
    await api.finishRun(stats, { error: err });
    throw err;
  }
}
