/* OUTHIRE — post-payment video upload.
 * Everything is checked on the device first: duration off a hidden <video>,
 * aspect from videoWidth/videoHeight, size off the File. Only then does the
 * server mint a signed upload URL. */
(function () {
  'use strict';

  var OH = window.OH;
  var $ = function (s) { return document.querySelector(s); };

  var MAX_SECONDS = 45;
  var MIN_SECONDS = 20;
  var MAX_BYTES = 50 * 1024 * 1024;

  var token = OH.qs('token');
  var intro = $('#intro');
  var statusBox = $('#status');
  var uploader = $('#uploader');
  var fileInput = $('#file');
  var dropzone = $('#dropzone');
  var checks = $('#checks');
  var preview = $('#preview');
  var previewVideo = $('#preview-video');
  var probe = $('#probe');
  var errBox = $('#upload-error');
  var uploadBtn = $('#upload-btn');
  var progress = $('#progress');
  var progressLabel = $('#progress-label');

  var chosen = null;   // { file, duration, width, height }

  function note(html, live) {
    statusBox.className = 'notice' + (live ? ' notice-live' : '');
    statusBox.innerHTML = html;
    statusBox.hidden = false;
  }
  function fail(html) {
    errBox.className = 'notice notice-live';
    errBox.innerHTML = html;
    errBox.hidden = false;
  }
  function clearFail() { errBox.hidden = true; errBox.innerHTML = ''; }

  function setCheck(name, state, value) {
    var li = checks.querySelector('[data-check="' + name + '"]');
    if (!li) return;
    li.setAttribute('data-state', state);
    li.querySelector('.state').textContent = value;
  }

  /* ------------------------------------------------------------------
     Gate on the token before showing the form at all.
     ------------------------------------------------------------------ */

  (async function start() {
    if (!token) {
      intro.textContent = 'This page needs the upload link from your receipt email.';
      note('No upload token in the address. The link in your email looks like <span class="num">/upload.html?token=…</span>. If you paid and never got it, reply to the receipt.');
      return;
    }
    try {
      var res = await OH.api('/api/upload-url', { action: 'status', token: token });
      var e = res.entry;
      intro.innerHTML = 'Filed as <strong>' + OH.esc(e.display_name) + '</strong>, bid <span class="num">' +
        OH.money(e.current_bid_cents) + '</span>. One video, forty-five seconds or under.';
      if (e.has_video && e.status === 'live') {
        note('Your video is already up and the entry is live. <a href="/entry.html?slug=' + OH.esc(e.slug) + '">See it on the board</a>. Uploading again replaces it and sends the entry back to review.');
      } else if (e.has_video) {
        note('Your video is uploaded and waiting on review. Uploading again replaces it.');
      }
      uploader.hidden = false;
    } catch (err) {
      intro.textContent = 'That upload link is not valid.';
      note(OH.esc(err.message || 'The token was not recognised.') + ' If you have paid, the link in your receipt email is the one that works.');
    }
  })();

  /* ------------------------------------------------------------------
     File selection and local validation.
     ------------------------------------------------------------------ */

  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) inspect(fileInput.files[0]);
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove('is-over'); });
  });
  dropzone.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) inspect(f);
  });

  function readMetadata(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true; URL.revokeObjectURL(url);
        reject(new Error('The browser could not read that file as video.'));
      }, 15000);

      probe.onloadedmetadata = function () {
        if (done) return;
        done = true; clearTimeout(timer);
        var meta = {
          duration: probe.duration,
          width: probe.videoWidth,
          height: probe.videoHeight,
          url: url
        };
        resolve(meta);
      };
      probe.onerror = function () {
        if (done) return;
        done = true; clearTimeout(timer); URL.revokeObjectURL(url);
        reject(new Error('That file could not be decoded. Try an MP4.'));
      };
      probe.src = url;
    });
  }

  async function inspect(file) {
    clearFail();
    chosen = null;
    uploadBtn.disabled = true;
    checks.hidden = false;
    preview.hidden = true;
    progress.hidden = true;
    progressLabel.hidden = true;

    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
      return fail('That is not a video file.');
    }

    var meta;
    try {
      meta = await readMetadata(file);
    } catch (err) {
      return fail(OH.esc(err.message));
    }

    var seconds = meta.duration;
    var sizeMb = file.size / (1024 * 1024);
    var portrait = meta.height > meta.width;
    var problems = [];

    if (!isFinite(seconds) || seconds <= 0) {
      setCheck('duration', 'fail', '—');
      problems.push('The length of that file could not be read.');
    } else if (seconds > MAX_SECONDS + 0.5) {
      setCheck('duration', 'fail', OH.clock(seconds));
      problems.push('Video must be under 45 seconds. This one is <span class="num">' + OH.clock(seconds) + '</span>.');
    } else {
      setCheck('duration', 'ok', OH.clock(seconds));
    }

    if (isFinite(seconds) && seconds > 0 && seconds < MIN_SECONDS) {
      setCheck('min', 'fail', OH.clock(seconds));
      problems.push('Minimum is 20 seconds. This one is <span class="num">' + OH.clock(seconds) + '</span>.');
    } else {
      setCheck('min', isFinite(seconds) && seconds >= MIN_SECONDS ? 'ok' : 'fail', isFinite(seconds) ? OH.clock(seconds) : '—');
    }

    if (!meta.width || !meta.height) {
      setCheck('portrait', 'fail', '—');
    } else if (!portrait) {
      setCheck('portrait', 'fail', meta.width + '×' + meta.height);
      problems.push('The feed is portrait only. This one is <span class="num">' + meta.width + '×' + meta.height + '</span>.');
    } else {
      setCheck('portrait', 'ok', meta.width + '×' + meta.height);
    }

    if (file.size > MAX_BYTES) {
      setCheck('size', 'fail', sizeMb.toFixed(1) + 'MB');
      problems.push('Files have to be under 50MB. This one is <span class="num">' + sizeMb.toFixed(1) + 'MB</span>.');
    } else {
      setCheck('size', 'ok', sizeMb.toFixed(1) + 'MB');
    }

    previewVideo.src = meta.url;
    preview.hidden = false;

    if (problems.length) {
      fail(problems.join('</p><p style="margin-top:8px">'));
      return;
    }

    chosen = { file: file, duration: Math.round(seconds), width: meta.width, height: meta.height };
    uploadBtn.disabled = false;
  }

  /* ------------------------------------------------------------------
     Upload. XHR, because fetch has no upload progress event.
     ------------------------------------------------------------------ */

  function put(url, file, headers, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      Object.keys(headers || {}).forEach(function (k) { xhr.setRequestHeader(k, headers[k]); });
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error('Storage rejected the upload (' + xhr.status + ').'));
      };
      xhr.onerror = function () { reject(new Error('The upload connection dropped.')); };
      xhr.send(file);
    });
  }

  uploadBtn.addEventListener('click', async function () {
    if (!chosen) return;
    clearFail();
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading';
    progress.hidden = false;
    progressLabel.hidden = false;

    function tick(fraction) {
      var pct = Math.round(fraction * 100);
      progress.firstElementChild.style.width = pct + '%';
      progressLabel.textContent = pct + '%';
    }
    tick(0);

    try {
      var signed = await OH.api('/api/upload-url', {
        action: 'sign',
        token: token,
        filename: chosen.file.name,
        content_type: chosen.file.type || 'video/mp4',
        size: chosen.file.size
      });

      await put(signed.signedUrl, chosen.file, {
        'x-upsert': 'true',
        'Content-Type': chosen.file.type || 'video/mp4'
      }, tick);

      tick(1);

      await OH.api('/api/upload-url', {
        action: 'complete',
        token: token,
        path: signed.path,
        duration: chosen.duration
      });

      uploader.hidden = true;
      intro.textContent = 'Uploaded.';
      note('Your video is in. It goes to review before it appears on the board, which is usually the same day. You keep your bid and your rank while it is pending.');
    } catch (err) {
      progress.hidden = true;
      progressLabel.hidden = true;
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload and submit';
      fail(OH.esc(err.message || 'The upload failed. Nothing was changed.'));
    }
  });
})();
