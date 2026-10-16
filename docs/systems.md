# Systems inventory

Source: the firm's shared docs page (https://harlowpike.lawport.net/shared/dneill/forms/accounts/), read 2026-10-16. Logins are on a separate sheet held by Denise. Never use "reset password" (it emails Dana).

"Access" and "fields" stay `TBD` until we have logins and have looked at each system. Update this file as we learn, and record quirks under "known issues".

| # | System | URL | What one record probably is | Role in the call journey | Owner | Access | Fields | Known issues |
|---|---|---|---|---|---|---|---|---|
| 1 | Ringsnitch | ringsnitch.tone.fyi | A tracked inbound call, with its source number (ad, website or billboard) | Marketing attribution; the main number is tracked here too | Brainfog set up the numbers | TBD | TBD | |
| 2 | Jigglewire | jigglewire.tone.fyi | A call answered or returned by the intake team | Main intake phones | Marcus (ask before changing anything) | TBD | TBD | |
| 3 | TalkEgg | talkegg.tone.fyi | A front desk call | Older phone setup | Gloria uses it (weekday mornings) | TBD | TBD | |
| 4 | Lawllama | lawllama.tone.fyi | A lead. Web form leads arrive automatically; intake staff add phone leads by hand | Intake and leads | Intake team | TBD | TBD | Hand entry means gaps and typos likely |
| 5 | Blankety | blankety.tone.fyi | A website contact form submission | Feeds Lawllama through an API connection | Brainfog | TBD | TBD | Check whether every submission reaches Lawllama |
| 6 | Docketmonster | docketmonster.tone.fyi | A case, after signing | Outcome: who became a client | TBD | TBD | TBD | Old system with old docs |
| 7 | Mostlyanswered | mostlyanswered.tone.fyi | An overnight or after-hours message | Answering service | No one logs in | A file is posted each morning, downloaded manually; the URL is not on the page | TBD | Manual download; ask Denise where the file lives |
| 8 | Brainfog Media | brainfog.tone.fyi | n/a (agency; invoices) | Marketing spend | Denise and Dana (invoices) | Own logins | n/a | May relate to `ops.marketing_spend` |
| 9 | Website | harlowpike.lawport.net | n/a (hosting; also email) | Hosts the form and the shared docs | Lawport hosts, Brainfog built | n/a | n/a | |

Main office number: (888) 477-7204.

## Already in our database (schema `ops`, read-only, never alter)

| Table | Rows | Newest | Notes |
|---|---|---|---|
| `ops.lsa_charges` | 174 | lead_received_at 2026-10-16 00:18 UTC | Looks like Google Local Services Ads charges per lead. This is a source we did not expect on the page |
| `ops.marketing_spend` | 33 | month 2026-10-01 | Monthly ad spend |
| `ops.staff` | 7 | updated 2026-10-15 | Seven staff, but only four intake people plus Gloria are named. Check who the rest are |

The `ops` data is live, since `ops.lsa_charges` was updated within the last day.

## Open questions for Denise

1. Logins for systems 1 to 7. Which are still in daily use?
2. Where is the Mostlyanswered overnight file posted?
3. Are LSA (Google Local Services Ads) leads handled somewhere? They are not on the systems list.
4. Do call recordings exist, and where? (The brief says calls are recorded.)
5. How do Blankety form leads reach Lawllama, and has the connection ever failed?
