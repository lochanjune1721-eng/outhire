/* outbid.lol — serverless helpers.
 * No npm dependencies: Stripe over its REST API, Supabase over PostgREST,
 * webhook HMAC via node:crypto. Keeps the "no build step" promise honest. */

import crypto from 'node:crypto';

export const CONNECT_ACCOUNT = process.env.STRIPE_CONNECT_ACCOUNT_ID || 'acct_1SNgH8ItrE8tEH6a';
export const MIN_CENTS = 500;
export const HEADLINE_MAX = 120;

export const CATEGORIES = [
  'SEO', 'Agents', 'AI Media', 'Marketing', 'Developer', 'Productivity',
  'People', 'Design', 'Engineering', 'Data', 'Sales', 'Content',
  'Product', 'Growth', 'Ops', 'Founding', 'Internship', 'Other'
];

/* Only links from real hiring platforms may spawn a board. This is the copy
   that counts — the client-side list is only there for a faster answer. */
export const JOB_HOSTS = [
  'linkedin.com', 'wellfound.com', 'angel.co', 'workatastartup.com',
  'lever.co', 'greenhouse.io', 'ashbyhq.com', 'workable.com', 'breezy.hr',
  'indeed.com', 'glassdoor.com', 'naukri.com', 'instahyre.com', 'cutshort.io'
];

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }
  });
}
export const bad = (msg, status = 400) => json({ error: msg }, status);

export async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

export function env(name, required = true) {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing environment variable ${name}.`);
  return v;
}

/* ---------------------------------------------------------------- values -- */

export function safeUrl(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!/^https?:\/\//i.test(s)) {
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) s = 'https://' + s; else return null;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch { return null; }
}

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

export function jobHostAllowed(url) {
  const h = hostOf(url);
  return !!h && JOB_HOSTS.some((allowed) => h === allowed || h.endsWith('.' + allowed));
}

/* Two links to the same posting should join one board, not spawn two. Strip
   tracking params, the trailing slash, and LinkedIn's query-only job form. */
export function normaliseJobUrl(raw) {
  const s = safeUrl(raw);
  if (!s) return null;
  const u = new URL(s);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  const keep = new URLSearchParams();
  const jobId = u.searchParams.get('currentJobId') || u.searchParams.get('jk') || u.searchParams.get('gh_jid');
  if (jobId) keep.set('id', jobId);
  u.search = keep.toString();
  u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u.toString();
}

export function slugify(s, fallback = 'board') {
  const out = String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return out || fallback;
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function isEmail(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim()); }
export function emailDomain(s) { return String(s || '').split('@')[1]?.toLowerCase().trim() || ''; }

export const FREE_INBOXES = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'proton.me', 'protonmail.com', 'pm.me',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'gmx.com', 'zoho.com',
  'mail.com', 'yandex.com', 'tutanota.com', 'fastmail.com',
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'temp-mail.org', 'throwawaymail.com', 'sharklasers.com', 'yopmail.com',
  'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc'
]);

export function siteUrl(request) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  return `${proto}://${host}`;
}

/* ------------------------------------------------------------- supabase -- */
/* Service role only. This module is never shipped to the browser. */

function sbHeaders(extra = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

export async function sbFetch(path, init = {}) {
  const base = env('SUPABASE_URL').replace(/\/$/, '');
  const res = await fetch(`${base}${path}`, { ...init, headers: sbHeaders(init.headers) });
  const text = await res.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!res.ok) {
    const msg = (body && body.message) || (typeof body === 'string' ? body : 'Database request failed.');
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const q = (v) => encodeURIComponent(v);

export const db = {
  select: (table, query = '') => sbFetch(`/rest/v1/${table}?${query}`),
  async one(table, query) {
    const rows = await sbFetch(`/rest/v1/${table}?${query}&limit=1`);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  },
  insert: (table, row, prefer = 'return=representation') =>
    sbFetch(`/rest/v1/${table}`, {
      method: 'POST', headers: { Prefer: prefer }, body: JSON.stringify(row)
    }),
  update: (table, query, patch) =>
    sbFetch(`/rest/v1/${table}?${query}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch)
    }),
  upsert: (table, row, onConflict) =>
    sbFetch(`/rest/v1/${table}?on_conflict=${q(onConflict)}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(row)
    }),
  eq: (col, val) => `${col}=eq.${q(val)}`
};

/* Verify a Supabase Auth JWT by asking Supabase who it belongs to. Cheaper to
   reason about than verifying the signature ourselves, and it honours
   revocation. */
export async function userFromToken(accessToken) {
  if (!accessToken) return null;
  const base = env('SUPABASE_URL').replace(/\/$/, '');
  const res = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return null;
  const u = await res.json();
  return u && u.email ? u : null;
}

/* --------------------------------------------------------------- stripe -- */

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) form(v, key, out);
    else if (Array.isArray(v)) v.forEach((item, i) => {
      if (typeof item === 'object') form(item, `${key}[${i}]`, out);
      else out.append(`${key}[${i}]`, String(item));
    });
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(path, payload, method = 'POST') {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: payload ? form(payload).toString() : undefined
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message || 'Stripe request failed.');
  return body;
}

/* Constant-time verification of the Stripe signature over the raw body. */
export function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=')).filter((p) => p.length === 2)
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > toleranceSec) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------- admin tk -- */

export function mintAdminToken(ttlSec = 60 * 60 * 8) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac('sha256', env('ADMIN_PASSWORD')).update(String(exp)).digest('base64url');
  return `${exp}.${sig}`;
}

export function checkAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [expStr, sig] = token.split('.');
  if (!expStr || !sig) return false;
  if (Number(expStr) < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', env('ADMIN_PASSWORD')).update(expStr).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function constantTimeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/* ----------------------------------------------------------------- mail -- */
/* Optional: with RESEND_API_KEY set, mail actually sends. Without it the
   message is logged rather than silently dropped, so an upload link is never
   lost without a trace. */

export async function sendMail({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || 'outbid.lol <onboarding@resend.dev>';
  if (!key) {
    console.log('[mail:unsent — no RESEND_API_KEY]', JSON.stringify({ to, subject, text }));
    return { sent: false };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text })
    });
    if (!res.ok) throw new Error(await res.text());
    return { sent: true };
  } catch (e) {
    console.error('[mail:failed]', e.message, JSON.stringify({ to, subject, text }));
    return { sent: false };
  }
}
