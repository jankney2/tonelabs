import { jest } from '@jest/globals';
import { parseCsv, parseCsvObjects } from '../src/integrations/mostlyanswered/csv.js';
import { MostlyansweredApiService, parseListing } from '../src/integrations/mostlyanswered/MostlyansweredApiService.js';
import { contentHash } from '../src/integrations/hash.js';
import { syncMostlyanswered } from '../src/integrations/mostlyanswered/syncMessages.js';

const LISTING = `<html><body><table><tr><th>Name</th><th>Last modified</th><th>Size</th></tr><tr><th colspan="3"><hr></th></tr>
<tr><td><a href="/files/">Parent Directory</a></td><td></td><td>-</td></tr>
<tr><td><a href="Harlow_Pike_Messages_2026-08-22.csv">Harlow_Pike_Messages_2026-08-22.csv</a></td><td>22-Aug-2026 07:00</td><td>1.8K</td></tr>
<tr><td><a href="Harlow_Pike_Messages_2026-08-23.csv">Harlow_Pike_Messages_2026-08-23.csv</a></td><td>23-Aug-2026 07:00</td><td>3.8K</td></tr>
<tr><td><a href="notes.txt">notes.txt</a></td><td>23-Aug-2026 07:00</td><td>1K</td></tr></table></body></html>`;
const CSV = 'Date/Time Taken,Caller Name,Callback Number,Message,Operator,Promised\r\n' +
  '8/21/26 11:00 AM,Ann Lee,812-555-0156,"New matter (family): custody, schedule. ""Urgent""",RM,Callback within 24 hrs\r\n' +
  '8/21/26 12:02 PM,Bo Kim,630-555-0154,Sales call,KL,\r\n';

test('csv: quotes, escaped quotes, commas, CRLF and empty trailing field', () => {
  const rows = parseCsvObjects(CSV);
  expect(rows).toHaveLength(2);
  expect(rows[0]['Message']).toBe('New matter (family): custody, schedule. "Urgent"');
  expect(rows[1].Promised).toBe('');
  expect(parseCsv('a,b\n\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
});

test('listing: keeps file rows, drops the parent link', () => {
  expect(parseListing(LISTING).map((f) => f.name)).toEqual(['Harlow_Pike_Messages_2026-08-22.csv', 'Harlow_Pike_Messages_2026-08-23.csv', 'notes.txt']);
  expect(parseListing(LISTING)[0]).toEqual({ name: 'Harlow_Pike_Messages_2026-08-22.csv', last_modified: '22-Aug-2026 07:00', size: '1.8K' });
});

test('service: basic auth, directory base, file path', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return new Response(calls.length === 1 ? LISTING : CSV); };
  const api = new MostlyansweredApiService({ baseUrl: 'https://x.test/files/harlowpike/', username: 'u', password: 'p', fetchImpl, maxRetries: 0 });
  await api.listFiles();
  const rows = await api.getFile('Harlow_Pike_Messages_2026-08-22.csv');
  expect(calls[0].init.headers.Authorization).toBe(`Basic ${btoa('u:p')}`);
  expect(calls[1].url).toBe('https://x.test/files/harlowpike/Harlow_Pike_Messages_2026-08-22.csv');
  expect(rows[1]['Caller Name']).toBe('Bo Kim');
});

const makeDb = (held = []) => ({
  select: () => ({ from: () => Object.assign(Promise.resolve(held), { where: async () => [] }) }),
  insert: () => ({ values: () => ({ onConflictDoUpdate: () => 'upsert' }) }),
  batch: jest.fn(async () => {}),
  update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
});
const makeApi = () => ({
  startRun: jest.fn(async () => {}), finishRun: jest.fn(async () => {}),
  listFiles: async () => parseListing(LISTING),
  getFile: jest.fn(async () => parseCsvObjects(CSV)),
});

test('sync: downloads each csv, ignores other files, audits the run', async () => {
  const api = makeApi();
  const stats = await syncMostlyanswered({ api, db: makeDb(), mode: 'full' });
  expect(api.getFile).toHaveBeenCalledTimes(2);
  expect(stats).toMatchObject({ downloaded: 2, skippedNames: ['notes.txt'] });
  expect(stats.messages.new).toBe(4); // 2 lines in each of 2 files, keyed by file:line
  expect(api.finishRun).toHaveBeenCalledWith(stats);
});

test('sync: incremental skips files whose listing entry is unchanged', async () => {
  const api = makeApi();
  const [a] = parseListing(LISTING);
  const stats = await syncMostlyanswered({ api, db: makeDb([{ sourceId: a.name, contentHash: await contentHash(a) }]), mode: 'incremental' });
  expect(api.getFile).toHaveBeenCalledTimes(1);
  expect(api.getFile).toHaveBeenCalledWith('Harlow_Pike_Messages_2026-08-23.csv');
  expect(stats.downloaded).toBe(1);
});

test('sync: a failed download is audited and rethrown', async () => {
  const api = makeApi();
  api.getFile.mockRejectedValue(new Error('boom'));
  await expect(syncMostlyanswered({ api, db: makeDb(), mode: 'full' })).rejects.toThrow('boom');
  expect(api.finishRun).toHaveBeenCalledWith(expect.anything(), { error: expect.any(Error) });
});
