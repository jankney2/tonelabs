// Cloudflare Cron Trigger handler: keeps hp.raw_ringsnitch_calls in sync (calls every run; trackers and users twice a day).
// Runs every 30 minutes (UTC cron can't follow Chicago daylight saving), but outside office hours
// the :30 run is skipped, so it syncs twice an hour in office hours and once an hour otherwise.
// Incremental only (recent calls + overlap), which stays well inside Worker CPU limits and the
// Ringsnitch rate limit (1,000 requests/hour). Full syncs are run by hand: npm run sync:ringsnitch -- --full
import { RingSnitchApiService } from './integrations/ringsnitch/RingSnitchApiService.js';
import { syncRingsnitchCalls } from './integrations/ringsnitch/syncCalls.js';
import { syncRingsnitchReference } from './integrations/ringsnitch/syncReference.js';
import { isBusinessHours, isReferenceSyncSlot } from './officeHours.js';
import { createDb } from './db/index.js';
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
