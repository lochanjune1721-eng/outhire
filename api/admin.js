/* POST /api/admin — review console back end.
 *
 * The password is compared here and nowhere else. A successful login returns a
 * short-lived HMAC token; every other action carries that token, so the
 * password is sent once per session rather than on every click.
 *
 * { action:'login',   password }                 -> { token, expires_in }
 * { action:'list',    token, status }            -> { entries, counts }
 * { action:'approve', token, id }                -> { ok }
 * { action:'reject',  token, id }                -> { ok }
 * { action:'grant',   token, ...entry fields }   -> { ok, slug, upload_token }
 */
import {
  json, bad, readJson, methodGuard, str, isEmail, httpUrl, slugify, token as randomToken,
  env, db, selectOne, insertRow, updateRow, categoryIdBySlug,
  timingSafeString, mintAdminToken, verifyAdminToken
} from './_lib.js';

const TTL = 60 * 60 * 8;

const LIST_SELECT =
  'id,slug,display_name,headline,email,portfolio_url,linkedin_url,video_path,' +
  'video_duration,current_bid_cents,click_count,view_count,status,upload_token,' +
  'created_at,last_bid_at,categories(name,slug)';

function publicVideoUrl(path) {
  if (!path) return null;
  return env('SUPABASE_URL').replace(/\/$/, '') + '/storage/v1/object/public/videos/' + path;
}

async function countBy(status) {
  var base = env('SUPABASE_URL').replace(/\/$/, '');
  var key = env('SUPABASE_SERVICE_ROLE_KEY');
  var res = await fetch(base + '/rest/v1/entries?status=eq.' + status + '&select=id', {
    method: 'HEAD',
    headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'count=exact' }
  });
  var range = res.headers.get('content-range') || '';
  var total = parseInt(range.split('/')[1], 10);
  return Number.isFinite(total) ? total : 0;
}

export default async function handler(request) {
  var guard = methodGuard(request, 'POST');
  if (guard) return guard;

  var body = await readJson(request);
  var action = str(body.action, 20);

  /* ------------------------------- login ----------------------------- */

  if (action === 'login') {
    var expected;
    try { expected = env('ADMIN_PASSWORD'); }
    catch (e) { return bad('Review is not configured on this deployment.', 500); }

    var supplied = String(body.password == null ? '' : body.password);
    if (!supplied || !timingSafeString(supplied, expected)) {
      return bad('That password was not accepted.', 401);
    }
    return json({ token: mintAdminToken(TTL), expires_in: TTL });
  }

  /* --------------------------- authorisation ------------------------- */

  var bearer = str(body.token, 400);
  if (!verifyAdminToken(bearer)) {
    return bad('Session expired. Enter the password again.', 401);
  }

  try {
    /* -------------------------------- list --------------------------- */

    if (action === 'list') {
      var status = str(body.status, 20) || 'pending';
      if (['pending', 'live', 'rejected'].indexOf(status) === -1) return bad('Unknown status.');

      var rows = await db(
        'entries?status=eq.' + status + '&select=' + encodeURIComponent(LIST_SELECT) +
        '&order=created_at.desc&limit=200'
      );

      var counts = {
        pending: await countBy('pending'),
        live: await countBy('live'),
        rejected: await countBy('rejected')
      };

      return json({
        counts: counts,
        entries: (rows || []).map(function (e) {
          return {
            id: e.id,
            slug: e.slug,
            display_name: e.display_name,
            headline: e.headline,
            email: e.email,
            portfolio_url: e.portfolio_url,
            linkedin_url: e.linkedin_url,
            video_url: publicVideoUrl(e.video_path),
            video_duration: e.video_duration,
            current_bid_cents: e.current_bid_cents || 0,
            click_count: e.click_count || 0,
            view_count: e.view_count || 0,
            status: e.status,
            upload_token: e.upload_token,
            created_at: e.created_at,
            category_name: e.categories ? e.categories.name : null
          };
        })
      });
    }

    /* --------------------------- approve/reject ---------------------- */

    if (action === 'approve' || action === 'reject') {
      var id = str(body.id, 60);
      if (!id) return bad('No entry named.');

      var entry = await selectOne('entries?id=eq.' + encodeURIComponent(id) + '&select=id,video_path,status&limit=1');
      if (!entry) return bad('No entry with that id.', 404);

      if (action === 'approve' && !entry.video_path) {
        return bad('That entry has no video yet, so there is nothing to approve.');
      }

      await updateRow('entries', 'id=eq.' + encodeURIComponent(id), {
        status: action === 'approve' ? 'live' : 'rejected'
      });
      return json({ ok: true, status: action === 'approve' ? 'live' : 'rejected' });
    }

    /* ------------------------------- grant --------------------------- */
    /* Free entry for seeding. It sets current_bid_cents directly rather than
       inserting a bid, so seeded ranks never inflate the revenue counter. */

    if (action === 'grant') {
      var display_name = str(body.display_name, 80);
      var email = str(body.email, 200).toLowerCase();
      var headline = str(body.headline, 140);
      var category_slug = str(body.category_slug, 40);
      var amount_cents = Math.max(0, Math.round(Number(body.amount_cents) || 0));

      if (!display_name) return bad('Add a name.');
      if (!isEmail(email)) return bad('That email does not look right.');
      if (!headline) return bad('Add a headline.');
      if (headline.length > 140) return bad('Headline must be 140 characters or under. This one is ' + headline.length + '.');
      if (!category_slug) return bad('Pick a role.');

      var category_id = await categoryIdBySlug(category_slug);
      if (!category_id) return bad('That role is not on the list.');

      var uploadToken = randomToken(24);
      var created = await insertRow('entries', {
        slug: slugify(display_name),
        board_id: null,
        category_id: category_id,
        display_name: display_name,
        headline: headline,
        email: email,
        portfolio_url: httpUrl(body.portfolio_url),
        linkedin_url: httpUrl(body.linkedin_url),
        current_bid_cents: amount_cents,
        last_bid_at: amount_cents > 0 ? new Date().toISOString() : null,
        status: 'pending',
        upload_token: uploadToken
      });

      if (!created) return bad('The entry could not be created.', 500);
      return json({ ok: true, slug: created.slug, upload_token: uploadToken });
    }

    return bad('Unknown action.');

  } catch (err) {
    console.error('[outhire] admin action failed', err);
    return bad(err.message || 'That did not go through.', 500);
  }
}
