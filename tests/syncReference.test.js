import { jest } from '@jest/globals';
import { syncRingsnitchReference } from '../src/integrations/ringsnitch/syncReference.js';

// Fake api: only the list endpoints and run markers the sync uses.
function fakeApi({ trackers = [], users = [] } = {}) {
  return {
    startRun: jest.fn(async () => {}),
    finishRun: jest.fn(async () => {}),
    getTrackers: jest.fn(async () => ({ trackers, total_pages: 1 })),
    getUsers: jest.fn(async () => ({ users, total_pages: 1 })),
  };
}

test('fetches both lists and audits the run', async () => {
  // A db whose queries all come back empty is enough to prove the wiring; landSnapshot is covered by the live db run.
  const empty = { from: () => ({ where: async () => [] }) };
  const db = {
    select: () => empty,
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => 'upsert' }) }),
    batch: jest.fn(async () => {}),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
  };
  const api = fakeApi({ trackers: [{ id: 'TRK101' }], users: [{ id: 'USR101' }, { id: 'USR102' }] });
  const stats = await syncRingsnitchReference({ api, db });
  expect(stats.trackers).toMatchObject({ fetched: 1, new: 1 });
  expect(stats.users).toMatchObject({ fetched: 2, new: 2 });
  expect(db.batch).toHaveBeenCalledTimes(2);
  expect(api.finishRun).toHaveBeenCalledWith(stats);
});

test('a list that spans more pages than allowed is an error, not a partial success', async () => {
  const api = fakeApi();
  api.getTrackers = async () => ({ trackers: [], total_pages: 99 });
  const db = {};
  await expect(syncRingsnitchReference({ api, db })).rejects.toThrow(/partial list/);
  expect(api.finishRun).toHaveBeenCalledWith({}, { error: expect.any(Error) });
});
