#!/usr/bin/env node
/* GOAT.lol — optional photo pass.
 *
 *   node scripts/fetch-photos.js --check           what would resolve, no writes
 *   node scripts/fetch-photos.js --check --only=greatest-footballer
 *   node scripts/fetch-photos.js                   fetch, resize, upload
 *   node scripts/fetch-photos.js --only=greatest-singer --limit=5
 *
 * The site works without this: a person with no photo renders as initials in
 * the display face, gold on surface, which is a deliberate part of the design.
 * This just fills them in.
 *
 * It looks each person up by NAME rather than by occupation, because the names
 * are already curated — that is far more reliable than querying Wikidata for
 * "people whose occupation is X" and hoping the QID was right.
 *
 * Licences are verified before anything is stored. Commons mixes freely
 * reusable files with fair-use ones, and a fair-use portrait on a site where
 * people spend money is a real problem, not a cosmetic one. Anything whose
 * licence cannot be verified is skipped and the person keeps their initials.
 *
 * Needs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (not for --check).
 * Resizing needs sharp:  npm install sharp
 */

import { BOARDS } from './goat-data.js';

const UA = 'GOAT.lol-photos/1.0 (one-off seeding script; contact via site)';
const args = process.argv.slice(2);
const has = (n) => args.some((a) => a === `--${n}` || a.startsWith(`--${n}=`));
const val = (n) => { const f = args.find((a) => a.startsWith(`--${n}=`)); return f ? f.split('=')[1] : null; };

const CHECK = has('check');
const ONLY = val('only');
const LIMIT = Number(val('limit') || 0);

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OK_LICENCE = [
  /^cc0/i, /^cc[ -]by([ -]sa)?([ -][\d.]+)?/i, /public domain/i, /^pd[- ]/i,
  /^attribution$/i, /free art license/i, /^gfdl/i
];
const licenceOk = (s) => !!s && OK_LICENCE.some((r) => r.test(String(s).trim()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function api(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(attempt * 2000); continue; }
    return null;
  }
  return null;
}

/** The lead image on the person's English Wikipedia page, with its licence. */
async function lookup(name) {
  const page = await api(
    'https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1' +
    `&titles=${encodeURIComponent(name)}&prop=pageimages&piprop=original|name`
  );
  const pages = page?.query?.pages || {};
  const first = Object.values(pages)[0];
  if (!first || first.missing !== undefined || !first.pageimage) return null;

  const file = 'File:' + first.pageimage;
  const meta = await api(
    'https://commons.wikimedia.org/w/api.php?action=query&format=json' +
    `&titles=${encodeURIComponent(file)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1000`
  );
  const mpages = meta?.query?.pages || {};
  const info = Object.values(mpages)[0]?.imageinfo?.[0];
  if (!info) return null;

  const em = info.extmetadata || {};
  return {
    url: info.thumburl || info.url,
    licence: strip(em.LicenseShortName?.value),
    author: strip(em.Artist?.value) || 'Wikimedia Commons',
    file: first.pageimage
  };
}

let sharp = null;
async function loadSharp() {
  if (sharp !== null) return sharp;
  try { sharp = (await import('sharp')).default; }
  catch { sharp = false; console.warn('  ! sharp not installed — run `npm install sharp`'); }
  return sharp;
}

async function upload(meta, slug) {
  const s = await loadSharp();
  const res = await fetch(meta.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  let buf = Buffer.from(await res.arrayBuffer());
  if (s) {
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
  if (!up.ok) { console.warn(`    ! upload failed for ${slug}: ${up.status}`); return null; }
  return path;
}

async function patch(slug, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/people?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) console.warn(`    ! patch failed for ${slug}: ${res.status}`);
}

async function main() {
  const boards = ONLY ? BOARDS.filter((b) => b.slug === ONLY) : BOARDS;
  if (!boards.length) { console.error(`No board called "${ONLY}".`); process.exit(1); }
  if (!CHECK && (!SUPABASE_URL || !SERVICE_KEY)) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --check.');
    process.exit(1);
  }

  let found = 0, badLicence = 0, missing = 0, done = 0;

  for (const b of boards) {
    let hit = 0, skip = 0;
    for (let i = 0; i < b.people.length; i++) {
      if (LIMIT && done >= LIMIT) break;
      const name = b.people[i], slug = b.slugs[i];
      const meta = await lookup(name);
      await sleep(180);   // be polite to the Wikimedia APIs

      if (!meta) { missing++; skip++; continue; }
      if (!licenceOk(meta.licence)) { badLicence++; skip++; continue; }
      found++; hit++;

      if (!CHECK) {
        const path = await upload(meta, slug);
        if (path) await patch(slug, {
          photo_path: path, photo_credit: meta.author, photo_license: meta.licence
        });
        done++;
      }
    }
    console.log(`${b.slug.padEnd(34)} ${String(hit).padStart(3)}/${b.people.length} usable` +
                (skip ? `  (${skip} skipped)` : ''));
    if (LIMIT && done >= LIMIT) break;
  }

  console.log(`\nusable: ${found}   no page image: ${missing}   licence not verifiable: ${badLicence}`);
  if (CHECK) console.log('Nothing was written. Drop --check to fetch for real.');
}

main().catch((e) => { console.error(e); process.exit(1); });
