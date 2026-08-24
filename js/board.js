/* OUTHIRE — recruiter boards.
 * recruiters.html creates one; board.html renders the same feed scoped to it,
 * reusing every renderer from feed.js so the two views cannot drift. */
(function () {
  'use strict';

  var OH = window.OH;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var page = document.body.getAttribute('data-page');

  /* =====================================================================
     recruiters.html — create a board
     ===================================================================== */

  function initRecruiters() {
    var form = $('#form');
    if (!form) return;
    var errBox = $('#form-error');
    var btn = $('#submit-btn');

    function fail(msg) {
      errBox.textContent = msg;
      errBox.hidden = false;
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errBox.hidden = true;

      var body = {
        company_name: $('#company_name').value.trim(),
        role_title: $('#role_title').value.trim(),
        job_url: $('#job_url').value.trim(),
        recruiter_email: $('#recruiter_email').value.trim()
      };

      if (!body.company_name) return fail('Add the company name. It appears at the top of the board.');
      if (!body.role_title) return fail('Add the role. One board is one role.');
      if (body.job_url && !OH.safeUrl(body.job_url)) return fail('The job URL needs to start with http or https.');
      if (body.recruiter_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.recruiter_email)) {
        return fail('That email does not look right. Leave it blank if you would rather not.');
      }

      btn.disabled = true;
      var original = btn.textContent;
      btn.textContent = 'Creating';

      try {
        var res = await OH.api('/api/board', body);
        var boardUrl = window.location.origin + '/board.html?token=' + encodeURIComponent(res.share_token);
        var submitUrl = window.location.origin + '/submit.html?board=' + encodeURIComponent(res.share_token);

        form.hidden = true;
        $('#result').hidden = false;
        $('#result-role').textContent = body.role_title + ' at ' + body.company_name + '. Anyone with this link can watch the board.';
        $('#share-url').value = boardUrl;
        $('#open-board').href = boardUrl;
        $('#open-submit').href = submitUrl;

        $('#copy-btn').addEventListener('click', function () {
          var input = $('#share-url');
          input.select();
          input.setSelectionRange(0, 999999);
          var done = function () { $('#copy-note').textContent = 'Copied. Paste it into the job post.'; };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(input.value).then(done, function () { document.execCommand('copy'); done(); });
          } else {
            document.execCommand('copy');
            done();
          }
        });
        $('#result').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      } catch (err) {
        btn.disabled = false;
        btn.textContent = original;
        fail(err.message || 'The board could not be created.');
      }
    });
  }

  /* =====================================================================
     board.html — one role, same feed
     ===================================================================== */

  async function initBoard() {
    var feedEl = $('#feed');
    if (!feedEl) return;

    var token = OH.qs('token');
    var sub = $('#board-sub');

    if (!token) {
      feedEl.innerHTML = '<div class="feed-empty"><p class="display">No board named.</p>' +
        '<p>A board link looks like <span class="num">/board.html?token=…</span>.</p>' +
        '<p><a class="btn" href="/recruiters.html">Make one</a></p></div>';
      sub.textContent = 'This address has no board token.';
      return;
    }

    var board = await OH.getBoardByToken(token);
    if (!board) {
      feedEl.innerHTML = '<div class="feed-empty"><p class="display">No board at that link.</p>' +
        '<p>It may have been mistyped.</p>' +
        '<p><a class="btn" href="/recruiters.html">Make a new one</a></p></div>';
      sub.textContent = 'That board link is not recognised.';
      return;
    }

    document.title = (board.role_title || 'Board') + ' — ' + (board.company_name || 'Outhire');
    sub.innerHTML = OH.esc(board.role_title || 'This role') +
      (board.company_name ? ' at ' + OH.esc(board.company_name) : '') +
      '. Candidates paid to be here and filmed themselves saying why.';

    var enter = $('#nav-enter');
    if (enter) enter.href = '/submit.html?board=' + encodeURIComponent(token);
    var jobLink = $('#nav-job');
    var job = OH.safeUrl(board.job_url);
    if (jobLink && job) { jobLink.href = job; jobLink.hidden = false; jobLink.rel = 'noopener noreferrer'; jobLink.target = '_blank'; }

    var opened = $('#stat-opened');
    if (opened) opened.textContent = OH.timeAgo(board.created_at);

    var state = { sort: 'bid', offset: 0 };

    /* ---- feed + rail ---- */

    var top = await OH.listEntries({ boardId: board.id, limit: 20, sort: 'bid' });

    if (!top.rows.length) {
      feedEl.innerHTML = window.OHFeed.emptyFeed(token);
    } else {
      feedEl.innerHTML = top.rows.map(function (e, i) {
        return window.OHFeed.entryCard(e, i + 1, token);
      }).join('');
    }

    var railEl = $('#rail-rows');
    var railCount = $('#rail-count');
    if (railCount) railCount.textContent = OH.int(top.total);

    var player = null;
    window.OHFeed.renderRail(railEl, top.rows, function (i) { if (player) player.goTo(i); });
    window.OHFeed.mountClickLogging(feedEl);
    if (top.rows.length) {
      player = window.OHFeed.mountPlayback(feedEl, function (i) { window.OHFeed.markRail(railEl, i); });
    }

    var statEntries = $('#stat-entries');
    var statTop = $('#stat-top');
    if (statEntries) window.OHFeed.countUp(statEntries, top.total, function (v) { return OH.int(v); });
    if (statTop) window.OHFeed.countUp(statTop, top.rows.length ? top.rows[0].current_bid_cents : 0, function (v) { return OH.money(v); });

    /* ---- ruled table, recruiter sorts by bid or newest ---- */

    var body = $('#ledger-rows');
    var prev = $('#prev-page');
    var next = $('#next-page');
    var PAGE = window.OHFeed.PAGE_SIZE;

    $$('.tabs .chip').forEach(function (b) {
      b.addEventListener('click', function () {
        state.sort = b.getAttribute('data-sort');
        state.offset = 0;
        $$('.tabs .chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        draw();
      });
    });

    if (prev) prev.addEventListener('click', function () { state.offset = Math.max(0, state.offset - PAGE); draw(); });
    if (next) next.addEventListener('click', function () { state.offset += PAGE; draw(); });

    async function draw() {
      body.innerHTML = '<tr><td colspan="7" class="muted">Loading.</td></tr>';
      var res = await OH.listEntries({
        boardId: board.id, sort: state.sort, limit: PAGE, offset: state.offset
      });
      if (!res.rows.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty">' +
          (state.offset === 0
            ? 'No entries yet. First one takes <span class="num">#1</span> for <span class="num">$5</span>.'
            : 'Nothing on this page.') + '</td></tr>';
      } else {
        body.innerHTML = res.rows.map(function (e, i) {
          return window.OHFeed.ledgerRow(e, state.offset + i + 1, token);
        }).join('');
      }
      var from = res.total ? state.offset + 1 : 0;
      var to = Math.min(state.offset + PAGE, res.total);
      var range = $('#pager-range');
      if (range) range.textContent = from + '–' + to + ' of ' + OH.int(res.total);
      if (prev) prev.disabled = state.offset === 0;
      if (next) next.disabled = to >= res.total;
    }

    draw();
  }

  function boot() {
    if (page === 'recruiters') initRecruiters();
    else if (page === 'board') initBoard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
