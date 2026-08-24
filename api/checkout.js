/* POST /api/checkout
 *
 * Creates or finds the caller's entry with status 'pending', then opens a
 * Stripe Checkout session for the bid. The entry row is only ever written
 * here and in the webhook — the browser has no write path to `entries`.
 *
 * Body: { display_name, email, headline, portfolio_url, linkedin_url,
 *         category_slug, amount_cents, job_url?, board_token? }
 * 200:  { url }
 */
import {
  json, bad, readJson, methodGuard, str, isEmail, httpUrl, slugify, token,
  db, selectOne, insertRow, categoryIdBySlug, stripe, siteUrl, CONNECT_ACCOUNT, env
} from './_lib.js';

const MIN_CENTS = 500;
const MAX_CENTS = 100000000;   // $1,000,000 — a sanity ceiling, not a product rule

export default async function handler(request) {
  var guard = methodGuard(request, 'POST');
  if (guard) return guard;

  var body = await readJson(request);

  /* ------------------------------ validate --------------------------- */

  var display_name = str(body.display_name, 80);
  var email = str(body.email, 200).toLowerCase();
  var headline = str(body.headline, 140);
  var category_slug = str(body.category_slug, 40);
  var amount_cents = Math.round(Number(body.amount_cents));

  if (!display_name) return bad('Add a name.');
  if (!isEmail(email)) return bad('That email does not look right.');
  if (!headline) return bad('Add a headline.');
  if (headline.length > 140) return bad('Headline must be 140 characters or under. This one is ' + headline.length + '.');
  if (!category_slug) return bad('Pick a role.');
  if (!Number.isFinite(amount_cents)) return bad('That bid is not a number.');
  if (amount_cents < MIN_CENTS) return bad('Minimum bid is $5.');
  if (amount_cents > MAX_CENTS) return bad('That bid is above the ceiling.');

  var portfolio_url = httpUrl(body.portfolio_url);
  var linkedin_url = httpUrl(body.linkedin_url);
  var job_url = httpUrl(body.job_url);

  try {
    var category_id = await categoryIdBySlug(category_slug);
    if (!category_id) return bad('That role is not on the list.');

    /* ------------------------------ board ---------------------------- */
    /* A pasted job URL creates or joins the board for that posting. An
       explicit board token (arrived from a recruiter link) just joins. */

    var board = null;
    var board_token = str(body.board_token, 100);

    if (board_token) {
      board = await selectOne('boards?share_token=eq.' + encodeURIComponent(board_token) + '&select=id&limit=1');
      if (!board) return bad('That board link is not recognised.');
    } else if (job_url) {
      board = await selectOne('boards?job_url=eq.' + encodeURIComponent(job_url) + '&select=id&limit=1');
      if (!board) {
        var host = '';
        try { host = new URL(job_url).hostname.replace(/^www\./, ''); } catch (e) { host = 'Unlisted'; }
        board = await insertRow('boards', {
          share_token: token(12),
          company_name: host,
          role_title: str(body.role_title, 120) || display_name + "'s role",
          job_url: job_url,
          recruiter_email: null
        });
      }
    }

    /* ------------------------------ entry ---------------------------- */
    /* One person, one entry per board. A second payment raises the bid on the
       entry they already have rather than filing a duplicate. */

    var scope = board ? 'board_id=eq.' + board.id : 'board_id=is.null';
    var existing = await selectOne(
      'entries?email=eq.' + encodeURIComponent(email) + '&' + scope +
      '&status=neq.rejected&select=id,slug,current_bid_cents,status&limit=1'
    );

    var entry = existing;
    if (entry) {
      if (amount_cents <= (entry.current_bid_cents || 0)) {
        return bad('You are already holding ' + '$' + Math.round((entry.current_bid_cents || 0) / 100) +
                   ' on this board. Raise it to go higher.');
      }
    } else {
      entry = await insertRow('entries', {
        slug: slugify(display_name),
        board_id: board ? board.id : null,
        category_id: category_id,
        display_name: display_name,
        headline: headline,
        email: email,
        portfolio_url: portfolio_url,
        linkedin_url: linkedin_url,
        current_bid_cents: 0,
        status: 'pending'
      });
      if (!entry) return bad('The entry could not be created.', 500);
    }

    /* ----------------------------- stripe ---------------------------- */

    var site = siteUrl(request);
    var dollars = (amount_cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: amount_cents % 100 ? 2 : 0, maximumFractionDigits: 2
    });

    var session = await stripe('checkout/sessions', {
      mode: 'payment',
      customer_email: email,
      success_url: site + '/upload.html?paid=1&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: site + '/submit.html?cancelled=1',
      client_reference_id: entry.id,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: amount_cents,
          product_data: {
            name: 'Outhire bid — $' + dollars,
            description: display_name + ' — ' + headline.slice(0, 90)
          }
        }
      }],
      metadata: {
        entry_id: entry.id,
        entry_slug: entry.slug,
        amount_cents: String(amount_cents),
        email: email
      },
      payment_intent_data: {
        // Destination charge: the platform takes the payment, Stripe moves the
        // funds to the connected account.
        transfer_data: { destination: CONNECT_ACCOUNT() },
        metadata: { entry_id: entry.id, amount_cents: String(amount_cents) },
        description: 'Outhire bid — ' + display_name
      }
    });

    if (!session || !session.url) return bad('Stripe did not return a checkout URL.', 502);
    return json({ url: session.url });

  } catch (err) {
    console.error('[outhire] checkout failed', err);
    return bad(err.message || 'Checkout could not be opened. Nothing was charged.', err.status && err.status < 500 ? 400 : 500);
  }
}
