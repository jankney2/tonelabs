// Prototype: one read-only page of Ringsnitch calls, with requests audited to hp.integration_logs.
// Usage: node scripts/probe-ringsnitch.js   (never prints the key)
import './load-env.js';
import { RingSnitchApiService } from '../src/integrations/ringsnitch/RingSnitchApiService.js';
import { createDb } from '../src/db/index.js';
import { IntegrationLogger } from '../src/db/integrationLogger.js';

const api = new RingSnitchApiService({
  readKey: process.env.RINGSNITCH_READKEY,
  accountId: process.env.RINGSNITCH_ACCOUNT_ID,
  logger: new IntegrationLogger(createDb(process.env.DATABASE_URL)),
});
await api.startRun('probe');
try {
  const page = await api.getCallsPage({ perPage: 5 });
  console.log(`got ${page.calls.length} of ${page.total_records}`);
  await api.finishRun({ rowsFetched: page.calls.length });
} catch (e) {
  await api.finishRun({}, { error: e });
  throw e;
}
