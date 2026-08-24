/* GOAT.lol — client configuration.
 *
 * No build step, so Vercel env vars cannot reach static files. These two are
 * the values marked safe in client JS; everything secret (service role key,
 * Dodo keys, admin password) stays in the Vercel dashboard and is read only
 * inside /api.
 *
 * NOTE: rotating the Supabase JWT secret regenerates the anon key as well as
 * the service role key. If you rotate, update the value below at the same time.
 */
window.GOAT_CONFIG = {
  SUPABASE_URL: 'YOUR_SUPABASE_URL',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY'
};
