/* outbid.lol — recruiter magic-link login and applicant dashboard.
 * Candidate emails are not readable with the anon key at all (column
 * privileges, see sql/schema.sql). "Reveal contact" goes through
 * /api/recruiter, which records the reveal and notifies the candidate. */
(function () {
  'use strict';
  var OB = window.OB;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var FREE_INBOXES = [
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'yahoo.com', 'ymail.com', 'proton.me', 'protonmail.com', 'pm.me',
    'icloud.com', 'me.com', 'mac.com', 'aol.com', 'gmx.com', 'zoho.com',
    'mail.com', 'yandex.com', 'tutanota.com', 'fastmail.com',
    'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
    'temp-mail.org', 'throwawaymail.com', 'sharklasers.com', 'yopmail.com',
    'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc'
  ];

  function domainOfEmail(e) { return String(e || '').split('@')[1] ? String(e).split('@')[1].toLowerCase().trim() : ''; }
  function isFreeInbox(e) { return FREE_INBOXES.indexOf(domainOfEmail(e)) !== -1; }

  var state = { sort: 'new', email: null, token: null };

  function loginFail(msg) { $('#login-error').textContent = msg; $('#login-error').classList.remove('hide'); }

  /* ----------------------------- login ------------------------------- */

  $('#login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    $('#login-error').classList.add('hide');
    var email = $('#work-email').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return loginFail('That email does not look right.');
    if (isFreeInbox(email)) {
      return loginFail('Use your work email. Free and disposable inboxes are not accepted, because the domain is what proves you work there.');
    }
    if (OB.OFFLINE) return loginFail('Supabase is not configured yet, so sign-in is unavailable.');

    var btn = $('#send-link');
    btn.disabled = true; btn.textContent = 'Sending';
    try {
      var r = await OB.sb.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: window.location.origin + '/recruiter.html' }
      });
      if (r.error) throw r.error;
      $('#login-form').innerHTML =
        '<div class="notice notice-good">Check <b>' + OB.esc(email) + '</b> for the link. It signs you straight in.</div>';
    } catch (e2) {
      btn.disabled = false; btn.textContent = 'Send the magic link';
      loginFail(e2.message || 'The link could not be sent.');
    }
  });

  /* --------------------------- dashboard ----------------------------- */

  function applicantRow(entry, note) {
    var photo = OB.photoUrl(entry.photo_path);
    var url = OB.safeUrl(entry.url);
    var vid = OB.parseVideo(entry.video_url);
    var n = note || {};
    return '<tr data-entry="' + OB.esc(entry.id) + '">' +
      '<td><div class="media" style="--media:56px">' +
        (photo ? '<img src="' + OB.esc(photo) + '" alt="" loading="lazy">'
               : '<div class="monogram">' + OB.esc((entry.display_name || '?')[0].toUpperCase()) + '</div>') +
      '</div></td>' +
      '<td>' +
        '<b>' + OB.esc(entry.display_name) + '</b>' +
        '<div class="muted" style="font-size:14px;margin-top:4px">' + OB.esc(entry.headline) + '</div>' +
        '<div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap;font-size:13px">' +
          (url ? '<a href="' + OB.esc(url) + '" target="_blank" rel="noopener noreferrer nofollow" data-click="' + OB.esc(entry.id) + '">Portfolio</a>' : '') +
          (vid ? '<a href="' + OB.esc(OB.safeUrl(entry.video_url)) + '" target="_blank" rel="noopener noreferrer">Video</a>' : '') +
        '</div>' +
      '</td>' +
      '<td class="num">' + OB.int(entry.click_count) + '</td>' +
      '<td>' + OB.esc(OB.timeAgo(entry.created_at)) + '</td>' +
      '<td>' +
        '<label style="display:flex;gap:7px;align-items:center;font-size:14px">' +
          '<input type="checkbox" data-shortlist style="width:auto"' + (n.shortlisted ? ' checked' : '') + '> Shortlist' +
        '</label>' +
        '<textarea data-note rows="2" placeholder="Notes" style="margin-top:8px;font-size:14px">' + OB.esc(n.note || '') + '</textarea>' +
        '<div style="margin-top:8px" data-contact>' +
          '<button class="btn btn-sm" type="button" data-reveal>Reveal contact</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }

  function boardBlock(board, entries, notes) {
    var byEntry = {};
    (notes || []).forEach(function (n) { byEntry[n.entry_id] = n; });
    var rows = entries.slice();
    if (state.sort === 'clicks') rows.sort(function (a, b) { return (b.click_count || 0) - (a.click_count || 0); });
    else rows.sort(function (a, b) { return Date.parse(b.created_at) - Date.parse(a.created_at); });

    return '<div class="card" data-board="' + OB.esc(board.id) + '">' +
      '<div class="section-head" style="margin-bottom:10px">' +
        '<h2>' + OB.esc(board.role_title || 'Role') + ' — ' + OB.esc(board.company_name || '') + '</h2>' +
        '<span class="tag">' + entries.length + (entries.length === 1 ? ' applicant' : ' applicants') + '</span>' +
      '</div>' +
      (rows.length
        ? '<div class="tablewrap"><table class="list"><thead><tr>' +
            '<th></th><th>Applicant</th><th>Clicks</th><th>Applied</th><th style="width:230px">Your notes</th>' +
          '</tr></thead><tbody>' + rows.map(function (e) { return applicantRow(e, byEntry[e.id]); }).join('') + '</tbody></table></div>'
        : '<p class="muted">Nobody has applied to this role yet.</p>') +
    '</div>';
  }

  async function loadDash(session) {
    state.email = session.user.email;
    state.token = session.access_token;
    var domain = domainOfEmail(state.email);

    $('#auth-view').classList.add('hide');
    $('#dash-view').classList.remove('hide');
    $('#dash-sub').textContent = 'Signed in as ' + state.email + '.';

    var boards = await OB.sb.from('boards').select('*').eq('company_domain', domain);
    var list = boards.data || [];

    if (!list.length) {
      // Verification failing is not a rejection — small startups use odd
      // domains, so this goes to manual review instead.
      $('#dash-body').innerHTML =
        '<p class="empty">No boards match <b>' + OB.esc(domain) + '</b> yet.<br>' +
        'If you are hiring for a role whose listing uses a different domain, ' +
        '<a href="mailto:hello@outbid.lol?subject=Board%20claim%20for%20' + encodeURIComponent(domain) + '">ask for a manual review</a> ' +
        'and we will check it by hand rather than turn you away.</p>';
      return;
    }

    var blocks = [];
    for (var i = 0; i < list.length; i++) {
      var res = await OB.listEntries({ boardId: list[i].id, sort: 'new', limit: 200 });
      var notes = await OB.sb.from('recruiter_notes').select('*').eq('board_id', list[i].id);
      blocks.push(boardBlock(list[i], res.rows, notes.data));
    }
    $('#dash-body').innerHTML = blocks.join('');
  }

  /* Persist shortlist / notes / reveals through the server. */
  document.addEventListener('change', async function (e) {
    var tr = e.target.closest ? e.target.closest('[data-entry]') : null;
    if (!tr || !state.token) return;
    if (!e.target.matches('[data-shortlist], [data-note]')) return;
    var card = tr.closest('[data-board]');
    try {
      await OB.api('/api/recruiter', {
        action: 'note', token: state.token,
        board_id: card.getAttribute('data-board'),
        entry_id: tr.getAttribute('data-entry'),
        shortlisted: tr.querySelector('[data-shortlist]').checked,
        note: tr.querySelector('[data-note]').value
      });
    } catch (err) { /* keep the typed value; the next change retries */ }
  });

  document.addEventListener('click', async function (e) {
    var btn = e.target.closest ? e.target.closest('[data-reveal]') : null;
    if (!btn || !state.token) return;
    var tr = btn.closest('[data-entry]');
    btn.disabled = true; btn.textContent = 'Revealing';
    try {
      var r = await OB.api('/api/recruiter', {
        action: 'reveal', token: state.token, entry_id: tr.getAttribute('data-entry')
      });
      tr.querySelector('[data-contact]').innerHTML =
        '<a href="mailto:' + OB.esc(r.email) + '">' + OB.esc(r.email) + '</a>' +
        '<div class="muted" style="font-size:13px;margin-top:4px">They have been told you looked.</div>';
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Reveal contact';
    }
  });

  $$('[data-sort]').forEach(function (b) {
    b.addEventListener('click', async function () {
      state.sort = b.getAttribute('data-sort');
      $$('[data-sort]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      var s = await OB.sb.auth.getSession();
      if (s.data.session) loadDash(s.data.session);
    });
  });

  $('#signout').addEventListener('click', async function () {
    await OB.sb.auth.signOut();
    window.location.href = '/recruiter.html';
  });

  (async function boot() {
    if (OB.OFFLINE) return;
    var s = await OB.sb.auth.getSession();
    if (s.data.session) loadDash(s.data.session);
    OB.sb.auth.onAuthStateChange(function (evt, session) { if (session) loadDash(session); });
  })();
})();
