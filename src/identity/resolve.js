// Identity resolution, phone only. Safe to run again at any time: it only handles raw records that have no
// hp.person_links row yet, and every insert is keyed so a repeat changes nothing.
//   1. employees       copy the firm's staff (read-only ops.staff) and map each system's ids to them
//   2. link + events   for each unlinked raw record: normalise the phone, find or create the person, write the link
//                      (with method, confidence and reason) and one contact event (+ ring legs for Jigglewire calls)
//   3. refresh people  display name, stage, first/last contact, and the two review flags below
// Merges are only *flagged*: a number with several different names (shared_phone) or that is an automated caller
// (is_automated) is kept as one person and listed in hp.match_review for a human to look at.
import { sql } from 'drizzle-orm';
import { normalizePhone } from '../lib/phone.js';
import { toUtc } from '../lib/dates.js';
import { isBusinessHours } from '../officeHours.js';
import { displayName, nameKey, AUTOMATED_SUMMARY_SQL } from './rules.js';
import { SOURCES } from './sources.js';
import { people, personLinks, contactEvents, callLegs, matchReview, employees, employeeIdentifiers, identityRuns } from '../db/hp-schema.js';

const BATCH = 1000; // raw records per round trip
const CHUNK = 400; // rows per INSERT (keeps parameters well under the driver limit)
const PHONE_CONFIDENCE = 0.9; // same normalised number; shared numbers (family, business line) are why it is not 1.0

// Numbers that belong to the firm: tracking numbers, where they forward, the main line. Never a client.
const FIRM_NUMBERS = ['+13125550100', '(888) 477-7204'];

const rowsOf = (res) => res.rows ?? res;
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Staff -> employees, and every system's id for them -> employee_identifiers. Returns a lookup from Jigglewire extension. */
export async function syncEmployees(db) {
  const staff = rowsOf(await db.execute(sql`SELECT ext, name, email, role, schedule FROM ops.staff`));
  for (const s of staff) {
    const email = s.email ? String(s.email).toLowerCase() : null;
    await db.insert(employees).values({
      name: s.name, role: s.role, email, schedule: s.schedule, isIntake: /^intake/i.test(s.role ?? ''),
    }).onConflictDoUpdate({
      target: employees.email,
      set: { name: s.name, role: s.role, schedule: s.schedule, isIntake: /^intake/i.test(s.role ?? '') },
    });
  }
  const byEmail = new Map(rowsOf(await db.execute(sql`SELECT employee_id, email FROM hp.employees WHERE email IS NOT NULL`)).map((e) => [e.email, Number(e.employee_id)]));
  const ids = [];
  for (const s of staff) {
    const employeeId = byEmail.get(String(s.email ?? '').toLowerCase());
    if (!employeeId) continue;
    // Gloria's extension belongs to TalkEgg's front desk mailbox, not to Jigglewire.
    if (s.ext) ids.push({ employeeId, system: /talkegg/i.test(s.role ?? '') ? 'talkegg_box' : 'jigglewire_ext', externalId: String(s.ext) });
    ids.push({ employeeId, system: 'email', externalId: String(s.email).toLowerCase() });
  }
  const llUsers = rowsOf(await db.execute(sql`SELECT source_id, lower(payload->'attributes'->>'email') AS email FROM hp.raw_lawllama_users`));
  for (const u of llUsers) if (byEmail.has(u.email)) ids.push({ employeeId: byEmail.get(u.email), system: 'lawllama_user', externalId: String(u.source_id) });
  if (ids.length) await db.insert(employeeIdentifiers).values(ids).onConflictDoNothing();

  const ext = rowsOf(await db.execute(sql`SELECT external_id, employee_id FROM hp.employee_identifiers WHERE system = 'jigglewire_ext'`));
  const map = new Map(ext.map((e) => [String(e.external_id), Number(e.employee_id)]));
  return (extension) => map.get(String(extension)) ?? null;
}

async function firmNumbers(db) {
  const rows = rowsOf(await db.execute(sql`SELECT payload->>'tracking_number' AS a, payload->>'destination_number' AS b FROM hp.raw_ringsnitch_trackers`));
  return new Set([...FIRM_NUMBERS, ...rows.flatMap((r) => [r.a, r.b])].map(normalizePhone).filter(Boolean));
}

/** Link one batch of raw records of one source and write their events. Returns counts. */
export async function linkBatch(db, source, rows, ctx) {
  const prepared = rows.map((row) => {
    const phone = normalizePhone(row.phone);
    const firm = phone !== null && ctx.firmNumbers.has(phone);
    return { row, phone: firm ? null : phone, firm, name: displayName(row.name), key: nameKey(row.name) };
  });

  // People: one per distinct phone. ON CONFLICT keeps the earlier row, so concurrent or repeated runs agree.
  const phones = [...new Set(prepared.map((p) => p.phone).filter(Boolean))];
  for (const part of chunks(phones, CHUNK)) {
    await db.insert(people).values(part.map((primaryPhone) => ({ primaryPhone }))).onConflictDoNothing();
  }
  const personByPhone = new Map();
  for (const part of chunks(phones, CHUNK)) {
    const found = rowsOf(await db.execute(sql`SELECT person_id, primary_phone FROM hp.people WHERE primary_phone IN (${sql.join(part.map((p) => sql`${p}`), sql`, `)})`));
    for (const f of found) personByPhone.set(f.primary_phone, Number(f.person_id));
  }

  // Events first, then legs, then links last: if a run stops half way, the unlinked records are simply picked up again.
  const events = prepared.map(({ row, phone }) => {
    const mapped = source.map(row, ctx);
    const occurredAt = toUtc(row.occurred_at, source.table);
    return occurredAt && {
      sourceTable: source.table, sourceId: String(row.source_id), personId: phone ? personByPhone.get(phone) ?? null : null,
      employeeId: mapped.employeeId ?? null, kind: mapped.kind, occurredAt, answered: mapped.answered ?? null,
      handledBy: mapped.handledBy ?? null,
      outcome: mapped.outcome ?? null, durationS: mapped.durationS ?? null, channel: mapped.channel ?? null,
      officeHours: isBusinessHours(new Date(occurredAt)), amountUsd: mapped.amountUsd ?? null, legs: mapped.legs ?? [],
    };
  });
  const good = events.filter(Boolean);
  for (const part of chunks(good, CHUNK)) {
    await db.insert(contactEvents).values(part.map(({ legs, ...e }) => e)).onConflictDoNothing();
  }
  const idBySource = new Map();
  for (const part of chunks(good.map((e) => e.sourceId), CHUNK)) {
    const found = rowsOf(await db.execute(sql`SELECT id, source_id FROM hp.contact_events WHERE source_table = ${source.table} AND source_id IN (${sql.join(part.map((p) => sql`${p}`), sql`, `)})`));
    for (const f of found) idBySource.set(f.source_id, Number(f.id));
  }
  const legRows = good.flatMap((e) => e.legs.map((l) => ({ eventId: idBySource.get(e.sourceId), ...l }))).filter((l) => l.eventId);
  for (const part of chunks(legRows, CHUNK)) await db.insert(callLegs).values(part).onConflictDoNothing();

  const links = prepared.map(({ row, phone, firm, name, key }) => {
    const rawPhone = row.phone ? String(row.phone) : '';
    return {
      sourceTable: source.table, sourceId: String(row.source_id), personId: phone ? personByPhone.get(phone) : null,
      method: phone ? 'phone' : 'none', confidence: phone ? PHONE_CONFIDENCE.toFixed(2) : '0.00',
      reason: phone ? `normalised phone ${phone} matches` : firm ? 'firm number, not a client' : rawPhone ? `phone not usable: ${rawPhone}` : 'no phone on record',
      nameSeen: name, nameKey: key,
    };
  });
  for (const part of chunks(links, CHUNK)) await db.insert(personLinks).values(part).onConflictDoNothing();

  const review = prepared.filter((p) => !p.phone && !p.firm && p.row.phone).map((p) => ({
    dedupeKey: `no_valid_phone:${source.table}:${p.row.source_id}`, kind: 'no_valid_phone', phone: String(p.row.phone),
    evidence: { source_table: source.table, source_id: String(p.row.source_id) },
  }));
  for (const part of chunks(review, CHUNK)) await db.insert(matchReview).values(part).onConflictDoNothing();
  return { records: rows.length, events: good.length, skippedNoTime: events.length - good.length };
}

/** Derived columns on people. Each statement recomputes from links/events, so the result never depends on run order. */
export async function refreshPeople(db) {
  // Best name wins by source: a human-entered Lawllama/Docketmonster name over a caller-ID name.
  await db.execute(sql`
    UPDATE hp.people p SET display_name = x.name, modified_at = now()
    FROM (SELECT DISTINCT ON (person_id) person_id, name_seen AS name FROM hp.person_links
          WHERE person_id IS NOT NULL AND name_seen IS NOT NULL
          ORDER BY person_id, CASE source_table WHEN 'raw_lawllama_leads' THEN 1 WHEN 'raw_docketmonster_matters' THEN 2
            WHEN 'raw_blankety_submissions' THEN 3 WHEN 'raw_jigglewire_voicemails' THEN 4 WHEN 'raw_jigglewire_call_log' THEN 4 ELSE 5 END, id) x
    WHERE p.person_id = x.person_id AND p.display_name IS DISTINCT FROM x.name`);
  // Stage: client once a matter is opened, lead once intake has a record, otherwise just a caller.
  await db.execute(sql`
    UPDATE hp.people p SET stage = s.stage, modified_at = now()
    FROM (SELECT person_id, CASE WHEN bool_or(source_table = 'raw_docketmonster_matters') THEN 'client'
            WHEN bool_or(source_table IN ('raw_lawllama_leads', 'raw_blankety_submissions')) THEN 'lead' ELSE 'caller' END AS stage
          FROM hp.person_links WHERE person_id IS NOT NULL GROUP BY person_id) s
    WHERE p.person_id = s.person_id AND p.stage IS DISTINCT FROM s.stage`);
  await db.execute(sql`
    UPDATE hp.people p SET first_contact_at = e.first_at, last_contact_at = e.last_at, modified_at = now()
    FROM (SELECT person_id, min(occurred_at) AS first_at, max(occurred_at) AS last_at FROM hp.contact_events
          WHERE person_id IS NOT NULL GROUP BY person_id) e
    WHERE p.person_id = e.person_id AND (p.first_contact_at IS DISTINCT FROM e.first_at OR p.last_contact_at IS DISTINCT FROM e.last_at)`);
  // Automated: at least half the number's Ringsnitch call summaries say robocall/automated, and intake never heard from it.
  await db.execute(sql`
    WITH auto AS (
      SELECT l.person_id FROM hp.person_links l
      JOIN hp.raw_ringsnitch_calls r ON l.source_table = 'raw_ringsnitch_calls' AND l.source_id = r.source_id
      WHERE l.person_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM hp.person_links x WHERE x.person_id = l.person_id
          AND x.source_table IN ('raw_lawllama_leads', 'raw_blankety_submissions', 'raw_docketmonster_matters'))
      GROUP BY l.person_id
      HAVING avg(CASE WHEN r.payload->>'ai_summary' ~* ${sql.raw(`'${AUTOMATED_SUMMARY_SQL}'`)} THEN 1 ELSE 0 END) >= 0.5)
    UPDATE hp.people p SET is_automated = (p.person_id IN (SELECT person_id FROM auto)), modified_at = now()
    WHERE p.is_automated IS DISTINCT FROM (p.person_id IN (SELECT person_id FROM auto))`);
  await db.execute(sql`
    INSERT INTO hp.match_review (dedupe_key, kind, person_id, phone, evidence)
    SELECT 'automated:' || p.person_id, 'automated_caller', p.person_id, p.primary_phone,
      jsonb_build_object('calls', (SELECT count(*) FROM hp.contact_events e WHERE e.person_id = p.person_id), 'rule', 'half or more call summaries say automated')
    FROM hp.people p WHERE p.is_automated ON CONFLICT (dedupe_key) DO NOTHING`);
  // Shared: two or more genuinely different names on one number (a spouse, an assistant, a typo to check).
  await db.execute(sql`
    WITH shared AS (
      SELECT person_id, array_agg(DISTINCT name_seen) AS names FROM hp.person_links
      WHERE person_id IS NOT NULL AND name_key IS NOT NULL GROUP BY person_id HAVING count(DISTINCT name_key) > 1)
    UPDATE hp.people p SET shared_phone = (p.person_id IN (SELECT person_id FROM shared)), modified_at = now()
    WHERE p.shared_phone IS DISTINCT FROM (p.person_id IN (SELECT person_id FROM shared))`);
  await db.execute(sql`
    INSERT INTO hp.match_review (dedupe_key, kind, person_id, phone, evidence)
    SELECT 'shared:' || p.person_id, 'shared_phone', p.person_id, p.primary_phone,
      jsonb_build_object('names', (SELECT array_agg(DISTINCT l.name_seen) FROM hp.person_links l WHERE l.person_id = p.person_id AND l.name_key IS NOT NULL))
    FROM hp.people p WHERE p.shared_phone ON CONFLICT (dedupe_key) DO NOTHING`);
}

/** Empty the identity tables (not employees) so the next run rebuilds them from the raw tables. Only our own derived data. */
export async function resetIdentity(db) {
  for (const t of ['call_legs', 'contact_events', 'match_review', 'person_links', 'people']) await db.execute(sql.raw(`DELETE FROM hp.${t}`));
}

/** Run everything. Returns per-source counts; also written to hp.identity_runs for the dashboard's "data as of". */
export async function resolveIdentities({ db, log = () => {} }) {
  const [run] = await db.insert(identityRuns).values({}).returning({ id: identityRuns.id });
  const stats = { people: 0, sources: {} };
  try {
    const employeeFor = await syncEmployees(db);
    const ctx = { employeeFor, firmNumbers: await firmNumbers(db), stats };
    for (const source of SOURCES) {
      const total = { records: 0, events: 0, skippedNoTime: 0 };
      for (;;) {
        const rows = rowsOf(await db.execute(sql.raw(source.query.replace('{LIMIT}', String(BATCH)))));
        if (!rows.length) break;
        const done = await linkBatch(db, source, rows, ctx);
        for (const k of Object.keys(total)) total[k] += done[k];
        log(`${source.table}: ${total.records} records linked`);
        if (done.records < BATCH) break;
      }
      stats.sources[source.table] = total;
    }
    await refreshPeople(db);
    stats.people = Number(rowsOf(await db.execute(sql`SELECT count(*) AS n FROM hp.people`))[0].n);
    await db.update(identityRuns).set({ finishedAt: sql`now()`, status: 'ok', stats }).where(sql`id = ${run.id}`);
    return stats;
  } catch (err) {
    await db.update(identityRuns).set({ finishedAt: sql`now()`, status: 'error', stats: { ...stats, error: err.message } }).where(sql`id = ${run.id}`);
    throw err;
  }
}
