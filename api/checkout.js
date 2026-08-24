/* POST /api/checkout — create the pending entry and open Stripe Checkout.
 * Connect destination charge to STRIPE_CONNECT_ACCOUNT_ID. */
import {
  json, bad, readJson, db, stripe, siteUrl, safeUrl, slugify, randomToken,
  isEmail, CATEGORIES, MIN_CENTS, HEADLINE_MAX, CONNECT_ACCOUNT
} from './_lib.js';

export default async function handler(request) {
  if (request.method !== 'POST') return bad('Use POST.', 405);

  try {
    const b = await readJson(request);

    const side = b.side === 'recruiter' ? 'recruiter' : 'candidate';
    const display_name = String(b.display_name || '').trim().slice(0, 80);
    const email = String(b.email || '').trim().toLowerCase();
    const headline = String(b.headline || '').trim();
    const url = safeUrl(b.url);
    const category = CATEGORIES.includes(b.category) ? b.category : null;
    const amount_cents = Math.round(Number(b.amount_cents) || 0);

    if (!display_name) return bad('A name is required.');
    if (!isEmail(email)) return bad('A valid email is required.');
    if (!headline) return bad('A one-liner is required.');
    if (headline.length > HEADLINE_MAX) return bad(`The one-liner is capped at ${HEADLINE_MAX} characters.`);
    if (!url) return bad('A valid http or https URL is required.');
    if (!category) return bad('Choose a category from the list.');

    // Role boards are a flat $5 with no bidding; the homepage board bids.
    let board = null;
    if (b.board_slug) {
      board = await db.one('boards', db.eq('slug', String(b.board_slug)));
      if (!board) return bad('That board does not exist.');
    }
    const charge = board ? MIN_CENTS : amount_cents;
    if (charge < MIN_CENTS) return bad('The minimum is $5.');

    /* Same URL on the same board is the same entry — that is what makes
       "enter the same URL and up your bid" work instead of duplicating. */
    const boardFilter = board ? db.eq('board_id', board.id) : 'board_id=is.null';
    let entry = await db.one('entries', `${db.eq('url', url)}&${db.eq('side', side)}&${boardFilter}`);

    if (!entry) {
      let slug = slugify(display_name, 'entry');
      if (await db.one('entries', db.eq('slug', slug))) slug = `${slug}-${randomToken(3).toLowerCase()}`;
      const rows = await db.insert('entries', {
        slug, side, board_id: board ? board.id : null,
        display_name, headline, url, email, category,
        // media_required is a CHECK constraint, so a placeholder stands in
        // until upload.html replaces it. Nothing is live before review anyway.
        photo_path: `pending/${slug}.jpg`,
        current_bid_cents: 0, status: 'pending'
      });
      entry = Array.isArray(rows) ? rows[0] : rows;
    } else {
      const rows = await db.update('entries', db.eq('id', entry.id), {
        display_name, headline, email, category
      });
      entry = Array.isArray(rows) ? rows[0] : rows;
    }

    const base = siteUrl(request);
    const session = await stripe('checkout/sessions', {
      mode: 'payment',
      success_url: `${base}/upload.html?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/submit.html?side=${side}`,
      customer_email: email,
      client_reference_id: entry.id,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: charge,
          product_data: {
            name: board
              ? `outbid.lol — ${board.role_title || 'role board'}`
              : `outbid.lol — ${side === 'recruiter' ? 'open role' : 'candidate'} spot`,
            description: headline.slice(0, 120)
          }
        }
      }],
      payment_intent_data: {
        on_behalf_of: CONNECT_ACCOUNT,
        transfer_data: { destination: CONNECT_ACCOUNT }
      },
      metadata: { entry_id: entry.id, amount_cents: String(charge), side, board_id: board ? board.id : '' }
    });

    return json({ url: session.url });
  } catch (e) {
    console.error('[checkout]', e);
    return bad(e.message || 'Checkout could not be created.', 500);
  }
}
