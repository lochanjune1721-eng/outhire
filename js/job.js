/* outbid.lol — spawn a role board from a pasted job link.
 * The whitelist is checked here for a fast answer and again in
 * /api/parse-job, which is the copy that actually gates board creation.
 * The parse is never trusted silently: it always comes back for confirmation. */
(function () {
  'use strict';
  var OB = window.OB;
  var $ = function (s) { return document.querySelector(s); };

  var errBox = $('#job-error'), confirmForm = $('#confirm');
  var lastUrl = '';

  $('#hosts').textContent = 'Accepted: ' + OB.JOB_HOSTS.join(', ') + '.';

  function fail(msg) { errBox.textContent = msg; errBox.classList.remove('hide'); }
  function clearFail() { errBox.classList.add('hide'); errBox.textContent = ''; }

  function showConfirm(parsed, manual, note) {
    $('#company').value = parsed.company_name || '';
    $('#role').value = parsed.role_title || '';
    $('#location').value = parsed.location || '';
    $('#seniority').value = parsed.seniority || '';
    $('#paste-field').classList.toggle('hide', !manual);
    $('#confirm-title').textContent = manual ? 'We could not read that listing' : 'Confirm the role';
    $('#confirm-note').textContent = note || (manual
      ? 'That platform blocked the fetch. Paste the job description below and we will read it from the text, or just fill the fields in yourself.'
      : 'Check these before the board goes live.');
    confirmForm.classList.remove('hide');
    confirmForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function parse(text) {
    clearFail();
    var raw = $('#joburl').value.trim();
    if (!raw) return fail('Paste a job listing URL first.');
    if (!OB.jobHostAllowed(raw)) {
      return fail('That link isn’t from a hiring platform we recognise.');
    }
    lastUrl = OB.safeUrl(raw);

    var btn = text ? $('#reparse') : $('#parse');
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Reading';
    try {
      var r = await OB.api('/api/parse-job', { url: lastUrl, text: text || null });
      showConfirm(r.parsed || {}, !!r.manual, r.note);
    } catch (e) {
      // A failed fetch is the expected path on LinkedIn, not an error state.
      showConfirm({}, true, e.message);
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }

  $('#parse').addEventListener('click', function () { parse(null); });
  $('#reparse').addEventListener('click', function () {
    var t = $('#paste').value.trim();
    if (t.length < 40) return fail('Paste a bit more of the listing — there is not enough text to read.');
    parse(t);
  });

  confirmForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearFail();
    var body = {
      url: lastUrl,
      company_name: $('#company').value.trim(),
      role_title: $('#role').value.trim(),
      location: $('#location').value.trim(),
      seniority: $('#seniority').value.trim(),
      confirmed: true
    };
    if (!body.company_name || !body.role_title) return fail('Company and role title are both required.');

    var btn = $('#create');
    btn.disabled = true; btn.textContent = 'Creating';
    try {
      var r = await OB.api('/api/parse-job', body);
      window.location.href = '/board.html?slug=' + encodeURIComponent(r.slug);
    } catch (e2) {
      btn.disabled = false; btn.textContent = 'Create the board';
      fail(e2.message || 'The board could not be created.');
    }
  });
})();
