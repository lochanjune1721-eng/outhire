/* POST /api/board — create a recruiter board.
 *
 * Free, no account. `boards` is public-read but not public-write under RLS,
 * so the insert has to happen here with the service role key.
 *
 * Body: { company_name, role_title, job_url?, recruiter_email? }
 * 200:  { share_token, url }
 */
import { json, bad, readJson, methodGuard, str, isEmail, httpUrl, token, insertRow, selectOne, siteUrl } from './_lib.js';

export default async function handler(request) {
  var guard = methodGuard(request, 'POST');
  if (guard) return guard;

  var body = await readJson(request);
  var company_name = str(body.company_name, 120);
  var role_title = str(body.role_title, 120);
  var job_url = httpUrl(body.job_url);
  var recruiter_email = str(body.recruiter_email, 200).toLowerCase();

  if (!company_name) return bad('Add the company name.');
  if (!role_title) return bad('Add the role. One board is one role.');
  if (recruiter_email && !isEmail(recruiter_email)) return bad('That email does not look right.');
  if (body.job_url && !job_url) return bad('The job URL needs to start with http or https.');

  try {
    // A posting already on the board gets its existing link back rather than a
    // second board splitting the same candidates in two.
    if (job_url) {
      var existing = await selectOne(
        'boards?job_url=eq.' + encodeURIComponent(job_url) + '&select=share_token&limit=1'
      );
      if (existing) {
        return json({ share_token: existing.share_token, url: siteUrl(request) + '/board.html?token=' + existing.share_token, existing: true });
      }
    }

    var board = await insertRow('boards', {
      share_token: token(12),
      company_name: company_name,
      role_title: role_title,
      job_url: job_url,
      recruiter_email: recruiter_email || null
    });

    if (!board) return bad('The board could not be created.', 500);

    return json({
      share_token: board.share_token,
      url: siteUrl(request) + '/board.html?token=' + board.share_token
    });
  } catch (err) {
    console.error('[outhire] board create failed', err);
    return bad(err.message || 'The board could not be created.', 500);
  }
}
