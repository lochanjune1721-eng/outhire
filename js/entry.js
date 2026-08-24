/* outbid.lol — single entry (?slug=). */
(function () {
  'use strict';
  var OB = window.OB, B = window.OBBoard;
  var host = document.getElementById('solo'); if (!host) return;

  async function boot() {
    var slug = OB.qs('slug');
    if (!slug) { host.innerHTML = '<p class="empty">No entry named. Try the <a href="/">leaderboard</a>.</p>'; return; }

    var entry = await OB.getEntry(slug);
    if (!entry) {
      host.innerHTML = '<p class="empty">No live entry at that address. It may still be in review.</p>';
      return;
    }
    document.title = entry.display_name + ' — outbid.lol';

    var url = OB.safeUrl(entry.url);
    var isRecruiter = entry.side === 'recruiter';

    host.innerHTML =
      '<h1>' + OB.esc(entry.display_name) + '</h1>' +
      '<p class="lede">' + OB.esc(entry.headline) + '</p>' +
      '<div class="board" style="margin-top:24px" id="solo-row"></div>' +
      '<div class="card" style="margin-top:16px">' +
        '<h2>' + (isRecruiter ? 'The role' : 'The details') + '</h2>' +
        '<div class="tablewrap"><table class="list"><tbody>' +
          '<tr><th>Current bid</th><td class="num coral">' + OB.money(entry.current_bid_cents) + '</td></tr>' +
          '<tr><th>Category</th><td>' + OB.esc(entry.category || '—') + '</td></tr>' +
          '<tr><th>Clicks</th><td class="num">' + OB.int(entry.click_count) + '</td></tr>' +
          '<tr><th>' + (isRecruiter ? 'Company' : 'Portfolio') + '</th><td>' +
            (url ? '<a href="' + OB.esc(url) + '" target="_blank" rel="noopener noreferrer nofollow" data-click="' + OB.esc(entry.id) + '">' + OB.esc(OB.domainOf(url)) + '</a>' : '—') +
          '</td></tr>' +
          '<tr><th>On the board</th><td>' + OB.esc(OB.longAgo(entry.created_at)) + '</td></tr>' +
        '</tbody></table></div>' +
      '</div>';

    // Reuse the leaderboard card so the entry looks identical to its row.
    B.render(document.getElementById('solo-row'), [entry], 1, {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
