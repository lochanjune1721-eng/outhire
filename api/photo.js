/* POST /api/photo — resolve one person's picture, once, for everyone.
 *
 * The site calls this for anyone still showing initials. It finds their
 * Wikipedia lead image, checks the licence, copies the bytes into Supabase
 * storage and writes photo_path back — so the next visitor, and every visitor
 * after, is served from your own bucket. Nothing is hotlinked and nobody has
 * to run a script.
 *
 * It also covers people added through the board for $1, who never existed when
 * any seeding script ran.
 *
 * The image is requested from Wikipedia at 800px, so there is nothing to
 * resize and no image library on the server.
 */
import { json, bad, readJson, db, env, sbFetch } from './_lib.js';

const UA = process.env.WIKI_UA || 'GOAT.lol/1.0 (https://goat.lol; caching lead images)';
const REST = process.env.WIKI_REST || 'https://en.wikipedia.org/api/rest_v1';
const COMMONS = process.env.COMMONS_API || 'https://commons.wikimedia.org/w/api.php';

// Freely reusable with attribution. Everything else is skipped.
const OK_LICENCE = [
  /^cc0/i, /^cc[ -]by([ -]sa)?([ -][\d.]+)?/i, /public domain/i, /^pd[- ]/i,
  /^attribution$/i, /free art license/i, /^gfdl/i
];
const licenceOk = (s) => !!s && OK_LICENCE.some((r) => r.test(String(s).trim()));
const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function lead(name) {
  const title = encodeURIComponent(String(name).replace(/ /g, '_'));
  const res = await fetch(`${REST}/page/summary/${title}`, {
    headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return null;
  const d = await res.json();
  const src = d?.thumbnail?.source;
  if (!src) return null;
  return {
    // Ask for the size the cards actually use; no resizing needed afterwards.
    url: src.replace(/\/\d+px-/, '/800px-'),
    file: decodeURIComponent((d.originalimage?.source || src).split('/').pop().replace(/^\d+px-/, ''))
  };
}

async function licence(file) {
  const url = `${COMMONS}?` + new URLSearchParams({
    action: 'query', format: 'json', titles: 'File:' + file,
    prop: 'imageinfo', iiprop: 'extmetadata'
  });
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const body = await res.json();
  const em = Object.values(body?.query?.pages || {})[0]?.imageinfo?.[0]?.extmetadata;
  if (!em) return null;
  return {
    licence: strip(em.LicenseShortName?.value),
    author: strip(em.Artist?.value) || 'Wikimedia Commons'
  };
}

export default async function handler(request) {
  if (request.method !== 'POST') return bad('Use POST.', 405);
  try {
    const { slug } = await readJson(request);
    if (!slug || typeof slug !== 'string' || slug.length > 80) return bad('No person named.');

    const person = await db.one('people', db.eq('slug', slug));
    if (!person) return bad('No such person.', 404);
    // Already done by an earlier visitor, or by the bulk script.
    if (person.photo_path) return json({ photo_path: person.photo_path, cached: true });

    const hit = await lead(person.name);
    if (!hit) return json({ photo_path: null, why: 'no image found' });

    const meta = await licence(hit.file);
    if (!meta || !licenceOk(meta.licence)) {
      return json({ photo_path: null, why: `licence not verifiable (${meta?.licence || 'unknown'})` });
    }

    const img = await fetch(hit.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!img.ok) return json({ photo_path: null, why: 'download failed' });
    const bytes = Buffer.from(await img.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) return json({ photo_path: null, why: 'image too large' });

    const type = img.headers.get('content-type') || 'image/jpeg';
    const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg';
    const path = `people/${person.slug}.${ext}`;

    const up = await fetch(`${env('SUPABASE_URL').replace(/\/$/, '')}/storage/v1/object/photos/${path}`, {
      method: 'POST',
      headers: {
        apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
        Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': type, 'x-upsert': 'true'
      },
      body: bytes
    });
    if (!up.ok) return json({ photo_path: null, why: `upload failed (${up.status})` });

    await db.update('people', db.eq('id', person.id), {
      photo_path: path, photo_credit: meta.author, photo_license: meta.licence
    });

    return json({ photo_path: path, credit: meta.author, license: meta.licence });
  } catch (e) {
    console.error('[photo]', e);
    return json({ photo_path: null, why: 'lookup failed' });
  }
}
