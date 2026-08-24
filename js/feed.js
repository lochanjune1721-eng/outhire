/* OUTHIRE — feed, ruled sidebar, activity, ledger table, single entry.
 * Shared rendering is exposed on window.OHFeed so board.js can mount the same
 * feed scoped to one recruiter board without duplicating any of it.
 */
(function () {
  'use strict';

  var OH = window.OH;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var FEED_LIMIT = 20;
  var PAGE_SIZE = 50;

  /* ---------------------------------------------------------------------
     CLAIM — the next action is always one click away.
     --------------------------------------------------------------------- */

  function claimHref(entry, boardToken) {
    var p = new URLSearchParams();
    p.set('bid', String(Math.round(OH.claimCents(entry) / 100)));
    if (entry && entry.slug) p.set('claim', entry.slug);
    var cat = OH.categorySlug(entry);
    if (cat) p.set('category', cat);
    if (boardToken) p.set('board', boardToken);
    return '/submit.html?' + p.toString();
  }

  function claimButton(entry, boardToken) {
    return '<a class="btn-claim" href="' + OH.esc(claimHref(entry, boardToken)) + '">' +
           'Claim this rank for <span class="num">' + OH.money(OH.claimCents(entry)) + '</span></a>';
  }

  /* ---------------------------------------------------------------------
     ENTRY CARD
     --------------------------------------------------------------------- */

  function mediaMarkup(entry, rank) {
    var src = OH.videoUrl(entry.video_path);
    if (src) {
      return '<video playsinline loop muted preload="metadata" ' +
             'poster="" src="' + OH.esc(src) + '"></video>';
    }
    return '<div class="plate">' +
             '<div class="plate-note">' + (OH.DEMO ? 'Demo entry. No video attached.' : 'Video pending.') + '</div>' +
           '</div>';
  }

  function linksMarkup(entry) {
    var out = [];
    var p = OH.safeUrl(entry.portfolio_url);
    var l = OH.safeUrl(entry.linkedin_url);
    if (p) out.push('<a href="' + OH.esc(p) + '" target="_blank" rel="noopener noreferrer" data-click-entry="' + OH.esc(entry.id) + '">Portfolio</a>');
    if (l) out.push('<a href="' + OH.esc(l) + '" target="_blank" rel="noopener noreferrer" data-click-entry="' + OH.esc(entry.id) + '">LinkedIn</a>');
    if (entry.video_duration) out.push('<span class="num muted">' + OH.clock(entry.video_duration) + '</span>');
    return out.join('');
  }

  function entryCard(entry, rank, boardToken) {
    var role = OH.categoryName(entry);
    return '' +
      '<article class="entry" data-rank="' + OH.esc(String(rank)) + '" data-id="' + OH.esc(entry.id) + '" data-slug="' + OH.esc(entry.slug) + '">' +
        '<div class="rank display" aria-hidden="true">' + OH.esc(String(rank)) + '</div>' +
        '<div class="player">' +
          mediaMarkup(entry, rank) +
          '<button class="sound" type="button" data-sound hidden>Sound off</button>' +
          '<div class="ov ov-meta">' +
            '<div class="ov-name">' +
              '<a href="/entry.html?slug=' + OH.esc(entry.slug) + '">' + OH.esc(entry.display_name) + '</a>' +
              (role ? ' <span class="tag">' + OH.esc(role) + '</span>' : '') +
            '</div>' +
            '<p class="ov-headline">' + OH.esc(entry.headline) + '</p>' +
            '<div class="ov-links">' + linksMarkup(entry) + '</div>' +
          '</div>' +
          '<div class="ov ov-bid">' +
            '<div class="ov-row"><span class="ov-k">Bid</span><span class="ov-v ov-lead num">' + OH.money(entry.current_bid_cents) + '</span></div>' +
            '<div class="ov-row"><span class="ov-k">Rank</span><span class="ov-v num">#' + OH.esc(String(rank)) + '</span></div>' +
            '<div class="ov-row"><span class="ov-k">Clicks</span><span class="ov-v num">' + OH.int(entry.click_count) + '</span></div>' +
            claimButton(entry, boardToken) +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function emptyFeed(boardToken) {
    return '<div class="feed-empty">' +
             '<p class="display">No entries yet.</p>' +
             '<p>First one takes <span class="num">#1</span> for <span class="num">$5</span>.</p>' +
             '<p><a class="btn" href="/submit.html' + (boardToken ? '?board=' + encodeURIComponent(boardToken) : '') + '">Take rank one</a></p>' +
           '</div>';
  }

  /* ---------------------------------------------------------------------
     PLAYBACK — one video at a time, ever.
     --------------------------------------------------------------------- */

  function mountPlayback(feedEl, onActive) {
    var cards = $$('.entry', feedEl);
    if (!cards.length) return { cards: cards, goTo: function () {} };

    var active = -1;
    var muted = true;
    var viewed = {};

    function pauseAll(except) {
      cards.forEach(function (card, i) {
        var v = $('video', card);
        if (v && i !== except) { v.pause(); }
      });
    }

    function activate(i) {
      if (i === active) return;
      active = i;
      pauseAll(i);
      var card = cards[i];
      if (!card) return;
      var v = $('video', card);
      var btn = $('[data-sound]', card);
      if (v) {
        v.muted = muted;
        var p = v.play();
        if (p && p.catch) p.catch(function () { /* autoplay refused; the tap handles it */ });
        if (btn) { btn.hidden = false; btn.textContent = muted ? 'Sound off' : 'Sound on'; }
      }
      var id = card.getAttribute('data-id');
      if (id && !viewed[id]) { viewed[id] = true; OH.recordView(id); }
      if (onActive) onActive(i, card);
    }

    var io = new IntersectionObserver(function (items) {
      var best = null;
      items.forEach(function (it) {
        if (it.intersectionRatio >= 0.6 && (!best || it.intersectionRatio > best.intersectionRatio)) best = it;
      });
      if (best) activate(cards.indexOf(best.target));
    }, { root: feedEl, threshold: [0, 0.6, 0.9, 1] });

    cards.forEach(function (c) { io.observe(c); });

    // Tap to unmute. Applies to every entry from then on.
    feedEl.addEventListener('click', function (e) {
      var card = e.target.closest ? e.target.closest('.entry') : null;
      if (!card) return;
      if (e.target.closest('a, .btn-claim')) return;
      var isSound = !!e.target.closest('[data-sound]');
      if (!isSound && !e.target.closest('.player')) return;
      if (!isSound && e.target.closest('.ov')) return;
      muted = !muted;
      cards.forEach(function (c) { var v = $('video', c); if (v) v.muted = true; });
      var v = $('video', card);
      if (v) {
        v.muted = muted;
        if (!muted) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
      }
      $$('[data-sound]', feedEl).forEach(function (b) { b.textContent = muted ? 'Sound off' : 'Sound on'; });
    });

    function goTo(i) {
      var target = cards[Math.max(0, Math.min(cards.length - 1, i))];
      if (target) target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }

    // Desktop: arrow keys navigate.
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var r = feedEl.getBoundingClientRect();
      if (r.bottom < 80 || r.top > window.innerHeight - 80) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') { e.preventDefault(); goTo(active + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); goTo(active - 1); }
      else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
      else if (e.key === 'End') { e.preventDefault(); goTo(cards.length - 1); }
    });

    activate(0);
    return { cards: cards, goTo: goTo };
  }

  /* Outbound link clicks are logged against the entry. */
  function mountClickLogging(root) {
    root.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('[data-click-entry]') : null;
      if (!a) return;
      OH.logClick(a.getAttribute('data-click-entry'));
    });
  }

  /* ---------------------------------------------------------------------
     RULED SIDEBAR
     --------------------------------------------------------------------- */

  function renderRail(container, rows, onPick) {
    if (!container) return;
    if (!rows.length) {
      container.innerHTML = '<p class="muted" style="padding:12px 16px">No entries yet.</p>';
      return;
    }
    container.innerHTML = rows.map(function (e, i) {
      return '<button class="rail-row" type="button" data-index="' + i + '" aria-current="false">' +
               '<span class="rail-rank">#' + (i + 1) + '</span>' +
               '<span><span class="rail-name">' + OH.esc(e.display_name) + '</span>' +
               '<span class="rail-sub">' + OH.esc(OH.categoryName(e) || 'Other') + '</span></span>' +
               '<span class="rail-bid">' + OH.money(e.current_bid_cents) + '</span>' +
             '</button>';
    }).join('');
    container.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.rail-row') : null;
      if (b && onPick) onPick(parseInt(b.getAttribute('data-index'), 10));
    });
  }

  function markRail(container, index) {
    if (!container) return;
    $$('.rail-row', container).forEach(function (b, i) {
      b.setAttribute('aria-current', i === index ? 'true' : 'false');
    });
  }

  /* ---------------------------------------------------------------------
     MASTHEAD COUNTERS
     --------------------------------------------------------------------- */

  function countUp(el, to, render) {
    if (!el) return;
    if (reduced || to <= 0) { el.innerHTML = render(to); return; }
    var start = performance.now();
    var dur = 900;
    function frame(now) {
      var t = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      el.innerHTML = render(Math.round(to * eased));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  async function initMasthead() {
    var s = await OH.stats();

    var line = $('#revenue-line');
    if (line) {
      var since = s.launched_at ? ', ' + OH.sinceLaunch(s.launched_at) : '';
      var holder = document.createElement('span');
      line.innerHTML = '';
      line.appendChild(holder);
      countUp(holder, s.total_revenue_cents || 0, function (v) {
        return 'This side project has made <span class="num">' + OH.money(v) + '</span> since launch' + since + '.';
      });
    }

    var visitors = $('#stat-visitors');
    OH.recordVisit().then(function (n) {
      countUp(visitors, n || s.visit_count || 0, function (v) { return OH.int(v); });
    });

    var top = $('#stat-top');
    var count = $('#stat-entries');
    var res = await OH.listEntries({ limit: 1, globalOnly: true });
    if (count) countUp(count, res.total, function (v) { return OH.int(v); });
    if (top) countUp(top, res.rows.length ? res.rows[0].current_bid_cents : 0, function (v) { return OH.money(v); });
  }

  /* ---------------------------------------------------------------------
     ACTIVITY — last 10 bids, live.
     --------------------------------------------------------------------- */

  function activityLine(bid, isNew) {
    var e = bid.entries || {};
    var role = e.categories ? e.categories.name : OH.categoryName(e);
    var rank = bid.rank ? '#' + bid.rank : null;
    return '<li' + (isNew ? ' class="is-new"' : '') + '>' +
             '<span>' + OH.esc(e.display_name || 'Someone') + '</span>' +
             '<span class="sep">—</span>' +
             '<span>' + OH.esc(role || 'Other') + '</span>' +
             (rank ? '<span>at <span class="num">' + rank + '</span></span>' : '') +
             '<span class="sep">·</span>' +
             '<span class="num">' + OH.money(bid.amount_cents) + '</span>' +
             '<span class="sep">·</span>' +
             '<span class="num muted">' + OH.timeAgo(bid.created_at) + '</span>' +
           '</li>';
  }

  async function initActivity() {
    var list = $('#activity-list');
    if (!list) return;

    var bids = await OH.recentBids(10);
    if (!bids.length) {
      list.innerHTML = '<li class="muted">No bids yet. The first one sets the floor at <span class="num">$5</span>.</li>';
    } else {
      list.innerHTML = bids.map(function (b) { return activityLine(b, false); }).join('');
    }

    OH.onBid(async function (row) {
      var full = { amount_cents: row.amount_cents, created_at: row.created_at, entries: null };
      try {
        var r = await OH.sb.from('entries')
          .select('slug,display_name,status,categories(name)').eq('id', row.entry_id).maybeSingle();
        full.entries = r.data;
      } catch (err) { /* the row still lands, just without the join */ }
      if (!full.entries || full.entries.status !== 'live') return;
      list.insertAdjacentHTML('afterbegin', activityLine(full, true));
      while (list.children.length > 10) list.removeChild(list.lastElementChild);
    });
  }

  /* ---------------------------------------------------------------------
     LEDGER TABLE
     --------------------------------------------------------------------- */

  function ledgerRow(entry, rank, boardToken) {
    return '<tr data-rank="' + rank + '">' +
      '<td class="c-rank">#' + rank + '</td>' +
      '<td class="c-name">' +
        '<a class="cell-name" href="/entry.html?slug=' + OH.esc(entry.slug) + '">' + OH.esc(entry.display_name) + '</a>' +
        '<span class="cell-sub">' + OH.esc(entry.headline) + '</span>' +
      '</td>' +
      '<td class="c-role">' + OH.esc(OH.categoryName(entry) || 'Other') + '</td>' +
      '<td class="c-bid">' + OH.money(entry.current_bid_cents) + '</td>' +
      '<td class="c-click">' + OH.int(entry.click_count) + '</td>' +
      '<td class="c-when">' + OH.esc(OH.timeAgo(entry.last_bid_at)) + '</td>' +
      '<td class="c-act">' + claimButton(entry, boardToken) + '</td>' +
    '</tr>';
  }

  async function initLedger() {
    var body = $('#ledger-rows');
    if (!body) return;

    var state = { scope: 'all', category: '', offset: 0 };

    var filters = $('#filters');
    var cats = await OH.categories();
    if (filters) {
      filters.innerHTML = '<button class="chip" type="button" data-cat="" aria-pressed="true">All roles</button>' +
        cats.map(function (c) {
          return '<button class="chip" type="button" data-cat="' + OH.esc(c.slug) + '" aria-pressed="false">' + OH.esc(c.name) + '</button>';
        }).join('');
      filters.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.chip') : null;
        if (!b) return;
        state.category = b.getAttribute('data-cat');
        state.offset = 0;
        $$('.chip', filters).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        draw();
      });
    }

    $$('.tabs .chip').forEach(function (b) {
      b.addEventListener('click', function () {
        state.scope = b.getAttribute('data-scope');
        state.offset = 0;
        $$('.tabs .chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        draw();
      });
    });

    var prev = $('#prev-page');
    var next = $('#next-page');
    if (prev) prev.addEventListener('click', function () {
      state.offset = Math.max(0, state.offset - PAGE_SIZE); draw(); $('#ledger').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    });
    if (next) next.addEventListener('click', function () {
      state.offset = state.offset + PAGE_SIZE; draw(); $('#ledger').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    });

    async function draw() {
      body.innerHTML = '<tr><td colspan="7" class="muted">Loading.</td></tr>';
      var res = await OH.listEntries({
        scope: state.scope, category: state.category || null,
        globalOnly: true, limit: PAGE_SIZE, offset: state.offset
      });
      if (!res.rows.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty">' +
          (state.offset === 0
            ? 'No entries yet. First one takes <span class="num">#1</span> for <span class="num">$5</span>.'
            : 'Nothing on this page.') + '</td></tr>';
      } else {
        body.innerHTML = res.rows.map(function (e, i) {
          return ledgerRow(e, state.offset + i + 1, null);
        }).join('');
      }
      var from = res.total ? state.offset + 1 : 0;
      var to = Math.min(state.offset + PAGE_SIZE, res.total);
      var range = $('#pager-range');
      if (range) range.textContent = from + '–' + to + ' of ' + OH.int(res.total);
      if (prev) prev.disabled = state.offset === 0;
      if (next) next.disabled = to >= res.total;
      var railCount = $('#rail-count');
      if (railCount && state.offset === 0 && !state.category && state.scope === 'all') {
        railCount.textContent = OH.int(res.total);
      }
    }

    draw();
  }

  /* ---------------------------------------------------------------------
     PAGE: INDEX
     --------------------------------------------------------------------- */

  async function initIndex() {
    var feedEl = $('#feed');
    var res = await OH.listEntries({ limit: FEED_LIMIT, globalOnly: true });

    if (!res.rows.length) {
      feedEl.innerHTML = emptyFeed(null);
    } else {
      feedEl.innerHTML = res.rows.map(function (e, i) { return entryCard(e, i + 1, null); }).join('');
    }

    var railEl = $('#rail-rows');
    var railCount = $('#rail-count');
    if (railCount) railCount.textContent = OH.int(res.total);

    var player = null;
    renderRail(railEl, res.rows, function (i) { if (player) player.goTo(i); });

    mountClickLogging(feedEl);
    if (res.rows.length) {
      player = mountPlayback(feedEl, function (i) { markRail(railEl, i); });
    }

    initMasthead();
    initActivity();
    initLedger();
  }

  /* ---------------------------------------------------------------------
     PAGE: ENTRY (?slug=)
     --------------------------------------------------------------------- */

  async function initEntry() {
    var host = $('#solo');
    if (!host) return;
    var slug = OH.qs('slug');
    if (!slug) {
      host.innerHTML = '<p class="empty">No entry named. Try the <a href="/">leaderboard</a>.</p>';
      return;
    }

    var entry = await OH.getEntry(slug);
    if (!entry) {
      host.innerHTML = '<p class="empty">No live entry at that address. It may be pending review, or it may have been rejected.</p>';
      return;
    }

    document.title = entry.display_name + ' — Outhire';
    var rank = await OH.rankOf(entry);
    var role = OH.categoryName(entry);
    var p = OH.safeUrl(entry.portfolio_url);
    var l = OH.safeUrl(entry.linkedin_url);

    host.innerHTML =
      '<div class="player">' + mediaMarkup(entry, rank || 1) +
        '<button class="sound" type="button" data-sound>Sound off</button>' +
      '</div>' +
      '<div>' +
        '<div class="solo-rank display" data-lead="' + (rank === 1) + '">' + OH.esc(String(rank || '—')) + '</div>' +
        '<h1>' + OH.esc(entry.display_name) + (role ? ' <span class="tag">' + OH.esc(role) + '</span>' : '') + '</h1>' +
        '<p class="lede">' + OH.esc(entry.headline) + '</p>' +
        '<dl class="dl">' +
          '<div><dt>Current bid</dt><dd' + (rank === 1 ? ' style="color:var(--live)"' : '') + '>' + OH.money(entry.current_bid_cents) + '</dd></div>' +
          '<div><dt>Rank</dt><dd>#' + OH.esc(String(rank || '—')) + '</dd></div>' +
          '<div><dt>Clicks</dt><dd>' + OH.int(entry.click_count) + '</dd></div>' +
          '<div><dt>Views</dt><dd>' + OH.int(entry.view_count) + '</dd></div>' +
          '<div><dt>Length</dt><dd>' + OH.clock(entry.video_duration) + '</dd></div>' +
          '<div><dt>Last bid</dt><dd>' + OH.esc(OH.timeAgo(entry.last_bid_at)) + '</dd></div>' +
          (p ? '<div><dt>Portfolio</dt><dd><a href="' + OH.esc(p) + '" target="_blank" rel="noopener noreferrer" data-click-entry="' + OH.esc(entry.id) + '">' + OH.esc(p.replace(/^https?:\/\//, '')) + '</a></dd></div>' : '') +
          (l ? '<div><dt>LinkedIn</dt><dd><a href="' + OH.esc(l) + '" target="_blank" rel="noopener noreferrer" data-click-entry="' + OH.esc(entry.id) + '">' + OH.esc(l.replace(/^https?:\/\//, '')) + '</a></dd></div>' : '') +
        '</dl>' +
        '<div style="margin-top:24px">' + claimButton(entry, null) + '</div>' +
        '<p class="hint muted" style="margin-top:8px">Claiming files your own entry one dollar above this one.</p>' +
      '</div>';

    mountClickLogging(host);
    OH.recordView(entry.id);

    var v = $('video', host);
    var sound = $('[data-sound]', host);
    if (v) {
      v.muted = true;
      var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
      host.addEventListener('click', function (e) {
        if (e.target.closest('a, .btn-claim')) return;
        if (!e.target.closest('.player')) return;
        v.muted = !v.muted;
        if (!v.muted) { var q = v.play(); if (q && q.catch) q.catch(function () {}); }
        if (sound) sound.textContent = v.muted ? 'Sound off' : 'Sound on';
      });
    } else if (sound) {
      sound.hidden = true;
    }
  }

  /* ---------------------------------------------------------------------
     EXPORTS + BOOT
     --------------------------------------------------------------------- */

  window.OHFeed = {
    entryCard: entryCard,
    emptyFeed: emptyFeed,
    ledgerRow: ledgerRow,
    claimButton: claimButton,
    claimHref: claimHref,
    mountPlayback: mountPlayback,
    mountClickLogging: mountClickLogging,
    renderRail: renderRail,
    markRail: markRail,
    countUp: countUp,
    PAGE_SIZE: PAGE_SIZE
  };

  function boot() {
    var page = document.body.getAttribute('data-page');
    if (page === 'index') initIndex();
    else if (page === 'entry') initEntry();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
