/* POST /api/webhook — Stripe. On checkout.session.completed: verify the
 * signature over the raw body, insert the bid (unique on stripe_session_id
 * for idempotency), set the entry live, mint an upload token and email it. */
import {
  json, bad, env, db, verifyStripeSignature, randomToken, sendMail, siteUrl, sbFetch
} from './_lib.js';

export default async function handler(request) {
  if (request.method !== 'POST') return bad('Use POST.', 405);

  // Web-standard handler, so the raw body is available for the HMAC.
  const raw = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!verifyStripeSignature(raw, sig, env('STRIPE_WEBHOOK_SECRET'))) {
    return bad('Invalid signature.', 400);
  }

  let event;
  try { event = JSON.parse(raw); } catch { return bad('Malformed payload.'); }
  if (event.type !== 'checkout.session.completed') return json({ received: true });

  const session = event.data.object;
  const entryId = session.metadata?.entry_id || session.client_reference_id;
  const amount = Number(session.metadata?.amount_cents || session.amount_total || 0);
  if (!entryId || !amount) return json({ received: true, skipped: 'no entry on session' });

  try {
    /* Idempotency: stripe_session_id is unique, and ignore-duplicates makes a
       replayed webhook a no-op rather than a second bid. */
    const inserted = await sbFetch('/rest/v1/bids?on_conflict=stripe_session_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ entry_id: entryId, amount_cents: amount, stripe_session_id: session.id })
    });
    if (Array.isArray(inserted) && inserted.length === 0) {
      return json({ received: true, duplicate: true });
    }

    const entry = await db.one('entries', db.eq('id', entryId));
    if (!entry) return json({ received: true, skipped: 'entry gone' });

    let token = entry.upload_token;
    if (!token) {
      token = randomToken(24);
      await db.update('entries', db.eq('id', entryId), { upload_token: token });
    }

    const link = `${siteUrl(request)}/upload.html?token=${encodeURIComponent(token)}`;
    await sendMail({
      to: entry.email,
      subject: 'Your outbid.lol spot — add your photo',
      text:
        `You're on the board.\n\n` +
        `Add your photo or a video link here, and your spot goes into review:\n${link}\n\n` +
        `This link is yours alone. Don't share it.\n`
    });

    return json({ received: true });
  } catch (e) {
    console.error('[webhook]', e);
    // 500 so Stripe retries rather than dropping a paid bid on the floor.
    return bad('Webhook processing failed.', 500);
  }
}
