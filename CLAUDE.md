# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## State of the repo

Step 1 is done: a Hono Worker with Basic Auth, a `/api/health` DB check, a placeholder page, a read-only DB audit script and Jest tests. Ingestion is done for the reachable systems and identity resolution (phone only) is built; not built yet: event reconciliation, the dashboard. Other files: `BRIEF.md` (the assignment, project ID 9960-0186, read it first), `ideas.md` (the user's notes), `.env` (credentials; don't print it, commit it, or zip it), `.dev.vars` (git-ignored local Worker secrets).

## Commands

- `npm run dev`: local server (`wrangler dev`, http://localhost:8787). Reads `.dev.vars` (`AUTH_PASSWORD`, `DATABASE_URL`).
- `npm test`: Jest, calls the Hono app directly with a fake DB (`tests/health.test.js`).
- `npm run audit`: read-only listing of DB tables, row counts and newest timestamps.
- `npm run deploy`: `wrangler deploy` with `.env` loaded. Secrets were set once with `wrangler secret put AUTH_PASSWORD` and `DATABASE_URL`.
- Basic Auth user is `harlowpike`; the password is `AUTH_PASSWORD` in `.dev.vars`.
- `src/app.js` is the Hono app (`createApp({getDb})`, DB injectable for tests); `src/worker.js` is the entry. Files in `public/` are served through the Worker so auth covers them.
- Database is Neon Postgres, queried with `@neondatabase/serverless`. It already holds firm data in schema `ops` (`lsa_charges`, `marketing_spend`, `staff`). Never alter it; land our own data in `raw_<source>` tables.
- No usable `python3` on this machine (missing Xcode tools); use Node for scripting.

## Git

- Branch `main`. Keep commits small: one feature or one logical change per commit, with tests and docs for that change in the same commit.
- Write a short imperative subject line (for example "Add Ringsnitch raw table"). Never commit `.env` or `.dev.vars`.
- Only commit when the user asks.

## The project

A consulting-style engagement for a law firm, Harlow & Pike. The job has three parts:

1. **Ingest.** Connect the firm's systems and load their data into our own database. The Worker (presumably Cloudflare) and database come from `.env`. The firm's shared docs live at https://harlowpike.lawport.net/shared/dneill/forms/accounts/.
2. **Reconcile.** Make the database the one trustworthy source. The source data is deliberately imperfect: the same record shows up in several systems under different details, systems disagree on whether or when something happened, some records aren't what they look like, and some useful information is missing. Every trust decision must be justified with evidence.
3. **Dashboard.** Build one focused dashboard, live at the app address, that helps a specific person at the firm decide or act. Prioritize one clear thing over many views.

## Client context (Dana's email, in `ideas.md`)

- Dana is the firm's decision-maker. The firm's phones and intake run on several unconnected systems, each with its own view of who contacted them and what happened next, so answers differ by system.
- She wants all systems connected in one trusted place, and wants to see what to look at and where things are broken. She suspects the firm loses clients through poor call handling.
- Office hours are Mon-Fri 8-6 Chicago time. Intake staff are Devin, Katherine, Marcus and Rosa. Gloria covers the front desk on weekday mornings.
- If a login fails, ask Denise. Never click "reset password" on anything, because it emails Dana.

## Building the integrations (current phase)

We are now connecting each system in turn, using Ringsnitch as the template. For every system:

1. A class in `src/integrations/<system>/<System>ApiService.js` that **extends `ExternalApiService`**. Put anything system-specific there: base URL, auth, paging, rate-limit spacing, one method per endpoint. Static auth (bearer/header/basic/query) is just constructor config; anything needing a round trip (Jigglewire's OAuth JWT exchange) overrides `authenticate()`.
2. **One raw table per endpoint**, `hp.raw_<system>_<endpoint>` plus a `_history` twin, created by the next numbered file in `sql/` (apply with `npm run db:apply -- sql/NNN_x.sql`) and mirrored in `src/db/hp-schema.js`. Payload is stored exactly as the API returned it (`source_id`, `payload`, `content_hash`, first/last seen, `not_in_latest_pull`). Never reshape in the raw tables; reconciliation comes later.
3. **Sync modules** in the same folder that land data through `src/integrations/landRaw.js` (`landRows`, `landSnapshot`, `flagMissing`), so every system follows the same idempotent rules. Complete lists use `landSnapshot`; date-windowed lists use `landRows` and flag missing rows only after a complete full sync.
4. **A script** `scripts/sync-<system>.js` (`--full`, `--max-pages`) and an `npm run sync:<system>` entry; requests are audited to `hp.integration_logs` through the service's logger.
5. Jest tests with a fake fetch/db, a row in `docs/systems.md` (access, fields, quirks found), and a probe or live run to check the real response shapes before designing tables (docs often omit fields).

Done so far: Ringsnitch (calls, trackers, users; also on the cron), Jigglewire (call log, extensions, queue presence, voicemail; script only, not yet on the cron), Lawllama (leads with contacts, lead statuses, users; script only; contact SSN/DOB/immigration status are redacted and never stored; monthly record quota, so sync incrementally), Blankety (forms, questions, submissions; script only; 1,000 calls/day), Docketmonster (matters over SOAP via `soap.js`, no XML library; script only; whole history is one call), Mostlyanswered (answering service: Basic Auth directory of daily CSVs, `csv.js` parser; daily cron at 13:30 UTC (needs Worker secrets `MOSTLY_ANSWERED_*`, not deployed yet); messages keyed `<file>:<row>`; in identity resolution, view `message_callbacks`). Branch per system: `feature/<system>-integration`.

## Identity resolution (done: phone only; includes answering-service messages)

`npm run resolve` (`--full` rebuilds) links every raw record to a person by normalised phone and writes `hp.people`, `person_links` (method, confidence, reason), `match_review`, `employees`, `contact_events`, `call_legs`; views `person_summary`, `lost_opportunities`, `inbound_calls`, `message_callbacks` (`sql/008`, `sql/009`, `sql/011`; `sql/012` adds loss_type `chat_lead_unanswered` to `lost_opportunities`). Code in `src/identity/` (`rules.js` pure rules, `sources.js` what to read per source, `resolve.js` the run), dates in `src/lib/dates.js`. Hourly cron at :15 is coded but not deployed. Details and evidence: the last section of `docs/systems.md`. Dashboard rule agreed: identity and attribution are materialised by the job, dashboard numbers are computed at request time from those tables.

## Dashboard

Built: read-only endpoints in `src/dashboard/` and a two-tab page in `public/` (Missed opportunities, Front desk productivity). See `docs/dashboard.md`. Node 24 is needed locally (`~/.nvm/versions/node/v24.21.0`; the default `node` is v14).

## Planned architecture (agreed, not yet built; full plan in `~/.claude/plans/make-note-of-the-witty-unicorn.md`)

- Backend: Hono on the Cloudflare Worker (Express-style routing, native to Workers), deployed with `wrangler deploy`. Express with a tunnel was rejected because `APP_URL` is the Worker and the app has to stay up after hand-in.
- Frontend: vanilla JS and Chart.js, served as static assets from the same Worker.
- Ingestion: local Node scripts that write raw per-source tables and then reconcile into `people` and `contacts` tables.
- Auth: HTTP Basic Auth with a Worker secret. Nothing heavier.
- First step is a hello-world deploy plus a database connection check. Don't write code until the user says so.

## Working constraints from the brief

- The firm's staff are AI-played and reachable by email and phone. The contact is Denise Neill, the office manager (denise.neill@harlowpike.lawport.net). She sends the logins and escalates questions to Dana. Check inbox and spam. Email and phone steps are performed by the user, not by this tool.
- After a first look at the data, the user sends Denise a short update: the main opportunity, open questions, and what is next. Send another if the direction changes.
- The user will later be asked to walk through an important result and make a small change, so keep the code understandable and documented.
- Keep the dashboard and database running until the firm has been in touch.

## Design direction (from `ideas.md`)

- Aim for a single source of truth. On ingesting a record, check all systems for an existing match before creating a new one.
- Identity matching, strongest signal first: phone number, then email, then name matching (least confident). Store the match confidence and the reason with each link so trust decisions can be explained later.
- Decide which system is most reliable per field or event, and record why.

## Hand-in

Deliver a zip (without `.env`) containing the code and a short README covering:

- who should use the dashboard, what to notice or do first, and why
- up to three decisions that mattered, each with evidence, an alternative considered, and what would make you revisit it
- one important result: the query behind it, what one row is, how records are joined, and a check that it means what is claimed
- the dashboard login, if any

Submit by POSTing the zip to `https://harlowpike.lawport.net/api/submit`, with an `Authorization: Bearer $HARLOWPIKE_SUBMIT_KEY` header and `Content-Type: application/zip`. The AI conversation exports go to the same URL with `?part=logs`, at most 95 MB per request. Claude Code sessions are in `~/.claude/projects/`. See `BRIEF.md` for the exact curl commands. Handing in again is allowed; the latest zip is read.
