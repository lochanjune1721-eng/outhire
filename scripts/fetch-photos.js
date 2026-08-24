#!/usr/bin/env node
/* GOAT.lol — photos.
 *
 *   node scripts/fetch-photos.js --check        what resolves; writes nothing
 *   node scripts/fetch-photos.js --link-only    fast: store Commons URLs directly
 *   node scripts/fetch-photos.js                full: download, 800x800, upload
 *
 *   --only=greatest-footballer   one board      --limit=200    stop after N
 *   --concurrency=6              parallel work  --force        redo existing
 *
 * The site works without any of this: a person with no photo renders as
 * initials in the display face, gold on surface, which is a deliberate part of
 * the design rather than a gap.
 *
 * Three things make this survivable at 2,926 names:
 *   - Lookups are BATCHED 50 titles per API call, so name resolution is ~120
 *     requests rather than ~5,900.
 *   - It RESUMES. Anyone who already has a photo is skipped, so an interrupted
 *     run costs nothing.
 *   - Exact-title lookup falls back to search, because plenty of these are not
 *     at the title you would guess ("1996 Chicago Bulls", "Pizza", "MrBeast").
 *
 * Licences are verified before anything is stored. Commons mixes freely
 * reusable files with fair-use ones, and a fair-use portrait on a site where
 * people spend money is a real problem, not a cosmetic one. Anything that
 * cannot be verified is skipped and that person keeps their initials.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (not for --check).
 * Full mode also needs sharp:  npm install sharp
 */

import { BOARDS } from './goat-data.js';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const has = (n) => args.some((a) => a === `--${n}` || a.startsWith(`--${n}=`));
const val = (n) => { const f = args.find((a) => a.startsWith(`--${n}=`)); return f ? f.split('=')[1] : null; };

const CHECK = has('check');
const LINK_ONLY = has('link-only');
const FORCE = has('force');
const ONLY = val('only');
const LIMIT = Number(val('limit') || 0);
const CONC = Math.max(1, Math.min(8, Number(val('concurrency') || 4)));

const WIKI = process.env.WIKI_API || 'https://en.wikipedia.org/w/api.php';
const COMMONS = process.env.COMMONS_API || 'https://commons.wikimedia.org/w/api.php';
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// A real contact address is required by the Wikimedia user-agent policy.
const UA = process.env.WIKI_UA || 'GOAT.lol-photos/1.0 (https://goat.lol; one-off seeding)';

const OK_LICENCE = [
  /^cc0/i, /^cc[ -]by([ -]sa)?([ -][\d.]+)?/i, /public domain/i, /^pd[- ]/i,
  /^attribution$/i, /free art license/i, /^gfdl/i
];
const licenceOk = (s) => !!s && OK_LICENCE.some((r) => r.test(String(s).trim()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// Carriage-return progress is for a terminal; piped to a file it becomes one
// unreadable line, so only redraw when someone is actually watching.
const TTY = process.stdout.isTTY;
const progress = (msg) => { if (TTY) process.stdout.write('\r' + msg); };

async function apiGet(base, params) {
  const url = base + '?' + new URLSearchParams({ format: 'json', ...params });
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res;
    try { res = await fetch(url, { headers: { 'User-Agent': UA } }); }
    catch { await sleep(attempt * 1500); continue; }
    if (res.ok) return res.json();
    // 429 carries a retry hint; 5xx is worth backing off for.
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || attempt * 2000;
      await sleep(wait); continue;
    }
    return null;
  }
  return null;
}

/* MediaWiki normalises and follows redirects, so the title that comes back is
   rarely the one asked for. Build the map so results can be attributed. */
function titleIndex(q) {
  const map = new Map();
  (q?.normalized || []).forEach((n) => map.set(n.from, n.to));
  (q?.redirects || []).forEach((r) => map.set(r.from, r.to));
  const resolve = (t) => { const seen = new Set(); let cur = t;
    while (map.has(cur) && !seen.has(cur)) { seen.add(cur); cur = map.get(cur); } return cur; };
  const byTitle = new Map();
  Object.values(q?.pages || {}).forEach((p) => byTitle.set(p.title, p));
  return (name) => byTitle.get(resolve(name)) || null;
}

/** Lead image for up to 50 names at once. */
async function leadImages(names) {
  const body = await apiGet(WIKI, {
    action: 'query', redirects: '1', titles: names.join('|'),
    prop: 'pageimages', piprop: 'thumbnail|name', pithumbsize: '1000', pilicense: 'any'
  });
  const find = titleIndex(body?.query);
  const out = new Map();
  for (const n of names) {
    const p = find(n);
    if (p && p.missing === undefined && p.pageimage && p.thumbnail?.source) {
      out.set(n, { file: p.pageimage, url: p.thumbnail.source, title: p.title });
    }
  }
  return out;
}

/** Search fallback, one name at a time — only for what exact titles missed. */
async function searchImage(name) {
  const body = await apiGet(WIKI, {
    action: 'query', generator: 'search', gsrsearch: name, gsrlimit: '1',
    prop: 'pageimages', piprop: 'thumbnail|name', pithumbsize: '1000', pilicense: 'any'
  });
  const p = Object.values(body?.query?.pages || {})[0];
  if (p && p.pageimage && p.thumbnail?.source) {
    return { file: p.pageimage, url: p.thumbnail.source, title: p.title };
  }
  return null;
}

/** Licence and author for up to 50 files at once. */
async function licences(files) {
  const body = await apiGet(COMMONS, {
    action: 'query', titles: files.map((f) => 'File:' + f).join('|'),
    prop: 'imageinfo', iiprop: 'extmetadata'
  });
  const find = titleIndex(body?.query);
  const out = new Map();
  for (const f of files) {
    const p = find('File:' + f);
    const em = p?.imageinfo?.[0]?.extmetadata;
    if (em) {
      out.set(f, {
        licence: strip(em.LicenseShortName?.value),
        author: strip(em.Artist?.value) || 'Wikimedia Commons'
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ store -- */

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...init.headers
    }
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

/** Who already has one, so an interrupted run resumes instead of restarting. */
async function alreadyDone() {
  const done = new Set();
  if (CHECK || FORCE) return done;
  let from = 0;
  for (;;) {
    const rows = await sb(`/rest/v1/people?select=slug&photo_path=not.is.null&limit=1000&offset=${from}`);
    if (!rows?.length) break;
    rows.forEach((r) => done.add(r.slug));
    if (rows.length < 1000) break;
    from += 1000;
  }
  return done;
}

let sharp = null;
async function loadSharp() {
  if (sharp !== null) return sharp;
  try { sharp = (await import('sharp')).default; }
  catch { sharp = false; }
  return sharp;
}

async function cache(url, slug) {
  const s = await loadSharp();
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  let buf = Buffer.from(await res.arrayBuffer());
  if (s) {
    // Same crop the cards use, so what is stored is what is shown.
    buf = await s(buf).resize(800, 800, { fit: 'cover', position: 'attention' })
                      .jpeg({ quality: 84 }).toBuffer();
  }
  const path = `people/${slug}.jpg`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/photos/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'image/jpeg', 'x-upsert': 'true'
    },
    body: buf
  });
  if (!up.ok) return null;
  return path;
}

async function pool(items, n, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await worker(items[i++]);
  }));
}

/* -------------------------------------------------------------------- run -- */

async function main() {
  const boards = ONLY ? BOARDS.filter((b) => b.slug === ONLY) : BOARDS;
  if (!boards.length) { console.error(`No board called "${ONLY}".`); process.exit(1); }
  if (!CHECK && (!SUPABASE_URL || !SERVICE_KEY)) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --check.');
    process.exit(1);
  }
  if (!CHECK && !LINK_ONLY && !(await loadSharp())) {
    console.error('Full mode resizes images. Run `npm install sharp`, or use --link-only.');
    process.exit(1);
  }

  const done = await alreadyDone();
  if (done.size) console.log(`resuming — ${done.size} already have a photo\n`);

  let todo = [];
  for (const b of boards) {
    for (let i = 0; i < b.people.length; i++) {
      if (!done.has(b.slugs[i])) todo.push({ board: b.slug, name: b.people[i], slug: b.slugs[i] });
    }
  }
  if (LIMIT) todo = todo.slice(0, LIMIT);
  console.log(`${todo.length} to look up across ${boards.length} board(s)\n`);

  // 1. exact titles, 50 at a time
  const resolved = new Map();
  for (const group of chunk(todo, 50)) {
    const hits = await leadImages(group.map((t) => t.name));
    for (const t of group) if (hits.has(t.name)) resolved.set(t.slug, hits.get(t.name));
    progress(`resolving titles… ${resolved.size}/${todo.length}`);
    await sleep(120);
  }
  if (TTY) console.log('');
  console.log(`resolved ${resolved.size} by exact title`);

  // 2. search fallback for the rest
  const unresolved = todo.filter((t) => !resolved.has(t.slug));
  let searched = 0;
  await pool(unresolved, CONC, async (t) => {
    const hit = await searchImage(t.name);
    if (hit) resolved.set(t.slug, hit);
    searched++;
    progress(`searching the rest… ${searched}/${unresolved.length}`);
  });
  if (TTY) console.log('');
  console.log(`resolved ${searched ? resolved.size : 0} total after search fallback`);

  // 3. licences, 50 files at a time
  const files = [...new Set([...resolved.values()].map((v) => v.file))];
  const lic = new Map();
  for (const group of chunk(files, 50)) {
    const got = await licences(group);
    got.forEach((v, k) => lic.set(k, v));
    progress(`checking licences… ${lic.size}/${files.length}`);
    await sleep(120);
  }
  if (TTY) console.log('');

  // 4. store
  const misses = [];
  let usable = 0, stored = 0, badLicence = 0;

  const work = todo.filter((t) => resolved.has(t.slug));
  for (const t of todo) if (!resolved.has(t.slug)) misses.push({ ...t, why: 'no image found' });

  await pool(work, CONC, async (t) => {
    const hit = resolved.get(t.slug);
    const meta = lic.get(hit.file);
    if (!meta || !licenceOk(meta.licence)) {
      badLicence++;
      misses.push({ ...t, why: `licence not verifiable (${meta?.licence || 'unknown'})` });
      return;
    }
    usable++;
    if (CHECK) return;

    const path = LINK_ONLY ? hit.url : await cache(hit.url, t.slug);
    if (!path) { misses.push({ ...t, why: 'download or upload failed' }); return; }

    await sb(`/rest/v1/people?slug=eq.${encodeURIComponent(t.slug)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        photo_path: path, photo_credit: meta.author, photo_license: meta.licence
      })
    });
    stored++;
    if (stored % 25 === 0) progress(`storing… ${stored}/${usable}`);
  });


  const pct = todo.length ? Math.round((usable / todo.length) * 100) : 0;
  console.log(`\nusable ${usable}/${todo.length} (${pct}%)   ` +
              `no image ${todo.length - usable - badLicence}   licence unverifiable ${badLicence}`);
  if (!CHECK) console.log(`stored ${stored}` + (LINK_ONLY ? ' as Commons links' : ' in the photos bucket'));

  if (misses.length) {
    writeFileSync(new URL('../photo-misses.json', import.meta.url), JSON.stringify(misses, null, 2));
    console.log(`\n${misses.length} without a photo — written to photo-misses.json.`);
    console.log('They render as initials, which is by design. Fill any that matter in /admin.html.');
  }
  if (CHECK) console.log('\nNothing was written. Drop --check to run for real.');
}

main().catch((e) => { console.error(e); process.exit(1); });
