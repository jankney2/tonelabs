// Prototype: tiny read-only look at each Lawllama endpoint. Prints structure and one record.
// Usage: node scripts/probe-lawllama.js   (never prints the token)
// Mind the monthly record quota: pages are kept at 3 rows and nothing is looped.
import './load-env.js';
import { LawllamaApiService } from '../src/integrations/lawllama/LawllamaApiService.js';
import { createDb } from '../src/db/index.js';
import { IntegrationLogger } from '../src/db/integrationLogger.js';

const api = new LawllamaApiService({
  token: process.env.LAWLLAMA_BEARER,
  logger: new IntegrationLogger(createDb(process.env.DATABASE_URL)),
});
const show = (label, body) => {
  const rows = body.data;
  console.log(`\n== ${label}`);
  console.log('top-level keys:', Object.keys(body).join(', '));
  if (Array.isArray(rows)) console.log(`rows: ${rows.length}, has_more: ${body.has_more}`);
  console.log(JSON.stringify(Array.isArray(rows) ? rows[0] : rows ?? body, null, 2));
};
await api.startRun('probe');
try {
  const leads = await api.getLeadsPage({ limit: 3, include: 'contact' });
  show('GET /v1/leads?limit=3&include=contact', leads);
  if (leads.included) console.log('included[0]:', JSON.stringify(leads.included[0]));
  show('GET /v1/lead_statuses', await api.getLeadStatuses());
  show('GET /v1/users?limit=3', await api.getUsersPage({ limit: 3 }));
  const contactId = leads.data?.[0]?.relationships?.contact?.data?.id ?? leads.data?.[0]?.contact_id;
  if (contactId) show(`GET /v1/contacts/${contactId}`, await api.getContact(contactId));
  console.log('\nrate limit headers:', api.rateLimit);
  await api.finishRun({ rowsFetched: 3 });
} catch (e) {
  await api.finishRun({}, { error: e });
  console.error(e.message, e.status, e.body);
  process.exitCode = 1;
}
