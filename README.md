# GOAT.lol

Pay-to-rank leaderboards for the greatest of all time, across ~83 boards — sport,
screen, music, science, business, culture. Fans buy credit, then spend it backing
whoever they believe in. **The money is the ranking.** No algorithm, no free votes.

Inside each person's page is a second leaderboard: their top fans, by total spent.
The top three are named on the person's card.

Vanilla HTML, CSS and JavaScript. No framework, no bundler, no build step.
Supabase over the CDN tag. Two Vercel functions for Dodo Payments. One Node
script for seeding.

---

## The moment the product turns on

Someone taps `$1` on Messi, the number moves, the board reorders, and their
handle appears on his fan list. No modal, no confirmation, no redirect, no
reload. That is `js/board.js`; everything else is packaging.

That is only possible because of credits. One card transaction of $5+, then
unlimited $1 bids from balance — the processor's fixed fee is paid once instead
of on every dollar.

---

## Credit and the rules

| | |
|---|---|
| Minimum top-up | $5 — fixed amounts of $5, $10, $25, $50, $100 |
| Per bid | $1 minimum, whole dollars only |
| Adding a person | $1 from balance, and that dollar is their first backing |
| Credit | never expires, **non-refundable**, said plainly at checkout |
| Taking #1 | costs at least **$5 more** than the current leader |
| Ties | equal totals stay in the order reached — earlier keeps the higher rank |
| Everything else | cumulative, public, permanent, never refunded or decayed |

**Spending is a Postgres function, never client code.** `place_bid()` locks the
user's row, checks the balance, deducts, inserts the bid, adds to the person's
total, upserts `fan_totals`, and stamps `first_backed_at` — one transaction. The
client cannot write a balance; there is no insert/update/delete policy on any
table.

The `$5 to take #1` rule lives inside that function too, so it cannot be bypassed
by calling the RPC directly. A bid that would land between the leader's total and
that threshold is refused, and the error names the amount that would actually
work.

`credit_balance()` is the other half — the only thing that adds money, called
solely by the webhook with the service role key, and explicitly **not granted**
to `anon` or `authenticated`.

---

## Making mismatched photos look like one set

This decides whether the site looks made or scraped, so the treatment lives in
one place (`.ph` in `css/style.css`) and every photo goes through `G.photo()`.

- Every photo square, `object-fit: cover`, `object-position: center 30%` so faces
  sit where faces actually are in press portraits
- `filter: saturate(.85) contrast(1.05)` plus a warm wash at 8% on all of them —
  the single biggest trick; a 2009 press photo and a 2024 portrait become one set
- Bottom gradient wherever a name sits on the image, so it stays legible against
  any background
- Missing photo → initials in the display face, gold on `--surface`. Deliberate,
  not a hole
- Fixed aspect ratios everywhere; source dimensions never dictate layout

---

## The boards

**147 boards, 2,926 contenders, curated by hand.** There is no Wikidata query
behind this and nothing in it is a placeholder — `scripts/goat-data.js` is the
single source of truth, and `sql/seed.sql` is generated from it.

Ten boards hold fewer than 20 because that is how many real entries exist —
there have only ever been 15 Indian prime ministers. They are left short on
purpose: a board with 15 real names beats one padded to 20 with invented ones,
and anyone can add a missing name for $1.

**Everyone seeds at $0 and nobody is pre-ranked.** The first $1 on a board takes
#1. Since every total starts equal, the ranking rule falls through to
`created_at`, so the seed spaces that by the curated position — the board opens
in the hand-picked order rather than an arbitrary one, without anyone holding a
cent.

Editing the list:

```bash
# edit scripts/goat-data.js, then
node scripts/make-seed-sql.mjs      # regenerates sql/seed.sql
```

`sql/seed.sql` is safe to re-run: existing rows keep their id, their money and
their position, and only names and grouping are refreshed.

## Photos

Every card renders without one — a missing photo becomes initials in the display
face, gold on surface, which is a deliberate part of the design rather than a
gap. To fill them in:

```bash
node scripts/fetch-photos.js --check        # what resolves; writes nothing
node scripts/fetch-photos.js --link-only    # fast: point at Commons directly
npm install sharp
node scripts/fetch-photos.js                # full: download, 800x800, cache
```

`--link-only` finishes in minutes, needs no `sharp` and no storage, and gets
pictures on the board today. It points `photo_path` at Commons URLs, so the
images are hotlinked — fine at launch traffic, but run the full mode before you
have real traffic, because Wikimedia asks people not to hotlink at scale and you
get no control over sizing or availability.

Useful flags: `--only=greatest-footballer`, `--limit=200`, `--concurrency=6`,
`--force` (redo people who already have one).

Three things make this survivable across 2,926 names:

- **Batched.** Title lookups go 50 at a time, so a full run is roughly 700 API
  calls rather than ~5,900.
- **Resumable.** Anyone who already has a photo is skipped, so an interrupted
  run costs nothing — just start it again.
- **Search fallback.** Exact-title lookup misses plenty of these (`1996 Chicago
  Bulls`, `Pizza`, `MrBeast`), so anything not found by title is searched for.

Licences are verified before anything is stored. Commons mixes freely reusable
files with fair-use ones, and a fair-use portrait on a site where people spend
money is a real problem, not a cosmetic one. Anything unverifiable is skipped,
that person keeps their initials, and every miss is written to
`photo-misses.json` with the reason so you can fill the ones that matter in
`/admin.html`.

Expect real coverage to be partial. People and clubs resolve well; dishes,
cuisines and single-year team lineups often do not. That is what the initials
tile is for.

**`sharp` is deliberately not a dependency.** The deployed site has none at all
— the serverless functions use `fetch` and `node:crypto` only — so install it ad
hoc when you want the full photo pass and leave the deploy clean.

## One thing I could not verify

**Dodo's exact API shape.** Everything Dodo-specific is confined to three
functions at the bottom of `api/_lib.js`. Verify before going live:

- `DODO_API_BASE` — test vs live host
- `createDodoCheckout()` — endpoint path and body field names
- `verifyDodoWebhook()` — written to the Standard Webhooks spec
  (`webhook-id` / `webhook-timestamp` / `webhook-signature`, HMAC-SHA256 base64
  over `id.timestamp.body`, secret base64 after the `whsec_` prefix)

If Dodo differs, only those three functions change.

**Before building further: confirm with Dodo that this product is approved.**
A site where people pay to rank public figures *and* hold a stored balance is
unusual on both counts. Their docs say a rejected product gets one appeal and
that decision is final, so this is worth a conversation before more work goes in.

## Setup

1. **Database** — paste `sql/schema.sql` into the Supabase SQL editor and run it.
   Tables, `place_bid`, `credit_balance`, RLS, realtime, and the `photos` bucket.

   The script opens with a **reset block that drops and recreates every table**.
   It is there because this project previously held two other schemas whose
   tables collide with these — the old `bids` keys on `entry_id` where this one
   keys on `person_id`, and `create table if not exists` silently keeps the old
   shape, so the run dies at the first index. The reset makes the script
   re-runnable from any state. **It deletes data** — on a database that has
   taken real money, delete that block and migrate by hand.
2. **Client keys** — put the Supabase URL and anon key into `js/config.js`. No
   build step, so env vars cannot reach static files; the anon key is public by
   design. Nothing secret goes there.
3. **Vercel env** — copy `.env.example` into the project's environment variables.
4. **Seed** — run `sql/seed.sql` in the same SQL editor. 147 boards and 2,926
   people, no network required. The site is fully live at this point.
5. **Photos** (optional) — `npm install sharp && node scripts/fetch-photos.js`.
6. **Review** — open `/admin.html` and go board by board: swap bad photos,
   delete wrong entries, add missing names. Three minutes a board is the
   difference between a site that looks made and one that looks scraped.
7. **Dodo webhook** — point it at `https://yourdomain/api/payment-done`.

## Files

```
index.html      grouped category grid, unclaimed, live feed
category.html   one board (?slug=) — the tapering leaderboard
person.html     portrait, total, rank, full fan leaderboard (?slug=)
fans.html       global top backers
wallet.html     balance, top-ups, profile, full history
rules.html  about.html  terms.html  privacy.html
admin.html      the manual review pass

css/style.css   the whole design system, photo treatment included
js/supabase.js  client, auth, queries, and the header shell (balance on every page)
js/board.js     the tapering board and one-tap backing
js/index.js  js/category.js  js/person.js  js/fans.js  js/wallet.js  js/admin.js

api/_lib.js         shared helpers; the Dodo adapter is the last block
api/checkout.js     create a pending topup, return Dodo's link
api/payment-done.js the webhook — the only place credit is added
api/admin.js        server-side password check, photo swaps, deletes

scripts/goat-data.js       147 boards, 2,926 names — the source of truth
scripts/make-seed-sql.mjs  regenerates sql/seed.sql from it
scripts/fetch-photos.js    optional Commons photo pass, licence-checked
sql/schema.sql             tables, place_bid, RLS, storage
sql/seed.sql               generated: the boards and their contenders
```

---

## Privacy and money safety

- **Emails are unreadable with the anon key.** RLS is row-level and cannot hide a
  column, so `users` rows are public and `SELECT` is revoked, then granted back on
  `id, display_name, is_anonymous, total_spent_cents, created_at` only. Your own
  balance comes back through the security-definer `me()`.
- **Balance never changes on the success page** — only on the webhook.
- Top-ups are idempotent twice over: `dodo_payment_id` is unique, and the
  pending→confirmed flip carries the old status in its filter, so two
  simultaneous webhooks credit exactly once.
- Only the five fixed top-up amounts are accepted; a client-chosen number would
  be a client-chosen price.
- Admin deletes refuse anyone holding money — contributions are permanent, and
  deleting the row would silently erase them.
- `SUPABASE_SERVICE_ROLE_KEY` is read only in `/api` and the seed script, and
  appears in nothing the browser downloads.

`terms.html` and `privacy.html` are honest drafts, not legal advice. Have a
lawyer read them before you take money — stored balances in particular attract
questions.

---

## Verified against real Postgres

The schema and `place_bid()` were exercised on a local Postgres 16 with a
Supabase shim (`auth.users`, `auth.uid()`, `storage.*`, the three roles), not
just read over. What passed:

- the reported `column "person_id" does not exist` reproduced, fixed, and the
  script then re-run three times cleanly on the same dirty database
- `sql/seed.sql` applied on top: 147 boards, 2,926 people, every board covered,
  zero placeholder names, and re-running changed nothing
- with the real seed loaded, $1 on an all-zero board takes #1; a $1 tie does not
  take it (the earlier-backed entry keeps the rank); $6 does
- $1 minimum, whole dollars, and insufficient balance all refused
- the $5 rule: with the leader at $10, a $11 bid is refused with
  *"needs $15 here, not $11"*, $14 is refused, $15 is accepted at rank 1
- a bid that stays below the leader is never blocked, and topping up your own
  leader is unconstrained
- tie ordering: two people at $10 rank by who was backed first
- `add_person` charges $1, seeds the person at $1 with one backer, and refuses
  both a non-Wikipedia link and an unknown board
- balance reconciles exactly across a run of bids, and `balance_never_negative`
  rejects a manual overdraw
- `credit_balance()` is unreachable by `anon` and `authenticated`
- `anon` cannot read `users.email` or `users.balance_cents`, but can read
  `display_name`
- zero INSERT/UPDATE/DELETE policies exist on any table

## Quality floor

Responsive to 360px, verified in headless Chromium at 360 / 768 / 1440 — category
tiles stack #1 above #2 on mobile, and the taper survives. Every photo is
`loading="lazy"`. Keyboard focus is a gold ring. Photo credit and licence on every
person page. Balance in the header on every page, from one shared shell so it
cannot drift.
