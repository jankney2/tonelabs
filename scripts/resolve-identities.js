// Link every raw record to a person (by phone), attribute calls to employees, and write the event timeline.
//   node scripts/resolve-identities.js          only records not linked yet; safe to run again
//   node scripts/resolve-identities.js --full   empty the identity tables first and rebuild from the raw tables
// Merges are flagged in hp.match_review, never forced. See src/identity/resolve.js.
import './load-env.js';
import { createDb } from '../src/db/index.js';
import { resolveIdentities, resetIdentity } from '../src/identity/resolve.js';

try {
  const db = createDb(process.env.DATABASE_URL);
  if (process.argv.includes('--full')) await resetIdentity(db);
  console.log(JSON.stringify(await resolveIdentities({ db, log: console.log }), null, 2));
} catch (e) {
  console.error('resolve failed:', e.message);
  process.exitCode = 1;
}
