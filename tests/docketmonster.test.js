import { jest } from '@jest/globals';
import { DocketmonsterApiService } from '../src/integrations/docketmonster/DocketmonsterApiService.js';
import { syncDocketmonsterMatters } from '../src/integrations/docketmonster/syncMatters.js';
import { buildEnvelope, decodeXml, parseMatters, parseFault } from '../src/integrations/docketmonster/soap.js';

const xml = (status, body) => new Response(body, { status, headers: { 'content-type': 'text/xml' } });
const envelope = (inner) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="x"><soap:Body>${inner}</soap:Body></soap:Envelope>`;
const matter = (n, extra = '') => `<Matter><MatterNumber>${n}</MatterNumber><ClientName>Smith, A</ClientName><ClientPhone>(305) 555-0146</ClientPhone><OpenedDate>2026-10-01T09:43:09</OpenedDate><EstimatedFee>2400.0000</EstimatedFee>${extra}<Status>Open</Status></Matter>`;
const list = (...m) => envelope(`<GetMattersOpenedResponse xmlns="http://docketmonster.com/cm9/"><GetMattersOpenedResult>${m.join('')}</GetMattersOpenedResult></GetMattersOpenedResponse>`);
const fault = envelope('<soap:Fault><faultcode>soap:Server</faultcode><faultstring>Matter NOPE was not found.</faultstring><detail><ErrorCode>NOT_FOUND</ErrorCode></detail></soap:Fault>');

function make(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return responses.shift(); };
  const api = new DocketmonsterApiService({ firmCode: 'F1', username: 'u', password: 'p&<w>', fetchImpl, maxRetries: 0 });
  return { api, calls };
}

test('envelope carries the AuthHeader, escapes credentials and names the operation', () => {
  const e = buildEnvelope('GetMattersOpened', { FromDate: '2026-01-01', ToDate: '2026-01-31' }, { firmCode: 'F1', username: 'u', password: 'p&<w>' });
  expect(e).toContain('<FirmCode>F1</FirmCode>');
  expect(e).toContain('<Password>p&#38;&#60;w&#62;</Password>');
  expect(e).toContain('<GetMattersOpened xmlns="http://docketmonster.com/cm9/"><FromDate>2026-01-01</FromDate>');
});

test('parsing keeps every field as a string, decodes entities, tolerates empty and unknown elements', () => {
  const [m] = parseMatters(list(matter('HP-1', '<MatterDescription>Smith &amp; Sons &#233;</MatterDescription><ReferralSource/><Extra>x</Extra>')));
  expect(m).toMatchObject({ MatterNumber: 'HP-1', EstimatedFee: '2400.0000', MatterDescription: 'Smith & Sons é', ReferralSource: '', Extra: 'x' });
  expect(decodeXml('&lt;a&gt; &quot;q&quot;')).toBe('<a> "q"');
  expect(parseFault(fault)).toEqual({ faultcode: 'soap:Server', faultstring: 'Matter NOPE was not found.', errorCode: 'NOT_FOUND' });
  expect(parseFault(list())).toBeNull();
});

test('getMattersOpened posts to the asmx with SOAPAction and returns matters', async () => {
  const { api, calls } = make([xml(200, list(matter('A'), matter('B')))]);
  const rows = await api.getMattersOpened('2026-10-01', '2026-10-31');
  expect(rows.map((r) => r.MatterNumber)).toEqual(['A', 'B']);
  expect(calls[0].url).toBe('https://docketmonster.tone.fyi/CaseManager9/MatterService.asmx');
  expect(calls[0].init.method).toBe('POST');
  expect(calls[0].init.headers.SOAPAction).toBe('"http://docketmonster.com/cm9/GetMattersOpened"');
});

test('getMatterCount reads the number; a SOAP fault becomes an ApiError with its code', async () => {
  const { api } = make([xml(200, envelope('<GetMatterCountResponse><GetMatterCountResult>259</GetMatterCountResult></GetMatterCountResponse>')), xml(500, fault)]);
  expect(await api.getMatterCount('2020-01-01', '2026-12-31')).toBe(259);
  await expect(api.getMatter('NOPE')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 500, message: expect.stringContaining('was not found') });
});

test('credentials are required', () => {
  expect(() => new DocketmonsterApiService({ firmCode: 'F1' })).toThrow(/required/);
});

// A db where reads are empty and writes succeed: proves wiring, not SQL (the live run exercises the SQL).
const makeDb = (maxOpened = null) => ({
  select: () => ({ from: () => Object.assign(Promise.resolve([{ t: maxOpened }]), { where: async () => [] }) }),
  insert: () => ({ values: () => ({ onConflictDoUpdate: () => 'upsert' }) }),
  batch: jest.fn(async () => {}),
  update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: 'gone' }] }) }) }),
});
const fakeApi = (rows) => ({ startRun: jest.fn(async () => {}), finishRun: jest.fn(async () => {}), getMattersOpened: jest.fn(async () => rows) });
const NOW = new Date('2026-10-16T20:00:00Z');

test('full sync asks for everything up to tomorrow and flags missing matters', async () => {
  const api = fakeApi([{ MatterNumber: 'A' }, { MatterNumber: 'B' }, { MatterNumber: 'B' }]);
  const stats = await syncDocketmonsterMatters({ api, db: makeDb(), mode: 'full', now: NOW });
  expect(api.getMattersOpened).toHaveBeenCalledWith('2000-01-01', '2026-10-17');
  expect(stats).toMatchObject({ mode: 'full', matters: { fetched: 2, new: 2, missing: 1 } });
  expect(api.finishRun).toHaveBeenCalledWith(stats);
});

test('incremental starts 30 days before the newest opened date, never flags missing; empty table becomes full', async () => {
  const api = fakeApi([{ MatterNumber: 'A' }]);
  const inc = await syncDocketmonsterMatters({ api, db: makeDb('2026-10-16T12:48:58'), now: NOW });
  expect(api.getMattersOpened).toHaveBeenCalledWith('2026-09-16', '2026-10-17');
  expect(inc).toMatchObject({ mode: 'incremental', matters: { missing: 0 } });
  expect((await syncDocketmonsterMatters({ api, db: makeDb(null), now: NOW })).mode).toBe('full');
});

test('failures are audited', async () => {
  const api = fakeApi([]);
  api.getMattersOpened.mockRejectedValue(new Error('boom'));
  await expect(syncDocketmonsterMatters({ api, db: makeDb(), mode: 'full' })).rejects.toThrow('boom');
  expect(api.finishRun).toHaveBeenCalledWith(expect.anything(), { error: expect.any(Error) });
});
