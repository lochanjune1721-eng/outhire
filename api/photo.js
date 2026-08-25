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
// en.wikipedia's own api.php answers for files hosted locally there as well as
// for Commons files, so it is the right second place to ask.
const WIKI_API = process.env.WIKI_API || 'https://en.wikipedia.org/w/api.php';

/* The file name out of an image URL.
   Wikipedia's REST summary appends UTM parameters to these URLs, and taking
   everything after the last slash carried "?utm_source=en.wikipedia.org&..."
   into the Commons title — which then matches nothing, for every person on the
   site, and reported itself as an unverifiable licence. */
function fileFromUrl(u) {
  const path = String(u || '').split('#')[0].split('?')[0];
  return decodeURIComponent(path.split('/').pop().replace(/^\d+px-/, ''));
}

// Freely reusable with attribution. Everything else is skipped.
const OK_LICENCE = [
  /^cc0/i, /^cc[ -]by([ -]sa)?([ -][\d.]+)?/i, /public domain/i, /^pd[- ]/i,
  /^attribution$/i, /free art license/i, /^gfdl/i
];
const licenceOk = (s) => !!s && OK_LICENCE.some((r) => r.test(String(s).trim()));
const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function lead(name, steps) {
  const title = encodeURIComponent(String(name).replace(/ /g, '_'));
  const res = await fetch(`${REST}/page/summary/${title}`, {
    headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000)
  });
  steps?.push({ step: 'wikipedia summary', status: res.status });
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
    url: src.split('#')[0].split('?')[0].replace(/\/\d+px-/, '/800px-'),
    file: fileFromUrl(d.originalimage?.source || src)
  };
}

async function extmetadata(api, label, file, steps) {
  const url = `${api}?` + new URLSearchParams({
    action: 'query', format: 'json', titles: 'File:' + file,
    prop: 'imageinfo', iiprop: 'extmetadata', origin: '*'
  });
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  // Same reasoning as lead(): a refusal is not an unlicensed file.
  if (!res.ok) throw new Error(`${label} returned ${res.status} for ${file}`);
  const body = await res.json();
  const page = Object.values(body?.query?.pages || {})[0];
  const em = page?.imageinfo?.[0]?.extmetadata;
  steps?.push({ step: label + ' licence', status: res.status, file, found: !!em });
  return em || null;
}

async function licence(file, steps) {
  /* Commons holds most of them, but a lead image uploaded straight to
     en.wikipedia is never there. Asking en.wikipedia second covers both,
     since its api.php answers for local files and Commons files alike. */
  let em = await extmetadata(COMMONS, 'commons', file, steps);
  if (!em) em = await extmetadata(WIKI_API, 'en.wikipedia', file, steps);
  if (!em) return null;
  return {
    licence: strip(em.LicenseShortName?.value),
    author: strip(em.Artist?.value) || 'Wikimedia Commons'
  };
}

/* GET /api/photo — open this in a browser to find out why pictures are not
   appearing. It reports booleans and counts only, never a key. */
/* Which deployment is answering. Without this, "the variables are set" and
   "the endpoint cannot see them" are both true and there is no way to tell why
   — a Preview build does not receive Production-scoped variables, and a stale
   build does not receive anything added since it was built. Names and refs
   only; no value from process.env is ever read into this response. */
function deployment() {
  const d = {
    vercel_env: process.env.VERCEL_ENV || '(not on Vercel)',
    git_branch: process.env.VERCEL_GIT_COMMIT_REF || '(unknown)',
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || '(unknown)'
  };
  /* Settles the other silent cause: a variable named almost correctly. A
     misspelling is invisible in a dashboard list and reads exactly like a
     variable that was never added. */
  d.env_names_seen = Object.keys(process.env)
    .filter((n) => /SUP|BASE|SERVICE_ROLE|ANON/i.test(n)).sort()
    // A name saved with no value is in process.env but reads as falsy, so a
    // plain name list says "present" about a variable that is doing nothing.
    .map((n) => (process.env[n] ? n : n + ' (present but EMPTY)'));
  return d;
}

/* What kind of key this is, without revealing it. A Supabase key carries its
   own role, so "you pasted the anon key" is knowable here rather than guessed
   from a 401 three calls later. Only the role claim is reported; it is not a
   secret and cannot be used for anything. */
function keyShape(k) {
  if (typeof k !== 'string' || k === '') return 'EMPTY — the variable exists but has no value';
  if (k.startsWith('sb_secret_')) return 'service_role (new sb_secret_ format)';
  if (k.startsWith('sb_publishable_')) {
    return 'PUBLISHABLE — this is the browser key, not the service role key';
  }
  const parts = k.split('.');
  if (parts.length !== 3) return 'unrecognised — not a JWT and not an sb_ key';
  try {
    const claims = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const role = claims.role || '(no role claim)';
    const expired = claims.exp && claims.exp * 1000 < Date.now() ? ' — EXPIRED' : '';
    return role + expired;
  } catch {
    return 'unrecognised — the JWT payload will not decode';
  }
}

async function diagnose() {
  const out = { ok: false, deployment: deployment(), checks: {}, next: null };
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  out.checks.SUPABASE_URL_set = !!url;
  out.checks.SUPABASE_SERVICE_ROLE_KEY_set = !!key;
  // Only the kind of key, never the key.
  if ('SUPABASE_SERVICE_ROLE_KEY' in process.env) out.checks.service_key_looks_like = keyShape(key);

  if (!url || !key) {
    const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
    /* Three different situations used to print the same sentence. A name that
       is present but empty is not a misspelling, and telling someone to check
       their spelling when the spelling is right is worse than saying nothing. */
    const empty = missing.filter((n) => n in process.env);
    const absent = missing.filter((n) => !(n in process.env));
    const preview = out.deployment.vercel_env && out.deployment.vercel_env !== 'production';
    const parts = [];

    if (empty.length) {
      parts.push(empty.join(' and ') + ' ' + (empty.length > 1 ? 'exist' : 'exists') +
        ' on this deployment but ' + (empty.length > 1 ? 'their values are' : 'its value is') +
        ' empty — saved as a name with nothing in it. In Vercel -> Settings -> Environment ' +
        'Variables, delete ' + empty.join(' and ') + ' and add ' +
        (empty.length > 1 ? 'them' : 'it') + ' again, pasting the value this time. A Secret ' +
        'variable cannot be read back after saving, so an empty one looks exactly like a full ' +
        'one in the list. Then Deployments -> ... -> Redeploy.');
    }
    if (absent.length) {
      parts.push(absent.join(' and ') + ' ' + (absent.length > 1 ? 'are' : 'is') +
        ' not on this deployment at all. ' + (preview
          ? 'This is a ' + out.deployment.vercel_env + ' build, and variables scoped to ' +
            'Production only are never given to it — tick Preview on each, or point Settings ' +
            '-> Git -> Production Branch at ' + out.deployment.git_branch + '.'
          : 'Add ' + (absent.length > 1 ? 'them' : 'it') + ' scoped to Production, then redeploy. ' +
            'Variables are read at build time, so adding without a redeploy changes nothing.'));
    }
    out.next = parts.join(' ');
    return out;
  }

  if (/EXPIRED/.test(out.checks.service_key_looks_like || '')) {
    out.next = 'SUPABASE_SERVICE_ROLE_KEY holds a service_role key that has expired. ' +
      'Issue a new one: Supabase -> Project Settings -> API. Then redeploy.';
    return out;
  }
  if (out.checks.service_key_looks_like && !/^service_role/.test(out.checks.service_key_looks_like)) {
    out.next = 'SUPABASE_SERVICE_ROLE_KEY is set, but the key in it is ' +
      out.checks.service_key_looks_like + '. It must be the service_role key: Supabase -> ' +
      'Project Settings -> API -> service_role. Then redeploy.';
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

/* The whole resolve, with a running account of what each stage returned.
   POST throws the account away; GET /api/photo?slug=... returns it, because
   three of these stages are invisible to the plain diagnosis and two of them
   fail with reasons the board is right to keep quiet about per person and
   wrong to keep quiet about for everyone. */
async function resolve(slug, steps) {
  const person = await db.one('people', db.eq('slug', slug));
  steps.push({ step: 'find person', found: !!person, name: person?.name });
  if (!person) return { status: 404, body: { error: 'No such person.' } };
  if (person.photo_path) return { body: { photo_path: person.photo_path, cached: true } };

  const hit = await lead(person.name, steps);
  steps.push({ step: 'lead image', found: !!hit, file: hit?.file });
  if (!hit) return { body: { photo_path: null, why: 'no image found' } };

  const meta = await licence(hit.file, steps);
  const ok = meta && licenceOk(meta.licence);
  steps.push({ step: 'licence check', licence: meta?.licence || null, acceptable: !!ok });
  if (!ok) return { body: { photo_path: null, why: `licence not verifiable (${meta?.licence || 'unknown'})` } };

  const img = await fetch(hit.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  steps.push({ step: 'download image', status: img.status, url: hit.url });
  if (!img.ok) return { body: { photo_path: null, why: `download failed (${img.status})` } };
  const bytes = Buffer.from(await img.arrayBuffer());
  steps.push({ step: 'download image', bytes: bytes.length });
  if (bytes.length > 5 * 1024 * 1024) return { body: { photo_path: null, why: 'image too large' } };

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
  /* Supabase says why in the body — "Bucket not found", "new row violates
     row-level security policy". A bare status number sent you guessing. */
  const upBody = up.ok ? null : (await up.text().catch(() => '')).slice(0, 300);
  steps.push({ step: 'upload to storage', status: up.status, path, response: upBody });
  if (!up.ok) return { body: { photo_path: null, why: `upload failed (${up.status}) ${upBody}`.trim() } };

  try {
    await db.update('people', db.eq('id', person.id), {
      photo_path: path, photo_credit: meta.author, photo_license: meta.licence
    });
    steps.push({ step: 'save photo_path to row', ok: true });
  } catch (e) {
    /* The bytes are in the bucket now. If the row cannot be updated, the file
       is still good and the caller should still show it — but every later
       visitor would re-download it forever, so say so out loud. */
    console.error('[photo] stored %s but could not write photo_path:', path, e);
    steps.push({ step: 'save photo_path to row', ok: false, error: e?.message });
    return { body: {
      photo_path: path, credit: meta.author, license: meta.licence,
      why: 'stored the image but could not save it to the row: ' + (e?.message || String(e))
    } };
  }

  return { body: { photo_path: path, credit: meta.author, license: meta.licence } };
}

export default webHandler(async function handler(request) {
  if (request.method === 'GET') {
    /* One URL you can paste into the address bar that runs the real thing.
       A POST-only trace is no use to someone holding a browser. */
    const slug = new URL(request.url).searchParams.get('slug');
    if (!slug) return json(await diagnose());
    const steps = [];
    try {
      const r = await resolve(slug, steps);
      return json({ trace: true, user_agent_sent: UA, steps, result: r.body }, r.status || 200);
    } catch (e) {
      return json({ trace: true, user_agent_sent: UA, steps,
                    result: { photo_path: null, why: 'lookup failed: ' + (e?.message || String(e)) } });
    }
  }
  if (request.method !== 'POST') return bad('Use POST, or GET for a diagnosis.', 405);

  // Fail loudly rather than returning a silent null nobody can debug.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({
      photo_path: null,
      why: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not visible to this ' +
           (process.env.VERCEL_ENV || 'local') + ' deployment (' +
           (process.env.VERCEL_GIT_COMMIT_REF || 'unknown branch') +
           '). Open /api/photo in a browser for the full diagnosis.'
    }, 500);
  }
  try {
    const { slug } = await readJson(request);
    if (!slug || typeof slug !== 'string' || slug.length > 80) return bad('No person named.');
    const r = await resolve(slug, []);
    if (r.status) return json(r.body, r.status);
    return json(r.body);
  } catch (e) {
    console.error('[photo]', e);
    return json({ photo_path: null, why: 'lookup failed: ' + (e && e.message ? e.message : String(e)) });
  }
});
