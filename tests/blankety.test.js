import { jest } from '@jest/globals';
import { BlanketyApiService } from '../src/integrations/blankety/BlanketyApiService.js';
import { syncBlanketyForms } from '../src/integrations/blankety/syncForms.js';
import { syncBlanketySubmissions } from '../src/integrations/blankety/syncSubmissions.js';

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const envelope = (content, count = Array.isArray(content) ? content.length : 0, limit = 20) =>
  ({ responseCode: 200, message: 'success', content, resultSet: { offset: 0, limit, count } });
const sub = (id) => ({ id, form_id: 'F1', created_at: '2026-10-16 14:59:36', status: 'ACTIVE', answers: {} });

function make(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return responses.shift(); };
  return { api: new BlanketyApiService({ apiKey: 'key', fetchImpl, maxRetries: 0 }), calls };
}

test('sends the key in the APIKEY header, never in the URL', async () => {
  const { api, calls } = make([json(200, envelope([]))]);
  await api.getFormsPage();
  expect(calls[0].init.headers.APIKEY).toBe('key');
  expect(calls[0].url).not.toMatch(/key/);
});

test('records the daily rate limit headers', async () => {
  const { api } = make([json(200, envelope([]), { 'x-rate-limit-limit': '1000', 'x-rate-limit-remaining': '997', 'x-rate-limit-window': '86400' })]);
  await api.getFormsPage();
  expect(api.rateLimit).toEqual({ limit: '1000', remaining: '997', window: '86400' });
});

test('submissions request passes paging and the time window', async () => {
  const { api, calls } = make([json(200, envelope([]))]);
  await api.getSubmissionsPage('F1', { offset: 1000, createdAfter: '2026-10-14 00:00:00' });
  const u = new URL(calls[0].url);
  expect(u.pathname).toBe('/v1/form/F1/submissions');
  expect(Object.fromEntries(u.searchParams)).toMatchObject({ offset: '1000', limit: '1000', created_after: '2026-10-14 00:00:00' });
});

test('paginate follows offsets until a short page', async () => {
  const { api, calls } = make([json(200, envelope([1, 2])), json(200, envelope([3, 4])), json(200, envelope([5]))]);
  const seen = [];
  for await (const b of api.paginate((offset) => api.getFormsPage({ offset, limit: 2 }), 2)) seen.push(...b.content);
  expect(seen).toEqual([1, 2, 3, 4, 5]);
  expect(calls.map((c) => new URL(c.url).searchParams.get('offset'))).toEqual(['0', '2', '4']);
});

// A db where reads are empty and writes succeed: proves wiring, not SQL (the live run exercises the SQL).
const makeDb = (maxCreated = null) => ({
  select: () => ({ from: () => Object.assign(Promise.resolve([{ t: maxCreated }]), { where: async () => [] }) }),
  insert: () => ({ values: () => ({ onConflictDoUpdate: () => 'upsert' }) }),
  batch: jest.fn(async () => {}),
  update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
});
const runMarkers = () => ({ startRun: jest.fn(async () => {}), finishRun: jest.fn(async () => {}), rateLimit: null });
async function* pages(...bodies) { for (const b of bodies) yield b; }

test('forms sync lands forms and each form\'s questions, keyed by form id', async () => {
  const api = {
    ...runMarkers(),
    getFormsPage: jest.fn(),
    paginate: () => pages(envelope([{ id: 'F1' }, { id: 'F2' }])),
    getQuestions: async (id) => envelope({ 3: { qid: '3', name: 'fullName' }, 4: { qid: '4', name: 'email' } }),
  };
  const { stats, formIds } = await syncBlanketyForms({ api, db: makeDb() });
  expect(formIds).toEqual(['F1', 'F2']);
  expect(stats).toMatchObject({ forms: { fetched: 2, new: 2 }, questions: { fetched: 4, new: 4 } }); // F1:3 and F2:3 are distinct
});

test('submissions sync lands every page for every form', async () => {
  const api = { ...runMarkers(), getSubmissionsPage: jest.fn(), paginate: () => pages(envelope([sub('A'), sub('B')], 1000), envelope([sub('C')], 1)) };
  const stats = await syncBlanketySubmissions({ api, db: makeDb(), formIds: ['F1'], mode: 'full' });
  expect(stats).toMatchObject({ mode: 'full', pages: 2, submissions: { fetched: 3, new: 3 } });
  expect(api.finishRun).toHaveBeenCalledWith(stats);
});

test('submissions sync: --max-pages stops early and never flags missing', async () => {
  const api = { ...runMarkers(), paginate: () => pages(envelope([sub('A')], 1000), envelope([sub('B')], 1)) };
  const stats = await syncBlanketySubmissions({ api, db: makeDb(), formIds: ['F1'], mode: 'full', maxPages: 1 });
  expect(stats.pages).toBe(1);
  expect(stats.submissions.missing).toBe(0);
});

test('incremental starts 2 days before the newest submission; empty table becomes a full run', async () => {
  const seen = [];
  const api = { ...runMarkers(), getSubmissionsPage: async (f, o) => { seen.push(o.createdAfter); return envelope([]); }, paginate(fetchPage) { return (async function* () { yield await fetchPage(0); })(); } };
  const inc = await syncBlanketySubmissions({ api, db: makeDb('2026-10-16 14:59:36'), formIds: ['F1'] });
  expect(inc).toMatchObject({ mode: 'incremental', createdAfter: '2026-10-14 14:59:36' });
  expect(seen).toEqual(['2026-10-14 14:59:36']);
  expect((await syncBlanketySubmissions({ api, db: makeDb(null), formIds: ['F1'] })).mode).toBe('full');
});

test('failures are audited', async () => {
  const bad = { ...runMarkers(), paginate: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error('boom'); } }) }) };
  await expect(syncBlanketySubmissions({ api: bad, db: makeDb(), formIds: ['F1'], mode: 'full' })).rejects.toThrow('boom');
  expect(bad.finishRun).toHaveBeenCalledWith(expect.anything(), { error: expect.any(Error) });
});
