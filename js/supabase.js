/* OUTHIRE — Supabase client, shared queries, formatting.
 * Everything on this page is public data read through the anon key under RLS.
 * Nothing here writes to `entries`; the only client write paths are the
 * `clicks` insert and two security-definer RPCs.
 */
(function () {
  'use strict';

  var cfg = window.OUTHIRE_CONFIG || {};
  var configured =
    typeof cfg.SUPABASE_URL === 'string' &&
    cfg.SUPABASE_URL.indexOf('http') === 0 &&
    typeof cfg.SUPABASE_ANON_KEY === 'string' &&
    cfg.SUPABASE_ANON_KEY.length > 20;

  var sb = null;
  if (configured && window.supabase && window.supabase.createClient) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: false }
    });
  }
  var DEMO = !sb;

  /* ---------------------------------------------------------------------
     CATEGORIES — fixed list, mirrored from the database seed so the submit
     form and the filter row work before the first query resolves.
     --------------------------------------------------------------------- */

  var CATEGORIES = [
    { slug: 'engineering', name: 'Engineering' },
    { slug: 'frontend', name: 'Frontend' },
    { slug: 'backend', name: 'Backend' },
    { slug: 'ml-ai', name: 'ML/AI' },
    { slug: 'design', name: 'Design' },
    { slug: 'product', name: 'Product' },
    { slug: 'marketing', name: 'Marketing' },
    { slug: 'growth', name: 'Growth' },
    { slug: 'sales', name: 'Sales' },
    { slug: 'content', name: 'Content' },
    { slug: 'video', name: 'Video' },
    { slug: 'data', name: 'Data' },
    { slug: 'devops', name: 'DevOps' },
    { slug: 'ops', name: 'Ops' },
    { slug: 'founding', name: 'Founding' },
    { slug: 'internship', name: 'Internship' },
    { slug: 'other', name: 'Other' }
  ];

  /* ---------------------------------------------------------------------
     FORMATTING — every numeral on the site goes through one of these.
     --------------------------------------------------------------------- */

  function money(cents) {
    var n = Math.round((cents || 0) / 100);
    return '$' + n.toLocaleString('en-US');
  }

  function moneyExact(cents) {
    var v = (cents || 0) / 100;
    return '$' + v.toLocaleString('en-US', {
      minimumFractionDigits: v % 1 ? 2 : 0,
      maximumFractionDigits: 2
    });
  }

  function int(n) { return (n || 0).toLocaleString('en-US'); }

  // The next action is always one click away: current bid plus one dollar,
  // never below the $5 floor.
  function claimCents(entry) {
    return Math.max(500, (entry && entry.current_bid_cents ? entry.current_bid_cents : 0) + 100);
  }

  function clock(seconds) {
    var s = Math.max(0, Math.round(seconds || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function timeAgo(when) {
    if (!when) return '—';
    var then = when instanceof Date ? when : new Date(when);
    var secs = Math.max(0, (Date.now() - then.getTime()) / 1000);
    if (secs < 60) return Math.floor(secs) + ' sec ago';
    var mins = secs / 60;
    if (mins < 60) return Math.floor(mins) + ' min ago';
    var hrs = mins / 60;
    if (hrs < 48) return Math.floor(hrs) + ' hr ago';
    return Math.floor(hrs / 24) + ' days ago';
  }

  function hoursSince(when) {
    if (!when) return 0;
    var then = when instanceof Date ? when : new Date(when);
    return Math.max(0, Math.floor((Date.now() - then.getTime()) / 3600000));
  }

  // "M hours ago" for the masthead — reads as hours until that stops being sane.
  function sinceLaunch(when) {
    var h = hoursSince(when);
    if (h < 72) return int(h) + ' hours ago';
    return int(Math.floor(h / 24)) + ' days ago';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Only ever emit http(s) hrefs that came out of the database.
  function safeUrl(u) {
    if (!u) return null;
    try {
      var parsed = new URL(String(u).trim(), window.location.origin);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.href;
    } catch (e) { return null; }
  }

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function videoUrl(path) {
    if (!path) return null;
    if (/^https?:\/\//.test(path)) return path;
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.indexOf('http') !== 0) return null;
    return cfg.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/public/videos/' + path;
  }

  function categoryName(entry) {
    if (!entry) return '';
    if (entry.categories && entry.categories.name) return entry.categories.name;
    if (entry.category_name) return entry.category_name;
    return '';
  }

  function categorySlug(entry) {
    if (!entry) return '';
    if (entry.categories && entry.categories.slug) return entry.categories.slug;
    return entry.category_slug || '';
  }

  /* ---------------------------------------------------------------------
     DEMO LEDGER — used until config.js is filled in. Twenty-six entries so
     the feed, the sidebar and the paginated table all have something real to
     lay out against.
     --------------------------------------------------------------------- */

  var DEMO_ROWS = [
    ['Mara Ellison', 'Shipped three production ML pipelines before anyone asked me to.', 'ml-ai', 31200, 1842],
    ['Devon Achebe', 'I rewrote our checkout and cut abandoned carts by a third.', 'frontend', 24400, 1310],
    ['Priya Raghunathan', 'Twelve years of infrastructure. Zero pages last quarter.', 'devops', 18900, 1122],
    ['Tomas Lindqvist', 'I design the boring screens nobody wants and users never notice.', 'design', 15100, 980],
    ['Adaeze Nwosu', 'Went from support tickets to owning the roadmap in eighteen months.', 'product', 12600, 903],
    ['Jonah Feldman', 'I make databases go fast. That is the entire pitch.', 'backend', 11000, 861],
    ['Sasha Petrov', 'Built the growth loop that took us from 4k to 90k users.', 'growth', 9800, 774],
    ['Liana Costa', 'I close enterprise deals without a single discount.', 'sales', 8700, 690],
    ['Kwame Osei', 'Founding engineer twice. Both are still running.', 'founding', 7600, 655],
    ['Ines Moreau', 'I turn messy warehouses into dashboards executives actually open.', 'data', 6900, 601],
    ['Ravi Chandran', 'Two years of platform work, one on-call rotation I fixed for good.', 'engineering', 6100, 544],
    ['Noor Haddad', 'I write the docs your engineers keep bookmarking.', 'content', 5400, 498],
    ['Elliot Vance', 'Edited 400 short videos last year. Here is the four-hundred-and-first.', 'video', 4900, 452],
    ['Bea Sørensen', 'I run ops for a 60-person team on a spreadsheet and stubbornness.', 'ops', 4300, 410],
    ['Marcus Idowu', 'Performance marketing at a 2.1x blended ROAS for nine straight months.', 'marketing', 3800, 366],
    ['Yuki Tanabe', 'I am a designer who ships their own code.', 'design', 3300, 322],
    ['Hana Bergström', 'Backend, mostly Go, mostly at three in the morning when it matters.', 'backend', 2900, 288],
    ['Diego Salas', 'I have onboarded 200 customers and lost four.', 'sales', 2500, 251],
    ['Ola Adeyemi', 'Six months into my first ML role and already on the eval team.', 'ml-ai', 2100, 219],
    ['Freya Nolan', 'Internship season. I built the thing in the video over one weekend.', 'internship', 1700, 190],
    ['Sam Okonkwo', 'I fix frontends other people gave up on.', 'frontend', 1400, 162],
    ['Camille Duret', 'Product analytics, SQL, and a refusal to ship vanity metrics.', 'data', 1100, 137],
    ['Theo Marchetti', 'I do the unglamorous half of DevOps: the runbooks.', 'devops', 900, 114],
    ['Nia Whitfield', 'Content strategy for companies that think they hate content.', 'content', 700, 88],
    ['Arun Belur', 'Career switcher. Third video, first one I would show my mother.', 'other', 600, 61],
    ['Petra Kovac', 'I have been a PM at two startups that failed and I know exactly why.', 'product', 500, 34]
  ];

  function buildDemo() {
    var now = Date.now();
    return DEMO_ROWS.map(function (r, i) {
      var cat = CATEGORIES.filter(function (c) { return c.slug === r[2]; })[0] || CATEGORIES[16];
      var slug = r[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + (i + 1);
      // A slice of the demo ledger also sits on the demo recruiter board, so
      // board.html has something to render before the database is wired up.
      var onBoard = [1, 3, 6, 9, 14, 20].indexOf(i) !== -1;
      return {
        id: 'demo-' + (i + 1),
        slug: slug,
        board_id: onBoard ? 'demo-board' : null,
        display_name: r[0],
        headline: r[1],
        portfolio_url: 'https://example.com/' + slug,
        linkedin_url: 'https://www.linkedin.com/in/' + slug,
        video_path: null,
        video_duration: 30 + (i % 15),
        current_bid_cents: r[3],
        click_count: r[4],
        view_count: r[4] * 7 + 300,
        status: 'live',
        created_at: new Date(now - (i + 2) * 7200000).toISOString(),
        last_bid_at: new Date(now - (i * 41 + 6) * 60000).toISOString(),
        categories: { slug: cat.slug, name: cat.name }
      };
    });
  }

  var demoEntries = DEMO ? buildDemo() : [];
  var demoStats = {
    total_revenue_cents: demoEntries.reduce(function (a, e) { return a + e.current_bid_cents; }, 0),
    visit_count: 14208,
    launched_at: new Date(Date.now() - 61 * 3600000).toISOString()
  };

  function rankSort(a, b) {
    if (b.current_bid_cents !== a.current_bid_cents) return b.current_bid_cents - a.current_bid_cents;
    var al = a.last_bid_at ? Date.parse(a.last_bid_at) : Infinity;
    var bl = b.last_bid_at ? Date.parse(b.last_bid_at) : Infinity;
    if (al !== bl) return al - bl;          // earlier bid holds the rank on a tie
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  }

  function newestSort(a, b) {
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  }

  function startOfToday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  /* ---------------------------------------------------------------------
     QUERIES
     --------------------------------------------------------------------- */

  var SELECT =
    'id,slug,board_id,display_name,headline,portfolio_url,linkedin_url,' +
    'video_path,video_duration,current_bid_cents,click_count,view_count,' +
    'status,created_at,last_bid_at,categories(slug,name)';

  /**
   * listEntries — the one query the feed, the sidebar, the table and the
   * recruiter board all share.
   * @param {{scope?:'all'|'today', category?:string, boardId?:string|null,
   *          sort?:'bid'|'new', limit?:number, offset?:number}} opts
   * @returns {Promise<{rows:Array, total:number, offset:number}>}
   */
  async function listEntries(opts) {
    var o = opts || {};
    var limit = o.limit || 50;
    var offset = o.offset || 0;
    var sort = o.sort === 'new' ? 'new' : 'bid';

    if (DEMO) {
      var rows = demoEntries.slice();
      if (o.boardId) rows = rows.filter(function (e) { return e.board_id === o.boardId; });
      else if (o.boardId === null && o.globalOnly) rows = rows.filter(function (e) { return !e.board_id; });
      if (o.category) rows = rows.filter(function (e) { return categorySlug(e) === o.category; });
      if (o.scope === 'today') {
        var t = Date.parse(startOfToday());
        rows = rows.filter(function (e) { return e.last_bid_at && Date.parse(e.last_bid_at) >= t; });
      }
      rows.sort(sort === 'new' ? newestSort : rankSort);
      return { rows: rows.slice(offset, offset + limit), total: rows.length, offset: offset };
    }

    var q = sb.from('entries').select(SELECT, { count: 'exact' }).eq('status', 'live');

    if (o.boardId) q = q.eq('board_id', o.boardId);
    else if (o.globalOnly) q = q.is('board_id', null);

    if (o.category) {
      var cat = await categoryIdBySlug(o.category);
      if (!cat) return { rows: [], total: 0, offset: offset };
      q = q.eq('category_id', cat);
    }
    if (o.scope === 'today') q = q.gte('last_bid_at', startOfToday());

    if (sort === 'new') {
      q = q.order('created_at', { ascending: false });
    } else {
      q = q.order('current_bid_cents', { ascending: false })
           .order('last_bid_at', { ascending: true, nullsFirst: false })
           .order('created_at', { ascending: true });
    }

    var res = await q.range(offset, offset + limit - 1);
    if (res.error) throw res.error;
    return { rows: res.data || [], total: res.count == null ? (res.data || []).length : res.count, offset: offset };
  }

  var catIdCache = null;
  async function categoryIdBySlug(slug) {
    if (DEMO) return slug;
    if (!catIdCache) {
      var r = await sb.from('categories').select('id,slug');
      catIdCache = {};
      (r.data || []).forEach(function (c) { catIdCache[c.slug] = c.id; });
    }
    return catIdCache[slug] || null;
  }

  async function categories() {
    if (DEMO) return CATEGORIES.slice();
    var r = await sb.from('categories').select('slug,name,sort_order').order('sort_order');
    if (r.error || !r.data || !r.data.length) return CATEGORIES.slice();
    return r.data;
  }

  async function getEntry(slug) {
    if (DEMO) {
      return demoEntries.filter(function (e) { return e.slug === slug; })[0] || null;
    }
    var r = await sb.from('entries').select(SELECT).eq('slug', slug).maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  }

  /** Global rank of one entry within its board (or the global feed). */
  async function rankOf(entry) {
    if (!entry) return null;
    if (DEMO) {
      var pool = demoEntries.filter(function (e) { return e.board_id === entry.board_id; }).sort(rankSort);
      return pool.findIndex(function (e) { return e.id === entry.id; }) + 1;
    }
    var q = sb.from('entries').select('id', { count: 'exact', head: true })
      .eq('status', 'live')
      .gt('current_bid_cents', entry.current_bid_cents || 0);
    q = entry.board_id ? q.eq('board_id', entry.board_id) : q.is('board_id', null);
    var r = await q;
    if (r.error) return null;
    return (r.count || 0) + 1;
  }

  async function getBoardByToken(token) {
    if (!token) return null;
    if (DEMO) {
      return {
        id: 'demo-board',
        share_token: token,
        company_name: 'Northgate Systems',
        role_title: 'Senior Frontend Engineer',
        job_url: 'https://example.com/jobs/senior-frontend',
        created_at: new Date(Date.now() - 26 * 3600000).toISOString()
      };
    }
    var r = await sb.from('boards').select('*').eq('share_token', token).maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  }

  async function stats() {
    if (DEMO) return demoStats;
    var r = await sb.from('site_stats')
      .select('total_revenue_cents,visit_count,launched_at').eq('id', 1).maybeSingle();
    if (r.error || !r.data) return { total_revenue_cents: 0, visit_count: 0, launched_at: null };
    return r.data;
  }

  /** Last N bids for the activity feed, joined to the entry they landed on. */
  async function recentBids(n) {
    var limit = n || 10;
    if (DEMO) {
      return demoEntries.slice().sort(function (a, b) {
        return Date.parse(b.last_bid_at) - Date.parse(a.last_bid_at);
      }).slice(0, limit).map(function (e, i) {
        return {
          id: 'demo-bid-' + i,
          amount_cents: e.current_bid_cents,
          created_at: e.last_bid_at,
          entries: e
        };
      });
    }
    var r = await sb.from('bids')
      .select('id,amount_cents,created_at,entries(slug,display_name,current_bid_cents,status,categories(name))')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (r.error) throw r.error;
    return (r.data || []).filter(function (b) { return b.entries && b.entries.status === 'live'; });
  }

  /** Realtime bids. Returns an unsubscribe function. */
  function onBid(handler) {
    if (DEMO || !sb) return function () {};
    var ch = sb.channel('bids-activity').on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'bids' },
      function (payload) { handler(payload.new); }
    ).subscribe();
    return function () { sb.removeChannel(ch); };
  }

  /* --------------------------- writes (the only three) ------------------ */

  function logClick(entryId) {
    if (DEMO || !sb || !entryId) return Promise.resolve();
    return sb.from('clicks').insert({ entry_id: entryId }).then(function () {}, function () {});
  }

  function recordView(entryId) {
    if (DEMO || !sb || !entryId) return Promise.resolve();
    return sb.rpc('record_view', { entry: entryId }).then(function () {}, function () {});
  }

  // One visit per browser session, so the masthead counts people not page loads.
  async function recordVisit() {
    if (DEMO) return demoStats.visit_count;
    if (!sb) return 0;
    try {
      if (sessionStorage.getItem('oh_visit') === '1') {
        var s = await stats();
        return s.visit_count || 0;
      }
      sessionStorage.setItem('oh_visit', '1');
    } catch (e) { /* private mode: count the visit anyway */ }
    var r = await sb.rpc('record_visit');
    if (r.error) { var s2 = await stats(); return s2.visit_count || 0; }
    return r.data || 0;
  }

  /* --------------------------- API helper ------------------------------- */

  async function api(path, body) {
    var res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      var msg = (data && data.error) || ('Request failed with status ' + res.status + '.');
      throw new Error(msg);
    }
    return data;
  }

  /* The feed is a full-viewport scroll-snap column sitting under the masthead.
     Measure the masthead so the first entry lands whole instead of being cut
     off by its height. */
  function fitStage() {
    var head = document.querySelector('.masthead');
    var stage = document.querySelector('.stage');
    if (!head || !stage) return;
    var apply = function () {
      document.documentElement.style.setProperty(
        '--masthead', Math.round(head.getBoundingClientRect().height) + 'px');
    };
    apply();
    if (window.ResizeObserver) new ResizeObserver(apply).observe(head);
    window.addEventListener('resize', apply);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(apply);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fitStage);
  else fitStage();

  window.OH = {
    sb: sb, DEMO: DEMO, CATEGORIES: CATEGORIES,
    money: money, moneyExact: moneyExact, int: int, claimCents: claimCents,
    clock: clock, timeAgo: timeAgo, hoursSince: hoursSince, sinceLaunch: sinceLaunch,
    esc: esc, safeUrl: safeUrl, qs: qs, videoUrl: videoUrl,
    categoryName: categoryName, categorySlug: categorySlug,
    listEntries: listEntries, categories: categories, getEntry: getEntry, rankOf: rankOf,
    getBoardByToken: getBoardByToken, stats: stats, recentBids: recentBids, onBid: onBid,
    logClick: logClick, recordView: recordView, recordVisit: recordVisit, api: api,
    fitStage: fitStage
  };
})();
