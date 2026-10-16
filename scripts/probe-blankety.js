// Prototype: tiny read-only look at each Blankety endpoint. Prints structure and one record.
// Usage: node scripts/probe-blankety.js   (never prints the key). Budget: 1,000 calls/day, this uses ~2 + 2 per form.
import './load-env.js';
const BASE = 'https://blankety.tone.fyi';
let calls = 0;
const get = async (path, query = {}) => {
  calls++;
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { APIKEY: process.env.BLANKETY_KEY, Accept: 'application/json' } });
  const text = await res.text();
  console.log(`\n== GET ${path} ${JSON.stringify(query)} -> ${res.status}`);
  console.log('headers:', JSON.stringify(Object.fromEntries([...res.headers].filter(([k]) => /rate|retry|limit|date/i.test(k)))));
  try { return JSON.parse(text); } catch { console.log(text.slice(0, 300)); return null; }
};
const forms = await get('/v1/user/forms');
console.log(JSON.stringify(forms, null, 2).slice(0, 1500));
for (const f of (forms?.content ?? []).slice(0, 3)) {
  const id = f.id ?? f.formId;
  const q = await get(`/v1/form/${id}/questions`);
  console.log(JSON.stringify(q, null, 2).slice(0, 2500));
  const s = await get(`/v1/form/${id}/submissions`, { limit: 3 });
  console.log('keys:', Object.keys(s ?? {}), 'resultSet:', JSON.stringify(s?.resultSet));
  console.log(JSON.stringify(s?.content?.[0], null, 2));
}
console.log('\ncalls used:', calls);
