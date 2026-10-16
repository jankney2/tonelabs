import { jest } from '@jest/globals';
import { runScheduledSync } from '../src/scheduled.js';

const env = { DATABASE_URL: 'postgres://u:p@h.neon.tech/d', RINGSNITCH_READKEY: 'k', RINGSNITCH_ACCOUNT_ID: 'ACC1' };

test('runs an incremental ringsnitch sync and returns its stats', async () => {
  let seen;
  const out = await runScheduledSync(env, { sync: async (opts) => { seen = opts; return { fetched: 3 }; } });
  expect(out).toEqual({ fetched: 3 });
  expect(seen.mode).toBe('incremental');
  expect(seen.api.accountId).toBe('ACC1');
});

test('a failing sync is swallowed so the Worker does not crash', async () => {
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(runScheduledSync(env, { sync: async () => { throw new Error('boom'); } })).resolves.toBeUndefined();
  err.mockRestore();
});

test('skips the half-hour run outside office hours, runs it inside', async () => {
  const sync = jest.fn(async () => ({}));
  // Oct 16 2026 is a Friday; Chicago is UTC-5 (CDT). 17:30Z = 12:30 local, 03:30Z = 22:30 local the day before.
  await runScheduledSync(env, { sync, now: new Date('2026-10-16T17:30:00Z') });
  expect(sync).toHaveBeenCalledTimes(1);
  await runScheduledSync(env, { sync, now: new Date('2026-10-16T03:30:00Z') });
  expect(sync).toHaveBeenCalledTimes(1);
  await runScheduledSync(env, { sync, now: new Date('2026-10-16T03:00:00Z') }); // top of the hour always runs
  expect(sync).toHaveBeenCalledTimes(2);
});
