/* /api/images — the resolver, running itself.
 *
 * Nobody should have to press a button for a site to have pictures on it. This
 * drains the queue of unresolved contenders without anyone watching:
 *
 *   - a Vercel cron ticks it once a day (vercel.json)
 *   - any page that notices unresolved people pokes it once per browser session
 *   - /admin.html can start it by hand
 *
 * Whichever starts it, the work happens here, on the server. A single run
 * resolves what fits inside the function's thirty seconds, then hands off to a
 * fresh invocation of itself and returns. One poke therefore drains all 2,926
 * over about an hour, unattended, and stops on its own when there is nothing
 * left. No page ever waits for any of it.
 *
 * Safe to call from anywhere, as often as you like: a lock row means only one
 * chain runs at a time, and it only ever touches rows that are already in the
 * database.
 *
 *   POST /api/images          start a run if one is not already going
 *   GET  /api/images          where things stand; starts nothing
 */
import { webHandler, json, db, count, sbFetch } from './_lib.js';
import { resolveImage, imageRow } from './_wikimedia.js';

const PER_RUN = 24;        // people per invocation — comfortably inside 30s
const CONCURRENT = 3;      // Wikimedia is donated infrastructure
const MAX_CHAIN = 400;     // 400 x 24 is far more than 2,926; a runaway stop
const STALE_MS = 3 * 60 * 1000;

/* ------------------------------- the lock -------------------------------- */

/** Claim the job, or return null if somebody else already has it. */
async function takeLock() {
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  /* Free, or held by a run that stopped writing heartbeats — a function that
     is killed mid-flight cannot release anything, so without the staleness
     clause one crash would wedge the queue permanently. */
  const rows = await sbFetch(
    `/rest/v1/image_job?id=eq.1&or=(running.is.false,last_beat.lt.${encodeURIComponent(stale)})`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ running: true, started_at: new Date().toISOString(),
                             last_beat: new Date().toISOString(), note: null }) });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

const beat = (done) => sbFetch('/rest/v1/image_job?id=eq.1', {
  method: 'PATCH', headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({ last_beat: new Date().toISOString(), done })
}).catch(() => {});

const release = (note) => sbFetch('/rest/v1/image_job?id=eq.1', {
  method: 'PATCH', headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({ running: false, last_beat: new Date().toISOString(), note: note || null })
}).catch(() => {});

/* ------------------------------ the handoff ------------------------------ */

function selfUrl() {
  // IMAGES_SELF_URL exists so this can be pointed somewhere real in a test or
  // a local run; without it there is no way to exercise the handoff at all.
  if (process.env.IMAGES_SELF_URL) return process.env.IMAGES_SELF_URL;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return host ? `https://${host.replace(/^https?:\/\//, '')}/api/images` : null;
}

/* Start the next invocation and do not wait for it to finish — it will run for
   half a minute and this function is about to end. The short timeout is there
   to guarantee the request was actually dispatched before we return; a
   fire-and-forget with no await at all can be killed before it leaves. */
async function handOff(depth, token) {
  const url = selfUrl();
  if (!url) return { ok: false, why: 'no self URL: VERCEL_URL is not set' };
  try {
    await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: depth + 1, token }), signal: AbortSignal.timeout(1200)
    });
    return { ok: true };
  } catch (e) {
    /* A timeout is the expected outcome and means the request went: the child
       is off resolving and will not answer inside a second. Anything else —
       DNS, connection refused, TLS — means nothing was dispatched and the
       queue has just stalled, which has to be recorded rather than swallowed
       or the whole thing silently stops with no explanation anywhere. */
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return timedOut ? { ok: true } : { ok: false, why: (e && e.message) || String(e) };
  }
}

/* -------------------------------- the work ------------------------------- */

async function progress() {
  return {
    verified: await count('people', 'image_status=eq.verified'),
    needs_review: await count('people', 'image_status=eq.needs_review'),
    missing: await count('people', 'image_status=eq.missing'),
    pending: await count('people', 'image_status=eq.pending')
  };
}

async function runBatch() {
  const rows = await db.select('people',
    'image_status=eq.pending&select=' +
    encodeURIComponent('id,slug,name,wikipedia_url,image_attempts,categories(name,group_name)') +
    `&order=slug&limit=${PER_RUN}`);
  if (!rows.length) return { done: 0, failed: 0, empty: true };

  let done = 0, failed = 0, lastError = null;
  for (let i = 0; i < rows.length; i += CONCURRENT) {
    await Promise.all(rows.slice(i, i + CONCURRENT).map(async (p) => {
      try {
        const r = await resolveImage({
          name: p.name, board: p.categories?.name,
          group: p.categories?.group_name, wikipedia_url: p.wikipedia_url
        });
        await db.update('people', db.eq('id', p.id),
          { ...imageRow(r), image_attempts: (p.image_attempts || 0) + 1 });
        done++;
      } catch (e) {
        /* Wikimedia refusing us is not a verdict about this person, so the row
           is left exactly as it was and a later run tries again. */
        failed++; lastError = e.message;
      }
    }));
    await beat(done);
  }
  return { done, failed, lastError, empty: false };
}

export default webHandler(async function handler(request) {
  if (request.method === 'GET') {
    // Looking, not starting. Safe for anything to poll.
    try {
      const p = await progress();
      const job = await db.one('image_job', 'id=eq.1');
      return json({
        progress: p,
        running: !!job?.running,
        last_beat: job?.last_beat || null,
        note: job?.note || null,
        finished: p.pending === 0
      });
    } catch (e) {
      return json({ error: 'The image columns are not in this database yet. Run ' +
                           'sql/image-columns.sql in the Supabase SQL editor. (' + e.message + ')' }, 400);
    }
  }
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  let depth = 0, token = null;
  try {
    const body = (await request.json().catch(() => ({}))) || {};
    depth = Number(body.chain) || 0;
    token = typeof body.token === 'string' ? body.token : null;
  } catch { /* no body is fine */ }

  /* A run hands the lock to its successor rather than releasing it, so a poke
     arriving mid-chain is turned away instead of starting a second chain
     alongside the first. The token is the current run's started_at, which only
     something holding the lock can have read — the table is service-role only.
     If the successor never arrives, the stale heartbeat frees it anyway. */
  let lock;
  if (depth > 0 && token) {
    const job = await db.one('image_job', 'id=eq.1');
    lock = job && job.running && job.started_at === token ? job : null;
    if (!lock) return json({ started: false, reason: 'stale chain token' });
    await beat(job.done || 0);
  } else {
    lock = await takeLock();
    if (!lock) {
      // Somebody is already draining the queue. Nothing to do, and not an error.
      return json({ started: false, reason: 'already running', progress: await progress() });
    }
  }

  try {
    const batch = await runBatch();
    const p = await progress();

    if (batch.empty || p.pending === 0) {
      await release('finished');
      return json({ started: true, finished: true, progress: p });
    }
    /* Every lookup failing means Wikimedia is refusing this deployment, not
       that these two dozen people are unphotographed. Stop the chain and leave
       the reason where the admin page can show it, rather than grinding
       through 2,900 names against a wall. */
    if (batch.done === 0 && batch.failed > 0) {
      await release('stopped: ' + batch.lastError);
      return json({ started: true, stopped: batch.lastError, progress: p });
    }
    if (depth >= MAX_CHAIN) {
      await release('chain limit reached');
      return json({ started: true, stopped: 'chain limit', progress: p });
    }

    /* Keep the lock and pass it on. If the handoff cannot be made there is
       nothing to inherit it, so release and say why — a stalled queue with no
       explanation is the worst outcome here. */
    const chained = await handOff(depth, lock.started_at);
    if (!chained.ok) {
      await release('could not hand off: ' + chained.why);
      return json({ started: true, resolved: batch.done, failed: batch.failed,
                    chained: false, stopped: chained.why, progress: p });
    }
    return json({ started: true, resolved: batch.done, failed: batch.failed,
                  chained: true, progress: p });
  } catch (e) {
    await release('error: ' + (e?.message || String(e)));
    return json({ started: true, error: e?.message || String(e) }, 500);
  }
});
