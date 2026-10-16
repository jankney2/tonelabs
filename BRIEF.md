# Harlow & Pike: your brief

Project ID: 9960-0186

The client's email is on your environment page. Read it first.

## The job

1. Connect the firm's systems and bring their data into your database.
2. Make that database the one place the firm can trust. The information is
   imperfect: systems disagree, and some records are not what they look like.
   Decide what to believe, and say why.
3. Build a dashboard on it that helps someone at the firm make a decision or
   do useful work. Choose what matters most, make it easy to understand and
   act on, and say why it deserves attention. A focused result beats a large
   collection of views with no clear priority.

The kinds of thing worth looking for:

- one record appearing in several systems under different details
- two systems that disagree about whether, or when, something happened
- information you don't have that may exist somewhere and would make the
  data better
- things the data shows that the firm could act on to run better

Use AI wherever it helps. You are responsible for the decisions and for
checking the result. Afterwards we'll ask you to walk us through an
important result and make a small change, with AI and documentation
available.

## Your contact

Denise Neill, office manager: denise.neill@harlowpike.lawport.net

Email her to start; she will send the logins. Ask her whatever the data
cannot tell you. Some answers she has to get from Dana, which takes a few
minutes. Keep an eye on your inbox while you work, and check your spam
folder.

Once you've had a first look, send her a short update: what you think the
main opportunity is, what you still need to understand, and what you plan
to look at or build next. It's a working guess, not a proposal for
approval. Keep working while you wait, and tell her if what you learn
changes your direction.

The firm's people are played by AI, on email and on the phone. The main
number is on the shared docs. Calls are recorded.

## What you have

The .env in this kit: your database, your Worker, and your app's address.
The firm's shared docs: https://harlowpike.lawport.net/shared/dneill/forms/accounts/

## Hand back

- the dashboard, live at your app's address
- one zip: your code and a short README that says
  - who should use the dashboard, what they should notice or do first, and
    why that comes first
  - up to three decisions that mattered (what not to trust is often one):
    the evidence behind each, an alternative you considered, and what would
    make you revisit it
  - for one important result: the query behind it, what one row is, how the
    records are joined, and a check that shows it means what you say
  - the dashboard's login, if it has one

  Links to code, queries and notes you already have are enough.
- your AI conversations, sent separately: the original exports, including
  planning or coaching chats outside your coding tool, not a summary. Claude
  Code keeps them in `~/.claude/projects/`, Codex in `~/.codex/sessions/`;
  chat apps have an export. The keys in this kit's .env can stay in; take
  out anything personal or unrelated. If a session can't be exported, say
  which.

Send the zip, without the .env:

```
curl -X POST https://harlowpike.lawport.net/api/submit \
  -H "Authorization: Bearer $HARLOWPIKE_SUBMIT_KEY" \
  -H "Content-Type: application/zip" --data-binary @handin.zip
```

Then the AI conversations, zipped, up to 95 MB per request (send as many
as you need):

```
curl -X POST "https://harlowpike.lawport.net/api/submit?part=logs" \
  -H "Authorization: Bearer $HARLOWPIKE_SUBMIT_KEY" \
  -H "Content-Type: application/zip" --data-binary @ai-logs.zip
```

You can hand in again; we read the latest zip and keep every log. Keep the
dashboard and the database running until we've been in touch.
