# Later

## Deploy the Ringsnitch sync cron
The cron is coded (`src/scheduled.js`, `[triggers]` in `wrangler.toml`) and tested locally, but not deployed. To go live:
1. Set the Worker secrets (values are in `.env`; do not print them): `wrangler secret put RINGSNITCH_READKEY` and `wrangler secret put RINGSNITCH_ACCOUNT_ID`. `DATABASE_URL` and `AUTH_PASSWORD` are already set.
2. `npm run deploy`.
3. After the first cron tick, check `hp.integration_logs` for a `run_end` with message `ok`.
4. Update the "Worker only reads" line in `CLAUDE.md`: the Worker now also writes to `hp` tables (never `ops`).
5. Decide whether a daily full sync is wanted (needs enough Worker CPU; the cron is incremental only).

## Ask Denise (for the next update email)
- Who answers the main line (888) 477-7204? Ringsnitch tracker TRK105 ("Main line (front desk)", forwards to +1 773 555 0110) has no calls among the 3,549 we pulled. Is it not recorded in Ringsnitch, or are those calls only in TalkEgg?
- Ringsnitch has only four users (Dana, Denise, "Front Office", Brainfog Media) and none are intake staff, and calls carry no user field. Confirm that who handled a call comes from Jigglewire/TalkEgg, not Ringsnitch.
- Existing open questions are in `docs/systems.md` (logins, Mostlyanswered file, LSA leads, recordings, Blankety to Lawllama).
