// Pull Ringsnitch calls into hp.raw_ringsnitch_calls, and trackers + users into their raw tables.
//   node scripts/sync-ringsnitch.js --full                 everything available
//   node scripts/sync-ringsnitch.js                        incremental (recent calls + 2 day overlap)
//   node scripts/sync-ringsnitch.js --full --max-pages 3   limit, for testing
import './load-env.js';
import { RingSnitchApiService } from '../src/integrations/ringsnitch/RingSnitchApiService.js';
import { syncRingsnitchCalls } from '../src/integrations/ringsnitch/syncCalls.js';
import { syncRingsnitchReference } from '../src/integrations/ringsnitch/syncReference.js';
import { createDb } from '../src/db/index.js';
import { IntegrationLogger } from '../src/db/integrationLogger.js';

const args = process.argv.slice(2);
const mode = args.includes('--full') ? 'full' : 'incremental';
const mp = args.indexOf('--max-pages');
const maxPages = mp >= 0 ? Number(args[mp + 1]) : Infinity;

const db = createDb(process.env.DATABASE_URL);
const api = new RingSnitchApiService({
  readKey: process.env.RINGSNITCH_READKEY,
  accountId: process.env.RINGSNITCH_ACCOUNT_ID,
  logger: new IntegrationLogger(db),
});
try {
  console.log(await syncRingsnitchCalls({ api, db, mode, maxPages }));
  console.log(await syncRingsnitchReference({ api, db }));
} catch (e) {
  console.error('sync failed:', e.message);
  process.exitCode = 1;
}
