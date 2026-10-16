import { createApp, AUTH_USER } from '../src/app.js';

const PASSWORD = 'test-pass';
const auth = (u, p) => ({ Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });
const env = {
  AUTH_PASSWORD: PASSWORD,
  ASSETS: { fetch: async () => new Response('<h1>Harlow &amp; Pike</h1>', { headers: { 'content-type': 'text/html' } }) },
};
const okDb = () => async () => [{ ok: 1 }];
const badDb = () => async () => { throw new Error('boom'); };

test('health without credentials is 401', async () => {
  const res = await createApp({ getDb: okDb }).request('/api/health', {}, env);
  expect(res.status).toBe(401);
});

test('health with wrong password is 401', async () => {
  const res = await createApp({ getDb: okDb }).request('/api/health', { headers: auth(AUTH_USER, 'nope') }, env);
  expect(res.status).toBe(401);
});

test('health with valid credentials and working DB is 200 ok', async () => {
  const res = await createApp({ getDb: okDb }).request('/api/health', { headers: auth(AUTH_USER, PASSWORD) }, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test('health returns 503 when the DB query throws', async () => {
  const res = await createApp({ getDb: badDb }).request('/api/health', { headers: auth(AUTH_USER, PASSWORD) }, env);
  expect(res.status).toBe(503);
  expect((await res.json()).ok).toBe(false);
});

test('/ serves the hello-world page when authenticated', async () => {
  const res = await createApp({ getDb: okDb }).request('/', { headers: auth(AUTH_USER, PASSWORD) }, env);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('Harlow');
});
