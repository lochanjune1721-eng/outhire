/* outbid.lol — admin. The password is verified by /api/admin and never
 * compared in the browser; the server returns a short-lived signed token. */
(function () {
  'use strict';
  var OB = window.OB;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var token = null, status = 'pending';
  try { token = sessionStorage.getItem('ob_admin') || null; } catch (e) {}

  function fail(msg) { $('#login-error').textContent = msg; $('#login-error').classList.remove('hide'); }

  $('#g_category').innerHTML = OB.CATEGORIES.map(function (c) { return '<option>' + OB.esc(c) + '</option>'; }).join('');

  $('#login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    $('#login-error').classList.add('hide');
    try {
      var r = await OB.api('/api/admin', { action: 'login', password: $('#pw').value });
      token = r.token;
      try { sessionStorage.setItem('ob_admin', token); } catch (e2) {}
      open();
    } catch (e3) { fail(e3.message || 'That password was not accepted.'); }
  });

  function open() {
    $('#login').classList.add('hide');
    $('#panel').classList.remove('hide');
    load();
  }

  async function load() {
    var host = $('#rows');
    host.innerHTML = '<p class="muted">Loading.</p>';
    try {
      var r = await OB.api('/api/admin', { action: 'list', token: token, status: status });
      if (!r.entries.length) { host.innerHTML = '<p class="muted">Nothing ' + status + '.</p>'; return; }
      host.innerHTML = '<div class="tablewrap"><table class="list"><thead><tr>' +
        '<th>Name</th><th>One-liner</th><th>Side</th><th>Bid</th><th>Media</th><th>Actions</th>' +
        '</tr></thead><tbody>' + r.entries.map(function (e) {
          return '<tr data-id="' + OB.esc(e.id) + '">' +
            '<td><b>' + OB.esc(e.display_name) + '</b><div class="muted" style="font-size:13px">' + OB.esc(OB.domainOf(e.url)) + '</div></td>' +
            '<td>' + OB.esc(e.headline) + '</td>' +
            '<td>' + OB.esc(e.side) + '</td>' +
            '<td class="num">' + OB.money(e.current_bid_cents) + '</td>' +
            '<td>' + (e.photo_path ? 'photo ' : '') + (e.video_url ? 'video' : '') + (!e.photo_path && !e.video_url ? '<span class="coral">none</span>' : '') + '</td>' +
            '<td><div style="display:flex;gap:6px;flex-wrap:wrap">' +
              (status !== 'live' ? '<button class="btn btn-sm" type="button" data-act="approve">Approve</button>' : '') +
              (status !== 'rejected' ? '<button class="btn btn-sm" type="button" data-act="reject">Reject</button>' : '') +
            '</div></td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>';
    } catch (e) {
      host.innerHTML = '<p class="muted">' + OB.esc(e.message) + '</p>';
      if (/token/i.test(e.message)) { token = null; try { sessionStorage.removeItem('ob_admin'); } catch (x) {} }
    }
  }

  $('#rows').addEventListener('click', async function (e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    var tr = b.closest('[data-id]');
    b.disabled = true;
    try {
      await OB.api('/api/admin', { action: b.getAttribute('data-act'), token: token, id: tr.getAttribute('data-id') });
      tr.remove();
    } catch (err) { b.disabled = false; }
  });

  $$('[data-status]').forEach(function (b) {
    b.addEventListener('click', function () {
      status = b.getAttribute('data-status');
      $$('[data-status]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      load();
    });
  });

  $('#grant').addEventListener('click', async function () {
    var box = $('#grant-result');
    box.classList.add('hide');
    try {
      var r = await OB.api('/api/admin', {
        action: 'grant', token: token,
        display_name: $('#g_name').value.trim(),
        email: $('#g_email').value.trim(),
        url: $('#g_url').value.trim(),
        headline: $('#g_headline').value.trim(),
        side: $('#g_side').value,
        category: $('#g_category').value
      });
      box.className = 'notice notice-good';
      box.innerHTML = 'Granted. Upload link: <a href="' + OB.esc(r.upload_url) + '">' + OB.esc(r.upload_url) + '</a>';
      box.classList.remove('hide');
    } catch (e) {
      box.className = 'notice notice-bad';
      box.textContent = e.message; box.classList.remove('hide');
    }
  });

  if (token) open();
})();
