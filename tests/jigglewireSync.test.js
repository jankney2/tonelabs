import { jest } from '@jest/globals';
import { syncJigglewireCallLog } from '../src/integrations/jigglewire/syncCallLog.js';
import { syncJigglewireReference } from '../src/integrations/jigglewire/syncReference.js';

// A db where every read is empty and every write succeeds: proves the wiring, not the SQL
// (the SQL is exercised by the live run against the real database).
const makeDb = () => ({
  select: () => ({ from: () => Object.assign(Promise.resolve([{ t: null }]), { where: async () => [] }) }),
  insert: () => ({ values: () => ({ onConflictDoUpdate: () => 'upsert' }) }),
  batch: jest.fn(async () => {}),
  update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
});
const runMarkers = () => ({ startRun: jest.fn(async () => {}), finishRun: jest.fn(async () => {}) });
async function* pages(...bodies) { for (const b of bodies) yield b; }

test('call log: lands every page and audits the run', async () => {
  const api = { ...runMarkers(), getCallLogPage: jest.fn(), paginate: () => pages({ records: [{ id: 'A' }, { id: 'B' }] }, { records: [{ id: 'C' }] }) };
  const db = makeDb();
  const stats = await syncJigglewireCallLog({ api, db, mode: 'full' });
  expect(stats).toMatchObject({ mode: 'full', pages: 2, fetched: 3, new: 3 });
  expect(db.batch).toHaveBeenCalledTimes(2);
  expect(api.finishRun).toHaveBeenCalledWith(stats);
});

test('call log: an empty table makes an incremental run a full one', async () => {
  const api = { ...runMarkers(), paginate: () => pages({ records: [] }) };
  expect((await syncJigglewireCallLog({ api, db: makeDb() })).mode).toBe('full');
});

test('call log: a failure is audited and rethrown', async () => {
  const api = { ...runMarkers(), paginate: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error('boom'); } }) }) };
  await expect(syncJigglewireCallLog({ api, db: makeDb(), mode: 'full' })).rejects.toThrow('boom');
  expect(api.finishRun).toHaveBeenCalledWith(expect.anything(), { error: expect.any(Error) });
});

test('reference: extensions, presence per queue and voicemail per extension', async () => {
  const extensions = [
    { id: '101', type: 'User', name: 'Marcus' },
    { id: '200', type: 'Department', name: 'Intake' },
  ];
  const api = {
    ...runMarkers(),
    paginate: (first) => ({ async *[Symbol.asyncIterator]() { yield await first(); } }),
    getExtensionsPage: async () => ({ records: extensions }),
    getQueuePresence: jest.fn(async () => ({ records: [{ member: { id: '101' }, acceptQueueCalls: true }, { member: { id: '103' }, acceptQueueCalls: false }] })),
    getVoicemailPage: jest.fn(async (id) => ({ records: id === '200' ? [{ id: 'VM1' }] : [] })),
  };
  const stats = await syncJigglewireReference({ api, db: makeDb() });
  expect(stats.extensions).toMatchObject({ fetched: 2, new: 2 });
  expect(api.getQueuePresence).toHaveBeenCalledTimes(1);
  expect(api.getQueuePresence).toHaveBeenCalledWith('200');
  expect(stats.queuePresence).toMatchObject({ fetched: 2, new: 2 });
  expect(api.getVoicemailPage).toHaveBeenCalledTimes(2);
  expect(stats.voicemails).toMatchObject({ fetched: 1, new: 1 });
});
