# Dashboard

Two tabs at the app address, built from the reconciled `hp` tables and views (sql/008-012). Code: `src/dashboard/` (params, SQL, routes) and `public/` (page, vanilla JS, Chart.js 4.4.7 vendored in `public/vendor/`). The Worker only reads.

**Who it is for:** Dana (missed opportunities) and the intake team plus Denise (front desk productivity). **Default range:** month to date, Chicago calendar days, both ends inclusive.

## Filters (query string, same on every endpoint)
| Param | Meaning | Applies to |
|---|---|---|
| `from`, `to` | `YYYY-MM-DD`, Chicago days; blank = month to date; max 366 days | all |
| `employee` | comma-separated employee ids | employees tab only |
| `source` | Lawllama lead source, or `No lead` | funnel, lost |
| `stage` | `caller`, `lead`, `client` | funnel, lost |
| `loss_type` | `lead_lost`, `unreturned_call`, `lead_not_called`, `chat_lead_unanswered` | lost |
| `hours` | `any`, `in` (Mon-Fri 8-6 Chicago), `out` | call totals, employees |
| `reason` | `slow_or_unreachable`, `price`, `went_elsewhere`, `not_a_fit` | lost (drill-down) |
| `handled_by` | `employee`, `answering_service`, `missed`, `voicemail`, `failed` (= anything but employee) | drill/calls |
| `dow`, `hour` | heatmap slot, Chicago time, `dow` 0 = Sunday | drill/calls |
| `leg` | `rung`, `accepted`, `missed`: with `employee`, calls that rang / were answered by / rang out on that person's phone | drill/calls |
| `step` | `leads`, `contacted`, `retained` | drill/leads |

## Endpoints (`GET /api/dashboard/...`)
- `filters`: employees, lead sources, data-as-of.
- `summary`: `calls` (one row = one inbound call on the intake phones, `hp.inbound_calls`) and `funnel` (one row = one lead created in the range, `hp.person_summary`).
- `lost`: one row = one person who could have become a client (`hp.lost_opportunities`), grouped by type, Lawllama lost-reason bucket and lead source. A person is dated by the failed call, the first chat-lead message, or (lost and never-called leads) lead creation, because Lawllama has no "marked lost" date.
- `lost/people`: the call-back list, newest first, 100 max; leaves out `lead_lost` unless `loss_type` is given.
- `calls`: heatmap data. One row = one weekday/hour slot (Chicago time, `dow` 0 = Sunday) with `inbound` calls and `failed` (no person at the firm spoke to the caller). Follows the date range and `hours` filter.
- `people/:id`: one person's timeline. Their `hp.contact_events` (newest first, 300 max, with the employee's name) and their `hp.person_links` (source, match method, confidence, reason). No raw payloads. Filters are ignored; 400 for a non-numeric id, 404 for an unknown one. Opened by clicking a name in "Who to call back".
- `drill/calls`, `drill/lost`, `drill/leads`: the records behind a number, each returning `{total, rows}` (newest first, 200 rows max; `total` is before the cap). They reuse the WHERE clause of the number they explain, so the list and the number cannot drift. `calls`: one row = one inbound call (`hp.inbound_calls`) with the caller when known. `lost`: one row = one lost-opportunity person, including `lead_lost`. `leads`: one row = one lead created in the range. On the page: tiles, funnel / reason / source bars, heatmap cells and the employee table's rung / answered / rang out numbers open them; a name in the list opens the person timeline.
- `employees`: one row = one intake employee. Legs come from `hp.call_legs` (each time the phone rang them). A call-back is the first employee to call or speak to a caller after a call no person answered (`hp.inbound_calls` joined to `hp.contact_events` on `person_id`).

## Check that the numbers mean what they say
For any range, `answered + answering_service + missed + voicemail = inbound` in `summary.calls`, and `answered` equals the sum of `answered` across all employees (the employees endpoint with no employee filter). Month to date on 2026-10-16: 438 + 488 + 96 + 10 = 1,032.

Each drill-down total must equal the number it was opened from. `node scripts/check-drilldown.js` (read-only, uses `DATABASE_URL`) checks this for four date ranges: call totals, every heatmap cell, lost people by type / reason / source, funnel steps and each employee's legs (157 checks, all matched on 2026-10-17). The tile "unanswered in office hours" is not a link when Time of day is "After hours", because its number is 0 then.

## Known limits
- Drill-downs do not cover the employee table's "Calls made" and call-back columns yet.
- Gloria's front desk phone (TalkEgg) is not ingested, so "front desk" is the intake phone team (Jigglewire).
- Chat-lead rows rest on a phone number an operator typed (link confidence 0.70).
- "Contacted" means an employee handled a call with or dialled the person in our data; a call from a personal phone would not show.
