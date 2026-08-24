# Outhire

A public leaderboard of people bidding on themselves. Candidates film forty-five
seconds on why they should be hired, attach a portfolio and a LinkedIn, and pay
to hold a rank. Recruiters browse by role or create a shareable board to drop
into their own job post. Minimum bid $5.

Plain HTML, CSS and JavaScript. No framework, no bundler, no build step.
Supabase over the CDN script tag for the database and storage; Vercel functions
for everything the browser is not allowed to do.

---

## Layout

```
index.html         feed + leaderboard
submit.html        entry form
upload.html        post-payment video upload (?token=)
entry.html         single entry (?slug=)
recruiters.html    create a board
board.html         recruiter board (?token=)
admin.html         approve / reject / grant

css/style.css
js/config.js       the two client-safe keys
js/supabase.js     client init + shared queries + formatting
js/feed.js         feed, sidebar, activity, ledger table, entry page
js/submit.js
js/upload.js
js/board.js        recruiters.html + board.html
js/admin.js

api/_lib.js        server helpers (not a route)
api/checkout.js    Stripe Checkout session
api/webhook.js     Stripe webhook
api/upload-url.js  signed upload URL, issued only after payment
api/board.js       board creation
api/admin.js       password check + review actions

sql/schema.sql     tables, triggers, RLS, storage, category seed
vercel.json
```

## Setup

**1. Database.** Open the Supabase SQL editor and run `sql/schema.sql` once. It
creates the tables, the triggers, the RLS policies, the `videos` bucket and the
fixed category list.

**2. Client keys.** Put the project URL and the anon key into `js/config.js`.
There is no build step, so Vercel environment variables cannot reach static
files — these two are the ones the spec marks as safe in client JS, and they
ship with the site. Leave the placeholders alone and the site runs against a
built-in demo ledger of twenty-six entries, which is how you check the feed
feels right before wiring anything up.

**3. Environment.** Set everything in `.env.example` in the Vercel dashboard.
`SUPABASE_SERVICE_ROLE_KEY` is read inside `/api` only and appears in no file
the browser downloads.

**4. Stripe webhook.** Point a webhook at `https://<your-domain>/api/webhook`
for `checkout.session.completed` and put its signing secret in
`STRIPE_WEBHOOK_SECRET`. Payments are destination charges to
`STRIPE_CONNECT_ACCOUNT_ID`.

**5. Email.** Optional. With `RESEND_API_KEY` set, the upload link is emailed on
payment. Without it the link is written to the function log, so the flow still
completes — check the log, send it by hand, or grant the entry from
`/admin.html` instead.

**6. Seed.** Open `/admin.html`, unlock with `ADMIN_PASSWORD`, and grant twenty
to thirty free entries. Each one comes back with an upload link to pass on. A
granted entry sets its bid directly and does not touch the revenue counter, so
seeding does not inflate the number in the masthead. Approve each entry once its
video is in, then turn payment on.

## How money moves

1. `submit.html` posts to `/api/checkout`.
2. `/api/checkout` finds the caller's entry by email, or creates one at
   `status = 'pending'`, then opens a Stripe Checkout session carrying the entry
   id in metadata.
3. Stripe calls `/api/webhook`. The signature is verified against the raw body,
   then a row goes into `bids`, unique on `stripe_session_id` — a redelivered
   event is a no-op rather than a second line on the ledger.
4. The trigger on `bids` raises `entries.current_bid_cents`, stamps
   `last_bid_at`, and adds the amount to `site_stats.total_revenue_cents`.
5. The webhook mints an `upload_token` and emails the upload link.
6. `upload.html` validates the file on the device, gets a signed URL from
   `/api/upload-url`, uploads, and sets the entry back to `pending`.
7. `/admin.html` approves it and it goes live.

One person holds one entry per board. A second payment raises the bid on the
entry they already have rather than filing a duplicate.

## Notes on the build

**Five serverless functions, not two.** The spec asks for two, on the grounds
that only Stripe needs a server. Three more are structurally required by the
rest of the spec, not by choice:

- `api/upload-url.js` — the bucket has public read and no public write, and
  uploads use "a signed URL issued only after payment". Minting that URL needs
  the service role key, so it cannot happen in the browser.
- `api/admin.js` — the spec requires the admin password to be "checked against a
  serverless endpoint, never client-side", and approve/reject writes to
  `entries`, which RLS gives the anon key no path to.
- `api/board.js` — `boards` is public-read but not public-write, so creating one
  from `recruiters.html` needs the service role key too.

Each one exists because RLS is correct, not because it was loosened.

**Two additions to the schema.** Both are marked in `sql/schema.sql`:

- `site_stats.visit_count` plus a `record_visit()` function. The masthead prints
  "X visitors since launch" and nothing in the given schema counts visits.
  A security-definer function keeps the table read-only to the public.
- A trigger on `clicks` and a `record_view()` function, because `click_count`
  and `view_count` live on `entries`, which the anon key cannot update.

**No npm dependencies.** Stripe is called over its REST API with `fetch`,
Supabase over PostgREST, and the webhook signature is verified with
`node:crypto`. Nothing installs, so nothing builds.

## Design

Five colours, and only five:

| Token     | Value     | Used for                          |
| --------- | --------- | --------------------------------- |
| `--paper` | `#EDEAE3` | all chrome                        |
| `--ink`   | `#12100E` | all text                          |
| `--rule`  | `#C4BFB4` | hairlines and borders             |
| `--live`  | `#E8422C` | live indicators, the #1 bid, focus |
| `--field` | `#1C1A17` | video letterbox surround          |

Anton for the rank numbers and page headlines, Inter for body text, JetBrains
Mono with tabular figures for every numeral on the site — that is what makes it
read as a record rather than a feed. Hairline borders, no radius except avatars,
no gradients, no shadows. The rank sits at 180px behind the video: in the
letterbox margin on desktop, bleeding off the top-left corner on mobile.

Motion is close to nothing. Activity rows slide in from the top, the revenue
counter ticks up once on load, and the feed scroll-snaps. All three stop under
`prefers-reduced-motion`. The layout holds to 360px, and keyboard focus is a
`--live` outline everywhere.

## Local

Any static server plus the Vercel CLI for the functions:

```
vercel dev
```

Without the CLI, `python3 -m http.server` serves the pages. The `/api` routes
will 404, so checkout, upload and admin do not work, but the feed, the
leaderboard and the demo ledger all render.
