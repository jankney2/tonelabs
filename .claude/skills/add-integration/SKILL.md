---
name: add-integration
description: Add a new external system (TalkEgg, Lawllama, Blankety, Docketmonster, ...) to the Harlow & Pike pipeline - API service class, raw tables per endpoint, sync scripts, tests and docs. Use when asked to integrate, ingest or connect a system.
---

# Add an integration

Template: Ringsnitch (`src/integrations/ringsnitch/`) for static-key auth, Jigglewire (`src/integrations/jigglewire/`) for token auth. Work on `feature/<system>-integration`.  keep commits small.

1. **Check if we are on the main git branch**. if we are on the main branch, branch off for a feature/[integration_name]. 
1. **Read the docs and credentials.** Fetch the system's docs; pay attention to auth, paging, rate limits and permissions. Credentials are in `.env` (never print them); add Worker secrets to `docs/todo.md` if the cron will need them. prompt user for documentation link. 
2. **Probe first.** Write `scripts/probe-<system>.js` that authenticates and prints one small page per endpoint (structure and one record, never secrets). Docs often omit response fields; design tables from real responses. Note oddities (timezones, duplicates, missing fields).
3. **Service class.** `src/integrations/<system>/<System>ApiService.js` extends `ExternalApiService` with `source: '<system>'`. Static auth goes in the constructor `auth` config. Auth needing a round trip overrides `authenticate({force})` and returns headers. Add one method per endpoint, pagination helper, and request spacing if the rate limit is tight.
4. **Tables.** One `hp.raw_<system>_<endpoint>` plus `_history` per endpoint in the next `sql/NNN_*.sql` (copy `sql/004_raw_jigglewire.sql`), mirrored in `src/db/hp-schema.js` with `rawTable`/`historyTable`. Apply with `npm run db:apply -- sql/NNN_x.sql`. Payload is stored exactly as returned; no reshaping, never touch `ops`.
5. **Sync modules and script.** Land through `src/integrations/landRaw.js`: `landSnapshot` for complete lists, `landRows` for date-windowed lists, `flagMissing` only after a complete full sync. Calls: `--full` and incremental (newest record minus 2 day overlap). Add `scripts/sync-<system>.js` (`--full`, `--max-pages`) and `npm run sync:<system>`. Wrap each run in `api.startRun`/`finishRun`.
6. **Verify.** Jest tests with a fake fetch and fake db (see `tests/jigglewire*.test.js`); `npm test`. Run the full sync, then an incremental one: the second must show 0 new, 0 changed.
7. **Document.** Fill in the system's row in `docs/systems.md` (access, fields, quirks, counts, date range), questions for Denise in `docs/todo.md`, and update the "Done so far" line in the CLAUDE.md integrations section.
