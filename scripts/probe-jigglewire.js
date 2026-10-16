// Prototype: read-only look at each Jigglewire endpoint (auth + one small page each).
// Usage: node scripts/probe-jigglewire.js   (never prints credentials or tokens)
import './load-env.js';
import { JigglewireApiService } from '../src/integrations/jigglewire/JigglewireApiService.js';

const api = new JigglewireApiService({
  clientId: process.env.JIGGLEWIRE_CLIENT_ID,
  clientSecret: process.env.JIGGLEWIRE_CLIENT_SECRET,
  jwt: process.env.JIGGLEWIRE_JWT,
});
const show = async (label, fn) => {
  try {
    const body = await fn();
    const { records, ...rest } = body;
    console.log(`\n== ${label}\n`, JSON.stringify(rest).slice(0, 600));
    console.log(`records: ${records?.length}`);
    if (records?.[0]) console.log(JSON.stringify(records[0], null, 1).slice(0, 2500));
    return body;
  } catch (e) {
    console.log(`\n== ${label} FAILED`, e.status, e.body ?? e.message);
  }
};
const ext = await show('extensions', () => api.getExtensionsPage({ perPage: 100 }));
await show('call-log', () => api.getCallLogPage({ perPage: 2, dateFrom: '2026-01-01T00:00:00Z' }));
const q = ext?.records?.find((r) => /queue/i.test(r.type));
if (q) await show(`presence ${q.id}`, () => api.getQueuePresence(q.id));
if (ext?.records?.[0]) await show(`voicemail ${ext.records[0].id}`, () => api.getVoicemailPage(ext.records[0].id, { perPage: 2, dateFrom: '2026-01-01T00:00:00Z' }));
