/* POST /api/upload-url
 *
 * The storage bucket has public read and no public write, so an upload URL is
 * minted server-side and only for a token that has actually been paid for.
 *
 * { action: 'status',   token }                      -> { entry }
 * { action: 'sign',     token, filename, content_type, size } -> { path, signedUrl }
 * { action: 'complete', token, path, duration }      -> { ok, slug }
 */
import { json, bad, readJson, methodGuard, str, env, selectOne, updateRow } from './_lib.js';

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_SECONDS = 45;
const MIN_SECONDS = 20;
const TYPES = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm'
};

async function findEntry(uploadToken) {
  if (!uploadToken || uploadToken.length < 8) return null;
  return selectOne(
    'entries?upload_token=eq.' + encodeURIComponent(uploadToken) +
    '&select=id,slug,display_name,headline,email,video_path,video_duration,current_bid_cents,status&limit=1'
  );
}

export default async function handler(request) {
  var guard = methodGuard(request, 'POST');
  if (guard) return guard;

  var body = await readJson(request);
  var action = str(body.action, 20) || 'status';
  var uploadToken = str(body.token, 200);

  try {
    var entry = await findEntry(uploadToken);
    if (!entry) return bad('That upload link is not valid.', 404);

    // The token is minted by the webhook after payment, so a token that exists
    // has been paid for. A granted seed entry can sit at zero and is still fine.
    if (entry.status === 'rejected') {
      return bad('This entry was rejected, so it cannot take a new video.', 403);
    }

    /* ----------------------------- status ---------------------------- */

    if (action === 'status') {
      return json({
        entry: {
          slug: entry.slug,
          display_name: entry.display_name,
          headline: entry.headline,
          current_bid_cents: entry.current_bid_cents || 0,
          video_duration: entry.video_duration || null,
          has_video: !!entry.video_path,
          status: entry.status
        }
      });
    }

    /* ------------------------------ sign ----------------------------- */

    if (action === 'sign') {
      var contentType = str(body.content_type, 100) || 'video/mp4';
      var size = Number(body.size);

      if (!TYPES[contentType]) return bad('That file type is not accepted. Use MP4, MOV or WebM.');
      if (!Number.isFinite(size) || size <= 0) return bad('The file size could not be read.');
      if (size > MAX_BYTES) return bad('Files have to be under 50MB.');

      var path = entry.slug + '/' + Date.now() + '.' + TYPES[contentType];
      var base = env('SUPABASE_URL').replace(/\/$/, '');
      var key = env('SUPABASE_SERVICE_ROLE_KEY');

      var res = await fetch(base + '/storage/v1/object/upload/sign/videos/' + path, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ expiresIn: 900 })
      });

      var data = await res.json().catch(function () { return null; });
      if (!res.ok || !data || !data.url) {
        console.error('[outhire] signing failed', res.status, data);
        return bad('The upload URL could not be issued.', 502);
      }

      return json({ path: path, signedUrl: base + '/storage/v1' + data.url });
    }

    /* ---------------------------- complete --------------------------- */

    if (action === 'complete') {
      var storedPath = str(body.path, 300);
      var duration = Math.round(Number(body.duration));

      if (!storedPath || storedPath.indexOf(entry.slug + '/') !== 0 || storedPath.indexOf('..') !== -1) {
        return bad('That upload path does not belong to this entry.');
      }
      if (!Number.isFinite(duration) || duration <= 0) return bad('The video length was not readable.');
      if (duration > MAX_SECONDS) return bad('Video must be under 45 seconds. This one is ' + duration + '.');
      if (duration < MIN_SECONDS) return bad('Video must be at least 20 seconds. This one is ' + duration + '.');

      // Back to review on every new upload, including a replacement.
      await updateRow('entries', 'id=eq.' + encodeURIComponent(entry.id), {
        video_path: storedPath,
        video_duration: duration,
        status: 'pending'
      });

      return json({ ok: true, slug: entry.slug });
    }

    return bad('Unknown action.');

  } catch (err) {
    console.error('[outhire] upload-url failed', err);
    return bad(err.message || 'The request failed.', 500);
  }
}
