// Pull Lawllama into its raw tables: leads (with contacts), lead statuses, users.
//   node scripts/sync-lawllama.js --full                 whole history (mind the monthly record quota!)
//   node scripts/sync-lawllama.js                        incremental (leads updated since newest - 2 days)
//   node scripts/sync-lawllama.js --full --max-pages 2   limit lead pages (100 leads each), for testing
// Limits: 120 requests/60 s (the service spaces requests) and a monthly record quota.
import './load-env.js';
import { LawllamaApiService } from '../src/integrations/lawllama/LawllamaApiService.js';
import { syncLawllamaLeads } from '../src/integrations/lawllama/syncLeads.js';
import { syncLawllamaReference } from '../src/integrations/lawllama/syncReference.js';
import { createDb } from '../src/db/index.js';
import { IntegrationLogger } from '../src/db/integrationLogger.js';

const args = process.argv.slice(2);
const mode = args.includes('--full') ? 'full' : 'incremental';
const mp = args.indexOf('--max-pages');
const maxPages = mp >= 0 ? Number(args[mp + 1]) : Infinity;

const db = createDb(process.env.DATABASE_URL);
const api = new LawllamaApiService({
  token: process.env.LAWLLAMA_BEARER,
  logger: new IntegrationLogger(db),
});
try {
  console.log(await syncLawllamaReference({ api, db }));
  console.log(await syncLawllamaLeads({ api, db, mode, maxPages }));
} catch (e) {
  console.error('sync failed:', e.message);
  process.exitCode = 1;
}
