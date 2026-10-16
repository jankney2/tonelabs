// Pull Blankety into its raw tables: forms, questions, form submissions.
//   node scripts/sync-blankety.js --full                 whole history
//   node scripts/sync-blankety.js                        incremental (submissions created since newest - 2 days)
//   node scripts/sync-blankety.js --full --max-pages 1   limit submission pages per form (1,000 each), for testing
// Limit: 1,000 API calls/day for the whole account. A run costs about 2 + 2 per form + 1 per 1,000 submissions.
import './load-env.js';
import { BlanketyApiService } from '../src/integrations/blankety/BlanketyApiService.js';
import { syncBlanketyForms } from '../src/integrations/blankety/syncForms.js';
import { syncBlanketySubmissions } from '../src/integrations/blankety/syncSubmissions.js';
import { createDb } from '../src/db/index.js';
import { IntegrationLogger } from '../src/db/integrationLogger.js';

const args = process.argv.slice(2);
const mode = args.includes('--full') ? 'full' : 'incremental';
const mp = args.indexOf('--max-pages');
const maxPages = mp >= 0 ? Number(args[mp + 1]) : Infinity;

const db = createDb(process.env.DATABASE_URL);
const api = new BlanketyApiService({
  apiKey: process.env.BLANKETY_KEY,
  logger: new IntegrationLogger(db),
});
try {
  const { stats, formIds } = await syncBlanketyForms({ api, db });
  console.log(stats);
  console.log(await syncBlanketySubmissions({ api, db, formIds, mode, maxPages }));
} catch (e) {
  console.error('sync failed:', e.message);
  process.exitCode = 1;
}
