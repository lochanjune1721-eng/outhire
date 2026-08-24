/* outbid.lol — client configuration.
 *
 * No build step, so Vercel env vars cannot be injected into static JS. The two
 * values below are the ones marked safe in client JS; fill them in here and
 * they ship with the site. Everything secret (service role key, Stripe keys,
 * LLM key, admin password) stays in the Vercel dashboard and is read only
 * inside /api.
 *
 * Left as-is, the site renders the single seed entry and an empty state.
 */
window.OUTBID_CONFIG = {
  SUPABASE_URL: 'YOUR_SUPABASE_URL',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY'
};
