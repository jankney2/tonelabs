// Cloudflare Cron Trigger handler: keeps hp.raw_ringsnitch_calls in sync (calls every run; trackers and users twice a day).
// Runs every 30 minutes (UTC cron can't follow Chicago daylight saving), but outside office hours
// the :30 run is skipped, so it syncs twice an hour in office hours and once an hour otherwise.
// Incremental only (recent calls + overlap), which stays well inside Worker CPU limits and the
// Ringsnitch rate limit (1,000 requests/hour). Full syncs are run by hand: npm run sync:ringsnitch -- --full
import { RingSnitchApiService } from './integrations/ringsnitch/RingSnitchApiService.js';
import { syncRingsnitchCalls } from './integrations/ringsnitch/syncCalls.js';
import { syncRingsnitchReference } from './integrations/ringsnitch/syncReference.js';
import { isBusinessHours, isReferenceSyncSlot } from './officeHours.js';
import { MostlyansweredApiService } from './integrations/mostlyanswered/MostlyansweredApiService.js';
import { syncMostlyanswered } from './integrations/mostlyanswered/syncMessages.js';
import { createDb } from './db/index.js';
import { resolveIdentities } from './identity/resolve.js';
import { IntegrationLogger } from './db/integrationLogger.js';

export async function runScheduledSync(env, { sync = syncRingsnitchCalls, syncReference = syncRingsnitchReference, now = new Date() } = {}) {
  if (now.getUTCMinutes() >= 30 && !isBusinessHours(now)) return undefined;
  const db = createDb(env.DATABASE_URL);
  const api = new RingSnitchApiService({
    readKey: env.RINGSNITCH_READKEY,
    accountId: env.RINGSNITCH_ACCOUNT_ID,
    logger: new IntegrationLogger(db),
  });
  // Trackers and users rarely change and have no date filter, so they are re-read in full only twice a day
  // (2 requests each time). They run after the calls so a failure there can't block calls.
  // A failure is already in hp.integration_logs (run_end); don't let it crash the Worker.
  let result;
  try {
    result = await sync({ api, db, mode: 'incremental' });
  } catch (err) {
    console.error(`scheduled ringsnitch sync failed: ${err.message}`);
  }
  if (isReferenceSyncSlot(now)) {
    try {
      await syncReference({ api, db });
    } catch (err) {
      console.error(`scheduled ringsnitch trackers/users sync failed: ${err.message}`);
    }
  }
  return result;
}

// Second cron: at :15 every hour, link whatever the syncs have landed to people and employees (src/identity/resolve.js).
// Separate expression so the Ringsnitch handler above does not also run at :15. Must match [triggers] in wrangler.toml.
export const IDENTITY_CRON = '15 * * * *';

export async function runIdentityJob(env, { resolve = resolveIdentities } = {}) {
  try {
    return await resolve({ db: createDb(env.DATABASE_URL) });
  } catch (err) {
    console.error(`scheduled identity run failed: ${err.message}`); // also recorded in hp.identity_runs
    return undefined;
  }
}

// Third cron: once a day, read the answering service's directory for new daily files (posted at 07:00 service time).
// 13:30 UTC is 08:30 Chicago in summer and 07:30 in winter. The hourly :15 identity job then links the new messages.
// Incremental: only files that are new or changed are downloaded. Must match [triggers] in wrangler.toml.
export const MOSTLYANSWERED_CRON = '30 13 * * *';

export async function runMostlyansweredSync(env, { sync = syncMostlyanswered } = {}) {
  const db = createDb(env.DATABASE_URL);
  const api = new MostlyansweredApiService({
    baseUrl: env.MOSTLY_ANSWERED_URL,
    username: env.MOSTLY_ANSWERED_USER,
    password: env.MOSTLY_ANSWERED_PASS,
    logger: new IntegrationLogger(db),
  });
  try {
    return await sync({ api, db, mode: 'incremental' });
  } catch (err) {
    console.error(`scheduled mostlyanswered sync failed: ${err.message}`); // also in hp.integration_logs (run_end)
    return undefined;
  }
}
