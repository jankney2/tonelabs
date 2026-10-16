// Cloudflare Cron Trigger handler: keeps hp.raw_ringsnitch_calls in sync.
// Runs every 30 minutes (UTC cron can't follow Chicago daylight saving), but outside office hours
// the :30 run is skipped, so it syncs twice an hour in office hours and once an hour otherwise.
// Incremental only (recent calls + overlap), which stays well inside Worker CPU limits and the
// Ringsnitch rate limit (1,000 requests/hour). Full syncs are run by hand: npm run sync:ringsnitch -- --full
import { RingSnitchApiService } from './integrations/ringsnitch/RingSnitchApiService.js';
import { syncRingsnitchCalls } from './integrations/ringsnitch/syncCalls.js';
import { isBusinessHours } from './officeHours.js';
import { createDb } from './db/index.js';
import { IntegrationLogger } from './db/integrationLogger.js';

export async function runScheduledSync(env, { sync = syncRingsnitchCalls, now = new Date() } = {}) {
  if (now.getUTCMinutes() >= 30 && !isBusinessHours(now)) return undefined;
  const db = createDb(env.DATABASE_URL);
  const api = new RingSnitchApiService({
    readKey: env.RINGSNITCH_READKEY,
    accountId: env.RINGSNITCH_ACCOUNT_ID,
    logger: new IntegrationLogger(db),
  });
  try {
    return await sync({ api, db, mode: 'incremental' });
  } catch (err) {
    // The failure is already in hp.integration_logs (run_end); don't let it crash the Worker.
    console.error(`scheduled ringsnitch sync failed: ${err.message}`);
  }
}
