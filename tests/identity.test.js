import { displayName, nameKey, callLegs, callEmployee, handledBy, AUTOMATED_SUMMARY_RE, messageCategory, chatLead } from '../src/identity/rules.js';
import { zonedToUtc, toUtc } from '../src/lib/dates.js';
import { linkBatch } from '../src/identity/resolve.js';
import { SOURCES } from '../src/identity/sources.js';
import { people, contactEvents, callLegs as callLegsTable, personLinks, matchReview } from '../src/db/hp-schema.js';

const employeeFor = (ext) => ({ 101: 1, 102: 2, 104: 4 })[ext] ?? null;

describe('names', () => {
  test('caller-ID "LAST, FIRST" and "First Last" are the same person', () => {
    expect(displayName('THOMPSON, DIEGO')).toBe('Diego Thompson');
    expect(nameKey('THOMPSON, DIEGO')).toBe(nameKey('diego thompson'));
  });
  test('names a phone system invents say nothing about the caller', () => {
    for (const n of ['WIRELESS CALLER', 'AUTO NOTIFY', '', null, undefined]) expect(displayName(n)).toBeNull();
    expect(nameKey('WIRELESS CALLER')).toBeNull();
  });
  test('different people on one number have different keys', () => {
    expect(nameKey('Opal Lopez')).not.toBe(nameKey('Jamal Lopez'));
  });
});

describe('automated callers', () => {
  test('matches the summaries of the two robocall numbers, not a real caller', () => {
    expect(AUTOMATED_SUMMARY_RE.test('Automated message about a medical records request. No caller on the line.')).toBe(true);
    expect(AUTOMATED_SUMMARY_RE.test('Automated robocall: a recorded voice, no caller on the line. Likely spam.')).toBe(true);
    expect(AUTOMATED_SUMMARY_RE.test('New caller asking about family (divorce). Wants to discuss hiring the firm.')).toBe(false);
  });
});

describe('Jigglewire attribution', () => {
  const missedTwice = {
    direction: 'Inbound', result: 'Missed', extension: null,
    legs: [
      { to: { name: 'Marcus Hill', extensionNumber: '101' }, result: 'Missed', duration: 20 },
      { to: { name: 'Katherine Doyle', extensionNumber: '102' }, result: 'Missed', duration: 20 },
    ],
  };
  test('a missed call records who it rang, in order, and has no handler', () => {
    expect(callLegs(missedTwice, employeeFor)).toEqual([
      { ringOrder: 1, extension: '101', employeeId: 1, result: 'Missed', durationS: 20 },
      { ringOrder: 2, extension: '102', employeeId: 2, result: 'Missed', durationS: 20 },
    ]);
    expect(callEmployee(missedTwice, employeeFor)).toBeNull();
    expect(handledBy(missedTwice, null)).toBe('missed');
  });
  test('the extension on an answered call is who took it', () => {
    const answered = { direction: 'Inbound', result: 'Accepted', extension: { extensionNumber: '104' }, legs: [] };
    expect(callEmployee(answered, employeeFor)).toBe(4);
    expect(handledBy(answered, 4)).toBe('employee');
  });
  test('"Call connected" after a forward is the answering service, not an employee', () => {
    const forwarded = {
      direction: 'Inbound', result: 'Call connected', extension: null,
      legs: [{ to: { extensionNumber: '101' }, result: 'Missed' }, { to: { name: 'After-hours answering', phoneNumber: '+18475550190' }, action: 'FindMe', legType: 'Forwarded', result: 'Call connected' }],
    };
    expect(handledBy(forwarded, null)).toBe('answering_service');
    expect(callLegs(forwarded, employeeFor)[1]).toMatchObject({ extension: null, employeeId: null });
  });
  test('voicemail and outbound calls', () => {
    expect(handledBy({ direction: 'Inbound', result: 'Voicemail', legs: [] }, null)).toBe('voicemail');
    expect(handledBy({ direction: 'Outbound', result: 'Call connected' }, 4)).toBe('employee');
    expect(handledBy({ direction: 'Outbound', result: 'No Answer' }, 4)).toBe('no_answer');
  });
});

describe('dates', () => {
  test('offset and Z timestamps are trusted as written', () => {
    expect(toUtc('2026-10-14T08:36:10.000-07:00', 'raw_jigglewire_call_log')).toBe('2026-10-14T15:36:10.000Z');
    expect(toUtc('2026-10-09T06:01:03Z', 'raw_ringsnitch_calls')).toBe('2026-10-09T06:01:03.000Z');
  });
  test('Blankety local time is US Eastern: 08:50 in October is 12:50 UTC', () => {
    expect(toUtc('2026-10-14 08:50:01', 'raw_blankety_submissions')).toBe('2026-10-14T12:50:01.000Z');
  });
  test('Docketmonster local time is Chicago: summer is -5, winter is -6', () => {
    expect(toUtc('2026-10-01T09:43:09', 'raw_docketmonster_matters')).toBe('2026-10-01T14:43:09.000Z');
    expect(toUtc('2026-12-01T09:43:09', 'raw_docketmonster_matters')).toBe('2026-12-01T15:43:09.000Z');
  });
  test('daylight saving edges in Chicago', () => {
    expect(zonedToUtc('2026-11-01 00:30:00', 'America/Chicago')).toBe('2026-11-01T05:30:00.000Z'); // still CDT
    expect(zonedToUtc('2026-11-01 03:00:00', 'America/Chicago')).toBe('2026-11-01T09:00:00.000Z'); // CST after fall back
    expect(zonedToUtc('2026-03-08 03:30:00', 'America/Chicago')).toBe('2026-03-08T08:30:00.000Z'); // CDT after spring forward
  });
  test('a zone-less value from a source with no known zone is rejected, not guessed', () => {
    expect(toUtc('2026-10-14 08:50:01', 'raw_unknown')).toBeNull();
    expect(toUtc('garbage', 'raw_blankety_submissions')).toBeNull();
  });
});

describe('linkBatch', () => {
  // A db that records inserts and answers the two lookups linkBatch makes (people by phone, event ids by source id).
  function fakeDb() {
    const inserted = [];
    return {
      inserted,
      insert: (table) => ({ values: (v) => { inserted.push({ table, v }); return { onConflictDoNothing: async () => {} }; } }),
      execute: async () => {
        // people are looked up before any event is inserted, event ids after
        if (!inserted.some((i) => i.table === contactEvents)) return { rows: inserted.find((i) => i.table === people).v.map((p, n) => ({ person_id: n + 1, primary_phone: p.primaryPhone })) };
        return { rows: inserted.find((i) => i.table === contactEvents).v.map((e, n) => ({ id: n + 10, source_id: e.sourceId })) };
      },
    };
  }
  const ctx = { employeeFor, firmNumbers: new Set(['+13125550100']), stats: {} };
  const source = SOURCES.find((s) => s.table === 'raw_jigglewire_call_log');
  const call = (id, phone, extra) => ({
    source_id: id, phone, name: 'THOMPSON, DIEGO', occurred_at: '2026-10-14T08:36:10.000-07:00',
    payload: { direction: 'Inbound', result: 'Missed', extension: null, duration: 20, legs: [{ to: { extensionNumber: '101' }, result: 'Missed', duration: 20 }] }, ...extra,
  });

  test('two records with the same number in different formats become one person', async () => {
    const db = fakeDb();
    await linkBatch(db, source, [call('A', '+1 (312) 555-0199'), call('B', '312.555.0199')], ctx);
    expect(db.inserted.find((i) => i.table === people).v).toEqual([{ primaryPhone: '+13125550199' }]);
    const links = db.inserted.find((i) => i.table === personLinks).v;
    expect(links.map((l) => l.personId)).toEqual([1, 1]);
    expect(links[0]).toMatchObject({ method: 'phone', confidence: '0.90', nameSeen: 'Diego Thompson' });
    expect(links[0].reason).toMatch(/\+13125550199/);
  });

  test('events carry the attribution, UTC time and office-hours flag; legs are written once per ring', async () => {
    const db = fakeDb();
    await linkBatch(db, source, [call('A', '312-555-0199')], ctx);
    const [event] = db.inserted.find((i) => i.table === contactEvents).v;
    expect(event).toMatchObject({ kind: 'call_in', occurredAt: '2026-10-14T15:36:10.000Z', handledBy: 'missed', employeeId: null, officeHours: true, personId: 1 });
    expect(db.inserted.find((i) => i.table === callLegsTable).v).toEqual([
      { eventId: 10, ringOrder: 1, extension: '101', employeeId: 1, result: 'Missed', durationS: 20 },
    ]);
  });

  test('the firm\'s own number and unusable phones create no person but are still linked and explained', async () => {
    const db = fakeDb();
    await linkBatch(db, source, [call('A', '(312) 555-0100'), call('B', 'garbage'), call('C', null)], { ...ctx });
    expect(db.inserted.find((i) => i.table === people)?.v ?? []).toEqual([]);
    const links = db.inserted.find((i) => i.table === personLinks).v;
    expect(links.map((l) => [l.personId, l.method, l.reason])).toEqual([
      [null, 'none', 'firm number, not a client'],
      [null, 'none', 'phone not usable: garbage'],
      [null, 'none', 'no phone on record'],
    ]);
    // only the unusable-but-present phone needs a human
    expect(db.inserted.find((i) => i.table === matchReview).v.map((r) => r.kind)).toEqual(['no_valid_phone']);
  });
});

describe('answering-service messages', () => {
  test('classifies each message shape', () => {
    expect(messageCategory('New matter (family): custody. Wants a callback.')).toBe('new_matter');
    expect(messageCategory('Existing client, calling about their case (HP-2026-0115). Please call back.')).toBe('existing_client');
    expect(messageCategory('Recording, no one on the line. It said "new chat lead", a name (A B?), x, then "press 1".')).toBe('chat_lead_recording');
    expect(messageCategory('Recorded message about a medical records request. No one on the line.')).toBe('robocall');
    expect(messageCategory('Sales call, no message.')).toBe('sales_call');
    expect(messageCategory('something new')).toBe('other');
  });

  test('reads the lead out of a chat-lead recording, not the robot', () => {
    const msg = 'Recording, no one on the line. It said "new chat lead", a name (Maria Crenshaw?), something about a deck, and a number, 847-555-0106, then "press 1". Hung up after.';
    expect(chatLead(msg)).toEqual({ name: 'Maria Crenshaw', phone: '847-555-0106' });
    expect(chatLead('Sales call, no message.')).toBeNull();
  });

  test('"No name given" is not a name', () => {
    expect(displayName('No name given')).toBeNull();
  });

  test('"8/21/26 11:00 AM" local time is read in Chicago, with daylight saving', () => {
    expect(toUtc('2026-08-21T11:00:00', 'raw_mostlyanswered_messages')).toBe('2026-08-21T16:00:00.000Z');
    expect(toUtc('2026-12-01T11:00:00', 'raw_mostlyanswered_messages')).toBe('2026-12-01T17:00:00.000Z');
  });
});
