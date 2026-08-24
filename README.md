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

## Two things I could not verify, and what I did about them

The sandbox this was built in blocks outbound HTTPS to both `wikidata.org` and
Dodo's docs, so neither could be checked against the live source.

**1. The Wikidata QIDs in `scripts/categories.js` are unverified.** A wrong QID
produces an empty or absurd board rather than an error, so the seed script
self-checks:

```bash
node scripts/seed.js --check          # queries every board, writes nothing
```

It prints, per board, the result count, how many have photos, and the top three
names it would seed — then lists every board that returned nothing. Fix those
QIDs before seeding for real. The cricket boards in particular all share the
`cricketer` occupation because Wikidata has no separate batsman/bowler QID; they
need either manual curation or a different query.

**2. Dodo's exact API shape is unverified.** Everything Dodo-specific is confined
to three functions at the bottom of `api/_lib.js`. Verify before going live:

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

---

## Setup

1. **Database** — paste `sql/schema.sql` into the Supabase SQL editor and run it.
   Tables, `place_bid`, `credit_balance`, RLS, realtime, and the `photos` bucket.
2. **Client keys** — put the Supabase URL and anon key into `js/config.js`. No
   build step, so env vars cannot reach static files; the anon key is public by
   design. Nothing secret goes there.
3. **Vercel env** — copy `.env.example` into the project's environment variables.
4. **Seed** — `node scripts/seed.js --check`, fix bad QIDs, then
   `npm install sharp && node scripts/seed.js`.
5. **Review** — open `/admin.html` and go board by board. Auto-fetch gives
   roughly 60% usable photos and some odd name choices. Three minutes a board is
   the difference between a site that looks made and one that looks scraped.
6. **Dodo webhook** — point it at `https://yourdomain/api/payment-done`.

**Everyone seeds at $0.** Nobody is pre-ranked. An empty board where the first $1
takes #1 is a far better first-user experience than one where someone is already
on top for no reason — which is also why most boards being empty at launch is
framed as an offer (`41 boards where #1 is still open. $1 takes it.`) rather than
a graveyard.

---

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

scripts/categories.js  the ~83 boards
scripts/seed.js        Wikidata → Commons → Supabase, with --check
sql/schema.sql
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

## Quality floor

Responsive to 360px, verified in headless Chromium at 360 / 768 / 1440 — category
tiles stack #1 above #2 on mobile, and the taper survives. Every photo is
`loading="lazy"`. Keyboard focus is a gold ring. Photo credit and licence on every
person page. Balance in the header on every page, from one shared shell so it
cannot drift.
