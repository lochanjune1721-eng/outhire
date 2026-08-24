/* POST /api/recruiter — shortlist, notes, and contact reveals.
 *
 * A candidate's email is not readable with the anon key at all (column
 * privileges in sql/schema.sql), so this endpoint is the only way to one --
 * and it always writes an audit row and tells the candidate. Verification
 * stops the lazy fakes; making the reveal visible is what stops the rest.
 */
import { json, bad, readJson, db, userFromToken, emailDomain, FREE_INBOXES, sendMail, siteUrl } from './_lib.js';

export default async function handler(request) {
  if (request.method !== 'POST') return bad('Use POST.', 405);

  try {
    const b = await readJson(request);

    const user = await userFromToken(b.token);
    if (!user) return bad('Sign in again.', 401);

    const email = String(user.email).toLowerCase();
    const domain = emailDomain(email);
    if (FREE_INBOXES.has(domain)) return bad('Recruiter access needs a work email.', 403);

    if (b.action === 'note') {
      const board = await db.one('boards', db.eq('id', b.board_id));
      if (!board) return bad('That board does not exist.', 404);
      if (board.company_domain !== domain) return bad('That board is not yours.', 403);

      await db.upsert('recruiter_notes', {
        board_id: board.id,
        entry_id: b.entry_id,
        recruiter_email: email,
        shortlisted: !!b.shortlisted,
        note: String(b.note || '').slice(0, 2000),
        updated_at: new Date().toISOString()
      }, 'entry_id,recruiter_email');

      return json({ ok: true });
    }

    if (b.action === 'reveal') {
      const entry = await db.one('entries', db.eq('id', b.entry_id));
      if (!entry) return bad('That entry does not exist.', 404);
      if (!entry.board_id) return bad('That entry is not on a role board.', 403);

      const board = await db.one('boards', db.eq('id', entry.board_id));
      if (!board || board.company_domain !== domain) return bad('That entry is not on one of your boards.', 403);
      if (!entry.email) return bad('This entry has no contact email on file.', 404);

      // Audit first: a reveal that is not recorded is a reveal that never
      // reaches the candidate.
      await db.upsert('contact_reveals', {
        entry_id: entry.id, recruiter_email: email
      }, 'entry_id,recruiter_email');

      await sendMail({
        to: entry.email,
        subject: `${board.company_name || 'A recruiter'} looked at your application`,
        text:
          `${email} at ${board.company_name || domain} just revealed your contact details ` +
          `on the board for ${board.role_title || 'a role'}.\n\n` +
          `Your board: ${siteUrl(request)}/board.html?slug=${encodeURIComponent(board.slug)}\n\n` +
          `You are told every time this happens.\n`
      });

      return json({ email: entry.email });
    }

    return bad('Unknown action.');
  } catch (e) {
    console.error('[recruiter]', e);
    return bad(e.message || 'That did not work.', 500);
  }
}
