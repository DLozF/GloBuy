// Cloudflare Worker: Luxe Translate premium translation proxy.
//
// Holds the LLM API key (as a Worker secret — never in source or the extension),
// enforces a free monthly token quota per anonymous install token, and proxies
// batches to an OpenAI-compatible LLM (DeepSeek by default). The extension
// authenticates with its install token only; the provider key never leaves the Worker.
//
// Setup:
//   wrangler kv namespace create QUOTA      # paste id into wrangler.toml
//   wrangler secret put LLM_API_KEY         # the (rotated!) provider key
//                                           # (GEMINI_API_KEY is still accepted as a fallback)
import { translateTexts, DEFAULT_MODEL, DEFAULT_ENDPOINT } from './translate.js';

const FREE_TOKENS_DEFAULT = 500000; // ~50 pages/month per install token
const RL_PER_MIN = 30;
const QUOTA_TTL_SECONDS = 60 * 60 * 24 * 40; // ~40 days; rolls over monthly via the key

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400'
  };
}
function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json', ...(extra || {}) }
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get('origin') || '*');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/translate') {
      return json({ error: 'not_found' }, 404, cors);
    }

    let payload;
    try { payload = await request.json(); }
    catch (e) { return json({ error: 'bad_request' }, 400, cors); }
    const { token, srcLang, tgtLang, texts, userKey } = payload || {};
    if (!token || !srcLang || !tgtLang || !Array.isArray(texts)) {
      return json({ error: 'bad_request' }, 400, cors);
    }
    if (!texts.length) return json({ translations: [] }, 200, cors);

    // BYOK: if the caller supplies their own provider key, bill it and skip both
    // the free quota and the shared key entirely.
    const byok = typeof userKey === 'string' && userKey.length > 0;

    // Per-IP rate limit (best-effort — anonymous tokens are free to mint).
    if (env.QUOTA && !byok) {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const rlKey = `rl:${ip}:${Math.floor(Date.now() / 60000)}`;
      const rl = Number(await env.QUOTA.get(rlKey)) || 0;
      if (rl >= RL_PER_MIN) return json({ error: 'rate_limited' }, 429, cors);
      await env.QUOTA.put(rlKey, String(rl + 1), { expirationTtl: 120 });
    }

    // Monthly token quota (subscribed `pro:` tokens skip the cap).
    const cap = Number(env.FREE_TOKENS) || FREE_TOKENS_DEFAULT;
    const usedKey = `quota:${monthKey()}:${token}`;
    let used = 0, pro = false;
    if (env.QUOTA && !byok) {
      pro = (await env.QUOTA.get(`pro:${token}`)) === '1';
      used = Number(await env.QUOTA.get(usedKey)) || 0;
      if (!pro && used >= cap) return json({ error: 'quota_exceeded', used, cap }, 402, cors);
    }

    let result;
    try {
      result = await translateTexts(texts, {
        srcLang, tgtLang,
        apiKey: byok ? userKey : (env.LLM_API_KEY || env.GEMINI_API_KEY),
        model: env.LLM_MODEL || DEFAULT_MODEL,
        endpoint: env.LLM_BASE_URL || DEFAULT_ENDPOINT
      });
    } catch (e) {
      // Upstream/parse failure → 502; the extension falls back to on-device.
      const message = String((e && e.message) || e);
      console.warn('translate upstream error:', message); // visible in `wrangler dev`
      return json({ error: 'upstream', message }, 502, cors);
    }

    if (byok) return json({ translations: result.translations, remaining: null, pro: true }, 200, cors);
    if (env.QUOTA && result.tokens) {
      await env.QUOTA.put(usedKey, String(used + result.tokens), { expirationTtl: QUOTA_TTL_SECONDS });
    }
    const remaining = pro ? null : Math.max(0, cap - (used + (result.tokens || 0)));
    return json({ translations: result.translations, remaining, pro }, 200, cors);
  }
};
