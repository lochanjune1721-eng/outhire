/* outbid.lol — a role board (?slug=). Same cards, flat $5, no bidding,
 * newest first by default. */
(function () {
  'use strict';
  var OB = window.OB, B = window.OBBoard;
  var $ = function (s) { return document.querySelector(s); };
  if (document.body.getAttribute('data-page') !== 'board') return;

  var state = { sort: 'new', offset: 0, board: null };

  async function draw() {
    var res = await OB.listEntries({
      boardId: state.board.id, sort: state.sort,
      limit: B.PAGE_SIZE, offset: state.offset
    });
    B.render($('#board-rows'), res.rows, state.offset + 1, {
      noBidding: true,
      boardSlug: state.board.slug,
      emptyHtml: '<p class="empty"><b>Nobody has applied here yet.</b> Flat $5 to be first.</p>'
    });
    B.renderPager($('#pager'), res.total, state.offset, function (off) { state.offset = off; draw(); });
  }

  async function boot() {
    var slug = OB.qs('slug');
    if (!slug) { $('#board-head').innerHTML = '<p class="empty">No board named. <a href="/job.html">Spawn one</a>.</p>'; return; }

    var board = await OB.getBoard(slug);
    if (!board) { $('#board-head').innerHTML = '<p class="empty">No board at that address. <a href="/job.html">Spawn one</a>.</p>'; return; }
    state.board = board;

    var role = board.role_title || 'this role';
    var company = board.company_name || 'this company';
    document.title = 'Applying to ' + role + ' at ' + company + ' — outbid.lol';
    var src = OB.safeUrl(board.source_url);

    $('#board-head').innerHTML =
      '<h1>Applying to ' + OB.esc(role) + ' at ' + OB.esc(company) + '</h1>' +
      '<p class="lede">' +
        (board.location ? OB.esc(board.location) + ' · ' : '') +
        'Everyone who applied to this role, newest first. Flat <b>$5</b> to appear — no bidding here.' +
      '</p>' +
      '<div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
        '<a class="btn btn-primary" href="/submit.html?board=' + OB.esc(board.slug) + '&bid=5">Add yourself for $5</a>' +
        (src ? '<a class="btn" href="' + OB.esc(src) + '" target="_blank" rel="noopener noreferrer nofollow">See the original listing</a>' : '') +
        '<a class="btn" href="/recruiter.html?board=' + OB.esc(board.slug) + '">Are you the recruiter for this role? Claim this board</a>' +
        '<div class="pill-group" role="group" aria-label="Sort">' +
          '<button class="pill" type="button" data-sort="new" aria-pressed="true">Newest</button>' +
          '<button class="pill" type="button" data-sort="bid" aria-pressed="false">Top bid</button>' +
        '</div>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('[data-sort]'), function (b) {
      b.addEventListener('click', function () {
        state.sort = b.getAttribute('data-sort'); state.offset = 0;
        Array.prototype.forEach.call(document.querySelectorAll('[data-sort]'), function (x) {
          x.setAttribute('aria-pressed', String(x === b));
        });
        draw();
      });
    });

    draw();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
