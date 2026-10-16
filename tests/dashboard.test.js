import { createApp, AUTH_USER } from '../src/app.js';
import { parseParams, chicagoToday } from '../src/dashboard/params.js';

const PASSWORD = 'test-pass';
const headers = { Authorization: 'Basic ' + Buffer.from(`${AUTH_USER}:${PASSWORD}`).toString('base64') };
const env = { AUTH_PASSWORD: PASSWORD, ASSETS: { fetch: async () => new Response('') } };

// Fake database: records every query() call and answers with the rows for the first matching SQL fragment.
function fakeDb(answers = {}) {
  const calls = [];
  const db = () => {
    const fn = async () => [];
    fn.query = async (text, values) => {
      calls.push({ text, values });
      if (answers.fail) throw new Error('secret connection string');
      const hit = Object.keys(answers).find((k) => text.includes(k));
      return hit ? answers[hit] : [];
    };
    return fn;
  };
  return { db, calls };
}
const get = (app, path) => app.request(path, { headers }, env);
const qs = (s) => new URLSearchParams(s);

describe('parseParams', () => {
  test('defaults to month to date in Chicago time', () => {
    // 02:00 UTC on 1 Nov is still 31 Oct in Chicago, so "today" is Oct 31 and the month is October
    const now = new Date('2026-11-01T02:00:00Z');
    expect(chicagoToday(now)).toBe('2026-10-31');
    expect(parseParams(qs(''), now).params).toMatchObject({ from: '2026-10-01', to: '2026-10-31', hours: 'any', employees: null });
  });

  test('reads every filter', () => {
    const r = parseParams(qs('from=2026-09-01&to=2026-09-30&employee=6,7&source=Web%20form&stage=lead&loss_type=lead_lost&hours=in'));
    expect(r.params).toEqual({ from: '2026-09-01', to: '2026-09-30', hours: 'in', stage: 'lead', lossType: 'lead_lost', source: 'Web form', employees: [6, 7] });
  });

  test.each([
    ['from=2026-13-01', 'dates'],
    ['from=2026-02-30', 'dates'],
    ['from=2026-10-05&to=2026-10-01', 'after'],
    ['from=2024-01-01&to=2026-10-01', 'limited'],
    ['hours=night', 'hours'],
    ['stage=vip', 'stage'],
    ['loss_type=x', 'loss_type'],
    ['employee=6,abc', 'employee'],
    ['employee=0', 'employee'],
  ])('rejects %s', (query, word) => {
    const r = parseParams(qs(query), new Date('2026-10-16T12:00:00Z'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain(word);
  });
});

describe('/api/dashboard', () => {
  test('requires Basic Auth', async () => {
    const res = await createApp({ getDb: fakeDb().db }).request('/api/dashboard/employees', {}, env);
    expect(res.status).toBe(401);
  });

  test('bad filters are a 400 and run no query', async () => {
    const { db, calls } = fakeDb();
    const res = await get(createApp({ getDb: db }), '/api/dashboard/summary?hours=night');
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('employees: binds the filters as parameters and returns numbers', async () => {
    const { db, calls } = fakeDb({ 'FROM hp.employees emp': [{ employee_id: '6', name: 'Marcus Hill', role: 'Intake specialist', rung: '394', accepted: '145', median_hours: '23.7' }] });
    const res = await get(createApp({ getDb: db }), '/api/dashboard/employees?from=2026-10-01&to=2026-10-16&employee=6&hours=in');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.range).toEqual({ from: '2026-10-01', to: '2026-10-16' });
    expect(body.employees[0]).toMatchObject({ employee_id: 6, name: 'Marcus Hill', rung: 394, accepted: 145, median_hours: 23.7 });
    expect(calls[0].values).toEqual(['2026-10-01', '2026-10-16', 'in', [6]]);
    expect(calls[0].text).not.toContain('2026-10-01'); // values are never spliced into the SQL
  });

  test('summary: call totals and funnel', async () => {
    const { db } = fakeDb({
      'FROM hp.inbound_calls': [{ inbound: '10', answered: '6', answering_service: '3', missed: '1', voicemail: '0', failed_in_hours: '2' }],
      'FROM hp.person_summary': [{ leads: '4', contacted: '3', retained: '1', lead_value: '1000.00', retained_value: '250' }],
    });
    const body = await (await get(createApp({ getDb: db }), '/api/dashboard/summary?from=2026-10-01&to=2026-10-02')).json();
    expect(body.calls).toEqual({ inbound: 10, answered: 6, answering_service: 3, missed: 1, voicemail: 0, failed_in_hours: 2 });
    expect(body.funnel).toEqual({ leads: 4, contacted: 3, retained: 1, lead_value: 1000, retained_value: 250 });
  });

  test('lost: passes the filters in order and defaults to month to date', async () => {
    const { db, calls } = fakeDb({ 'GROUP BY 1': [{ loss_type: 'lead_lost', people: '2', est_value: '300' }] });
    const res = await get(createApp({ getDb: db, now: () => new Date('2026-10-16T15:00:00Z') }), '/api/dashboard/lost?stage=lead&source=Web%20form');
    expect(res.status).toBe(200);
    expect((await res.json()).byType[0]).toEqual({ loss_type: 'lead_lost', people: 2, est_value: 300 });
    expect(calls[0].values).toEqual([expect.stringMatching(/^\d{4}-\d{2}-01$/), expect.any(String), 'lead', 'Web form', null]);
  });

  test('lost/people hides lead_lost unless asked for', async () => {
    const { db, calls } = fakeDb({ 'hours_waiting': [{ person_id: '9', display_name: 'A B', hours_waiting: '26.4', failed_inbound: '2' }] });
    const body = await (await get(createApp({ getDb: db }), '/api/dashboard/lost/people')).json();
    expect(body.people[0]).toMatchObject({ person_id: 9, hours_waiting: 26, failed_inbound: 2 });
    expect(calls[0].text).toContain(`loss_type <> 'lead_lost'`);
  });

  test('calls: heatmap cells as numbers', async () => {
    const { db, calls } = fakeDb({ 'GROUP BY 1, 2': [{ dow: '1', hour: '9', inbound: '12', failed: '5' }] });
    const body = await (await get(createApp({ getDb: db }), '/api/dashboard/calls?hours=in')).json();
    expect(body.heatmap).toEqual([{ dow: 1, hour: 9, inbound: 12, failed: 5 }]);
    expect(calls[0].values[2]).toBe('in');
  });

  test('people/:id returns the timeline and links without raw payloads', async () => {
    const { db, calls } = fakeDb({
      'FROM hp.people': [{ person_id: '9', display_name: 'A B', primary_phone: '+13125550101', stage: 'lead' }],
      'FROM hp.contact_events': [{ occurred_at: '2026-10-01T15:00:00Z', kind: 'call_in', duration_s: '30', amount_usd: null, employee: 'Devin Trask' }],
      'FROM hp.person_links': [{ source_table: 'raw_jigglewire_call_log', method: 'phone', confidence: '0.90', reason: 'normalised phone matches' }],
    });
    const body = await (await get(createApp({ getDb: db }), '/api/dashboard/people/9')).json();
    expect(body.person.person_id).toBe(9);
    expect(body.events[0]).toMatchObject({ kind: 'call_in', duration_s: 30, employee: 'Devin Trask' });
    expect(body.links[0].confidence).toBe(0.9);
    expect(JSON.stringify(body)).not.toContain('payload');
    expect(calls[0].values).toEqual([9]);
  });

  test('people/:id: unknown person is 404, bad id is 400', async () => {
    const app = createApp({ getDb: fakeDb().db });
    expect((await get(app, '/api/dashboard/people/123')).status).toBe(404);
    expect((await get(app, '/api/dashboard/people/1;drop')).status).toBe(400);
  });

  test('a database error is a 500 that does not leak the message', async () => {
    const res = await get(createApp({ getDb: fakeDb({ fail: true }).db }), '/api/dashboard/employees');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
});
