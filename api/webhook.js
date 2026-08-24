/* POST /api/webhook — Stripe events.
 *
 * On checkout.session.completed: verify the signature against the raw body,
 * insert the bid (unique on stripe_session_id, so replays are free), mint an
 * upload token if the entry has none, and email the link.
 *
 * The database trigger on `bids` is what raises entries.current_bid_cents,
 * stamps last_bid_at and adds to site_stats.total_revenue_cents.
 */
import {
  json, readJson, env, db, selectOne, insertRow, updateRow, token,
  verifyStripeSignature, sendUploadEmail, siteUrl
} from './_lib.js';

// The raw body is required for the signature, so nothing may parse it first.
export const config = { api: { bodyParser: false } };

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  var raw = await request.text();
  var signature = request.headers.get('stripe-signature');

  var secret;
  try { secret = env('STRIPE_WEBHOOK_SECRET'); }
  catch (e) { console.error('[outhire] webhook secret missing'); return json({ error: 'Not configured.' }, 500); }

  if (!verifyStripeSignature(raw, signature, secret)) {
    return json({ error: 'Signature verification failed.' }, 400);
  }

  var event;
  try { event = JSON.parse(raw); }
  catch (e) { return json({ error: 'Malformed payload.' }, 400); }

  if (event.type !== 'checkout.session.completed') {
    return json({ received: true, ignored: event.type });
  }

  var session = event.data && event.data.object;
  if (!session) return json({ received: true });

  // Only money that actually settled counts as a bid.
  if (session.payment_status !== 'paid') {
    return json({ received: true, ignored: 'unpaid' });
  }

  var meta = session.metadata || {};
  var entryId = meta.entry_id || session.client_reference_id;
  var amount = parseInt(meta.amount_cents, 10);
  if (!Number.isFinite(amount)) amount = session.amount_total;

  if (!entryId || !Number.isFinite(amount) || amount <= 0) {
    console.error('[outhire] webhook missing entry_id or amount', session.id);
    return json({ received: true, ignored: 'incomplete metadata' });
  }

  try {
    /* ----------------------------- the bid --------------------------- */
    /* Unique on stripe_session_id. resolution=ignore-duplicates makes a
       redelivered event a no-op instead of a second charge on the ledger. */

    var inserted = await db('bids', {
      method: 'POST',
      body: { entry_id: entryId, amount_cents: amount, stripe_session_id: session.id },
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }
    });

    var isNew = Array.isArray(inserted) && inserted.length > 0;
    if (!isNew) {
      return json({ received: true, duplicate: true });
    }

    /* --------------------------- upload token ------------------------ */

    var entry = await selectOne(
      'entries?id=eq.' + encodeURIComponent(entryId) +
      '&select=id,slug,email,display_name,upload_token,video_path,status&limit=1'
    );
    if (!entry) {
      console.error('[outhire] webhook could not find entry', entryId);
      return json({ received: true, warning: 'entry missing' });
    }

    var uploadToken = entry.upload_token;
    if (!uploadToken) {
      uploadToken = token(24);
      await updateRow('entries', 'id=eq.' + encodeURIComponent(entryId), { upload_token: uploadToken });
    }

    /* ------------------------------ email ---------------------------- */

    var uploadUrl = siteUrl(request) + '/upload.html?token=' + encodeURIComponent(uploadToken);
    if (entry.email) await sendUploadEmail(entry.email, entry, uploadUrl);

    return json({ received: true, entry: entry.slug });

  } catch (err) {
    console.error('[outhire] webhook handling failed', err);
    // 500 asks Stripe to retry; the ignore-duplicates insert keeps that safe.
    return json({ error: 'Webhook handling failed.' }, 500);
  }
}
