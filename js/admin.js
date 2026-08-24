/* OUTHIRE — review console.
 * The password never gets compared here. It is posted to /api/admin, which
 * returns a short-lived signed token held in sessionStorage. */
(function () {
  'use strict';

  var OH = window.OH;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var KEY = 'oh_admin_token';
  var token = null;
  try { token = sessionStorage.getItem(KEY); } catch (e) { token = null; }

  var gate = $('#gate');
  var panel = $('#console');
  var rows = $('#rows');
  var errBox = $('#admin-error');
  var state = { status: 'pending' };

  function showError(msg) { errBox.textContent = msg; errBox.hidden = false; }
  function clearError() { errBox.hidden = true; errBox.textContent = ''; }

  function call(body) {
    return OH.api('/api/admin', Object.assign({ token: token }, body));
  }

  function lock(message) {
    token = null;
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    panel.hidden = true;
    gate.hidden = false;
    $('#admin-stats').hidden = true;
    if (message) {
      var le = $('#login-error');
      le.textContent = message;
      le.hidden = false;
    }
  }

  /* ------------------------------ login ------------------------------ */

  $('#login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var le = $('#login-error');
    le.hidden = true;
    var btn = $('#login-btn');
    btn.disabled = true;
    btn.textContent = 'Checking';
    try {
      var res = await OH.api('/api/admin', { action: 'login', password: $('#password').value });
      token = res.token;
      try { sessionStorage.setItem(KEY, token); } catch (err) {}
      $('#password').value = '';
      open();
    } catch (err) {
      le.textContent = err.message || 'That password was not accepted.';
      le.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Unlock';
    }
  });

  $('#logout-btn').addEventListener('click', function () { lock(null); });

  /* ------------------------------ console ---------------------------- */

  async function open() {
    gate.hidden = true;
    panel.hidden = false;
    $('#admin-stats').hidden = false;

    var cats = await OH.categories();
    $('#g_category').innerHTML = '<option value="">Pick one</option>' + cats.map(function (c) {
      return '<option value="' + OH.esc(c.slug) + '">' + OH.esc(c.name) + '</option>';
    }).join('');

    load();
  }

  $$('.tabs .chip').forEach(function (b) {
    b.addEventListener('click', function () {
      state.status = b.getAttribute('data-status');
      $$('.tabs .chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      load();
    });
  });

  function adminRow(e) {
    var video = e.video_url
      ? '<a href="' + OH.esc(e.video_url) + '" target="_blank" rel="noopener noreferrer">Watch</a>'
      : '<span class="muted">No video</span>';
    var upload = e.upload_token
      ? '<a href="/upload.html?token=' + OH.esc(e.upload_token) + '" target="_blank" rel="noopener noreferrer">Upload link</a>'
      : '';
    var actions = [];
    if (e.status !== 'live') actions.push('<button class="btn" type="button" data-act="approve" data-id="' + OH.esc(e.id) + '">Approve</button>');
    if (e.status !== 'rejected') actions.push('<button class="btn btn-ghost" type="button" data-act="reject" data-id="' + OH.esc(e.id) + '">Reject</button>');

    return '<tr class="admin-row">' +
      '<td class="c-rank">' + OH.money(e.current_bid_cents) + '</td>' +
      '<td class="c-name">' +
        '<a class="cell-name" href="/entry.html?slug=' + OH.esc(e.slug) + '">' + OH.esc(e.display_name) + '</a>' +
        '<span class="cell-sub">' + OH.esc(e.headline) + '</span>' +
        '<span class="cell-sub">' + OH.esc(e.email || '') + '</span>' +
        '<span class="cell-sub">' + video + (upload ? ' · ' + upload : '') + '</span>' +
      '</td>' +
      '<td class="c-role">' + OH.esc(e.category_name || 'Other') + '</td>' +
      '<td class="c-click">' + (e.video_duration ? OH.clock(e.video_duration) : '—') + '</td>' +
      '<td class="c-when">' + OH.esc(OH.timeAgo(e.created_at)) + '</td>' +
      '<td class="c-act"><div class="btn-row">' + actions.join('') + '</div></td>' +
    '</tr>';
  }

  async function load() {
    clearError();
    rows.innerHTML = '<tr><td colspan="6" class="muted">Loading.</td></tr>';
    try {
      var res = await call({ action: 'list', status: state.status });
      $('#c-pending').textContent = OH.int(res.counts.pending);
      $('#c-live').textContent = OH.int(res.counts.live);
      $('#c-rejected').textContent = OH.int(res.counts.rejected);

      if (!res.entries.length) {
        rows.innerHTML = '<tr><td colspan="6" class="empty">Nothing ' + OH.esc(state.status) + '.</td></tr>';
        return;
      }
      rows.innerHTML = res.entries.map(adminRow).join('');
    } catch (err) {
      if (/token|password|expired|unauth/i.test(err.message || '')) return lock('The session expired. Enter the password again.');
      rows.innerHTML = '<tr><td colspan="6" class="empty">Could not load.</td></tr>';
      showError(err.message || 'Request failed.');
    }
  }

  rows.addEventListener('click', async function (e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    clearError();
    b.disabled = true;
    var original = b.textContent;
    b.textContent = '…';
    try {
      await call({ action: b.getAttribute('data-act'), id: b.getAttribute('data-id') });
      load();
    } catch (err) {
      b.disabled = false;
      b.textContent = original;
      showError(err.message || 'That did not go through.');
    }
  });

  /* --------------------------- grant free ---------------------------- */

  $('#grant-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var out = $('#grant-result');
    out.hidden = true;
    var btn = $('#grant-btn');
    btn.disabled = true;
    btn.textContent = 'Granting';
    try {
      var res = await call({
        action: 'grant',
        display_name: $('#g_name').value.trim(),
        email: $('#g_email').value.trim(),
        headline: $('#g_headline').value.trim(),
        portfolio_url: $('#g_portfolio').value.trim(),
        linkedin_url: $('#g_linkedin').value.trim(),
        category_slug: $('#g_category').value,
        amount_cents: Math.max(0, parseInt($('#g_bid').value, 10) || 0) * 100
      });
      var link = window.location.origin + '/upload.html?token=' + encodeURIComponent(res.upload_token);
      out.className = 'notice';
      out.innerHTML = 'Granted. Upload link: <a href="' + OH.esc(link) + '">' + OH.esc(link) + '</a>';
      out.hidden = false;
      e.target.reset();
      load();
    } catch (err) {
      out.className = 'notice notice-live';
      out.textContent = err.message || 'The entry was not created.';
      out.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Grant entry';
    }
  });

  /* ------------------------------ boot ------------------------------- */

  if (token) {
    call({ action: 'list', status: 'pending' }).then(open, function () { lock(null); });
  }
})();
