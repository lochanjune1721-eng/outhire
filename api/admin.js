/* POST /api/admin — the password is compared here, never in the browser.
 * A successful login returns a short-lived HMAC token so the password itself
 * is not held in the page. */
import {
  json, bad, readJson, db, env, constantTimeEqual, mintAdminToken, checkAdminToken,
  safeUrl, slugify, randomToken, siteUrl, CATEGORIES, HEADLINE_MAX
} from './_lib.js';

export default async function handler(request) {
  if (request.method !== 'POST') return bad('Use POST.', 405);

  try {
    const b = await readJson(request);

    if (b.action === 'login') {
      if (!constantTimeEqual(b.password, env('ADMIN_PASSWORD'))) {
        return bad('That password was not accepted.', 401);
      }
      return json({ token: mintAdminToken() });
    }

    if (!checkAdminToken(b.token)) return bad('Your admin token expired. Sign in again.', 401);

    if (b.action === 'list') {
      const status = ['pending', 'live', 'rejected'].includes(b.status) ? b.status : 'pending';
      const entries = await db.select(
        'entries',
        `${db.eq('status', status)}&order=created_at.desc&limit=200`
      );
      return json({ entries });
    }

    if (b.action === 'approve' || b.action === 'reject') {
      if (!b.id) return bad('No entry named.');
      await db.update('entries', db.eq('id', b.id), {
        status: b.action === 'approve' ? 'live' : 'rejected'
      });
      return json({ ok: true });
    }

    if (b.action === 'grant') {
      const display_name = String(b.display_name || '').trim().slice(0, 80);
      const headline = String(b.headline || '').trim();
      const url = safeUrl(b.url);
      const side = b.side === 'recruiter' ? 'recruiter' : 'candidate';
      const category = CATEGORIES.includes(b.category) ? b.category : 'Other';

      if (!display_name) return bad('A name is required.');
      if (!headline) return bad('A one-liner is required.');
      if (headline.length > HEADLINE_MAX) return bad(`The one-liner is capped at ${HEADLINE_MAX} characters.`);
      if (!url) return bad('A valid URL is required.');

      let slug = slugify(display_name, 'entry');
      if (await db.one('entries', db.eq('slug', slug))) slug = `${slug}-${randomToken(3).toLowerCase()}`;

      const token = randomToken(24);
      await db.insert('entries', {
        slug, side, display_name, headline, url,
        email: String(b.email || '').trim().toLowerCase() || null,
        category, photo_path: `pending/${slug}.jpg`,
        current_bid_cents: 0, status: 'pending', upload_token: token
      });

      return json({ ok: true, slug, upload_url: `${siteUrl(request)}/upload.html?token=${encodeURIComponent(token)}` });
    }

    return bad('Unknown action.');
  } catch (e) {
    console.error('[admin]', e);
    return bad(e.message || 'That did not work.', 500);
  }
}
