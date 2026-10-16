import { jest } from '@jest/globals';
import { LawllamaApiService } from '../src/integrations/lawllama/LawllamaApiService.js';
import { redactBody, REDACTED_CONTACT_FIELDS } from '../src/integrations/lawllama/redact.js';
import { syncLawllamaLeads } from '../src/integrations/lawllama/syncLeads.js';
import { syncLawllamaReference } from '../src/integrations/lawllama/syncReference.js';

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const contact = (id) => ({ type: 'contacts', id, attributes: { first_name: 'A', phone: '412.555.0162', email: 'a@x.net', ssn: '000-75-7392', date_of_birth: '1995-01-06', immigration_status: 'Unknown' } });
const lead = (id, cid) => ({ type: 'leads', id, attributes: { updated_at: 1 }, relationships: { contact: { data: { type: 'contacts', id: cid } } } });

function make(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return responses.shift(); };
  const api = new LawllamaApiService({ token: 'tok', fetchImpl, maxRetries: 0, minIntervalMs: 0 });
  return { api, calls };
}

test('sends the bearer token and spaces requests', async () => {
  const { api, calls } = make([json(200, { data: [] }), json(200, { data: [] })]);
  api.minIntervalMs = 80;
  const t = Date.now();
  await api.getLeadStatuses();
  await api.getLeadStatuses();
  expect(Date.now() - t).toBeGreaterThanOrEqual(75);
  expect(calls[0].init.headers.Authorization).toBe('Bearer tok');
});

test('records the rate limit headers', async () => {
  const { api } = make([json(200, { data: [] }, { 'x-rate-limit-limit': '120', 'x-rate-limit-remaining': '119', 'x-rate-limit-window': '60' })]);
  await api.getLeadStatuses();
  expect(api.rateLimit).toEqual({ limit: '120', remaining: '119', window: '60' });
});

test('quota_exceeded gets a clear message', async () => {
  const { api } = make([json(429, { errors: [{ status: '429', code: 'quota_exceeded' }] })]);
  await expect(api.getLeadStatuses()).rejects.toThrow(/monthly record quota/);
});

test('contacts are redacted in lists, includes and single reads; other resources untouched', async () => {
  const { api } = make([
    json(200, { data: [lead('1', '9')], included: [contact('9')], has_more: false }),
    json(200, { data: contact('9') }),
  ]);
  const page = await api.getLeadsPage({ limit: 1 });
  for (const f of REDACTED_CONTACT_FIELDS) expect(page.included[0].attributes).not.toHaveProperty(f);
  expect(page.included[0].attributes.phone).toBe('412.555.0162');
  expect(page.data[0]).toEqual(lead('1', '9'));
  const single = await api.getContact('9');
  for (const f of REDACTED_CONTACT_FIELDS) expect(single.data.attributes).not.toHaveProperty(f);
  expect(JSON.stringify(redactBody({ data: [contact('1')], included: [contact('2')] }))).not.toMatch(/000-75|1995-01|Unknown/);
});

test('leads request asks for contacts and passes cursor and updated_since', async () => {
  const { api, calls } = make([json(200, { data: [], has_more: false })]);
  await api.getLeadsPage({ cursor: 'c1', updatedSince: 1000 });
  const u = new URL(calls[0].url);
  expect(u.pathname).toBe('/v1/leads');
  expect(Object.fromEntries(u.searchParams)).toMatchObject({ cursor: 'c1', updated_since: '1000', include: 'contact', limit: '100' });
});

// A db where reads are empty and writes succeed: proves wiring, not SQL (the live run exercises the SQL).
const makeDb = () => ({
  select: () => ({ from: () => Object.assign(Promise.resolve([{ t: null }]), { where: async () => [] }) }),
  insert: () => ({ values: () => ({ onConflictDoUpdate: () => 'upsert' }) }),
  batch: jest.fn(async () => {}),
  update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
});
const runMarkers = () => ({ startRun: jest.fn(async () => {}), finishRun: jest.fn(async () => {}), rateLimit: null });
async function* pages(...bodies) { for (const b of bodies) yield b; }

test('lead sync lands leads and their contacts, deduping repeated contacts', async () => {
  const api = {
    ...runMarkers(), getLeadsPage: jest.fn(),
    paginate: () => pages(
      { data: [lead('1', '9'), lead('2', '9')], included: [contact('9'), contact('9')], has_more: true },
      { data: [lead('3', '8')], included: [contact('8')], has_more: false }),
  };
  const stats = await syncLawllamaLeads({ api, db: makeDb(), mode: 'full' });
  expect(stats).toMatchObject({ mode: 'full', pages: 2, leads: { fetched: 3, new: 3 }, contacts: { fetched: 2 } });
  expect(api.finishRun).toHaveBeenCalledWith(stats);
});

test('lead sync: --max-pages stops early and never flags missing', async () => {
  const api = { ...runMarkers(), paginate: () => pages({ data: [lead('1', '9')], included: [contact('9')], has_more: true }, { data: [lead('2', '9')], has_more: false }) };
  const stats = await syncLawllamaLeads({ api, db: makeDb(), mode: 'full', maxPages: 1 });
  expect(stats.pages).toBe(1);
  expect(stats.leads.missing).toBe(0);
});

test('lead sync: an empty table makes incremental a full run; failures are audited', async () => {
  const api = { ...runMarkers(), paginate: () => pages({ data: [], has_more: false }) };
  expect((await syncLawllamaLeads({ api, db: makeDb() })).mode).toBe('full');
  const bad = { ...runMarkers(), paginate: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error('boom'); } }) }) };
  await expect(syncLawllamaLeads({ api: bad, db: makeDb(), mode: 'full' })).rejects.toThrow('boom');
  expect(bad.finishRun).toHaveBeenCalledWith(expect.anything(), { error: expect.any(Error) });
});

test('reference sync lands statuses and all pages of users', async () => {
  const api = {
    ...runMarkers(),
    getLeadStatuses: async () => ({ data: [{ id: '1' }, { id: '2' }] }),
    getUsersPage: jest.fn(),
    paginate: () => pages({ data: [{ id: '7' }], has_more: true }, { data: [{ id: '8' }], has_more: false }),
  };
  const stats = await syncLawllamaReference({ api, db: makeDb() });
  expect(stats.leadStatuses).toMatchObject({ fetched: 2, new: 2 });
  expect(stats.users).toMatchObject({ fetched: 2, new: 2 });
});
