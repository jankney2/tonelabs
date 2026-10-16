// Pull Jigglewire into its raw tables: call log, extensions, queue presence, voicemail.
//   node scripts/sync-jigglewire.js --full                 everything available
//   node scripts/sync-jigglewire.js                        incremental (recent calls/voicemail + 2 day overlap)
//   node scripts/sync-jigglewire.js --full --max-pages 3   limit call-log pages, for testing
// Rate limit is 10 requests/minute, so a run is slow by design (the service spaces its requests).
import './load-env.js';
import { JigglewireApiService } from '../src/integrations/jigglewire/JigglewireApiService.js';
import { syncJigglewireCallLog } from '../src/integrations/jigglewire/syncCallLog.js';
import { syncJigglewireReference } from '../src/integrations/jigglewire/syncReference.js';
import { createDb } from '../src/db/index.js';
import { IntegrationLogger } from '../src/db/integrationLogger.js';

const args = process.argv.slice(2);
const mode = args.includes('--full') ? 'full' : 'incremental';
const mp = args.indexOf('--max-pages');
const maxPages = mp >= 0 ? Number(args[mp + 1]) : Infinity;

const db = createDb(process.env.DATABASE_URL);
const api = new JigglewireApiService({
  clientId: process.env.JIGGLEWIRE_CLIENT_ID,
  clientSecret: process.env.JIGGLEWIRE_CLIENT_SECRET,
  jwt: process.env.JIGGLEWIRE_JWT,
  logger: new IntegrationLogger(db),
});
try {
  console.log(await syncJigglewireCallLog({ api, db, mode, maxPages }));
  console.log(await syncJigglewireReference({ api, db, mode }));
} catch (e) {
  console.error('sync failed:', e.message);
  process.exitCode = 1;
}
