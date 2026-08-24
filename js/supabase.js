/* GOAT.lol — client, auth, shared queries, formatting, and the header shell.
 *
 * The client never writes a balance. It reads public tables under RLS and
 * calls exactly four RPCs: me(), set_profile(), place_bid(), add_person().
 */
(function () {
  'use strict';

  var cfg = window.GOAT_CONFIG || {};
  var configured =
    typeof cfg.SUPABASE_URL === 'string' && cfg.SUPABASE_URL.indexOf('http') === 0 &&
    typeof cfg.SUPABASE_ANON_KEY === 'string' && cfg.SUPABASE_ANON_KEY.length > 20;

  var libLoaded = !!(window.supabase && window.supabase.createClient);

  var sb = null;
  if (configured && libLoaded) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }
  var OFFLINE = !sb;

  /* Two very different problems used to produce the same sentence, which sent
     you to edit a config file that was already correct. */
  function offlineMessage() {
    if (!configured) {
      return 'Supabase is not configured. Fill in js/config.js, run sql/schema.sql, then seed.';
    }
    if (!libLoaded) {
      return 'The Supabase library did not load. Check the CDN script tag, and any network or content blocker.';
    }
    return 'Supabase is unavailable.';
  }

  var TOPUPS = [500, 1000, 2500, 5000, 10000];

  /* ------------------------------ format --------------------------------- */

  function money(cents) { return '$' + Math.round((cents || 0) / 100).toLocaleString('en-US'); }
  function int(n) { return (n || 0).toLocaleString('en-US'); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeUrl(u) {
    if (!u) return null;
    try {
      var p = new URL(String(u).trim());
      return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : null;
    } catch (e) { return null; }
  }

  function ago(when) {
    if (!when) return 'just now';
    var s = Math.max(0, (Date.now() - new Date(when).getTime()) / 1000);
    if (s < 60) return 'seconds ago';
    var m = s / 60;
    if (m < 60) return Math.floor(m) + (Math.floor(m) === 1 ? ' minute ago' : ' minutes ago');
    var h = m / 60;
    if (h < 24) return Math.floor(h) + (Math.floor(h) === 1 ? ' hour ago' : ' hours ago');
    var d = Math.floor(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  function qs(n) { return new URLSearchParams(window.location.search).get(n); }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w[0]; }).join('').toUpperCase() || '?';
  }

  function photoUrl(path) {
    if (!path) return null;
    if (/^https?:\/\//.test(path)) return path;
    if (!configured) return null;
    return cfg.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/public/photos/' + path;
  }

  /* Every photo goes through here, so the treatment is impossible to skip.
     A missing photo renders initials, which has to look deliberate. */
  function photo(person, opts) {
    opts = opts || {};
    var url = photoUrl(person && person.photo_path);
    var cls = 'ph' + (opts.plain ? ' plain' : '') + (opts.className ? ' ' + opts.className : '');
    // Carry the slug so a picture resolved later can find its own box.
    var mark = person && person.slug ? ' data-slug="' + esc(person.slug) + '"' : '';
    var cap = opts.caption ? '<span class="cap">' + esc(opts.caption) + '</span>' : '';
    var inner = url
      ? '<img src="' + esc(url) + '" alt="' + esc(person.name || '') + '" loading="lazy" decoding="async" ' +
        'onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),' +
        '{className:\'initials\',textContent:this.dataset.i}))" data-i="' + esc(initials(person.name)) + '">'
      : '<div class="initials">' + esc(initials(person && person.name)) + '</div>';
    return '<div class="' + cls + '"' + mark + (opts.style ? ' style="' + opts.style + '"' : '') + '>' + inner + cap + '</div>';
  }

  function fanName(u) {
    if (!u) return 'anonymous';
    if (u.is_anonymous) return 'anonymous';
    var n = (u.display_name || '').trim();
    if (!n) return 'anonymous';
    return n.charAt(0) === '@' ? n : '@' + n;
  }

  /* ------------------------------ queries -------------------------------- */

  var PCOLS = 'id,slug,category_id,name,blurb,wikipedia_url,photo_path,photo_credit,' +
              'photo_license,total_cents,backer_count,first_backed_at,created_at';

  async function categories() {
    if (OFFLINE) return [];
    var r = await sb.from('categories').select('*').order('sort_order');
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function category(slug) {
    if (OFFLINE) return null;
    var r = await sb.from('categories').select('*').eq('slug', slug).maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  }

  /** Ranked people. Rank is the money: total_cents desc, first_backed_at asc. */
  async function people(categoryId, limit, offset) {
    if (OFFLINE) return { rows: [], total: 0 };
    var r = await sb.from('people').select(PCOLS, { count: 'exact' })
      .eq('category_id', categoryId)
      .order('total_cents', { ascending: false })
      .order('first_backed_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .range(offset || 0, (offset || 0) + (limit || 100) - 1);
    if (r.error) throw r.error;
    return { rows: r.data || [], total: r.count || 0 };
  }

  async function person(slug) {
    if (OFFLINE) return null;
    var r = await sb.from('people').select(PCOLS + ',categories(slug,name,group_name)')
      .eq('slug', slug).maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  }

  /** Top backers of one person. */
  async function fansOf(personId, limit) {
    if (OFFLINE) return [];
    var r = await sb.from('fan_totals')
      .select('total_cents,users(id,display_name,is_anonymous)')
      .eq('person_id', personId)
      .order('total_cents', { ascending: false })
      .limit(limit || 20);
    if (r.error) throw r.error;
    return r.data || [];
  }

  /** Top backers across the whole site. */
  async function topFans(limit) {
    if (OFFLINE) return [];
    var r = await sb.from('users')
      .select('id,display_name,is_anonymous,total_spent_cents')
      .gt('total_spent_cents', 0)
      .order('total_spent_cents', { ascending: false })
      .limit(limit || 100);
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function recentBids(limit) {
    if (OFFLINE) return [];
    var r = await sb.from('bids')
      .select('id,amount_cents,created_at,users(display_name,is_anonymous),' +
              'people(slug,name,categories(slug,name))')
      .order('created_at', { ascending: false }).limit(limit || 12);
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function backedToday() {
    if (OFFLINE) return 0;
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var r = await sb.from('bids').select('amount_cents').gte('created_at', d.toISOString());
    if (r.error) return 0;
    return (r.data || []).reduce(function (a, b) { return a + (b.amount_cents || 0); }, 0);
  }

  async function stats() {
    if (OFFLINE) return { visitor_count: 0, launched_at: null };
    var r = await sb.from('site_stats').select('visitor_count,launched_at').eq('id', 1).maybeSingle();
    return r.data || { visitor_count: 0, launched_at: null };
  }

  async function search(term) {
    if (OFFLINE || !term || term.length < 2) return [];
    var r = await sb.from('people').select('slug,name,photo_path,total_cents,categories(name)')
      .ilike('name', '%' + term + '%')
      .order('total_cents', { ascending: false }).limit(8);
    return r.data || [];
  }

  function onBid(handler) {
    if (OFFLINE) return function () {};
    var ch = sb.channel('bid-feed').on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'bids' },
      function (p) { handler(p.new); }).subscribe();
    return function () { sb.removeChannel(ch); };
  }

  async function recordVisit() {
    if (OFFLINE) return 0;
    try {
      if (sessionStorage.getItem('goat_visit') === '1') return (await stats()).visitor_count || 0;
      sessionStorage.setItem('goat_visit', '1');
    } catch (e) {}
    var r = await sb.rpc('record_visit');
    return r.error ? 0 : (r.data || 0);
  }

  /* ------------------------------- auth ---------------------------------- */

  var ME = null;
  var meListeners = [];

  function onMe(fn) { meListeners.push(fn); if (ME !== null) fn(ME); }
  function emitMe() { meListeners.forEach(function (f) { try { f(ME); } catch (e) {} }); }

  async function refreshMe() {
    if (OFFLINE) { ME = null; emitMe(); return null; }
    var s = await sb.auth.getSession();
    if (!s.data.session) { ME = null; emitMe(); return null; }
    var r = await sb.rpc('me');
    ME = r.error ? null : r.data;
    emitMe();
    return ME;
  }

  async function signIn(email) {
    if (OFFLINE) throw new Error(offlineMessage());
    var r = await sb.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: window.location.origin + '/wallet.html' }
    });
    if (r.error) throw r.error;
  }

  async function signOut() { if (sb) await sb.auth.signOut(); ME = null; emitMe(); }

  /* --------------------------- the four RPCs ------------------------------ */

  async function placeBid(personId, cents) {
    if (OFFLINE) throw new Error(offlineMessage());
    var r = await sb.rpc('place_bid', { p_person: personId, p_amount: cents });
    if (r.error) throw new Error(cleanPgError(r.error.message));
    if (ME) { ME.balance_cents = r.data.balance_cents; emitMe(); }
    return r.data;
  }

  async function addPerson(categorySlug, name, wikipediaUrl, blurb) {
    if (OFFLINE) throw new Error(offlineMessage());
    var r = await sb.rpc('add_person', {
      p_category: categorySlug, p_name: name, p_wikipedia_url: wikipediaUrl, p_blurb: blurb || null
    });
    if (r.error) throw new Error(cleanPgError(r.error.message));
    await refreshMe();
    return r.data;
  }

  async function setProfile(name, anonymous) {
    var r = await sb.rpc('set_profile', { p_name: name, p_anonymous: !!anonymous });
    if (r.error) throw new Error(cleanPgError(r.error.message));
    ME = r.data; emitMe();
    return ME;
  }

  // Postgres prefixes raised messages; the message itself is already written
  // for a person to read, so strip the wrapper rather than replacing it.
  function cleanPgError(msg) {
    return String(msg || 'That did not work.')
      .replace(/^.*?(?:ERROR|error):\s*/, '')
      .replace(/^P0001:\s*/, '').trim();
  }

  async function api(path, body) {
    var res = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || ('Request failed (' + res.status + ').'));
    return data;
  }

  /* Turn a Supabase failure into the sentence that tells you what to do.
     These are the three states a fresh deploy actually lands in. */
  function explain(err) {
    var msg = (err && (err.message || err.error_description || err.error)) || String(err || '');
    if (/does not exist|42P01|schema cache|Could not find the table/i.test(msg)) {
      return 'The database has no tables yet. Run sql/schema.sql in the Supabase SQL editor, then seed.';
    }
    if (/Failed to fetch|NetworkError|load failed|ERR_|fetch failed/i.test(msg)) {
      return 'Could not reach Supabase. Check SUPABASE_URL in js/config.js and that the project is not paused.';
    }
    if (/JWT|api ?key|401|Unauthorized|invalid claim/i.test(msg)) {
      return 'Supabase rejected the anon key. If you rotated your keys, put the new anon key in js/config.js.';
    }
    return msg || 'Something went wrong talking to the database.';
  }

  /* Render that diagnostic where the page would otherwise sit on "Loading". */
  function showError(selector, err) {
    var host = document.querySelector(selector);
    if (host) host.innerHTML = '<p class="empty">' + esc(explain(err)) + '</p>';
    console.error('[goat]', err);
  }

  /* --------------------------- header shell ------------------------------- */
  /* One definition, so the balance really is on every page. */

  function mountHeader(current) {
    var host = document.querySelector('[data-header]');
    if (!host) return;
    host.innerHTML =
      '<div class="wrap"><div class="topbar">' +
        '<a class="logo" href="/">GOAT<span>.lol</span></a>' +
        '<div class="search">' +
          '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>' +
            '<path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
          '<label class="sr-only" for="site-search">Search people</label>' +
          '<input id="site-search" type="text" placeholder="Search anyone" autocomplete="off">' +
          '<div class="results hide" id="search-results"></div>' +
        '</div>' +
        '<nav class="navlinks" aria-label="Primary">' +
          '<a href="/#categories"' + (current === 'categories' ? ' aria-current="page"' : '') + '>Categories</a>' +
          '<a href="/fans.html"' + (current === 'fans' ? ' aria-current="page"' : '') + '>Fans</a>' +
          '<a href="/about.html"' + (current === 'about' ? ' aria-current="page"' : '') + '>About</a>' +
        '</nav>' +
        '<span class="balance" id="balance-pill">' +
          '<b class="num" id="balance-amount">$0</b>' +
          '<a class="btn btn-sm btn-gold" href="/wallet.html">Add</a>' +
        '</span>' +
      '</div></div>';

    onMe(function (me) {
      var amt = document.getElementById('balance-amount');
      if (!amt) return;
      amt.textContent = me ? money(me.balance_cents) : '$0';
      var pill = document.getElementById('balance-pill');
      var link = pill.querySelector('a');
      link.textContent = me ? 'Add' : 'Sign in';
    });

    // search
    var input = document.getElementById('site-search');
    var box = document.getElementById('search-results');
    var t = null;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(async function () {
        var rows = await search(input.value.trim());
        if (!rows.length) { box.classList.add('hide'); box.innerHTML = ''; return; }
        box.innerHTML = rows.map(function (p) {
          return '<a href="/person.html?slug=' + esc(p.slug) + '">' +
            photo(p, { plain: true }) +
            '<span style="flex:1;min-width:0">' + esc(p.name) +
              '<span class="muted" style="display:block;font-size:12px">' +
                esc(p.categories ? p.categories.name : '') + '</span></span>' +
            '<span class="num gold">' + money(p.total_cents) + '</span></a>';
        }).join('');
        box.classList.remove('hide');
      }, 220);
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.search')) { box.classList.add('hide'); }
    });
  }

  function mountFooter() {
    var host = document.querySelector('[data-footer]');
    if (!host) return;
    host.innerHTML =
      '<div class="wrap"><div class="foot">' +
        '<span>GOAT.lol — the board is the money, nothing else.</span>' +
        '<nav>' +
          '<a href="/rules.html">Rules</a><a href="/about.html">About</a>' +
          '<a href="/fans.html">Fans</a><a href="/wallet.html">Wallet</a>' +
          '<a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a>' +
        '</nav>' +
      '</div></div>';
  }

  function boot() {
    mountHeader(document.body.getAttribute('data-nav'));
    mountFooter();
    refreshMe();
    if (sb) sb.auth.onAuthStateChange(function () { refreshMe(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.G = {
    sb: sb, OFFLINE: OFFLINE, TOPUPS: TOPUPS,
    money: money, int: int, esc: esc, safeUrl: safeUrl, ago: ago, qs: qs,
    initials: initials, photoUrl: photoUrl, photo: photo, fanName: fanName,
    categories: categories, category: category, people: people, person: person,
    fansOf: fansOf, topFans: topFans, recentBids: recentBids, backedToday: backedToday,
    stats: stats, search: search, onBid: onBid, recordVisit: recordVisit,
    explain: explain, showError: showError, offlineMessage: offlineMessage,
    onMe: onMe, refreshMe: refreshMe, signIn: signIn, signOut: signOut, get me() { return ME; },
    placeBid: placeBid, addPerson: addPerson, setProfile: setProfile, api: api
  };
})();
