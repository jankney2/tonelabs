import { ExternalApiService, ApiError } from '../src/integrations/ExternalApiService.js';

const res = (status, body = {}, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const make = (responses, extra = {}) => {
  const logs = [];
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return responses.shift(); };
  const api = new ExternalApiService({
    baseUrl: 'https://x.test/', source: 'x', fetchImpl, maxRetries: 2,
    logger: { write: async (e) => { logs.push(e); } }, ...extra,
  });
  return { api, logs, calls };
};

test('sends auth header and logs a request row with the run id', async () => {
  const { api, logs, calls } = make([res(200, { ok: 1 })], { auth: { type: 'bearer', token: 'secret' } });
  const runId = await api.startRun('go');
  expect(await api.getJson('/a', { query: { q: 1 } })).toEqual({ ok: 1 });
  await api.finishRun({ rows: 1 });
  expect(calls[0].init.headers.Authorization).toBe('Bearer secret');
  expect(logs.map((l) => l.event)).toEqual(['run_start', 'request', 'run_end']);
  expect(logs[1]).toMatchObject({ source: 'x', runId, path: '/a?q=1', status: 200 });
});

test('retries 5xx then succeeds, logging each attempt', async () => {
  const { api, logs } = make([res(503), res(200, {})]);
  api.maxRetries = 1;
  await api.getJson('/a');
  expect(logs.map((l) => `${l.event}:${l.status}`)).toEqual(['error:503', 'request:200']);
});

test('throws ApiError on 4xx and never logs a query-string credential', async () => {
  const { api, logs } = make([res(403, { error: 'scope' })], { auth: { type: 'query', name: 'key', token: 'secret' } });
  await expect(api.getJson('/a')).rejects.toBeInstanceOf(ApiError);
  expect(JSON.stringify(logs)).not.toContain('secret');
});

test('a failing logger does not break the request', async () => {
  const { api } = make([res(200, { ok: 1 })], { logger: { write: async () => { throw new Error('db down'); } } });
  // The IntegrationLogger swallows its own errors; a raw throwing sink must still not crash callers.
  await expect(api.getJson('/a')).resolves.toEqual({ ok: 1 });
});
