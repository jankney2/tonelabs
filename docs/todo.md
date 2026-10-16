# Later

## Deploy the Ringsnitch sync cron
The cron is coded (`src/scheduled.js`, `[triggers]` in `wrangler.toml`) and tested locally, but not deployed. To go live:
1. Set the Worker secrets (values are in `.env`; do not print them): `wrangler secret put RINGSNITCH_READKEY` and `wrangler secret put RINGSNITCH_ACCOUNT_ID`. `DATABASE_URL` and `AUTH_PASSWORD` are already set.
2. `npm run deploy`.
3. After the first cron tick, check `hp.integration_logs` for a `run_end` with message `ok`.
4. Update the "Worker only reads" line in `CLAUDE.md`: the Worker now also writes to `hp` tables (never `ops`).
5. Decide whether a daily full sync is wanted (needs enough Worker CPU; the cron is incremental only).

## Jigglewire on the cron
`npm run sync:jigglewire` works by hand. Before adding it to `src/scheduled.js`: the Worker needs secrets `JIGGLEWIRE_CLIENT_ID`, `JIGGLEWIRE_CLIENT_SECRET`, `JIGGLEWIRE_JWT`, and the 10 requests/60 s limit means a run spaces requests 6.5 s apart (an incremental run is roughly 10 requests, about a minute of wall time; check it fits a cron invocation). Also check whether the JWT created in the Console expires.

## Ask Denise (for the next update email)
- Who answers the main line (888) 477-7204? Ringsnitch tracker TRK105 ("Main line (front desk)", forwards to +1 773 555 0110) has no calls among the 3,549 we pulled. Is it not recorded in Ringsnitch, or are those calls only in TalkEgg?
- Ringsnitch has only four users (Dana, Denise, "Front Office", Brainfog Media) and none are intake staff, and calls carry no user field. Confirm that who handled a call comes from Jigglewire/TalkEgg, not Ringsnitch.
- Jigglewire timestamps all say -07:00 (Pacific) although the office is in Chicago. Are the phone system clocks set to the wrong zone, or is it just the label? Rosa is switched off "Receive queue calls" on the Intake queue: deliberate?
- Existing open questions are in `docs/systems.md` (logins, LSA leads, recordings, Blankety to Lawllama).

## Date reconciliation
Most APIs return dates in different formats and zones. Add a helper (e.g. `src/lib/dates.js`) that normalises any source timestamp to UTC, with the source zone set per system, and use it when reconciling (never in the raw tables). Cover it with tests per source format, DST edges and the Jigglewire -07:00 question (see "Ask Denise"), plus a QA query that compares one contact's timestamps across systems. Also listed in the plan's Verification (QA) section.

## Ask Denise / Lawllama support
- What is Lawllama's monthly record quota and how much is used? The first full sync read about 3,000 records plus probes; confirm that is a small share before putting the sync on the cron. Support: (315) 597-0959 (they confirm changes with the account owner by email).
- Worker secret needed when Lawllama joins the cron: `LAWLLAMA_BEARER`.
- Lawllama leads have `signed_on_call`, `converted` and `retained_matter`; do they agree with status `Retained`, and with Docketmonster? (check at reconciliation)

## Ask Denise / Blankety
- Which time zone is the Blankety account set to? `created_at` has no zone; compare against the matching Lawllama lead `created_at` (UTC) at reconciliation to infer it.
- Worker secret needed when Blankety joins the cron: `BLANKETY_KEY` (1,000 calls/day account-wide; an incremental sync is about 4 calls).
- Do all 454 submissions match a Lawllama web-form lead by phone/email, and how long does each take to arrive? (check at reconciliation)

## Ask Denise / Docketmonster
- Every matter is `Open`. Does Docketmonster ever set another status (Closed, Declined), or is the status field not maintained? If it never changes, outcome has to come from Lawllama.
- Which time zone is `OpenedDate` (firm local = Chicago?) Compare against the matching Lawllama lead's `created_at` at reconciliation.
- Which edition do we have (is Integration Services licensed)? The calls work, so presumably yes.
- The 64 matters with no Lawllama phone match: walk-ins/referrals that never went through intake? (check at reconciliation)
- Worker secrets needed when Docketmonster joins the cron: `DOCKETMONSTER_FIRM_CODE`, `DOCKETMONSTER_USER`, `DOCKETMONSTER_PASS`.

## QA: audit every API's rate limits and quotas
Before hand-in (and before putting any sync on the cron), work out for each system whether our sync pattern can hit its limits, and record the numbers in `docs/systems.md`:
- Ringsnitch: 1,000 requests/hour per account, shared by all keys. Jigglewire: 10 requests/minute. Lawllama: 120 requests/60 s **plus a monthly record quota** (once exceeded every request returns 429 `quota_exceeded`; waiting does not help; fixing it means phoning support on (315) 597-0959, who confirm with the account owner by email). Blankety: 1,000 calls/day. TalkEgg and Docketmonster: none stated.
- For each: requests and records per full sync and per incremental sync (from `hp.integration_logs`), how often the cron runs them, worst case per hour/day/month, and the headroom. Lawllama's monthly quota is unknown, so measure records per sync and ask Denise/support what the quota is and how much of it is used.
- Check the cron intervals do not overlap and that the shared Ringsnitch budget leaves room for manual runs and probes.

## QA: deviations from the integration template
- **Docketmonster incremental overlap is 30 days, not the template's 2** (`OVERLAP_DAYS` in `src/integrations/docketmonster/syncMatters.js`). Why: `GetMattersOpened` filters by *opened* date, so a matter whose `Status` changes later is only re-read while it is inside the window. Cost: one SOAP call returning a few dozen matters (about 113 on the last run), no stated rate limit. Check before hand-in: does any matter ever leave `Open` (all 259 are `Open` today)? If not, the overlap can go back to 2; if yes, confirm a status change older than 30 days can't be missed (otherwise run `--full` periodically). Compare `hp.raw_docketmonster_matters_history` against the window to see it working.
- Same trap, 2-day overlap kept: Ringsnitch calls (`start_time`), Jigglewire call log (`startTime`) and Blankety submissions (`created_at`) are all windowed by *creation* time (checked in each sync module), so an edit to a row older than 2 days is missed until the next `--full`. Lawllama is fine: `updated_since` tracks edits. Calls and form submissions rarely change after the fact, so this is probably acceptable; decide per system whether the dashboard needs a periodic `--full`.

## Ask Denise (from identity resolution)
- 1,217 inbound calls were forwarded to the After-hours answering service (+1 847 555 0190); 322 of them in office hours, after the intake phones rang out. Is that the Mostlyanswered service? What happens to those messages, and is anyone calling those people back? The daily file is the missing link (see Mostlyanswered above).
- 279 people called, never spoke to an employee and have no Lawllama lead (304 calls, 226 via the answering service). Are messages from the answering service entered anywhere?
- Marcus's phone rings first on 1,338 calls and he answers 570 of them (43%), while Devin (first on 454) answers 91%. Is the ring order intentional (`ops.staff.ring_order` says Marcus first)?
- Lawllama `last_contacted_at` is empty and `converted` is always false. Are those fields in use?
- Resolved while building: Jigglewire's `-07:00` label is correct as an instant (see docs/systems.md); Blankety is on US Eastern time (4 h behind UTC, recheck after 1 Nov when daylight saving ends).

## Ask Denise (from Mostlyanswered)
- Which time zone are the answering service's message times in? (No zone in the CSV; assumed Chicago until proven by pairing messages with forwarded calls, see "QA: time zone reconciliation".)
- The service logs 83 "Recording, no one on the line ... new chat lead ... press 1" messages and 171 medical-records robocalls. Who is the "new chat lead" caller (a lead vendor or the website chat)? Should it reach the firm at all?
- Callbacks are "promised within 24 hrs" on 849 messages. Who makes them and where is it recorded? Operators are DS, JT, RM, KL: who are they (the service's staff)?
- The 307 "existing client" messages cite matters such as HP-2026-0115, which are not in Docketmonster as we hold it (matters run from HP-2026-1035 upward?). Is the numbering different, or are these callers not clients?
- Daily cron `30 13 * * *` (wrangler.toml) needs Worker secrets before the next `npm run deploy`: `wrangler secret put MOSTLY_ANSWERED_URL`, `MOSTLY_ANSWERED_USER`, `MOSTLY_ANSWERED_PASS` (values in `.env`). Without them the daily run fails and is logged, nothing else breaks.
- Operators DS, JT, RM, KL do not match staff initials (Devin Trask is DT, Katherine Doyle KD, Marcus Hill MH), so they stay outside `employees`; the person-to-employee link for messages is `hp.message_callbacks` (who tried to reach the caller afterwards).

## Later: event reconciliation
- Pair Ringsnitch and Jigglewire calls by their shared id suffix (`CAL<x>` / `JICAL<x>`) so each call is one event with the ad channel from Ringsnitch and the handler from Jigglewire; today both are kept as separate `contact_events`.
- Ringsnitch says `answered: true` on calls Jigglewire shows as forwarded or missed; record which system we trust for what.
- Email and name matching (low confidence) once the phone-only review list has been read.

## QA: time zone reconciliation
Every source writes time differently, and one wrong zone silently moves calls in or out of office hours. Before hand-in, prove each source's zone with data and record the result in `docs/systems.md`. Zones live in `src/lib/dates.js` (`SOURCE_ZONES`, `toUtc`).
- **Per-source check.** For each system, pair the same real-world event with another system's UTC time and report the offset in minutes: Ringsnitch (UTC, `Z`) vs Jigglewire call log (paired by id suffix `CAL<x>` / `JICAL<x>`; 2,991 pairs were 0 min on 2026-10-16), Lawllama `created_at` (UTC) vs Blankety `created_at` (all 454 were -4 h), Lawllama retained lead vs Docketmonster `OpenedDate` (only day-level so far, so Docketmonster's zone is still an assumption), Mostlyanswered (zone assumed Chicago: pair its "Wei Fontaine"-style messages with the Jigglewire call forwarded to +1 847 555 0190 minutes earlier and report the offset) and TalkEgg once ingested.
- **Daylight saving.** US clocks go back on 2026-11-01. Rerun the Blankety offset check on data after that date: a constant -4 h means a fixed UTC-4 account, -5 h means US Eastern. If it is fixed, change `SOURCE_ZONES` and rebuild with `npm run resolve -- --full`.
- **Office-hours flag.** Compare `contact_events.office_hours` against the hour of day in Chicago for a sample of calls near 8:00 and 18:00 and around midnight UTC; check Jigglewire's `-07:00` label never causes a mismatch.
- **Display.** The dashboard shows Chicago time everywhere and stores UTC. Test a call at 23:30 Chicago (next day in UTC) lands on the right weekday and hour bucket.
- **Tests.** Keep `tests/identity.test.js` date cases for each source format and the DST edges (spring forward, fall back); add a case for any new source.

## Dashboard phase: leads never contacted by an employee
Found while adding Mostlyanswered: a robot phones the answering service to read out website-chat leads (name, issue, the lead's own number). 30 distinct leads were read out between 2026-08-24 and 2026-10-15; only 6 are in Lawllama or Blankety, and **23 have no employee contact of any kind**, so they exist only in `raw_mostlyanswered_messages`. These are the clearest "lost before anyone looked" list we have, and they do not appear in `hp.lost_opportunities` (that view starts from phone calls and Lawllama leads). Use them on the dashboard, with the caveats below.

```sql
SELECT person_id, display_name, primary_phone, min(message_at) AS first_message_at, count(*) AS messages
FROM hp.message_callbacks
WHERE message_type = 'chat_lead_recording' AND stage = 'caller'
  AND NOT EXISTS (SELECT 1 FROM hp.contact_events e WHERE e.person_id = message_callbacks.person_id AND e.employee_id IS NOT NULL)
GROUP BY 1, 2, 3 ORDER BY first_message_at;   -- one row = one lead, 23 rows on 2026-10-16
```

- Each lead is read out 2-3 times a few minutes apart (the view flags the repeats), so count people, not messages.
- The name comes from the operator's transcription ("Maria Crenshaw?") and the number links at 0.70 confidence; a misheard digit would make a lead look uncontacted. Spot-check some against Lawllama and Blankety by name before showing a total.
- "Never contacted" means no employee-handled or outbound event in our data; a callback made from a personal phone would not show.
- Decided: folded into `hp.lost_opportunities` as `loss_type = 'chat_lead_unanswered'` (`sql/012`, columns `chat_lead_first_at`, `chat_lead_messages`). It is checked last, so 20 of the 23 show under it and the other 3 already count as `unreturned_call` (they also phoned in and were forwarded to the service). Total with that type or those 3: 23. Ask Denise who the "new chat lead" caller is (see Mostlyanswered questions).
