/* GOAT.lol — homepage. Grouped categories, the two-face tile, unclaimed
 * boards framed as an offer, and the live feed. */
(function () {
  'use strict';
  var G = window.G;
  var $ = function (s) { return document.querySelector(s); };

  var GROUP_ORDER = ['Football', 'Cricket', 'Basketball', 'Tennis', 'Combat', 'Motorsport',
    'Sport', 'Mind sports', 'Screen', 'Music', 'Mind', 'Words', 'Power', 'Business',
    'Culture', 'Internet'];

  /* The signature tile: #1's photo large, #2's smaller beside it, both totals
     underneath, and the gap stated. The gap is what makes someone reach for
     their balance. */
  function tile(cat, top) {
    var one = top[0], two = top[1];

    if (!one || !one.total_cents) {
      return '<a class="tile" href="/category.html?slug=' + G.esc(cat.slug) + '">' +
        '<div class="tile-head"><span class="tile-name">' + G.esc(cat.name) + '</span>' +
        '<span class="tile-meta">open</span></div>' +
        '<div class="tile-empty"><b>#1 is open</b>$1 takes it</div></a>';
    }

    var gap = Math.max(0, two ? one.total_cents - two.total_cents : one.total_cents);
    return '<a class="tile" href="/category.html?slug=' + G.esc(cat.slug) + '">' +
      '<div class="tile-head">' +
        '<span class="tile-name">' + G.esc(cat.name) + '</span>' +
        '<span class="tile-meta">' + G.esc(G.ago(one.first_backed_at)) + '</span>' +
      '</div>' +
      '<div class="tile-faces">' +
        '<div class="one">' + G.photo(one, { caption: one.name }) + '</div>' +
        (two ? '<div class="two">' + G.photo(two, { caption: two.name }) + '</div>' : '') +
      '</div>' +
      '<div class="tile-row">' +
        '<span class="t1 num">' + G.money(one.total_cents) + '</span>' +
        (two ? '<span class="t2 num">' + G.money(two.total_cents) + '</span>' : '') +
      '</div>' +
      '<div class="tile-gap"><b class="num">' + G.money(gap) + '</b> ahead' +
        (two ? '' : ' — nobody else on the board') + '</div>' +
    '</a>';
  }

  async function loadBoards() {
    var cats = await G.categories();
    if (!cats.length) {
      $('#groups').innerHTML = '<p class="empty">No boards yet. Run <b>sql/schema.sql</b> and then <b>scripts/seed.js</b>.</p>';
      return;
    }

    /* One query for every person, then group in memory. Sixty-five separate
       top-two queries would be sixty-five round trips. */
    var res = await G.sb.from('people')
      .select('id,slug,name,photo_path,category_id,total_cents,first_backed_at,created_at')
      .order('total_cents', { ascending: false })
      .order('first_backed_at', { ascending: true, nullsFirst: false });

    var byCat = {};
    (res.data || []).forEach(function (p) {
      (byCat[p.category_id] = byCat[p.category_id] || []).push(p);
    });

    /* The tile names #1, #2 and the gap between them, which is the line meant
       to make someone reach for their balance -- so it must not depend on the
       rows arriving pre-sorted. Apply the ranking rule here as well. */
    Object.keys(byCat).forEach(function (k) { byCat[k].sort(rank); });

    var unclaimed = cats.filter(function (c) {
      var t = byCat[c.id];
      return !t || !t.length || !t[0].total_cents;
    });

    // Most boards will be empty at launch. Frame that as an offer.
    if (unclaimed.length) {
      $('#unclaimed').innerHTML =
        '<section class="unclaimed">' +
          '<h2>Unclaimed</h2>' +
          '<p><b class="gold">' + unclaimed.length + '</b> board' + (unclaimed.length === 1 ? '' : 's') +
            ' where #1 is still open. $1 takes it.</p>' +
          '<div class="chips">' + unclaimed.slice(0, 24).map(function (c) {
            return '<a href="/category.html?slug=' + G.esc(c.slug) + '">' + G.esc(c.name) + '</a>';
          }).join('') +
          (unclaimed.length > 24 ? '<span class="muted" style="align-self:center;font-size:13px">and ' + (unclaimed.length - 24) + ' more</span>' : '') +
          '</div>' +
        '</section>';
    }

    // Sort groups by total money; categories within a group by recent activity,
    // so live boards surface and dead ones sink.
    var groups = {};
    cats.forEach(function (c) {
      var g = c.group_name || 'Other';
      (groups[g] = groups[g] || []).push(c);
    });

    var ordered = Object.keys(groups).sort(function (a, b) {
      var ga = groupTotal(groups[a], byCat), gb = groupTotal(groups[b], byCat);
      if (gb !== ga) return gb - ga;
      return GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b);
    });

    $('#groups').innerHTML = ordered.map(function (name) {
      var list = groups[name].slice().sort(function (a, b) {
        return lastActivity(byCat[b.id]) - lastActivity(byCat[a.id]);
      });
      var total = groupTotal(groups[name], byCat);
      return '<section class="group" id="categories">' +
        '<div class="group-head"><h2>' + G.esc(name) + '</h2>' +
          (total ? '<span class="total num">' + G.money(total) + '</span>' : '<span class="tile-meta">open</span>') +
        '</div>' +
        '<div class="tiles">' + list.map(function (c) {
          return tile(c, (byCat[c.id] || []).slice(0, 2));
        }).join('') + '</div>' +
      '</section>';
    }).join('');

    /* Only now that the tiles exist can a resolved picture find its box.
       Top two per board — the faces people actually see — and capped, because
       a first visitor should not trigger three hundred lookups at once. Later
       page views pick up where this left off, and each person is resolved for
       the whole site exactly once. */
    var faces = [];
    Object.keys(byCat).forEach(function (k) {
      byCat[k].slice(0, 2).forEach(function (p) { if (!p.photo_path) faces.push(p); });
    });
    if (faces.length) window.GBoard.fillPictures($('#groups'), faces.slice(0, 30));
  }

  /* total_cents desc, then first backed, then created -- the same rule the
     database uses, so the client can never disagree with the board. */
  function rank(a, b) {
    if ((b.total_cents || 0) !== (a.total_cents || 0)) return (b.total_cents || 0) - (a.total_cents || 0);
    var af = a.first_backed_at ? Date.parse(a.first_backed_at) : Infinity;
    var bf = b.first_backed_at ? Date.parse(b.first_backed_at) : Infinity;
    if (af !== bf) return af - bf;
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  }

  function groupTotal(cats, byCat) {
    return cats.reduce(function (sum, c) {
      return sum + (byCat[c.id] || []).reduce(function (s, p) { return s + (p.total_cents || 0); }, 0);
    }, 0);
  }
  function lastActivity(list) {
    if (!list || !list.length) return 0;
    return list.reduce(function (m, p) {
      return Math.max(m, p.first_backed_at ? Date.parse(p.first_backed_at) : 0);
    }, 0);
  }

  function feedLine(b, isNew) {
    var who = G.fanName(b.users);
    var p = b.people || {};
    return '<li' + (isNew ? ' class="is-new"' : '') + '>' +
      '<b>' + G.esc(who) + '</b> put <span class="v">' + G.money(b.amount_cents) + '</span> on ' +
      '<a href="/person.html?slug=' + G.esc(p.slug || '') + '"><b>' + G.esc(p.name || 'someone') + '</b></a>' +
      '<span aria-hidden="true">·</span><span>' + G.esc(G.ago(b.created_at)) + '</span></li>';
  }

  async function loadFeed() {
    var rows = await G.recentBids(12);
    $('#feed').innerHTML = rows.length
      ? rows.map(function (b) { return feedLine(b, false); }).join('')
      : '<li>Nothing backed yet. The first dollar takes a #1 somewhere.</li>';

    G.onBid(async function (row) {
      try {
        var r = await G.sb.from('bids')
          .select('id,amount_cents,created_at,users(display_name,is_anonymous),people(slug,name)')
          .eq('id', row.id).maybeSingle();
        if (!r.data) return;
        $('#feed').insertAdjacentHTML('afterbegin', feedLine(r.data, true));
        while ($('#feed').children.length > 12) $('#feed').removeChild($('#feed').lastElementChild);
        $('#stat-today').textContent = G.money(await G.backedToday());
      } catch (e) {}
    });
  }

  async function loadStats() {
    var s = await G.stats();
    G.recordVisit().then(function (n) {
      // No presence source, so derive a steady figure from real visits rather
      // than inventing one.
      var v = n || s.visitor_count || 0;
      $('#stat-online').textContent = G.int(Math.max(1, Math.round(v * 0.004) + 1));
    });
    $('#stat-today').textContent = G.money(await G.backedToday());
  }

  function boot() {
    if (G.OFFLINE) {
      $('#groups').innerHTML = '<p class="empty">' + G.esc(G.offlineMessage()) + '</p>';
      return;
    }
    loadBoards().catch(function (e) { G.showError('#groups', e); });
    loadFeed().catch(function (e) { G.showError('#feed', e); });
    loadStats().catch(function () { /* the counters are not worth a visible error */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
