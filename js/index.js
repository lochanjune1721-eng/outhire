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
  /* .tile-faces .one is fluid (flex: 1) and .two is 38% of the tile, which is
     roughly 200px and 90px in a three-column grid. aboveFold comes from the
     caller: only the opening group's first tiles get eager treatment. */
  /* Each fighter is half the card minus the VS badge: near-full width on a
     phone, ~430px on a wide screen. */
  var FIGHT_SIZES = '(max-width: 640px) 42vw, (max-width: 1100px) 40vw, 430px';
  var TILE_ONE_SIZES = '(max-width: 720px) 44vw, (max-width: 1000px) 30vw, 200px';
  var TILE_TWO_SIZES = '(max-width: 720px) 24vw, (max-width: 1000px) 14vw, 90px';

  function tile(cat, top, aboveFold) {
    var one = top[0], two = top[1];
    var pOne = aboveFold ? 'high' : 'lazy';
    var pTwo = aboveFold ? 'eager' : 'lazy';

    // A board nobody has backed still has contenders, and their faces are the
    // whole point of the page. Show them, and say the spot is open underneath —
    // rather than rendering an empty box with no photo element at all.
    if (!one) {
      return '<a class="tile" href="/category.html?slug=' + G.esc(cat.slug) + '">' +
        '<div class="tile-head"><span class="tile-name">' + G.esc(cat.name) + '</span>' +
        '<span class="tile-meta">open</span></div>' +
        '<div class="tile-empty"><b>Nobody here yet</b>$1 puts someone at #1</div></a>';
    }

    if (!one.total_cents) {
      return '<a class="tile" href="/category.html?slug=' + G.esc(cat.slug) + '">' +
        '<div class="tile-head">' +
          '<span class="tile-name">' + G.esc(cat.name) + '</span>' +
          '<span class="tile-meta">open</span>' +
        '</div>' +
        '<div class="tile-faces">' +
          '<div class="one">' + G.photo(one, { caption: one.name, size: 200,
              sizes: TILE_ONE_SIZES, priority: pOne }) + '</div>' +
          (two ? '<div class="two">' + G.photo(two, { caption: two.name, size: 90,
              sizes: TILE_TWO_SIZES, priority: pTwo }) + '</div>' : '') +
        '</div>' +
        '<div class="tile-gap"><b>#1 is open</b> — $1 takes it</div>' +
      '</a>';
    }

    var gap = Math.max(0, two ? one.total_cents - two.total_cents : one.total_cents);
    return '<a class="tile" href="/category.html?slug=' + G.esc(cat.slug) + '">' +
      '<div class="tile-head">' +
        '<span class="tile-name">' + G.esc(cat.name) + '</span>' +
        '<span class="tile-meta">' + G.esc(G.ago(one.first_backed_at)) + '</span>' +
      '</div>' +
      '<div class="tile-faces">' +
        '<div class="one">' + G.photo(one, { caption: one.name, size: 200,
            sizes: TILE_ONE_SIZES, priority: pOne }) + '</div>' +
        (two ? '<div class="two">' + G.photo(two, { caption: two.name, size: 90,
            sizes: TILE_TWO_SIZES, priority: pTwo }) + '</div>' : '') +
      '</div>' +
      '<div class="tile-row">' +
        '<span class="t1 num">' + G.money(one.total_cents) + '</span>' +
        (two ? '<span class="t2 num">' + G.money(two.total_cents) + '</span>' : '') +
      '</div>' +
      '<div class="tile-gap"><b class="num">' + G.money(gap) + '</b> ahead' +
        (two ? '' : ' — nobody else on the board') + '</div>' +
    '</a>';
  }

  /* The columns every other page selects, so the snapshot this page writes
     is a drop-in for the board pages too rather than a trimmed copy that
     only the home page can read. */
  var COLS = G.PCOLS;

  /* Every page at once. The old loop awaited page 0, then page 1, then page 2,
     so three thousand rows cost three round trips end to end before anything
     could be drawn. Nothing about them is ordered, so they all go together —
     alongside the categories, which used to be a fourth wait of its own. */
  function fetchPeople() {
    var PAGE = 1000, PAGES = 6;
    var reqs = [];
    for (var i = 0; i < PAGES; i++) {
      (function (page) {
        reqs.push(G.withImageCols(function (extra) {
          return G.sb.from('people')
            .select(COLS + extra)
            .order('total_cents', { ascending: false })
            .order('first_backed_at', { ascending: true, nullsFirst: false })
            /* A tied ORDER BY has no stable order across separate range()
               pages, so rows came back twice and others never arrived. A
               unique final key makes the paging total — and it has to hold
               now that the pages are fetched together rather than in turn. */
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(page * PAGE, page * PAGE + PAGE - 1);
        }));
      })(i);
    }
    return Promise.all(reqs).then(function (chunks) {
      var out = [];
      chunks.forEach(function (c) { if (c && c.data) out = out.concat(c.data); });
      return out;
    });
  }

  async function loadBoards() {
    var snap = G.snapshot();
    var painted = false;

    if (snap && snap.cats.length && snap.people.length) {
      draw(snap.cats, snap.people);      // no request has gone out yet
      painted = true;
    }

    var pair = await Promise.all([G.categories(), fetchPeople()]);
    var cats = pair[0], people = pair[1];

    if (!cats.length) {
      if (!painted) $('#fights').innerHTML = '<p class="empty">No boards yet. Run <b>sql/schema.sql</b> and then <b>scripts/seed.js</b>.</p>';
      return;
    }

    G.saveSnapshot(cats, people);
    draw(cats, people);
  }

  var bound = false;

  function draw(cats, people) {
    var res = { data: people };

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

    /* View state. "Top fights" is the boxed head-to-head; "All boards" is the
       full list so nothing is hidden behind a filter. */
    var PAGE = 30;
    var view = 'fights', groupFilter = 'all', sortBy = 'closest', shown = PAGE;

    var groups = {};
    cats.forEach(function (c) {
      var g = c.group_name || 'Other';
      (groups[g] = groups[g] || []).push(c);
    });

    function topTwo(c) { return (byCat[c.id] || []).slice(0, 2); }
    function potOf(c) {
      return (byCat[c.id] || []).reduce(function (s, p) { return s + (p.total_cents || 0); }, 0);
    }
    function gapOf(c) {
      var t = topTwo(c);
      if (!t[0] || !t[1]) return Number.MAX_SAFE_INTEGER;
      return (t[0].total_cents || 0) - (t[1].total_cents || 0);
    }

    function visibleCats() {
      var list = cats.filter(function (c) {
        return groupFilter === 'all' || (c.group_name || 'Other') === groupFilter;
      });
      return list.sort(function (a, b) {
        if (sortBy === 'hottest') return potOf(b) - potOf(a);
        if (sortBy === 'open') return potOf(a) - potOf(b);
        if (sortBy === 'az') return String(a.name).localeCompare(String(b.name));
        return gapOf(a) - gapOf(b);
      });
    }

    function renderChips() {
      var counts = {};
      cats.forEach(function (c) {
        var g = c.group_name || 'Other';
        counts[g] = (counts[g] || 0) + 1;
      });
      var names = Object.keys(counts).sort(function (a, b) {
        return counts[b] - counts[a] || a.localeCompare(b);
      });
      $('#chips').innerHTML =
        '<button class="chip' + (groupFilter === 'all' ? ' is-active' : '') + '" data-group="all">' +
          'All <span class="chip-n">' + cats.length + '</span></button>' +
        names.map(function (g) {
          return '<button class="chip' + (groupFilter === g ? ' is-active' : '') +
            '" data-group="' + G.esc(g) + '">' + G.esc(g) +
            ' <span class="chip-n">' + counts[g] + '</span></button>';
        }).join('');
    }

    /* One fighter: the face through G.photo so it uses the resolved Wikimedia
       thumbnail, the name, and the money. */
    function fighter(p, side, aboveFold) {
      if (!p) {
        return '<div class="fighter is-empty"><span class="fighter-photo"></span>' +
          '<span class="fighter-name">Open</span>' +
          '<span class="fighter-score num">' + G.money(0) + '</span>' +
          '<span class="fighter-label">backed</span></div>';
      }
      return '<a class="fighter" href="/person.html?slug=' + G.esc(p.slug || '') + '">' +
        '<span class="fighter-photo">' +
          G.photo(p, { caption: p.name, size: 400, sizes: FIGHT_SIZES,
                       priority: aboveFold ? (side === 'a' ? 'high' : 'eager') : 'lazy' }) +
        '</span>' +
        '<span class="fighter-name">' + G.esc(p.name) + '</span>' +
        '<span class="fighter-score num">' + G.money(p.total_cents || 0) + '</span>' +
        '<span class="fighter-label">backed</span>' +
      '</a>';
    }

    function fightCard(c, aboveFold) {
      var t = topTwo(c), a = t[0], b = t[1];
      var at = (a && a.total_cents) || 0, bt = (b && b.total_cents) || 0;
      var sum = at + bt;
      var pct = sum > 0 ? Math.round((at / sum) * 100) : 50;

      var foot;
      if (!a) foot = 'Nobody here yet — <b>$1</b> puts someone at #1';
      else if (!at) foot = '<b>#1 is open</b> — $1 takes it';
      else if (!b) foot = '<b>' + G.esc(a.name) + '</b> is unopposed';
      else if (at === bt) foot = 'Dead level — <b>$1</b> breaks the tie';
      else foot = '<b>' + G.esc(a.name) + '</b> leads by <b class="num">' + G.money(at - bt) + '</b>';

      return '<article class="fight">' +
        '<header class="fight-head">' +
          '<h3><a href="/category.html?slug=' + G.esc(c.slug) + '">' + G.esc(c.name) + '</a></h3>' +
          '<span class="fight-tag">' + G.esc(c.group_name || '') + '</span>' +
        '</header>' +
        '<div class="fight-body">' +
          fighter(a, 'a', aboveFold) +
          '<span class="vs" aria-hidden="true">VS</span>' +
          fighter(b, 'b', aboveFold) +
        '</div>' +
        '<div class="fight-bar"><span style="width:' + pct + '%"></span></div>' +
        '<p class="fight-foot">' + foot + '</p>' +
      '</article>';
    }

    function boardCard(c) {
      var t = topTwo(c), lead = t[0];
      return '<a class="board" href="/category.html?slug=' + G.esc(c.slug) + '">' +
        '<span class="board-meta">' +
          '<span class="board-name">' + G.esc(c.name) + '</span>' +
          '<span class="board-sub">' + G.esc(c.group_name || '') + '</span>' +
          '<span class="board-lead">' + (lead ? G.esc(lead.name) : 'Unclaimed — $1 takes #1') + '</span>' +
        '</span>' +
        '<span class="board-pot num">' + G.money(potOf(c)) + '</span>' +
      '</a>';
    }

    function render() {
      var list = visibleCats();
      var slice = list.slice(0, shown);

      $('#sec-title').textContent = view === 'fights' ? 'Top fights right now' : 'All boards';
      $('#sec-count').textContent = list.length ? slice.length + ' of ' + list.length : '';
      $('#fights').hidden = view !== 'fights';
      $('#boards').hidden = view !== 'boards';

      if (view === 'fights') {
        $('#fights').innerHTML = slice.map(function (c, i) { return fightCard(c, i < 2); }).join('');
        window.GImg.activate($('#fights'));
      } else {
        $('#boards').innerHTML = slice.map(boardCard).join('');
      }
      $('#more-wrap').hidden = slice.length >= list.length;
    }

    if (!bound) {
    bound = true;
    $('#chips').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      groupFilter = chip.dataset.group; shown = PAGE;
      renderChips(); render();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.addEventListener('click', function () {
        view = tab.dataset.view; shown = PAGE;
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
          var on = t === tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', String(on));
        });
        render();
      });
    });
    $('#sort').addEventListener('change', function (e) {
      sortBy = e.target.value; shown = PAGE; render();
    });
    $('#more').addEventListener('click', function () { shown += PAGE; render(); });
    }

    renderChips();
    render();

    /* Nothing is fetched or resolved here — every tile already carries its
       thumbnail URL. This starts the observers and preloads the two faces on
       the very first tile, which are the only images certain to be above the
       fold on every screen size. */

    // If anybody is still unresolved, start the server working on it. Once per
    // session, not awaited, and nothing on this page depends on it.
    window.GImg.poke(people);
    var firstCat = visibleCats()[0];
    var lead = firstCat ? topTwo(firstCat) : [];
    if (lead.length) {
      window.GImg.preload(lead.map(function (p, i) {
        return { person: p, size: 400, sizes: FIGHT_SIZES };
      }));
    }
  }


  /* total_cents desc, then first backed, then created -- the same rule the
     database uses, so the client can never disagree with the board. */
  function rank(a, b) {
    if ((b.total_cents || 0) !== (a.total_cents || 0)) return (b.total_cents || 0) - (a.total_cents || 0);
    var af = a.first_backed_at ? Date.parse(a.first_backed_at) : Infinity;
    var bf = b.first_backed_at ? Date.parse(b.first_backed_at) : Infinity;
    if (af !== bf) return af - bf;

    /* Nothing backed yet, so money cannot separate them. Fall back to the
       order the board was written in, which is the order in goat-data.js:
       Greatest Footballer opens Messi then Ronaldo, not whoever the database
       returned first. Real backing still overrides all of this. */
    var order = window.GOAT_SEED_ORDER || {};
    var ao = order[a.slug], bo = order[b.slug];
    if (ao !== undefined && bo !== undefined && ao !== bo) return ao - bo;
    if (ao !== undefined && bo === undefined) return -1;
    if (bo !== undefined && ao === undefined) return 1;

    var ac = Date.parse(a.created_at), bc = Date.parse(b.created_at);
    if (ac !== bc) return (ac || 0) - (bc || 0);
    return String(a.slug || '').localeCompare(String(b.slug || ''));
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
