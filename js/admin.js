/* GOAT.lol — the manual review pass. Auto-fetch gives roughly 60% usable
 * photos and some odd name choices, so this is where a board stops looking
 * scraped: swap bad photos, delete wrong entries, add obvious missing names. */
(function () {
  'use strict';
  var G = window.G;
  var $ = function (s) { return document.querySelector(s); };
  var token = null, slug = null;
  try { token = sessionStorage.getItem('goat_admin'); } catch (e) {}

  $('#login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    $('#login-error').classList.add('hide');
    try {
      var r = await G.api('/api/admin', { action: 'login', password: $('#pw').value });
      token = r.token;
      try { sessionStorage.setItem('goat_admin', token); } catch (e2) {}
      open();
    } catch (e3) {
      $('#login-error').textContent = e3.message;
      $('#login-error').classList.remove('hide');
    }
  });

  async function open() {
    $('#login').classList.add('hide');
    $('#panel').classList.remove('hide');
    var cats = await G.categories();
    $('#cat').innerHTML = '<option value="">Pick a board</option>' + cats.map(function (c) {
      return '<option value="' + G.esc(c.slug) + '">' + G.esc(c.group_name || '') + ' — ' + G.esc(c.name) + '</option>';
    }).join('');
  }

  $('#cat').addEventListener('change', function () { slug = this.value; load(); });

  async function load() {
    var host = $('#rows');
    if (!slug) { host.innerHTML = '<p class="muted">Pick a board.</p>'; return; }
    host.innerHTML = '<p class="muted">Loading.</p>';
    try {
      var r = await G.api('/api/admin', { action: 'list', token: token, slug: slug });
      host.innerHTML =
        r.people.map(function (p) {
          return '<div class="row" data-id="' + G.esc(p.id) + '" style="align-items:flex-start">' +
            G.photo(p, { plain: true, style: 'width:72px' }) +
            '<div class="row-body">' +
              '<div class="field" style="margin-top:0"><label>Name</label><input data-f="name" value="' + G.esc(p.name || '') + '"></div>' +
              '<div class="field"><label>One line</label><input data-f="blurb" value="' + G.esc(p.blurb || '') + '"></div>' +
              '<div class="field"><label>Photo path <span class="muted">— in the photos bucket, or a full URL</span></label>' +
                '<input data-f="photo_path" value="' + G.esc(p.photo_path || '') + '"></div>' +
              '<div class="field"><label>Photo credit</label><input data-f="photo_credit" value="' + G.esc(p.photo_credit || '') + '"></div>' +
              '<div class="field"><label>Licence</label><input data-f="photo_license" value="' + G.esc(p.photo_license || '') + '"></div>' +
              '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                '<button class="btn btn-sm btn-gold" type="button" data-save>Save</button>' +
                (p.total_cents > 0
                  ? '<span class="muted" style="font-size:12px">' + G.money(p.total_cents) + ' backed — permanent, cannot be deleted</span>'
                  : '<button class="btn btn-sm" type="button" data-del>Delete</button>') +
                '<span class="muted" data-note style="font-size:12px"></span>' +
              '</div>' +
            '</div></div>';
        }).join('') +
        '<div class="panel" style="margin-top:16px"><h2>Add a missing name</h2>' +
          '<div class="field"><label>Name</label><input id="new-name"></div>' +
          '<div class="field"><label>Wikipedia URL</label><input id="new-wiki" type="url"></div>' +
          '<div class="field"><label>One line</label><input id="new-blurb"></div>' +
          '<div style="margin-top:12px"><button class="btn btn-gold" type="button" id="new-go">Add at $0</button></div>' +
        '</div>';
    } catch (e) {
      host.innerHTML = '<p class="muted">' + G.esc(e.message) + '</p>';
      if (/token/i.test(e.message)) { try { sessionStorage.removeItem('goat_admin'); } catch (x) {} }
    }
  }

  $('#rows').addEventListener('click', async function (e) {
    var save = e.target.closest('[data-save]');
    var del = e.target.closest('[data-del]');
    var add = e.target.closest('#new-go');

    if (add) {
      add.disabled = true;
      try {
        await G.api('/api/admin', {
          action: 'add', token: token, slug: slug,
          name: $('#new-name').value, wikipedia_url: $('#new-wiki').value, blurb: $('#new-blurb').value
        });
        load();
      } catch (err) { add.disabled = false; alert(err.message); }
      return;
    }

    var row = e.target.closest('[data-id]');
    if (!row) return;
    var note = row.querySelector('[data-note]');

    if (save) {
      var patch = { action: 'update', token: token, id: row.getAttribute('data-id') };
      Array.prototype.forEach.call(row.querySelectorAll('[data-f]'), function (i) {
        patch[i.getAttribute('data-f')] = i.value;
      });
      try { await G.api('/api/admin', patch); note.textContent = 'Saved.'; }
      catch (err) { note.textContent = err.message; }
      setTimeout(function () { note.textContent = ''; }, 3000);
    }

    if (del) {
      try { await G.api('/api/admin', { action: 'delete', token: token, id: row.getAttribute('data-id') }); row.remove(); }
      catch (err) { note.textContent = err.message; }
    }
  });

  if (token) open();
})();
