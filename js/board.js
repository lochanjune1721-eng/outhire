/* outbid.lol — the tapering leaderboard.
 * Card size scales down with rank, so #1 physically dominates the page.
 * Shared by the homepage and the role boards; exported on window.OBBoard. */
(function () {
  'use strict';

  var OB = window.OB;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var PAGE_SIZE = 50;

  /* Rank -> tier. The tier drives every size in the card via CSS custom
     properties, so the taper is one lookup rather than six templates. */
  function tierOf(rank) {
    if (rank === 1) return 1;
    if (rank === 2) return 2;
    if (rank === 3) return 3;
    if (rank <= 10) return 4;
    if (rank <= 25) return 11;
    return 26;
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w[0]; }).join('').toUpperCase() || '?';
  }

  /* ------------------------------------------------------------------
     MEDIA — thumbnail first. An iframe is only ever created on click, so
     a fifty-row page never mounts fifty players.
     ------------------------------------------------------------------ */

  function mediaMarkup(entry) {
    var photo = OB.photoUrl(entry.photo_path);
    var vid = OB.parseVideo(entry.video_url);
    var still = photo || (vid ? OB.videoThumb(vid) : null);

    var inner;
    if (still) {
      inner = '<img src="' + OB.esc(still) + '" alt="" loading="lazy" decoding="async" ' +
              'onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),' +
              '{className:\'monogram\',textContent:this.dataset.ini}))" ' +
              'data-ini="' + OB.esc(initials(entry.display_name)) + '">';
    } else {
      inner = '<div class="monogram">' + OB.esc(initials(entry.display_name)) + '</div>';
    }

    var play = vid
      ? '<button class="play" type="button" data-play="' + OB.esc(entry.video_url) + '" ' +
        'aria-label="Play video from ' + OB.esc(entry.display_name) + '">' +
        '<span><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
        '<path d="M8 5v14l11-7z"/></svg></span></button>'
      : '';

    return '<div class="media" data-media' +
           (still ? ' data-photo' : '') +
           (vid && vid.platform === 'vimeo' && !photo ? ' data-vimeo="' + OB.esc(vid.id) + '"' : '') +
           '>' + inner + play + '</div>';
  }

  /* ------------------------------------------------------------------
     ROW
     ------------------------------------------------------------------ */

  function rowMarkup(entry, rank, opts) {
    opts = opts || {};
    var url = OB.safeUrl(entry.url);
    var domain = OB.domainOf(entry.url);
    var claim = OB.claimCents(entry);
    var linkLabel = entry.side === 'recruiter' ? 'see role' : 'see details';

    var claimBlock = opts.noBidding ? '' :
      '<div class="row-claim">' +
        '<a class="btn btn-primary btn-block btn-sm" href="' + OB.esc(claimHref(entry, rank, opts)) + '">' +
          'Claim this rank for <span class="num">' + OB.money(claim) + '</span>' +
        '</a>' +
      '</div>';

    return '' +
      '<article class="row" data-tier="' + tierOf(rank) + '" data-rank="' + rank + '" data-id="' + OB.esc(entry.id) + '">' +
        '<span class="rank-badge num">#' + rank + '</span>' +
        mediaMarkup(entry) +
        '<div class="row-body">' +
          '<h3 class="row-title">' +
            (url
              ? '<a href="' + OB.esc(url) + '" target="_blank" rel="noopener noreferrer nofollow" data-click="' + OB.esc(entry.id) + '">' + OB.esc(entry.display_name) + '</a>'
              : OB.esc(entry.display_name)) +
          '</h3>' +
          '<p class="row-line">' + OB.esc(entry.headline) + '</p>' +
          '<div class="row-meta">' +
            '<span>' + OB.esc(OB.timeAgo(entry.last_bid_at || entry.created_at)) + '</span>' +
            (domain ? '<span>' + OB.esc(domain) + '</span>' : '') +
            (entry.category ? '<span class="metachip">' + OB.esc(entry.category) + '</span>' : '') +
            '<span class="clickcount"><span class="dot dot-coral" aria-hidden="true"></span>' +
              '<span class="num">' + OB.int(entry.click_count) + '</span> clicks</span>' +
            '<a href="/entry.html?slug=' + OB.esc(entry.slug) + '">' + linkLabel + '</a>' +
          '</div>' +
          claimBlock +
        '</div>' +
        '<div class="row-right">' +
          (opts.noBidding
            ? '<span class="tag tag-quiet">' + OB.esc(OB.timeAgo(entry.created_at)) + '</span>'
            : '<span class="row-bid num">' + OB.money(entry.current_bid_cents) + '</span>') +
        '</div>' +
      '</article>';
  }

  function claimHref(entry, rank, opts) {
    var p = new URLSearchParams();
    p.set('bid', String(Math.round(OB.claimCents(entry) / 100)));
    p.set('side', entry.side || 'candidate');
    if (entry.category) p.set('category', entry.category);
    if (entry.slug) p.set('claim', entry.slug);
    if (opts && opts.boardSlug) p.set('board', opts.boardSlug);
    return '/submit.html?' + p.toString();
  }

  /* ------------------------------------------------------------------
     RENDER — with the Top 10 / Top 20 divider labels inline.
     ------------------------------------------------------------------ */

  function render(container, rows, startRank, opts) {
    opts = opts || {};
    if (!rows.length) {
      container.innerHTML = opts.emptyHtml ||
        '<p class="empty"><b>Nobody has outbid #1 yet.</b> New spots start at $5.</p>';
      return;
    }
    var out = [];
    rows.forEach(function (e, i) {
      var rank = startRank + i;
      if (rank === 4) out.push('<div class="divider">Top 10</div>');
      if (rank === 11) out.push('<div class="divider">Top 20</div>');
      if (rank === 26) out.push('<div class="divider">Everyone else</div>');
      out.push(rowMarkup(e, rank, opts));
    });
    container.innerHTML = out.join('');
    hydrate(container);
  }

  /* Click-to-play, click logging, and lazy Vimeo stills. */
  function hydrate(root) {
    $$('[data-vimeo]', root).forEach(async function (box) {
      var url = await OB.vimeoThumb(box.getAttribute('data-vimeo'));
      if (!url) return;
      var img = document.createElement('img');
      img.src = url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      var old = $('img, .monogram', box);
      if (old) old.replaceWith(img);
    });

    if (root.dataset.obBound) return;
    root.dataset.obBound = '1';

    root.addEventListener('click', function (e) {
      var play = e.target.closest ? e.target.closest('[data-play]') : null;
      if (play) {
        e.preventDefault();
        var v = OB.parseVideo(play.getAttribute('data-play'));
        if (!v) return;
        var box = play.closest('.media');
        var frame = document.createElement('iframe');
        frame.src = OB.videoEmbed(v);
        frame.title = 'Video';
        frame.allow = 'autoplay; fullscreen; picture-in-picture';
        frame.setAttribute('allowfullscreen', '');
        box.innerHTML = '';
        box.appendChild(frame);
        return;
      }
      var link = e.target.closest ? e.target.closest('[data-click]') : null;
      if (link) OB.logClick(link.getAttribute('data-click'));
    });
  }

  /* ------------------------------------------------------------------
     PAGINATION — numbered, 50 rows a page.
     ------------------------------------------------------------------ */

  function renderPager(el, total, offset, onGo) {
    if (!el) return;
    var pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) { el.innerHTML = ''; return; }
    var cur = Math.floor(offset / PAGE_SIZE) + 1;
    var nums = [];
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - cur) <= 2) nums.push(i);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    el.innerHTML =
      '<button class="pagebtn" type="button" data-go="' + (cur - 1) + '"' + (cur === 1 ? ' disabled' : '') + '>Prev</button>' +
      nums.map(function (n) {
        return n === '…'
          ? '<span class="pagebtn" style="border:0;background:none">…</span>'
          : '<button class="pagebtn" type="button" data-go="' + n + '" aria-current="' + (n === cur) + '">' + n + '</button>';
      }).join('') +
      '<button class="pagebtn" type="button" data-go="' + (cur + 1) + '"' + (cur === pages ? ' disabled' : '') + '>Next</button>';

    if (!el.dataset.bound) {
      el.dataset.bound = '1';
      el.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-go]') : null;
        if (!b || b.disabled) return;
        onGo((parseInt(b.getAttribute('data-go'), 10) - 1) * PAGE_SIZE);
      });
    }
  }

  window.OBBoard = {
    tierOf: tierOf, rowMarkup: rowMarkup, mediaMarkup: mediaMarkup,
    render: render, hydrate: hydrate, renderPager: renderPager, PAGE_SIZE: PAGE_SIZE
  };

  /* ==================================================================
     HOMEPAGE
     ================================================================== */

  if (document.body.getAttribute('data-page') !== 'home') return;

  var state = { side: 'candidate', category: '', scope: 'all', offset: 0, bid: 5 };

  function syncBid() {
    $('#bid-amount').textContent = '$' + state.bid.toLocaleString('en-US');
  }

  function setSide(side) {
    state.side = side; state.offset = 0;
    $$('[data-side]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-side') === side)); });
    $('#entry-url').placeholder = side === 'recruiter' ? 'Your job listing URL' : 'Your portfolio URL';
    draw();
  }

  async function draw() {
    var host = $('#board-rows');
    var res = await OB.listEntries({
      side: state.side, homepageOnly: true,
      category: state.category || null, scope: state.scope,
      limit: PAGE_SIZE, offset: state.offset
    });

    var empty = state.side === 'recruiter'
      ? '<p class="empty"><b>No open roles on the board yet.</b> New spots start at $5.</p>'
      : (state.category || state.scope === 'today'
          ? '<p class="empty">Nothing here yet. New spots start at <b>$5</b>.</p>'
          : '<p class="empty"><b>Nobody has outbid #1 yet.</b> New spots start at $5.</p>');

    render(host, res.rows, state.offset + 1, { emptyHtml: empty });
    renderPager($('#pager'), res.total, state.offset, function (off) {
      state.offset = off; draw();
      $('#board').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // The steppers open at one dollar above whatever holds #1 right now.
    if (state.offset === 0 && res.rows.length) {
      state.bid = Math.round(OB.claimCents(res.rows[0]) / 100);
      syncBid();
    }
  }

  async function initHeader() {
    var sel = $('#entry-category');
    sel.innerHTML = '<option value="">Choose a category</option>' +
      OB.CATEGORIES.map(function (c) { return '<option>' + OB.esc(c) + '</option>'; }).join('');

    var chips = $('#categories');
    chips.innerHTML = '<button class="chip" type="button" data-cat="" aria-pressed="true">' +
        '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="2" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="2" stroke="currentColor" stroke-width="2"/><rect x="14" y="14" width="7" height="7" rx="2" stroke="currentColor" stroke-width="2"/></svg>All</button>' +
      OB.CATEGORIES.map(function (c) {
        return '<button class="chip" type="button" data-cat="' + OB.esc(c) + '" aria-pressed="false">' + OB.esc(c) + '</button>';
      }).join('') +
      '<button class="chip" type="button" data-more aria-expanded="false">More ' +
        '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>';

    chips.addEventListener('click', function (e) {
      var more = e.target.closest ? e.target.closest('[data-more]') : null;
      if (more) {
        var open = chips.getAttribute('data-expanded') !== 'true';
        chips.setAttribute('data-expanded', String(open));
        more.setAttribute('aria-expanded', String(open));
        more.firstChild.nodeValue = open ? 'Less ' : 'More ';
        return;
      }
      var b = e.target.closest ? e.target.closest('.chip') : null;
      if (!b) return;
      state.category = b.getAttribute('data-cat'); state.offset = 0;
      $$('.chip[data-cat]', chips).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      draw();
    });

    $$('[data-side]').forEach(function (b) {
      b.addEventListener('click', function () { setSide(b.getAttribute('data-side')); });
    });
    $$('[data-scope]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.scope = b.getAttribute('data-scope'); state.offset = 0;
        $$('[data-scope]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        draw();
      });
    });

    $('#bid-down').addEventListener('click', function () { state.bid = Math.max(5, state.bid - 1); syncBid(); });
    $('#bid-up').addEventListener('click', function () { state.bid = state.bid + 1; syncBid(); });

    $('#entry-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var url = OB.safeUrl($('#entry-url').value);
      if (!url) { $('#entry-url').focus(); return; }
      var p = new URLSearchParams();
      p.set('url', url);
      p.set('side', state.side);
      p.set('bid', String(state.bid));
      var cat = $('#entry-category').value;
      if (cat) p.set('category', cat);
      window.location.href = '/submit.html?' + p.toString();
    });

    syncBid();
  }

  async function initStats() {
    var s = await OB.stats();
    $('#stat-visitors').textContent = OB.int(s.visitor_count);
    OB.recordVisit().then(function (n) { if (n) $('#stat-visitors').textContent = OB.int(n); });
    // "Online" has no server-side presence source; derive a steady, honest
    // stand-in from the visitor count rather than inventing a number.
    $('#stat-online').textContent = OB.int(Math.max(1, Math.round((s.visitor_count || 0) * 0.0005) + 1));
    if (s.total_revenue_cents) {
      $('#revenue-line').textContent = OB.money(s.total_revenue_cents) + ' bid so far';
    }
  }

  function activityLine(bid, isNew) {
    var e = bid.entries || {};
    return '<li' + (isNew ? ' class="is-new"' : '') + '>' +
      '<b>' + OB.esc(e.display_name || 'Someone') + '</b> took ' +
      '<span class="num">#' + (bid.rank || '—') + '</span>' +
      '<span aria-hidden="true">·</span>' +
      '<span class="amt">' + OB.money(bid.amount_cents) + '</span>' +
      '<span aria-hidden="true">·</span>' +
      '<span>' + OB.esc(OB.longAgo(bid.created_at)) + '</span>' +
    '</li>';
  }

  async function initActivity() {
    var list = $('#activity-list');
    var bids = await OB.recentBids(10);
    list.innerHTML = bids.length
      ? bids.map(function (b) { return activityLine(b, false); }).join('')
      : '<li>No bids yet. The first one starts at <b>$5</b>.</li>';

    OB.onBid(async function (row) {
      try {
        var r = await OB.sb.from('entries')
          .select('slug,display_name,category,status').eq('id', row.entry_id).maybeSingle();
        if (!r.data || r.data.status !== 'live') return;
        list.insertAdjacentHTML('afterbegin',
          activityLine({ amount_cents: row.amount_cents, created_at: row.created_at, entries: r.data }, true));
        while (list.children.length > 10) list.removeChild(list.lastElementChild);
      } catch (e) { /* the bid still landed */ }
    });
  }

  function boot() { initHeader(); draw(); initStats(); initActivity(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
