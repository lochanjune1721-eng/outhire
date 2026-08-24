/* outbid.lol — Supabase client, shared queries, formatting.
 * Everything here is public data read with the anon key under RLS. The only
 * client writes are the `clicks` insert and the record_visit() RPC.
 * Candidate emails are not selectable with this key -- see sql/schema.sql. */
(function () {
  'use strict';

  var cfg = window.OUTBID_CONFIG || {};
  var configured =
    typeof cfg.SUPABASE_URL === 'string' && cfg.SUPABASE_URL.indexOf('http') === 0 &&
    typeof cfg.SUPABASE_ANON_KEY === 'string' && cfg.SUPABASE_ANON_KEY.length > 20;

  var sb = null;
  if (configured && window.supabase && window.supabase.createClient) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }
  var OFFLINE = !sb;

  /* --------------------------------------------------------------------
     CATEGORIES — fixed list, so the board does not fragment into
     near-duplicate roles.
     -------------------------------------------------------------------- */

  var CATEGORIES = [
    'SEO', 'Agents', 'AI Media', 'Marketing', 'Developer', 'Productivity',
    'People', 'Design', 'Engineering', 'Data', 'Sales', 'Content',
    'Product', 'Growth', 'Ops', 'Founding', 'Internship', 'Other'
  ];

  /* --------------------------------------------------------------------
     JOB SOURCE WHITELIST — mirrored in api/parse-job.js, which is the
     copy that actually gates board creation. This one only gives the user
     an answer before a round trip.
     -------------------------------------------------------------------- */

  var JOB_HOSTS = [
    'linkedin.com', 'wellfound.com', 'angel.co', 'workatastartup.com',
    'lever.co', 'greenhouse.io', 'ashbyhq.com', 'workable.com', 'breezy.hr',
    'indeed.com', 'glassdoor.com', 'naukri.com', 'instahyre.com', 'cutshort.io'
  ];

  function jobHostAllowed(raw) {
    var u = safeUrl(raw);
    if (!u) return false;
    var host;
    try { host = new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return false; }
    return JOB_HOSTS.some(function (h) { return host === h || host.endsWith('.' + h); });
  }

  /* --------------------------------------------------------------------
     FORMATTING
     -------------------------------------------------------------------- */

  function money(cents) { return '$' + Math.round((cents || 0) / 100).toLocaleString('en-US'); }
  function int(n) { return (n || 0).toLocaleString('en-US'); }

  // Claim price for a row: its bid plus a dollar, never below the $5 floor.
  function claimCents(entry) {
    return Math.max(500, (entry && entry.current_bid_cents ? entry.current_bid_cents : 0) + 100);
  }

  function timeAgo(when) {
    if (!when) return 'just now';
    var secs = Math.max(0, (Date.now() - new Date(when).getTime()) / 1000);
    if (secs < 60) return Math.floor(secs) + 's ago';
    var m = secs / 60; if (m < 60) return Math.floor(m) + 'm ago';
    var h = m / 60; if (h < 24) return Math.floor(h) + 'h ago';
    var d = h / 24; if (d < 30) return Math.floor(d) + 'd ago';
    return Math.floor(d / 30) + 'mo ago';
  }

  function longAgo(when) {
    if (!when) return 'just now';
    var mins = Math.max(0, (Date.now() - new Date(when).getTime()) / 60000);
    if (mins < 1) return 'seconds ago';
    if (mins < 60) return Math.floor(mins) + (Math.floor(mins) === 1 ? ' minute ago' : ' minutes ago');
    var h = mins / 60;
    if (h < 24) return Math.floor(h) + (Math.floor(h) === 1 ? ' hour ago' : ' hours ago');
    var d = Math.floor(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Only ever emit http(s) hrefs.
  function safeUrl(u) {
    if (!u) return null;
    var s = String(u).trim();
    if (!/^https?:\/\//i.test(s)) {
      if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) s = 'https://' + s;
      else return null;
    }
    try {
      var p = new URL(s);
      if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
      return p.href;
    } catch (e) { return null; }
  }

  function domainOf(u) {
    var s = safeUrl(u);
    if (!s) return '';
    try { return new URL(s).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function qs(name) { return new URLSearchParams(window.location.search).get(name); }

  function photoUrl(path) {
    if (!path) return null;
    if (/^https?:\/\//.test(path)) return path;
    if (!configured) return null;
    return cfg.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/public/photos/' + path;
  }

  /* --------------------------------------------------------------------
     VIDEO — thumbnail first, iframe only on click. Forty iframes on one
     page is what makes a board like this crawl.
     -------------------------------------------------------------------- */

  function parseVideo(raw) {
    var u = safeUrl(raw);
    if (!u) return null;
    var yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
    if (yt) return { platform: 'youtube', id: yt[1] };
    var vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vm) return { platform: 'vimeo', id: vm[1] };
    return null;
  }

  function videoThumb(v) {
    if (!v) return null;
    if (v.platform === 'youtube') return 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg';
    return null;  // Vimeo needs an oEmbed lookup; resolved lazily by board.js
  }

  function videoEmbed(v) {
    if (!v) return null;
    if (v.platform === 'youtube') return 'https://www.youtube-nocookie.com/embed/' + v.id + '?autoplay=1&rel=0';
    return 'https://player.vimeo.com/video/' + v.id + '?autoplay=1';
  }

  var vimeoCache = {};
  async function vimeoThumb(id) {
    if (vimeoCache[id] !== undefined) return vimeoCache[id];
    try {
      var r = await fetch('https://vimeo.com/api/oembed.json?url=' +
        encodeURIComponent('https://vimeo.com/' + id) + '&width=640');
      if (!r.ok) throw new Error('oembed');
      var j = await r.json();
      vimeoCache[id] = j.thumbnail_url || null;
    } catch (e) { vimeoCache[id] = null; }
    return vimeoCache[id];
  }

  /* --------------------------------------------------------------------
     THE ONE SEED ENTRY — also the offline fallback, so the page renders
     truthfully before Supabase is wired up. No invented candidates.
     -------------------------------------------------------------------- */

  var SEED = {
    id: 'seed-lochan',
    slug: 'lochan',
    side: 'candidate',
    board_id: null,
    display_name: 'Lochan',
    headline: 'REPLACE ME: one line on why you should be hired.',
    url: 'https://lochan-maru.vercel.app',
    photo_path: 'seed/lochan.jpg',
    video_url: null,
    video_platform: null,
    category: 'Engineering',
    current_bid_cents: 500,
    click_count: 0,
    status: 'live',
    created_at: new Date().toISOString(),
    last_bid_at: new Date().toISOString()
  };

  /* --------------------------------------------------------------------
     QUERIES
     -------------------------------------------------------------------- */

  var COLS =
    'id,slug,side,board_id,display_name,headline,url,photo_path,video_url,' +
    'video_platform,category,current_bid_cents,click_count,status,created_at,last_bid_at';

  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }

  /**
   * listEntries — one query behind the homepage board, the role boards and
   * the recruiter dashboard.
   * @param {{side?:string, boardId?:string, homepageOnly?:boolean, category?:string,
   *          scope?:'all'|'today', sort?:'bid'|'new', limit?:number, offset?:number}} o
   */
  async function listEntries(o) {
    o = o || {};
    var limit = o.limit || 50, offset = o.offset || 0;
    var sort = o.sort === 'new' ? 'new' : 'bid';

    if (OFFLINE) {
      var rows = [SEED].filter(function (e) {
        if (o.boardId) return false;                       // no offline boards
        if (o.homepageOnly && e.board_id) return false;
        if (o.side && e.side !== o.side) return false;
        if (o.category && e.category !== o.category) return false;
        if (o.scope === 'today' && (!e.last_bid_at || e.last_bid_at < startOfToday())) return false;
        return true;
      });
      return { rows: rows.slice(offset, offset + limit), total: rows.length, offset: offset };
    }

    var q = sb.from('entries').select(COLS, { count: 'exact' }).eq('status', 'live');
    if (o.boardId) q = q.eq('board_id', o.boardId);
    else if (o.homepageOnly) q = q.is('board_id', null);
    if (o.side) q = q.eq('side', o.side);
    if (o.category) q = q.eq('category', o.category);
    if (o.scope === 'today') q = q.gte('last_bid_at', startOfToday());

    if (sort === 'new') {
      q = q.order('created_at', { ascending: false });
    } else {
      q = q.order('current_bid_cents', { ascending: false })
           .order('last_bid_at', { ascending: true, nullsFirst: false })
           .order('created_at', { ascending: true });
    }

    var r = await q.range(offset, offset + limit - 1);
    if (r.error) throw r.error;
    return { rows: r.data || [], total: r.count == null ? (r.data || []).length : r.count, offset: offset };
  }

  async function getEntry(slug) {
    if (OFFLINE) return slug === SEED.slug ? SEED : null;
    var r = await sb.from('entries').select(COLS).eq('slug', slug).maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  }

  async function getBoard(slug) {
    if (OFFLINE || !slug) return null;
    var r = await sb.from('boards').select('*').eq('slug', slug).maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  }

  async function stats() {
    if (OFFLINE) return { total_revenue_cents: 500, visitor_count: 0, launched_at: null };
    var r = await sb.from('site_stats')
      .select('total_revenue_cents,visitor_count,launched_at').eq('id', 1).maybeSingle();
    return (r.data) || { total_revenue_cents: 0, visitor_count: 0, launched_at: null };
  }

  async function recentBids(n) {
    if (OFFLINE) return [];
    var r = await sb.from('bids')
      .select('id,amount_cents,created_at,entries(slug,display_name,category,status,current_bid_cents)')
      .order('created_at', { ascending: false }).limit(n || 10);
    if (r.error) throw r.error;
    return (r.data || []).filter(function (b) { return b.entries && b.entries.status === 'live'; });
  }

  function onBid(handler) {
    if (OFFLINE) return function () {};
    var ch = sb.channel('bids-activity').on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'bids' },
      function (p) { handler(p.new); }).subscribe();
    return function () { sb.removeChannel(ch); };
  }

  function logClick(entryId) {
    if (OFFLINE || !entryId || String(entryId).indexOf('seed-') === 0) return Promise.resolve();
    return sb.from('clicks').insert({ entry_id: entryId }).then(function () {}, function () {});
  }

  async function recordVisit() {
    if (OFFLINE) return 0;
    try {
      if (sessionStorage.getItem('ob_visit') === '1') return (await stats()).visitor_count || 0;
      sessionStorage.setItem('ob_visit', '1');
    } catch (e) { /* private mode */ }
    var r = await sb.rpc('record_visit');
    if (r.error) return (await stats()).visitor_count || 0;
    return r.data || 0;
  }

  async function api(path, body) {
    var res = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.error) || ('Request failed (' + res.status + ').'));
    return data;
  }

  /* --------------------------------------------------------------------
     THEME
     -------------------------------------------------------------------- */

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('ob_theme'); } catch (e) {}
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-theme-toggle]') : null;
      if (!b) return;
      var now = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', now);
      try { localStorage.setItem('ob_theme', now); } catch (err) {}
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTheme);
  else initTheme();

  window.OB = {
    sb: sb, OFFLINE: OFFLINE, CATEGORIES: CATEGORIES, JOB_HOSTS: JOB_HOSTS, SEED: SEED,
    jobHostAllowed: jobHostAllowed,
    money: money, int: int, claimCents: claimCents, timeAgo: timeAgo, longAgo: longAgo,
    esc: esc, safeUrl: safeUrl, domainOf: domainOf, qs: qs, photoUrl: photoUrl,
    parseVideo: parseVideo, videoThumb: videoThumb, videoEmbed: videoEmbed, vimeoThumb: vimeoThumb,
    listEntries: listEntries, getEntry: getEntry, getBoard: getBoard,
    stats: stats, recentBids: recentBids, onBid: onBid,
    logClick: logClick, recordVisit: recordVisit, api: api
  };
})();
