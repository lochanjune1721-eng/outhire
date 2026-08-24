/* POST /api/upload-url — three actions, all gated on the paid upload token.
 *   status   -> whose entry this is
 *   sign     -> a signed storage upload URL (the bucket has no public write)
 *   complete -> attach the media and put the entry into review
 */
import { json, bad, readJson, db, env, sbFetch, safeUrl } from './_lib.js';

async function entryForToken(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null;
  return db.one('entries', db.eq('upload_token', token));
}

function parseVideo(raw) {
  const u = safeUrl(raw);
  if (!u) return null;
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { platform: 'youtube', url: u };
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { platform: 'vimeo', url: u };
  return null;
}

export default async function handler(request) {
  if (request.method !== 'POST') return bad('Use POST.', 405);

  try {
    const b = await readJson(request);
    const entry = await entryForToken(b.token);
    if (!entry) return bad('That upload link is not valid. Check the link in your email.', 403);

    // The token is only minted by the webhook, after payment clears.
    if (b.action === 'status') {
      return json({
        entry: {
          display_name: entry.display_name,
          side: entry.side,
          status: entry.status,
          has_media: !!(entry.video_url || (entry.photo_path && !entry.photo_path.startsWith('pending/')))
        }
      });
    }

    if (b.action === 'sign') {
      const path = `entries/${entry.slug}.jpg`;
      const base = env('SUPABASE_URL').replace(/\/$/, '');
      const signed = await sbFetch(`/storage/v1/object/upload/sign/photos/${path}`, {
        method: 'POST',
        body: JSON.stringify({ expiresIn: 600 })
      });
      // Supabase returns a relative url carrying its own one-shot token.
      return json({ path, signed_url: `${base}/storage/v1${signed.url}` });
    }

    if (b.action === 'complete') {
      const video = b.video_url ? parseVideo(b.video_url) : null;
      if (b.video_url && !video) return bad('That video link is not YouTube or Vimeo.');

      const photo_path = typeof b.photo_path === 'string' && b.photo_path.startsWith('entries/')
        ? b.photo_path
        : null;

      if (!photo_path && !video) return bad('Add a photo or a video link. At least one is required.');

      const patch = { status: 'pending' };
      if (photo_path) patch.photo_path = photo_path;
      if (video) { patch.video_url = video.url; patch.video_platform = video.platform; }
      // Drop the CHECK-constraint placeholder once real media has landed.
      if (!photo_path && video && entry.photo_path && entry.photo_path.startsWith('pending/')) {
        patch.photo_path = null;
      }

      await db.update('entries', db.eq('id', entry.id), patch);
      return json({ ok: true, slug: entry.slug });
    }

    return bad('Unknown action.');
  } catch (e) {
    console.error('[upload-url]', e);
    return bad(e.message || 'The upload could not be prepared.', 500);
  }
}
