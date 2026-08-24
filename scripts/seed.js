#!/usr/bin/env node
/* GOAT.lol — seeding.
 *
 *   node scripts/seed.js --check          query every board, print what it
 *                                         would seed, write nothing
 *   node scripts/seed.js --check=chefs    just one board
 *   node scripts/seed.js                  seed everything for real
 *   node scripts/seed.js --only=chefs     seed one board
 *   node scripts/seed.js --no-photos      rows only, skip image work
 *
 * Everyone seeds at $0. Nobody is pre-ranked — an empty board where the first
 * $1 takes #1 beats one where somebody is already on top for no reason.
 *
 * Run --check first. The Wikidata QIDs in categories.js were written without
 * network access, so some are wrong, and a wrong QID gives an empty or absurd
 * board rather than an error.
 *
 * Needs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (skip for --check).
 * Photo resizing needs sharp:  npm install sharp
 */

import { CATEGORIES } from './categories.js';

const SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'GOAT.lol-seed/1.0 (https://goat.lol; one-off seeding script)';

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
const val = (n) => { const f = flag(n); return f && f.includes('=') ? f.split('=')[1] : null; };

const CHECK = !!flag('check');
const ONLY = val('only') || val('check');
const NO_PHOTOS = !!flag('no-photos');

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* Commons licences that may be reused with attribution. Anything not on this
   list is skipped -- Commons mixes CC with fair-use, and a fair-use portrait
   on a commercial leaderboard is a real problem, not a cosmetic one. */
const OK_LICENCES = [
  /^cc0/i, /^cc[- ]by([- ]sa)?([- ][\d.]+)?/i, /public domain/i, /^pd[- ]/i,
  /^attribution$/i, /free art license/i, /^gfdl/i
];
const licenceOk = (s) => !!s && OK_LICENCES.some((r) => r.test(String(s).trim()));

/* ------------------------------------------------------------------ util -- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) => String(s).toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function sb(path, init = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...init.headers
    }
  });
  const text = await res.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

/* --------------------------------------------------------------- wikidata -- */

function buildQuery(cat) {
  const filters = [`?item wdt:${cat.prop} wd:${cat.qid} .`];
  // Only constrain to humans when the board is actually about people.
  if (cat.prop === 'P106' || cat.prop === 'P39' || cat.prop === 'P413') {
    filters.push('?item wdt:P31 wd:Q5 .');
  }
  if (cat.gender) filters.push(`?item wdt:P21 wd:${cat.gender} .`);
  if (cat.country) filters.push(`?item wdt:P27 wd:${cat.country} .`);

  // Sitelink count is a rough fame proxy and the only cheap one available.
  return `SELECT ?item ?itemLabel ?itemDescription ?image ?article ?sitelinks WHERE {
  ${filters.join('\n  ')}
  ?item wikibase:sitelinks ?sitelinks .
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
ORDER BY DESC(?sitelinks)
LIMIT ${cat.limit || 20}`;
}

async function queryWikidata(cat) {
  const url = `${SPARQL}?query=${encodeURIComponent(buildQuery(cat))}&format=json`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA } });
    if (res.ok) {
      const body = await res.json();
      return body.results.bindings.map((b) => ({
        qid: b.item.value.split('/').pop(),
        name: b.itemLabel?.value || '',
        blurb: b.itemDescription?.value || '',
        image: b.image?.value || null,
        wikipedia: b.article?.value || null,
        sitelinks: Number(b.sitelinks?.value || 0)
      // A label that is still a Q-number means no English label exists.
      })).filter((r) => r.name && !/^Q\d+$/.test(r.name));
    }
    if (res.status === 429 || res.status >= 500) { await sleep(attempt * 4000); continue; }
    throw new Error(`SPARQL ${res.status}`);
  }
  throw new Error('SPARQL failed after 3 attempts');
}

/* ---------------------------------------------------------------- commons -- */

/** Licence and author for a Commons file, so attribution is stored with the photo. */
async function commonsMeta(imageUrl) {
  const file = decodeURIComponent(imageUrl.split('/').pop());
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
    `&titles=${encodeURIComponent('File:' + file)}` +
    '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1200';
  const res = await fetch(api, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const body = await res.json();
  const pages = body?.query?.pages || {};
  const page = Object.values(pages)[0];
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata || {};
  const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').trim();
  return {
    url: info.thumburl || info.url,
    licence: strip(meta.LicenseShortName?.value),
    author: strip(meta.Artist?.value) || 'Wikimedia Commons',
    file
  };
}

let sharp = null;
async function loadSharp() {
  if (sharp !== null) return sharp;
  try { sharp = (await import('sharp')).default; }
  catch { sharp = false; console.warn('  ! sharp is not installed — run `npm install sharp` to resize photos'); }
  return sharp;
}

/** Download, square-crop to 800x800, upload to the photos bucket. */
async function cachePhoto(meta, slug) {
  const s = await loadSharp();
  const res = await fetch(meta.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  let buf = Buffer.from(await res.arrayBuffer());

  if (s) {
    buf = await s(buf)
      .resize(800, 800, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 84 })
      .toBuffer();
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
  if (!up.ok) { console.warn(`  ! upload failed for ${slug}: ${up.status}`); return null; }
  return path;
}

/* ------------------------------------------------------------------- run -- */

async function ensureCategory(cat, order) {
  const existing = await sb(`/rest/v1/categories?slug=eq.${encodeURIComponent(cat.slug)}&limit=1`);
  if (Array.isArray(existing) && existing.length) return existing[0];
  const rows = await sb('/rest/v1/categories', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ slug: cat.slug, name: cat.name, group_name: cat.group, sort_order: order })
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function seedCategory(cat, order) {
  const rows = await queryWikidata(cat);

  if (CHECK) {
    const names = rows.slice(0, 3).map((r) => r.name).join(', ');
    const withPhoto = rows.filter((r) => r.image).length;
    const flagged = rows.length === 0 ? '  <-- EMPTY, check the QID' : '';
    console.log(
      `${cat.slug.padEnd(22)} ${String(rows.length).padStart(3)} results  ` +
      `${String(withPhoto).padStart(3)} photos  ${names}${flagged}`
    );
    return { count: rows.length, empty: rows.length === 0 };
  }

  const category = await ensureCategory(cat, order);
  let added = 0, skippedLicence = 0;

  for (const r of rows) {
    const slug = slugify(r.name);
    if (!slug) continue;
    const seen = await sb(`/rest/v1/people?slug=eq.${encodeURIComponent(slug)}&limit=1`);
    if (Array.isArray(seen) && seen.length) continue;

    let photo_path = null, photo_credit = null, photo_license = null;

    if (r.image && !NO_PHOTOS) {
      const meta = await commonsMeta(r.image);
      if (meta && licenceOk(meta.licence)) {
        photo_path = await cachePhoto(meta, slug);
        photo_credit = meta.author;
        photo_license = meta.licence;
      } else if (meta) {
        // Unverifiable licence: seed the row, skip the image. The initials
        // fallback is designed to look deliberate, so this is not a hole.
        skippedLicence++;
      }
      await sleep(250);
    }

    await sb('/rest/v1/people', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        slug, category_id: category.id, name: r.name,
        blurb: r.blurb || null, wikipedia_url: r.wikipedia || null,
        photo_path, photo_credit, photo_license,
        total_cents: 0   // everyone starts at zero, always
      })
    });
    added++;
  }

  console.log(`${cat.slug.padEnd(22)} +${added} seeded` +
    (skippedLicence ? `, ${skippedLicence} photo(s) skipped on licence` : ''));
  return { count: added };
}

async function main() {
  const list = ONLY ? CATEGORIES.filter((c) => c.slug === ONLY) : CATEGORIES;
  if (!list.length) { console.error(`No board called "${ONLY}".`); process.exit(1); }

  if (CHECK) {
    console.log(`Checking ${list.length} board(s) against Wikidata. Nothing will be written.\n`);
  } else if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --check.');
    process.exit(1);
  }

  const empties = [];
  for (let i = 0; i < list.length; i++) {
    try {
      const out = await seedCategory(list[i], i);
      if (out.empty) empties.push(list[i].slug);
    } catch (e) {
      console.error(`${list[i].slug.padEnd(22)} FAILED: ${e.message}`);
      empties.push(list[i].slug);
    }
    await sleep(1200);   // be polite to the SPARQL endpoint
  }

  if (CHECK) {
    console.log(`\n${empties.length} board(s) returned nothing — fix these QIDs in scripts/categories.js before seeding:`);
    console.log(empties.length ? '  ' + empties.join('\n  ') : '  none');
  } else {
    console.log('\nSeeded. Now open /admin.html and review each board — swap bad photos,');
    console.log('delete wrong entries, add obvious missing names. Roughly three minutes a board.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
