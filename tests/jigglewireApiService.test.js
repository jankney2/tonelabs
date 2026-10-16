import { JigglewireApiService } from '../src/integrations/jigglewire/JigglewireApiService.js';

const json = (status, body) => new Response(JSON.stringify(body), { status });
const token = (n, extra = {}) => json(200, { access_token: `AT${n}`, refresh_token: `RT${n}`, expires_in: 3600, ...extra });

function make(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return responses.shift(); };
  const api = new JigglewireApiService({ clientId: 'cid', clientSecret: 'sec', jwt: 'the.jwt', fetchImpl, maxRetries: 0 });
  return { api, calls };
}
// Skip the 6.5 s spacing between API calls.
const fast = (api) => { Object.defineProperty(api, 'lastRequestAt', { get: () => 0, set() {} }); return api; };

test('exchanges the JWT with Basic client auth and a form body, then calls the API with the bearer token', async () => {
  const { api, calls } = make([token(1), json(200, { records: [] })]);
  fast(api);
  await api.getExtensionsPage();
  const [tok, ext] = calls;
  expect(tok.url).toBe('https://jigglewire.tone.fyi/restapi/oauth/token');
  expect(tok.init.method).toBe('POST');
  expect(tok.init.headers.Authorization).toBe(`Basic ${btoa('cid:sec')}`);
  expect(tok.init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  const form = new URLSearchParams(tok.init.body);
  expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
  expect(form.get('assertion')).toBe('the.jwt');
  expect(ext.init.headers.Authorization).toBe('Bearer AT1');
});

test('reuses the token while it is valid (one token request for many calls)', async () => {
  const { api, calls } = make([token(1), json(200, {}), json(200, {})]);
  fast(api);
  await api.getExtensionsPage();
  await api.getExtensionsPage();
  expect(calls.filter((c) => c.url.includes('/oauth/token'))).toHaveLength(1);
});

test('near expiry it refreshes with the (single-use) refresh token and stores the new one', async () => {
  const { api, calls } = make([token(1), json(200, {}), token(2), json(200, {}), token(3), json(200, {})]);
  fast(api);
  await api.getExtensionsPage();
  api.expiresAt = Date.now() + 1000; // inside the safety margin
  await api.getExtensionsPage();
  expect(new URLSearchParams(calls[2].init.body).get('grant_type')).toBe('refresh_token');
  expect(new URLSearchParams(calls[2].init.body).get('refresh_token')).toBe('RT1');
  expect(calls[3].init.headers.Authorization).toBe('Bearer AT2');
  api.expiresAt = Date.now() + 1000;
  await api.getExtensionsPage();
  expect(new URLSearchParams(calls[4].init.body).get('refresh_token')).toBe('RT2'); // RT1 is never reused
});

test('a failed refresh falls back to the JWT', async () => {
  const { api, calls } = make([token(1), json(200, {}), json(400, { error: 'invalid_grant' }), token(2), json(200, {})]);
  fast(api);
  await api.getExtensionsPage();
  api.expiresAt = Date.now() + 1000;
  await api.getExtensionsPage();
  expect(new URLSearchParams(calls[3].init.body).get('grant_type')).toContain('jwt-bearer');
  expect(calls[4].init.headers.Authorization).toBe('Bearer AT2');
});

test('a 401 mid-run gets a fresh token and retries once', async () => {
  const { api, calls } = make([token(1), json(401, { errorCode: 'TokenInvalid' }), token(2), json(200, { records: [1] })]);
  fast(api);
  expect((await api.getExtensionsPage()).records).toEqual([1]);
  expect(calls[3].init.headers.Authorization).toBe('Bearer AT2');
});

test('paginate follows navigation.nextPage.uri until it is absent', async () => {
  const next = 'https://jigglewire.tone.fyi/restapi/v1.0/account/~/call-log?page=2';
  const { api, calls } = make([token(1), json(200, { records: [1], navigation: { nextPage: { uri: next } } }), json(200, { records: [2], navigation: {} })]);
  fast(api);
  const pages = [];
  for await (const b of api.paginate(() => api.getCallLogPage({ dateFrom: 'x' }))) pages.push(b.records);
  expect(pages).toEqual([[1], [2]]);
  expect(calls[2].url).toBe(next);
  expect(calls[1].url).toContain('view=Detailed');
});

test('requires all three credentials', () => {
  expect(() => new JigglewireApiService({ clientId: 'a' })).toThrow(/required/);
});
