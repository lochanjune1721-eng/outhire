# outbid.lol

A pay-to-rank hiring leaderboard, in two directions.

**Candidates** pay to appear with their portfolio, a one-line pitch, and a photo
or video. **Recruiters** pay to appear with their open role. Both boards sit on
the same homepage behind one toggle. Separately, anyone can paste a job link
from a real hiring platform, which spawns a board for that specific role — flat
$5 to appear on it, and the recruiter signs in to see everyone who applied.

Vanilla HTML, CSS and JavaScript. No framework, no bundler, no build step.
Supabase over the CDN script tag. Vercel functions only for what the browser
must not do.

---

## The tapering leaderboard

The signature mechanic: card size scales down with rank, so #1 physically
dominates the page and each step down is visibly smaller. No copy has to argue
that the top spot is worth paying for.

| Rank | Padding | Media | Title | One-liner | Bid | Fill |
|---|---|---|---|---|---|---|
| #1 | 40px | 180px | 32/700 | 20px | 36px | `--accent-lo`, 2px coral border |
| #2 | 32px | 140px | 26/700 | 18px | 30px | `--accent-xlo` |
| #3 | 28px | 120px | 22/700 | 16px | 26px | `--accent-xxlo` |
| #4–10 | 24px | 96px | 19/600 | 15px | 22px | white |
| #11–25 | 20px | 72px | 17/600 | 14px | 19px | white |
| #26+ | 16px | 56px | 16/600 | 14px | 17px | white |

Rank maps to a tier, and the tier sets every size through CSS custom properties
— one lookup rather than six templates (`js/board.js` → `tierOf`).

**Media never loads forty iframes.** A row renders a still: the photo, or the
video platform's thumbnail with a coral play button over it. The `<iframe>` is
created only when someone clicks. If both a photo and a video are supplied, the
photo is the thumbnail and the play button sits on it. Missing images fall back
to a coral monogram tile rather than a broken frame.

---

## Files

```
index.html        homepage — header, side toggle, tapering board, activity, pagination
submit.html       entry form for both sides
upload.html       post-payment photo/video (?token=)
entry.html        one entry (?slug=)
job.html          paste a job link, confirm the parse, spawn a board
board.html        a role board (?slug=)
recruiter.html    magic-link login + applicant dashboard
admin.html        approve / reject / grant

css/style.css     the whole design system
js/config.js      the two client-safe keys
js/supabase.js    client, shared queries, formatting, theme
js/board.js       the tapering board (shared by homepage and role boards)
js/submit.js  js/upload.js  js/job.js  js/roleboard.js
js/recruiter.js  js/entry.js  js/admin.js

api/_lib.js       shared serverless helpers
api/checkout.js   Stripe Checkout, destination charge
api/webhook.js    checkout.session.completed → bid, upload token, email
api/parse-job.js  whitelist → fetch → LLM extract → confirm → create board
api/upload-url.js signed storage upload against a paid token
api/recruiter.js  shortlist, notes, contact reveals
api/admin.js      server-side password check

sql/schema.sql    tables, triggers, RLS, storage, the one seed entry
```

---

## Setup

**1. Database.** Paste `sql/schema.sql` into the Supabase SQL editor and run it.
It creates every table, the bid and click triggers, RLS, the `photos` bucket,
and the single seed entry.

**2. Client keys.** Put your Supabase URL and anon key into `js/config.js`.
There is no build step, so Vercel env vars cannot reach static files — the anon
key is public by design and ships in that file. Nothing secret goes there.

**3. Vercel env.** Copy `.env.example` into the project's environment variables.

**4. Stripe webhook.** Point it at `https://yourdomain/api/webhook` for
`checkout.session.completed` and copy the signing secret into
`STRIPE_WEBHOOK_SECRET`.

**5. Seed.** Before running the schema, replace the seed headline with your own
one-liner and upload your photo to the `photos` bucket as `seed/lochan.jpg`.
The board then shows one card at #1 and the empty state below it.

Left unconfigured, the site renders that one seed entry and the empty state. It
does **not** generate placeholder companies or fake candidates — an obviously
fake board is worse than an empty one.

---

## How the money works

`/api/checkout` finds or creates the entry as `pending`, then opens a Stripe
Checkout session as a Connect **destination charge** to
`STRIPE_CONNECT_ACCOUNT_ID`. Minimum $5. Role boards are a flat $5 with no
bidding; the homepage board bids.

Re-entering the same URL on the same side finds the existing row instead of
duplicating it — that is what makes *"enter the same URL and up your bid"* work.

`/api/webhook` verifies the Stripe signature over the raw request body
(`node:crypto` HMAC, constant-time compare, 5-minute tolerance), inserts the bid
with `resolution=ignore-duplicates` on the unique `stripe_session_id` so a
replayed webhook is a no-op, mints an `upload_token`, and emails the upload
link. A database trigger raises `entries.current_bid_cents`, stamps
`last_bid_at`, and adds to `site_stats.total_revenue_cents`.

---

## Job boards from pasted links

The domain whitelist is checked **first, before anything touches the network** —
that is what stops people spawning boards for jobs that do not exist. It lives
in `api/parse-job.js`; the copy in `js/supabase.js` only gives a faster answer.

**The manual path is built first, not second.** LinkedIn blocks server-side
fetches, so a failed fetch is the designed outcome, not an error state: the page
shows a paste-the-description form and editable fields. Either way the parsed
result always comes back for confirmation — nothing is written until the caller
sends a confirmed payload.

Boards deduplicate on a normalised URL (tracking params stripped, LinkedIn's
`currentJobId` and Indeed's `jk` preserved), so two links to the same posting
join one board.

**The model is deliberately not pinned.** `LLM_PROVIDER` picks the wire format:

- `openai` (default) — any OpenAI-compatible `/chat/completions` endpoint, which
  is what DeepSeek, OpenAI, Together, Groq and vLLM all speak. Set
  `LLM_BASE_URL` and `LLM_MODEL`.
- `anthropic` — the Anthropic Messages API.

With no `LLM_API_KEY` at all it degrades to the manual form rather than erroring.

---

## Protecting candidates

Verification stops the lazy fakes; message-flow design stops the rest.

- Recruiter sign-in is a Supabase magic link, work email only. Free and
  disposable inboxes are blocked in the browser *and* on the server.
- The email domain must match the board's `company_domain`. A mismatch is
  **flagged for manual review, not rejected** — small startups use odd domains.
- **Candidate emails are unreadable with the anon key at all.** RLS is
  row-level and cannot hide a column, so `sql/schema.sql` revokes `SELECT` on
  `entries` and grants back every column *except* `email` and `upload_token`.
  The only route to a candidate's address is `/api/recruiter` with
  `action: 'reveal'`, which writes a `contact_reveals` audit row and emails the
  candidate that it happened.

---

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` is read only inside `/api` and appears in nothing
  the browser downloads.
- No public writes to `entries` or `bids`. The anon key can insert into `clicks`
  and call `record_visit()`; that is all.
- The `photos` bucket has public read and **no** write policy. Uploads use a
  signed URL minted server-side against a paid `upload_token`.
- The admin password is compared with a constant-time equal inside
  `/api/admin`, never in the browser. Login returns a short-lived HMAC token so
  the password itself is not held in the page.
- Outbound entry links carry `rel="noopener noreferrer nofollow"`.

## No npm dependencies

The serverless functions call Stripe over its REST API, Supabase over PostgREST,
and hash the webhook HMAC with `node:crypto`. `package.json` exists only to set
`"type": "module"`. Nothing installs, nothing builds.

## Performance

Photos are centre-cropped and resized to 800px square **in the browser** before
upload, matching the `object-fit: cover` the cards use — what you see in the
preview is what the board renders. They load on every page view and are the one
thing that has to be fast. All below-the-fold images are `loading="lazy"`.

## Quality floor

Responsive to 360px, verified in headless Chromium at 360 / 768 / 1440 — the
taper still applies on mobile, and on #1 the media stacks above the text when
there is a real photo. Keyboard focus is a coral ring. Dark mode is a header
toggle persisted in `localStorage`. `prefers-reduced-motion` is respected, and
where hover is unavailable the claim button is permanently visible rather than
unreachable.
