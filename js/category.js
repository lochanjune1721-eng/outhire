/* GOAT.lol — one board (?slug=). */
(function () {
  'use strict';
  var G = window.G, B = window.GBoard;
  var $ = function (s) { return document.querySelector(s); };
  var PAGE = 50;
  var state = { cat: null, offset: 0 };

  function pager(total) {
    var pages = Math.ceil(total / PAGE);
    $('#pager').innerHTML = pages > 1 ? Array.from({ length: pages }, function (_, i) {
      return '<button class="btn btn-sm" type="button" data-p="' + i + '"' +
        (i * PAGE === state.offset ? ' aria-current="true" style="border-color:var(--gold);color:var(--gold)"' : '') +
        '>' + (i + 1) + '</button>';
    }).join('') : '';
  }

  function head(cat) {
    document.title = cat.name + ' — GOAT.lol';
    $('#cat-head').innerHTML =
      '<p class="muted" style="font-size:13px;margin:0">' + G.esc(cat.group_name || '') + '</p>' +
      '<h1>' + G.esc(cat.name) + '</h1>' +
      '<p class="lede">Rank is the money. Taking #1 costs at least <b class="gold">$5</b> more than the leader; ' +
      'everywhere else a dollar more than the person above is enough.</p>';
    $('#add-panel').hidden = false;
  }

  async function draw() {
    var res = await G.people(state.cat.id, PAGE, state.offset);
    var host = $('#board');
    host.setAttribute('data-start', String(state.offset + 1));
    await B.render(host, res.rows, state.offset + 1);
    pager(res.total);
  }

  $('#pager').addEventListener('click', function (e) {
    var b = e.target.closest('[data-p]');
    if (!b) return;
    state.offset = parseInt(b.getAttribute('data-p'), 10) * PAGE;
    draw();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('#add-go').addEventListener('click', async function () {
    var err = $('#add-error');
    err.classList.add('hide');
    if (!G.me) return B.toast('Sign in to add someone.', '/wallet.html', 'Sign in');
    var btn = this;
    btn.disabled = true;
    try {
      var r = await G.addPerson(state.cat.slug, $('#add-name').value.trim(),
        $('#add-wiki').value.trim(), $('#add-blurb').value.trim());
      window.location.href = '/person.html?slug=' + encodeURIComponent(r.slug);
    } catch (e) {
      err.textContent = e.message; err.classList.remove('hide');
      btn.disabled = false;
    }
  });

  async function boot() {
    if (G.OFFLINE) { $('#cat-head').innerHTML = '<p class="empty">' + G.esc(G.offlineMessage()) + '</p>'; return; }
    var slug = G.qs('slug');

    /* The home page leaves every board and contender it loaded in a
       snapshot. When the visitor got here by tapping one of those boards,
       this is the whole page already — so draw it now, before the request
       for it has left. The live rows below replace it either way. */
    var snap = G.snapshot();
    if (slug && snap) {
      var cached = snap.cats.filter(function (c) { return c.slug === slug; })[0];
      if (cached) {
        // Stored in board order, so filtering it keeps the ranking.
        var mine = snap.people.filter(function (p) { return p.category_id === cached.id; });
        state.cat = cached;
        head(cached);
        if (mine.length) {
          var host = $('#board');
          host.setAttribute('data-start', '1');
          B.render(host, mine.slice(0, PAGE), 1);
          pager(mine.length);
        }
      }
    }

    var cat = slug ? await G.category(slug) : null;
    if (!cat) {
      if (!state.cat) {
        $('#cat-head').innerHTML = '<p class="empty">No board at that address. <a href="/">See all boards</a>.</p>';
      }
      return;
    }
    state.cat = cat;
    head(cat);
    draw().catch(function (e) { G.showError('#board', e); });
  }
  function start() { boot().catch(function (e) { G.showError('#cat-head', e); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
