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

## Endpoints (`GET /api/dashboard/...`)
- `filters`: employees, lead sources, data-as-of.
- `summary`: `calls` (one row = one inbound call on the intake phones, `hp.inbound_calls`) and `funnel` (one row = one lead created in the range, `hp.person_summary`).
- `lost`: one row = one person who could have become a client (`hp.lost_opportunities`), grouped by type, Lawllama lost-reason bucket and lead source. A person is dated by the failed call, the first chat-lead message, or (lost and never-called leads) lead creation, because Lawllama has no "marked lost" date.
- `lost/people`: the call-back list, newest first, 100 max; leaves out `lead_lost` unless `loss_type` is given.
- `calls`: heatmap data. One row = one weekday/hour slot (Chicago time, `dow` 0 = Sunday) with `inbound` calls and `failed` (no person at the firm spoke to the caller). Follows the date range and `hours` filter.
- `people/:id`: one person's timeline. Their `hp.contact_events` (newest first, 300 max, with the employee's name) and their `hp.person_links` (source, match method, confidence, reason). No raw payloads. Filters are ignored; 400 for a non-numeric id, 404 for an unknown one. Opened by clicking a name in "Who to call back".
- `employees`: one row = one intake employee. Legs come from `hp.call_legs` (each time the phone rang them). A call-back is the first employee to call or speak to a caller after a call no person answered (`hp.inbound_calls` joined to `hp.contact_events` on `person_id`).

## Check that the numbers mean what they say
For any range, `answered + answering_service + missed + voicemail = inbound` in `summary.calls`, and `answered` equals the sum of `answered` across all employees (the employees endpoint with no employee filter). Month to date on 2026-10-16: 438 + 488 + 96 + 10 = 1,032.

## Known limits
- Gloria's front desk phone (TalkEgg) is not ingested, so "front desk" is the intake phone team (Jigglewire).
- Chat-lead rows rest on a phone number an operator typed (link confidence 0.70).
- "Contacted" means an employee handled a call with or dialled the person in our data; a call from a personal phone would not show.
