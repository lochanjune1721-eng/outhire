/* outbid.lol — post-payment media upload.
 * Photos are resized to 800px square in the browser before they leave the
 * device: these load on every page view and are the one thing that must be
 * fast. The signed upload URL is minted server-side against the token. */
(function () {
  'use strict';
  var OB = window.OB;
  var $ = function (s) { return document.querySelector(s); };

  var token = OB.qs('token');
  var intro = $('#intro'), status = $('#status'), form = $('#uploader');
  var fileInput = $('#file'), dz = $('#dropzone'), go = $('#go');
  var errBox = $('#upload-error'), bar = $('#progress');
  var chosen = null;   // { blob, dataUrl }
  var MAX_BYTES = 5 * 1024 * 1024;

  function say(msg, kind) {
    status.textContent = msg;
    status.className = 'notice' + (kind ? ' notice-' + kind : '');
  }
  function fail(msg) { errBox.textContent = msg; errBox.classList.remove('hide'); }
  function clearFail() { errBox.classList.add('hide'); errBox.textContent = ''; }

  function refresh() {
    var video = OB.parseVideo($('#video').value);
    go.disabled = !chosen && !video;
    var hint = $('#video-hint');
    var raw = $('#video').value.trim();
    if (!raw) hint.textContent = '';
    else if (video) hint.textContent = 'Recognised: ' + video.platform + '.';
    else hint.textContent = 'That is not a YouTube or Vimeo link.';
  }

  /* ------------------- resize to 800px square, client-side ----------- */

  function processImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) return reject(new Error('That file is not an image.'));
      if (file.size > MAX_BYTES) return reject(new Error('That image is ' + (file.size / 1048576).toFixed(1) + 'MB. The cap is 5MB.'));
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var side = Math.min(img.naturalWidth, img.naturalHeight);
        var out = Math.min(800, side);
        var c = document.createElement('canvas');
        c.width = out; c.height = out;
        var ctx = c.getContext('2d');
        // Centre-crop to a square, then scale. Matches the object-fit: cover
        // the card uses, so what you see here is what the board renders.
        ctx.drawImage(img,
          (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
          0, 0, out, out);
        c.toBlob(function (blob) {
          if (!blob) return reject(new Error('Could not read that image.'));
          resolve({ blob: blob, dataUrl: c.toDataURL('image/jpeg', 0.85) });
        }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
      img.src = url;
    });
  }

  async function take(file) {
    clearFail();
    try {
      chosen = await processImage(file);
      $('#thumb-img').src = chosen.dataUrl;
      $('#thumb').classList.remove('hide');
      refresh();
    } catch (e) { chosen = null; $('#thumb').classList.add('hide'); fail(e.message); refresh(); }
  }

  fileInput.addEventListener('change', function () { if (fileInput.files[0]) take(fileInput.files[0]); });
  $('#video').addEventListener('input', refresh);

  ['dragenter', 'dragover'].forEach(function (t) {
    dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.remove('is-over'); });
  });
  dz.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) take(f);
  });

  /* --------------------------- token check --------------------------- */

  (async function start() {
    if (!token) { intro.textContent = 'This page needs the upload link that was emailed to you after payment.'; return; }
    if (OB.OFFLINE) { intro.textContent = 'Supabase is not configured yet, so this link cannot be checked.'; return; }
    try {
      var r = await OB.api('/api/upload-url', { action: 'status', token: token });
      intro.textContent = 'You are adding media for ' + r.entry.display_name + '. Add a photo, a video link, or both.';
      if (r.entry.has_media) say('This spot already has media. Uploading again replaces it.', null), status.classList.remove('hide');
      form.classList.remove('hide');
      refresh();
    } catch (e) {
      intro.textContent = e.message || 'That upload link is not valid.';
    }
  })();

  /* ----------------------------- publish ----------------------------- */

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearFail();
    var video = OB.parseVideo($('#video').value);
    if (!chosen && !video) return fail('Add a photo or a video link. At least one is required.');
    if ($('#video').value.trim() && !video) return fail('That video link is not YouTube or Vimeo.');

    go.disabled = true; go.textContent = 'Publishing';
    bar.classList.remove('hide');
    var fill = bar.querySelector('i');
    var path = null;

    try {
      if (chosen) {
        fill.style.width = '15%';
        var signed = await OB.api('/api/upload-url', {
          action: 'sign', token: token, content_type: 'image/jpeg'
        });
        fill.style.width = '35%';
        var put = await fetch(signed.signed_url, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
          body: chosen.blob
        });
        if (!put.ok) throw new Error('The upload was rejected (' + put.status + ').');
        path = signed.path;
        fill.style.width = '75%';
      }

      var done = await OB.api('/api/upload-url', {
        action: 'complete', token: token, photo_path: path,
        video_url: video ? $('#video').value.trim() : null,
        video_platform: video ? video.platform : null
      });
      fill.style.width = '100%';
      form.classList.add('hide');
      status.classList.remove('hide');
      say('Published. Your spot is in review and appears on the board once it is approved.', 'good');
      if (done.slug) {
        status.innerHTML += ' <a href="/entry.html?slug=' + OB.esc(done.slug) + '">See your entry</a>.';
      }
    } catch (e2) {
      bar.classList.add('hide');
      go.disabled = false; go.textContent = 'Publish my spot';
      fail(e2.message || 'The upload failed. Nothing was lost — try again.');
    }
  });
})();
