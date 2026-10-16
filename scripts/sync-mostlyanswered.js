// Pull the Mostlyanswered answering-service files into raw_mostlyanswered_files / raw_mostlyanswered_messages.
//   node scripts/sync-mostlyanswered.js --full               download every daily file
//   node scripts/sync-mostlyanswered.js                      incremental (only new or changed files)
//   node scripts/sync-mostlyanswered.js --full --max-pages 5 download at most 5 files (testing; "pages" = files here)
import './load-env.js';
import { MostlyansweredApiService } from '../src/integrations/mostlyanswered/MostlyansweredApiService.js';
import { syncMostlyanswered } from '../src/integrations/mostlyanswered/syncMessages.js';
import { createDb } from '../src/db/index.js';
import { IntegrationLogger } from '../src/db/integrationLogger.js';

const args = process.argv.slice(2);
const mode = args.includes('--full') ? 'full' : 'incremental';
const mp = args.indexOf('--max-pages');
const maxFiles = mp >= 0 ? Number(args[mp + 1]) : Infinity;

const db = createDb(process.env.DATABASE_URL);
const api = new MostlyansweredApiService({
  baseUrl: process.env.MOSTLY_ANSWERED_URL,
  username: process.env.MOSTLY_ANSWERED_USER,
  password: process.env.MOSTLY_ANSWERED_PASS,
  logger: new IntegrationLogger(db),
});
try {
  console.log(await syncMostlyanswered({ api, db, mode, maxFiles }));
} catch (e) {
  console.error('sync failed:', e.message);
  process.exitCode = 1;
}
