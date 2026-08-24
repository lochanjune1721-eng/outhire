/* OUTHIRE — server-side helpers. Never reaches the browser.
 *
 * No npm dependencies and no build step: Stripe is called over its REST API
 * with fetch, Supabase over PostgREST with the service role key, and the
 * webhook signature is verified with node:crypto. Files in /api beginning with
 * an underscore are not routed by Vercel.
 */
import crypto from 'node:crypto';

/* ------------------------------ env ---------------------------------- */

export function env(name, fallback) {
  var v = process.env[name];
  if (v == null || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error('Missing environment variable: ' + name);
  }
  return v;
}

export const CONNECT_ACCOUNT = () => env('STRIPE_CONNECT_ACCOUNT_ID', 'acct_1SNgH8ItrE8tEH6a');

export function siteUrl(request) {
  var explicit = process.env.SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  try {
    var u = new URL(request.url);
    var host = request.headers.get('x-forwarded-host') || u.host;
    var proto = request.headers.get('x-forwarded-proto') || u.protocol.replace(':', '');
    return proto + '://' + host;
  } catch (e) {
    return 'http://localhost:3000';
  }
}

/* ---------------------------- responses ------------------------------- */

export function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export function bad(message, status) {
  return json({ error: message }, status || 400);
}

export async function readJson(request) {
  try {
    var text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch (e) {
    return {};
  }
}

export function methodGuard(request, allowed) {
  if (request.method !== allowed) {
    return json({ error: 'Method not allowed.' }, 405);
  }
  return null;
}

/* ------------------------------ strings ------------------------------- */

export function str(v, max) {
  if (v == null) return '';
  var s = String(v).trim();
  return max ? s.slice(0, max) : s;
}

export function isEmail(v) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || ''));
}

export function httpUrl(v) {
  if (!v) return null;
  var s = String(v).trim();
  if (!s) return null;
  try {
    var u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch (e) { return null; }
}

export function token(bytes) {
  return crypto.randomBytes(bytes || 24).toString('base64url');
}

export function slugify(name) {
  var base = String(name || 'entry').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!base) base = 'entry';
  return base + '-' + crypto.randomBytes(3).toString('hex');
}

/* ---------------------------- supabase -------------------------------- */

function sbHeaders(extra) {
  var key = env('SUPABASE_SERVICE_ROLE_KEY');
  return Object.assign({
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json'
  }, extra || {});
}

/** Raw PostgREST call with the service role key. Bypasses RLS by design. */
export async function db(path, init) {
  var base = env('SUPABASE_URL').replace(/\/$/, '');
  var res = await fetch(base + '/rest/v1/' + path, {
    method: (init && init.method) || 'GET',
    headers: sbHeaders(init && init.headers),
    body: init && init.body ? JSON.stringify(init.body) : undefined
  });
  var text = await res.text();
  var data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
  if (!res.ok) {
    var msg = (data && (data.message || data.error || data.hint)) || ('Database error ' + res.status);
    var err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export async function selectOne(path) {
  var rows = await db(path);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function insertRow(table, row, prefer) {
  var rows = await db(table, {
    method: 'POST',
    body: row,
    headers: { Prefer: prefer || 'return=representation' }
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function updateRow(table, filter, patch) {
  var rows = await db(table + '?' + filter, {
    method: 'PATCH',
    body: patch,
    headers: { Prefer: 'return=representation' }
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function categoryIdBySlug(slug) {
  if (!slug) return null;
  var row = await selectOne('categories?slug=eq.' + encodeURIComponent(slug) + '&select=id&limit=1');
  return row ? row.id : null;
}

/* ------------------------------ stripe -------------------------------- */

/** Flattens the nested object Stripe's form encoding expects. */
export function formEncode(obj, prefix, out) {
  out = out || new URLSearchParams();
  Object.keys(obj).forEach(function (k) {
    var v = obj[k];
    if (v === undefined || v === null || v === '') return;
    var key = prefix ? prefix + '[' + k + ']' : k;
    if (typeof v === 'object' && !Array.isArray(v)) formEncode(v, key, out);
    else if (Array.isArray(v)) v.forEach(function (item, i) {
      if (typeof item === 'object') formEncode(item, key + '[' + i + ']', out);
      else out.append(key + '[' + i + ']', String(item));
    });
    else out.append(key, String(v));
  });
  return out;
}

export async function stripe(path, body, idempotencyKey) {
  var headers = {
    Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'),
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  var res = await fetch('https://api.stripe.com/v1/' + path, {
    method: body ? 'POST' : 'GET',
    headers: headers,
    body: body ? formEncode(body).toString() : undefined
  });
  var data = await res.json();
  if (!res.ok) {
    var err = new Error((data && data.error && data.error.message) || 'Stripe rejected the request.');
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Stripe's own scheme: t=<ts>,v1=<hex>, signed over `${t}.${rawBody}`. */
export function verifyStripeSignature(rawBody, header, secret, toleranceSeconds) {
  if (!header) return false;
  var parts = String(header).split(',').reduce(function (acc, kv) {
    var i = kv.indexOf('=');
    if (i > 0) {
      var k = kv.slice(0, i).trim();
      var v = kv.slice(i + 1).trim();
      if (k === 'v1') (acc.v1 = acc.v1 || []).push(v);
      else acc[k] = v;
    }
    return acc;
  }, {});

  if (!parts.t || !parts.v1 || !parts.v1.length) return false;

  var age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(parts.t, 10));
  if (age > (toleranceSeconds || 300)) return false;

  var expected = crypto.createHmac('sha256', secret)
    .update(parts.t + '.' + rawBody, 'utf8').digest('hex');
  var expectedBuf = Buffer.from(expected, 'utf8');

  return parts.v1.some(function (candidate) {
    var buf = Buffer.from(candidate, 'utf8');
    return buf.length === expectedBuf.length && crypto.timingSafeEqual(buf, expectedBuf);
  });
}

/* ------------------------------- admin -------------------------------- */

export function timingSafeString(a, b) {
  var ab = Buffer.from(String(a), 'utf8');
  var bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) {
    // Still burn a comparison so the failure is not measurably faster.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/** Short-lived bearer token so the password is sent once, not on every action. */
export function mintAdminToken(ttlSeconds) {
  var secret = env('ADMIN_PASSWORD');
  var exp = Math.floor(Date.now() / 1000) + (ttlSeconds || 60 * 60 * 8);
  var payload = String(exp);
  var sig = crypto.createHmac('sha256', secret).update('outhire-admin.' + payload).digest('base64url');
  return payload + '.' + sig;
}

export function verifyAdminToken(value) {
  if (!value || typeof value !== 'string') return false;
  var i = value.indexOf('.');
  if (i < 1) return false;
  var payload = value.slice(0, i);
  var sig = value.slice(i + 1);
  var exp = parseInt(payload, 10);
  if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
  var secret = env('ADMIN_PASSWORD');
  var expected = crypto.createHmac('sha256', secret).update('outhire-admin.' + payload).digest('base64url');
  return timingSafeString(sig, expected);
}

/* -------------------------------- mail -------------------------------- */

/**
 * Sends the upload link. Resend if RESEND_API_KEY is set, otherwise the link
 * is logged so a fresh deploy still works end to end and nothing is silently
 * lost. Returns true only if a provider actually accepted it.
 */
export async function sendUploadEmail(to, entry, uploadUrl) {
  var key = process.env.RESEND_API_KEY;
  var from = process.env.MAIL_FROM || 'Outhire <onboarding@resend.dev>';

  var subject = 'Your Outhire upload link';
  var text =
    'Your bid went through. You are on the board at ' + (entry.display_name || 'your entry') + '.\n\n' +
    'Upload your video here:\n' + uploadUrl + '\n\n' +
    'Forty-five seconds or under, at least twenty, portrait, under 50MB.\n' +
    'The entry goes live once it clears review.\n';

  if (!key) {
    console.log('[outhire] no RESEND_API_KEY set; upload link for ' + to + ': ' + uploadUrl);
    return false;
  }

  try {
    var res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: from, to: [to], subject: subject, text: text })
    });
    if (!res.ok) {
      console.error('[outhire] email send failed', res.status, await res.text());
      console.log('[outhire] upload link for ' + to + ': ' + uploadUrl);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[outhire] email send threw', e);
    console.log('[outhire] upload link for ' + to + ': ' + uploadUrl);
    return false;
  }
}
