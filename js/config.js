/* OUTHIRE — client configuration.
 *
 * There is no build step, so Vercel environment variables cannot be injected
 * into static JS. The two values below are the ones the spec marks as safe in
 * client JS; fill them in here and they ship with the site. Everything secret
 * (service role key, Stripe keys, admin password) stays in the Vercel dashboard
 * and is only ever read inside /api/*.
 *
 * Leave them as-is and the site runs in demo mode against a hardcoded ledger,
 * which is how you check the feed feels right before wiring the database up.
 */
window.OUTHIRE_CONFIG = {
  SUPABASE_URL: 'YOUR_SUPABASE_URL',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY'
};
