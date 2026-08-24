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
import { webHandler, json, bad, readJson, db, env, sbFetch } from './_lib.js';

/* Wikimedia's UA policy asks for a real site and a way to reach a human, and
   their edge blocks generic or fictional agents coming from cloud IPs — which
   is exactly what a Vercel function is. Vercel sets the domain variables
   itself, so the default is honest without any configuration; set WIKI_CONTACT
   to an email you read, or WIKI_UA to override the whole string. */
const SITE = process.env.WIKI_SITE ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '';
const CONTACT = process.env.WIKI_CONTACT || '';
const UA = process.env.WIKI_UA || ('GOATdotLOL/1.0 (' +
  ([SITE ? 'https://' + SITE.replace(/^https?:\/\//, '') : 'https://github.com/lochanjune1721-eng/outhire',
    CONTACT].filter(Boolean).join('; ')) + ')');
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
  /* 404 means no such page — a real answer, and null is right. Anything else
     is Wikipedia refusing us (403 on the UA, 429 rate limit, 5xx), and
     returning null there disguises a site-wide outage as "this one person has
     no photo", which the board deliberately does not report. Throw instead, so
     it reaches the browser console and the diagnosis endpoint. */
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status} for ${name}`);
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
  // Same reasoning as lead(): a refusal is not an unlicensed file.
  if (!res.ok) throw new Error(`Commons returned ${res.status} for ${file}`);
  const body = await res.json();
  const em = Object.values(body?.query?.pages || {})[0]?.imageinfo?.[0]?.extmetadata;
  if (!em) return null;
  return {
    licence: strip(em.LicenseShortName?.value),
    author: strip(em.Artist?.value) || 'Wikimedia Commons'
  };
}

/* GET /api/photo — open this in a browser to find out why pictures are not
   appearing. It reports booleans and counts only, never a key. */
async function diagnose() {
  const out = { ok: false, checks: {}, next: null };
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  out.checks.SUPABASE_URL_set = !!url;
  out.checks.SUPABASE_SERVICE_ROLE_KEY_set = !!key;
  if (!url || !key) {
    out.next = 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel ' +
               '(Project -> Settings -> Environment Variables), then redeploy. ' +
               'Without them this endpoint cannot read or write anything.';
    return out;
  }

  try {
    const rows = await db.select('people', 'select=id&limit=1');
    out.checks.people_table_readable = Array.isArray(rows);
  } catch (e) {
    out.checks.people_table_readable = false;
    out.next = 'Cannot read the people table: ' + e.message +
               '. Run sql/schema.sql and sql/seed.sql in the Supabase SQL editor.';
    return out;
  }

  try {
    const total = await sbFetch('/rest/v1/people?select=id&limit=1', { headers: { Prefer: 'count=exact' } });
    out.checks.people_rows = Array.isArray(total) ? 'present' : 'unknown';
  } catch { /* count is a nicety */ }

  try {
    const withPhoto = await db.select('people', 'select=slug&photo_path=not.is.null&limit=1000');
    out.checks.people_with_photo = Array.isArray(withPhoto) ? withPhoto.length : 0;
  } catch { out.checks.people_with_photo = 'unknown'; }

  try {
    const r = await fetch(`${REST}/page/summary/Lionel_Messi`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000)
    });
    out.checks.wikipedia_reachable = r.ok;
    if (!r.ok) out.next = `Wikipedia returned ${r.status} from your deployment.`;
  } catch (e) {
    out.checks.wikipedia_reachable = false;
    out.next = 'Your deployment cannot reach Wikipedia: ' + e.message;
  }

  try {
    const b = await sbFetch('/storage/v1/bucket/photos');
    out.checks.photos_bucket = !!b;
  } catch (e) {
    out.checks.photos_bucket = false;
    out.checks.photos_bucket_error = e && e.message ? e.message : String(e);
    /* A 401/403 here is not a missing bucket — it is the anon key pasted into
       SUPABASE_SERVICE_ROLE_KEY. Both look identical from the outside, and
       sending someone to re-run the schema when their key is wrong wastes an
       afternoon. */
    out.next = out.next || (e && (e.status === 401 || e.status === 403)
      ? 'Supabase refused this key (' + e.status + '). SUPABASE_SERVICE_ROLE_KEY is set but is not ' +
        'the service role key — the anon key looks the same and is the usual mistake. ' +
        'Supabase -> Project Settings -> API -> service_role, then redeploy.'
      : 'The photos storage bucket is missing. Run sql/schema.sql.');
  }

  out.ok = Object.values(out.checks).every((v) => v !== false) && !out.checks.photos_bucket_error;
  if (out.ok && !out.next) {
    out.next = 'Everything checks out. Open a board and the pictures will fill in. ' +
               'POST {"slug":"lionel-messi"} here to resolve one by hand.';
  }
  return out;
}

export default webHandler(async function handler(request) {
  if (request.method === 'GET') return json(await diagnose());
  if (request.method !== 'POST') return bad('Use POST, or GET for a diagnosis.', 405);

  // Fail loudly rather than returning a silent null nobody can debug.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({
      photo_path: null,
      why: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set on this deployment. Open /api/photo in a browser for the full diagnosis.'
    }, 500);
  }
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

    const img = await fetch(hit.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
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

    /* The bytes are in the bucket now. If the row cannot be updated, the file
       is still good and the caller should still show it — but every later
       visitor would re-download it forever, so say so out loud. */
    try {
      await db.update('people', db.eq('id', person.id), {
        photo_path: path, photo_credit: meta.author, photo_license: meta.licence
      });
    } catch (e) {
      console.error('[photo] stored %s but could not write photo_path:', path, e);
      return json({
        photo_path: path, credit: meta.author, license: meta.licence,
        why: 'stored the image but could not save it to the row: ' + (e && e.message ? e.message : String(e))
      });
    }

    return json({ photo_path: path, credit: meta.author, license: meta.licence });
  } catch (e) {
    console.error('[photo]', e);
    return json({ photo_path: null, why: 'lookup failed: ' + (e && e.message ? e.message : String(e)) });
  }
});
