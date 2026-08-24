/* OUTHIRE — entry form. Validates in the browser, then hands off to
 * /api/checkout, which is the only thing allowed to create the row. */
(function () {
  'use strict';

  var OH = window.OH;
  var $ = function (s) { return document.querySelector(s); };

  var form = $('#form');
  if (!form) return;

  var errBox = $('#form-error');
  var btn = $('#submit-btn');
  var amountEl = $('#submit-amount');
  var bid = $('#bid');
  var headline = $('#headline');
  var count = $('#headline-count');
  var select = $('#category_slug');

  /* ------------------------------------------------------------------ */

  function fail(msg) {
    errBox.innerHTML = OH.esc(msg);
    errBox.hidden = false;
    errBox.scrollIntoView({ block: 'nearest' });
  }
  function clearFail() { errBox.hidden = true; errBox.innerHTML = ''; }

  function dollars() {
    var n = parseInt(bid.value, 10);
    return isNaN(n) ? 0 : n;
  }

  function syncAmount() {
    var d = dollars();
    amountEl.textContent = '$' + (d > 0 ? d.toLocaleString('en-US') : '0');
  }

  bid.addEventListener('input', syncAmount);
  bid.addEventListener('change', syncAmount);

  headline.addEventListener('input', function () {
    count.textContent = String(headline.value.length);
  });

  /* --------------------------- categories --------------------------- */

  OH.categories().then(function (cats) {
    select.innerHTML = '<option value="">Pick one</option>' + cats.map(function (c) {
      return '<option value="' + OH.esc(c.slug) + '">' + OH.esc(c.name) + '</option>';
    }).join('');
    var pre = OH.qs('category');
    if (pre) select.value = pre;
  });

  /* ----------------------- claim context ---------------------------- */
  /* Arrived from a "Claim this rank" button: prefill the bid and say plainly
     what that money buys. */

  (async function claimContext() {
    var slug = OH.qs('claim');
    var wanted = parseInt(OH.qs('bid'), 10);
    if (!isNaN(wanted) && wanted >= 5) { bid.value = String(wanted); syncAmount(); }

    var boardToken = OH.qs('board');
    var box = $('#claim-context');

    var lines = [];
    if (slug) {
      var target = await OH.getEntry(slug);
      if (target) {
        var rank = await OH.rankOf(target);
        lines.push('You are claiming rank <span class="num">#' + OH.esc(String(rank)) +
          '</span> from ' + OH.esc(target.display_name) + ', who is holding it at <span class="num">' +
          OH.money(target.current_bid_cents) + '</span>. Anything above that takes the rank.');
      }
    }
    if (boardToken) {
      var board = await OH.getBoardByToken(boardToken);
      if (board) {
        lines.push('Your entry joins the board for ' + OH.esc(board.role_title || 'this role') +
          (board.company_name ? ' at ' + OH.esc(board.company_name) : '') + ', and the main feed.');
      }
    }
    if (lines.length) {
      box.className = 'notice';
      box.innerHTML = lines.join('</p><p style="margin-top:8px">');
      box.hidden = false;
    }
  })();

  syncAmount();

  /* ----------------------------- submit ----------------------------- */

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearFail();

    var data = {
      display_name: $('#display_name').value.trim(),
      email: $('#email').value.trim(),
      headline: headline.value.trim(),
      portfolio_url: $('#portfolio_url').value.trim(),
      linkedin_url: $('#linkedin_url').value.trim(),
      category_slug: select.value,
      job_url: $('#job_url').value.trim(),
      board_token: OH.qs('board') || '',
      amount_cents: dollars() * 100
    };

    if (!data.display_name) return fail('Add a name. It is what the board lists you under.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) return fail('That email does not look right. The upload link has nowhere else to go.');
    if (!data.headline) return fail('Add a headline. One line on what you did.');
    if (data.headline.length > 140) return fail('Headline must be 140 characters or under. This one is ' + data.headline.length + '.');
    if (!data.category_slug) return fail('Pick a role.');
    if (data.portfolio_url && !OH.safeUrl(data.portfolio_url)) return fail('The portfolio URL needs to start with http or https.');
    if (data.linkedin_url && !OH.safeUrl(data.linkedin_url)) return fail('The LinkedIn URL needs to start with http or https.');
    if (data.job_url && !OH.safeUrl(data.job_url)) return fail('The job URL needs to start with http or https.');
    if (data.amount_cents < 500) return fail('Minimum bid is $5. This one is ' + OH.moneyExact(data.amount_cents) + '.');

    btn.disabled = true;
    var original = btn.innerHTML;
    btn.textContent = 'Opening Stripe';

    try {
      var res = await OH.api('/api/checkout', data);
      if (!res || !res.url) throw new Error('Checkout did not return a session.');
      window.location.href = res.url;
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = original;
      fail(err.message || 'Checkout failed. Nothing was charged.');
    }
  });
})();
