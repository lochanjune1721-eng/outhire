/* outbid.lol — entry form. Validates here, then hands to /api/checkout,
 * which is the only thing allowed to create the row. */
(function () {
  'use strict';
  var OB = window.OB;
  var $ = function (s) { return document.querySelector(s); };

  var form = $('#form'); if (!form) return;
  var side = OB.qs('side') === 'recruiter' ? 'recruiter' : 'candidate';
  var boardSlug = OB.qs('board') || '';
  var err = $('#form-error'), btn = $('#pay-btn'), bid = $('#bid');

  function fail(msg) { err.textContent = msg; err.classList.remove('hide'); err.scrollIntoView({ block: 'nearest' }); }
  function clear() { err.classList.add('hide'); err.textContent = ''; }
  function dollars() { var n = parseInt(bid.value, 10); return isNaN(n) ? 0 : n; }
  function syncAmount() { $('#pay-amount').textContent = '$' + Math.max(0, dollars()).toLocaleString('en-US'); }

  /* ---------------------- recruiter vs candidate copy ---------------- */

  if (side === 'recruiter') {
    $('#page-title').textContent = 'Post an open role';
    $('#page-lede').textContent = 'Fill this in, pay, then upload your logo. Minimum bid is $5.';
    $('#lbl-name').innerHTML = 'Company name <span class="req">*</span>';
    $('#lbl-email').innerHTML = 'Work email <span class="req">*</span>';
    $('#lbl-url').innerHTML = 'Company URL <span class="req">*</span>';
    $('#lbl-headline').innerHTML = 'One-liner <span class="req">*</span>';
    $('#headline').placeholder = 'The role, and why someone should want it. One line.';
    $('#hint-email').textContent = 'Never shown on the board. Your upload link goes here.';
    $('#job-field').classList.remove('hide');
    document.title = 'Post an open role — outbid.lol';
  }

  /* ------------------------------ prefill ---------------------------- */

  $('#url').value = OB.qs('url') || '';
  var wanted = parseInt(OB.qs('bid'), 10);
  if (!isNaN(wanted) && wanted >= 5) bid.value = String(wanted);

  OB.CATEGORIES.forEach(function (c) {
    var o = document.createElement('option'); o.textContent = c; $('#category').appendChild(o);
  });
  var preCat = OB.qs('category'); if (preCat) $('#category').value = preCat;

  $('#headline').addEventListener('input', function () {
    $('#headline-count').textContent = String($('#headline').value.length);
  });
  bid.addEventListener('input', syncAmount);
  bid.addEventListener('change', syncAmount);
  syncAmount();

  /* Arrived from a "Claim this rank" button, or from a role board. */
  (async function context() {
    var box = $('#context');
    var lines = [];

    var claim = OB.qs('claim');
    if (claim) {
      var target = await OB.getEntry(claim);
      if (target) {
        lines.push('You are claiming the spot held by <b>' + OB.esc(target.display_name) +
          '</b> at <b>' + OB.money(target.current_bid_cents) + '</b>. Anything above that takes the rank; ' +
          'anything below still puts you on the board.');
      }
    }
    if (boardSlug) {
      var board = await OB.getBoard(boardSlug);
      if (board) {
        lines.push('This entry joins the board for <b>' + OB.esc(board.role_title || 'this role') +
          (board.company_name ? '</b> at <b>' + OB.esc(board.company_name) : '') + '</b>.');
        // Role boards are a flat $5, no bidding.
        bid.value = '5'; bid.readOnly = true; syncAmount();
        $('#bid-hint').innerHTML = 'Role boards are a flat <span class="num">$5</span>. No bidding.';
      }
    }
    if (lines.length) { box.innerHTML = lines.join('<br>'); box.classList.remove('hide'); }
  })();

  /* ------------------------------ submit ----------------------------- */

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clear();

    var data = {
      side: side,
      board_slug: boardSlug,
      display_name: $('#display_name').value.trim(),
      email: $('#email').value.trim(),
      url: $('#url').value.trim(),
      headline: $('#headline').value.trim(),
      category: $('#category').value,
      job_url: side === 'recruiter' ? $('#job_url').value.trim() : '',
      amount_cents: dollars() * 100
    };

    var who = side === 'recruiter' ? 'company name' : 'name';
    if (!data.display_name) return fail('Add your ' + who + '. It is what the board lists you under.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) return fail('That email does not look right. Your upload link has nowhere else to go.');
    if (!OB.safeUrl(data.url)) return fail('That URL needs to start with http or https.');
    if (!data.headline) return fail('Add your one-liner.');
    if (data.headline.length > 120) return fail('The one-liner is capped at 120 characters. This one is ' + data.headline.length + '.');
    if (!data.category) return fail('Choose a category.');
    if (data.job_url && !OB.safeUrl(data.job_url)) return fail('That job listing URL needs to start with http or https.');
    if (data.amount_cents < 500) return fail('Minimum bid is $5.');

    btn.disabled = true;
    var original = btn.innerHTML;
    btn.textContent = 'Opening Stripe';
    try {
      var res = await OB.api('/api/checkout', data);
      if (!res || !res.url) throw new Error('Checkout did not return a session.');
      window.location.href = res.url;
    } catch (e2) {
      btn.disabled = false; btn.innerHTML = original;
      fail(e2.message || 'Checkout failed. Nothing was charged.');
    }
  });
})();
