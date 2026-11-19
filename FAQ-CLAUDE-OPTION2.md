# FAQ suggestions by Claude - option 2 (built into the app) - SAVED FOR LATER

Brent (11-18): FAQ look D + "answers before sending" (F); Claude option 1 for
now (Claude reads the inbox on request in this Project, through the Supabase
connector, and leaves drafts in the suggestion list). Option 2 below is the
built-in version, kept here to come back to "when needed" (when the inbox gets
busy enough that asking by hand becomes a chore).

## What option 2 adds
- A **Suggest** button in the staff inbox's FAQ screen, and optionally a
  **weekly run** (e.g. Monday morning) that fills the same suggestion list.
- Same review screen as option 1 (S3 in design/faq.html): each suggestion
  shows the drafted question and answer and "Asked in N messages"; Accept
  (opens the FAQ editor to check), Edit, Dismiss. Nothing publishes without
  a person.

## How it would work
1. **Supabase Edge Function `faq-suggest`** (Deno/TypeScript, runs on the
   Supabase server, never in the app).
   - Called by the app with the signed-in staff member's token; the function
     checks support.staff before doing anything (owners and helpers only;
     helpers maybe only their own items - decide then).
   - Reads the last N days of feedback + non-internal replies, **strips
     emails and names** (send only kind, body, status, fixed_in, the staff
     reply text), plus the current published FAQ (so it doesn't suggest
     duplicates) and the list of manual guide titles (so it can suggest a
     "Show me how" link).
   - Calls the Claude API (Messages API) with a prompt asking it to group
     repeated questions/problems, and return JSON: [{question, answer,
     topic, guide, asked, source_ids}]. Ask for plain words, the app's own
     names for screens (Account > Sync Settings ...), no promises about
     unreleased features beyond "planned".
   - Writes rows into support.faq_suggestions (status 'suggested',
     created_by 'claude-api'), skipping questions that match an existing
     FAQ entry or an open suggestion.
2. **Weekly run** (optional): pg_cron + pg_net calling the function, or
   Supabase's scheduled functions. Off by default; a switch in the FAQ screen.
3. **App**: the Suggest button calls the function and shows "Claude is reading
   the inbox..." then refreshes the list. A line says when it last ran.

## Keys and safety
- Needs an **Anthropic API key** (console.anthropic.com > API keys). Brent
  enters it himself as an **Edge Function secret** (Supabase dashboard >
  Edge Functions > Secrets, name ANTHROPIC_API_KEY). NEVER paste it into a
  chat, the app, the repo or a migration. Same rule as the Supabase secret
  key and database password.
- The key lives only on the server; the app never sees it.
- Feedback text leaves Supabase for the Claude API: say so in Privacy and
  your data ("Feedback may be read by an AI assistant to suggest FAQ
  answers; names and emails are removed first"). Check Anthropic's API data
  terms at the time (API inputs are not used for training by default).
- Rate-limit the button (e.g. once per 10 minutes) so a mistaken tap loop
  can't run up a bill. Cap messages sent per run (e.g. last 200).

## Cost
- Pay-as-you-go per run. At this app's volume (tens of messages a week) a run
  is a few thousand words in and a page out: well under a cent with a small
  model (Haiku), a few cents with a larger one. Weekly runs: cents a month.
  Check current prices on the Anthropic pricing page before turning it on.

## Already in place from option 1 (built 11-18)
- support.faq_suggestions table and the staff review screen; option 2 only
  adds the function, the button, the secret and (optionally) the schedule.
