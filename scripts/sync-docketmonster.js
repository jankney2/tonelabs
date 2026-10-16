// Pull Docketmonster matters into hp.raw_docketmonster_matters.
//   node scripts/sync-docketmonster.js --full   every matter (one SOAP call)
//   node scripts/sync-docketmonster.js          incremental (opened since newest - 30 days)
// No paging and no stated rate limit, so --max-pages does not apply.
import './load-env.js';
import { DocketmonsterApiService } from '../src/integrations/docketmonster/DocketmonsterApiService.js';
import { syncDocketmonsterMatters } from '../src/integrations/docketmonster/syncMatters.js';
import { createDb } from '../src/db/index.js';
import { IntegrationLogger } from '../src/db/integrationLogger.js';

const mode = process.argv.includes('--full') ? 'full' : 'incremental';
const db = createDb(process.env.DATABASE_URL);
const api = new DocketmonsterApiService({
  firmCode: process.env.DOCKETMONSTER_FIRM_CODE,
  username: process.env.DOCKETMONSTER_USER,
  password: process.env.DOCKETMONSTER_PASS,
  logger: new IntegrationLogger(db),
});
try {
  console.log(await syncDocketmonsterMatters({ api, db, mode }));
} catch (e) {
  console.error('sync failed:', e.message);
  process.exitCode = 1;
}
