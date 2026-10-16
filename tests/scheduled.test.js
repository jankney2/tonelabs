import { jest } from '@jest/globals';
import { runScheduledSync, runMostlyansweredSync, MOSTLYANSWERED_CRON } from '../src/scheduled.js';

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

test('syncs trackers and users only in the two daily slots, and a failure there does not hide the calls result', async () => {
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  const syncReference = jest.fn(async () => { throw new Error('nope'); });
  const sync = async () => ({ fetched: 3 });
  // Chicago is UTC-5 (CDT) on Oct 16 2026: 13:00Z = 08:00, 18:00Z = 13:00, 17:00Z = 12:00, 13:30Z = 08:30.
  for (const t of ['13:00', '18:00']) {
    expect(await runScheduledSync(env, { sync, syncReference, now: new Date(`2026-10-16T${t}:00Z`) })).toEqual({ fetched: 3 });
  }
  expect(syncReference).toHaveBeenCalledTimes(2);
  await runScheduledSync(env, { sync, syncReference, now: new Date('2026-10-16T17:00:00Z') });
  await runScheduledSync(env, { sync, syncReference, now: new Date('2026-10-16T13:30:00Z') });
  expect(syncReference).toHaveBeenCalledTimes(2);
  err.mockRestore();
});

test('the identity job runs resolve against the database, and a failure is swallowed', async () => {
  const { runIdentityJob, IDENTITY_CRON } = await import('../src/scheduled.js');
  expect(IDENTITY_CRON).toBe('15 * * * *');
  const resolve = jest.fn(async () => ({ people: 5 }));
  expect(await runIdentityJob(env, { resolve })).toEqual({ people: 5 });
  expect(resolve.mock.calls[0][0].db).toBeDefined();
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(runIdentityJob(env, { resolve: async () => { throw new Error('boom'); } })).resolves.toBeUndefined();
  err.mockRestore();
});

test('mostlyanswered cron: incremental sync with the Basic Auth settings from env, failures swallowed', async () => {
  let seen;
  const mEnv = { DATABASE_URL: env.DATABASE_URL, MOSTLY_ANSWERED_URL: 'https://x.test/files/h/', MOSTLY_ANSWERED_USER: 'u', MOSTLY_ANSWERED_PASS: 'p' };
  expect(await runMostlyansweredSync(mEnv, { sync: async (o) => { seen = o; return { downloaded: 1 }; } })).toEqual({ downloaded: 1 });
  expect(seen.mode).toBe('incremental');
  expect(seen.api.baseUrl).toBe('https://x.test/files/h');
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(runMostlyansweredSync(mEnv, { sync: async () => { throw new Error('boom'); } })).resolves.toBeUndefined();
  err.mockRestore();
  expect(MOSTLYANSWERED_CRON).toBe('30 13 * * *');
});
