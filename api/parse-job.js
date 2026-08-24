/* POST /api/parse-job
 *
 * Two jobs behind one endpoint:
 *   { url }               -> whitelist, fetch, LLM-extract, return for confirmation
 *   { url, text }         -> same, but read the pasted description instead
 *   { url, confirmed:true,
 *     company_name, ... } -> create or join the board
 *
 * The parse is never trusted silently — nothing is written until the caller
 * sends back a confirmed payload.
 *
 * The model is deliberately not pinned. LLM_PROVIDER picks the wire format:
 *   'openai' (default) — any OpenAI-compatible /chat/completions endpoint,
 *                        which is what DeepSeek, Together, Groq, vLLM and
 *                        OpenAI itself all speak. Set LLM_BASE_URL + LLM_MODEL.
 *   'anthropic'        — the Anthropic Messages API.
 * With no LLM_API_KEY at all it degrades to the manual path rather than 500.
 */
import {
  json, bad, readJson, db, jobHostAllowed, normaliseJobUrl, safeUrl,
  hostOf, slugify, randomToken
} from './_lib.js';

const UA = 'Mozilla/5.0 (compatible; outbid.lol/1.0; +https://outbid.lol)';

const SYSTEM =
  'You extract structured facts from job listings. Reply with JSON only, no prose, ' +
  'no code fences. Use exactly these keys: company_name, role_title, location, seniority. ' +
  'Use null for anything the text does not state. Never guess a company from the domain alone.';

function prompt(text) {
  return 'Extract the job facts from the listing below.\n\n' +
    '---\n' + text.slice(0, 18000) + '\n---\n\n' +
    'Return only: {"company_name":…,"role_title":…,"location":…,"seniority":…}';
}

/* Strip tags but keep the text; enough for an extraction prompt without
   pulling in a parser dependency. */
function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function firstJsonObject(s) {
  const t = String(s || '').replace(/```(?:json)?/gi, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

async function extract(text) {
  const key = process.env.LLM_API_KEY;
  if (!key || text.length < 40) return null;

  const provider = (process.env.LLM_PROVIDER || 'openai').toLowerCase();
  const ctl = AbortSignal.timeout(20000);

  try {
    if (provider === 'anthropic') {
      const res = await fetch((process.env.LLM_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
        method: 'POST',
        signal: ctl,
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || 'claude-opus-5',
          max_tokens: 512,
          system: SYSTEM,
          messages: [{ role: 'user', content: prompt(text) }]
        })
      });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json();
      const out = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return firstJsonObject(out);
    }

    // OpenAI-compatible: DeepSeek, OpenAI, Together, Groq, vLLM, and friends.
    const base = (process.env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: ctl,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'deepseek-chat',
        max_tokens: 512,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt(text) }
        ]
      })
    });
    if (!res.ok) throw new Error(await res.text());
    const body = await res.json();
    return firstJsonObject(body.choices?.[0]?.message?.content);
  } catch (e) {
    console.error('[parse-job:llm]', e.message);
    return null;
  }
}

function clean(parsed) {
  const s = (v) => {
    const out = typeof v === 'string' ? v.trim() : '';
    return out && out.toLowerCase() !== 'null' ? out.slice(0, 120) : '';
  };
  return {
    company_name: s(parsed?.company_name),
    role_title: s(parsed?.role_title),
    location: s(parsed?.location),
    seniority: s(parsed?.seniority)
  };
}

export default async function handler(request) {
  if (request.method !== 'POST') return bad('Use POST.', 405);

  try {
    const b = await readJson(request);
    const url = safeUrl(b.url);
    if (!url) return bad('Paste a job listing URL.');

    // Whitelist first, before anything else touches the network. This is what
    // stops people spawning boards for jobs that do not exist.
    if (!jobHostAllowed(url)) return bad('That link isn’t from a hiring platform we recognise.');

    const normalised = normaliseJobUrl(url);

    /* ---------------------------------------------------- create/join --- */
    if (b.confirmed) {
      const company_name = String(b.company_name || '').trim().slice(0, 120);
      const role_title = String(b.role_title || '').trim().slice(0, 120);
      if (!company_name || !role_title) return bad('Company and role title are both required.');

      const existing = await db.one('boards', db.eq('source_url', normalised));
      if (existing) return json({ slug: existing.slug, joined: true });

      let slug = slugify(`${company_name}-${role_title}`, 'role');
      if (await db.one('boards', db.eq('slug', slug))) slug = `${slug}-${randomToken(3).toLowerCase()}`;

      /* company_domain is what the recruiter dashboard matches an email
         against, so derive it from the listing rather than trusting input. */
      const host = hostOf(normalised);
      const generic = ['linkedin.com', 'indeed.com', 'glassdoor.com', 'wellfound.com', 'angel.co', 'naukri.com'];
      let company_domain = generic.includes(host) ? '' : host.replace(/^(jobs|boards|apply|careers)\./, '');
      if (!company_domain) company_domain = `${slugify(company_name, 'company')}.com`;

      const rows = await db.insert('boards', {
        slug, source_url: normalised, source_domain: host,
        company_name, role_title,
        company_domain,
        location: String(b.location || '').trim().slice(0, 120) || null
      });
      const board = Array.isArray(rows) ? rows[0] : rows;
      return json({ slug: board.slug, created: true });
    }

    /* --------------------------------------------------------- parse --- */
    const existing = await db.one('boards', db.eq('source_url', normalised));
    if (existing) {
      return json({
        parsed: {
          company_name: existing.company_name, role_title: existing.role_title,
          location: existing.location, seniority: ''
        },
        manual: false,
        existing_slug: existing.slug,
        note: 'A board already exists for this listing. Confirming takes you to it.'
      });
    }

    let text = typeof b.text === 'string' ? b.text.trim() : '';
    let manual = false;
    let note = null;

    if (!text) {
      // LinkedIn and friends block server-side fetches. That is expected, so
      // the manual path is the designed outcome, not an error.
      try {
        const res = await fetch(normalised, {
          signal: AbortSignal.timeout(9000),
          redirect: 'follow',
          headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en' }
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        text = htmlToText(await res.text());
        if (text.length < 200) throw new Error('page carried no readable text');
      } catch (e) {
        manual = true;
        note = 'That platform blocked the fetch. Paste the job description below and we will read it from the text, or just fill the fields in yourself.';
      }
    }

    let parsed = { company_name: '', role_title: '', location: '', seniority: '' };
    if (text) {
      const out = await extract(text);
      if (out) parsed = clean(out);
      else {
        manual = true;
        note = note || (process.env.LLM_API_KEY
          ? 'The listing could not be read automatically. Fill the fields in and confirm.'
          : 'Automatic reading is not configured, so fill the fields in yourself.');
      }
    }
    if (!parsed.role_title && !parsed.company_name) manual = true;

    return json({ parsed, manual, note });
  } catch (e) {
    console.error('[parse-job]', e);
    return bad(e.message || 'The listing could not be read.', 500);
  }
}
