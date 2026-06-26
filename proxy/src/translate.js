// Core translation logic for the Luxe Translate premium proxy.
//
// Pure module — no Cloudflare Worker globals — so it runs (and is unit-tested)
// under plain `node --test`. The HTTP/quota wrapper lives in index.js.
//
// The translation engine is an OpenAI-compatible chat-completions API — DeepSeek
// by default. Point LLM_BASE_URL / LLM_MODEL elsewhere (any OpenAI-compatible
// provider) without code changes. JSON mode keeps the returned array aligned
// 1:1 with the batch.
import { GLOSSARY } from './glossary.js';

export const DEFAULT_MODEL = 'deepseek-chat';
export const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';

// Task framing + the per-language glossary. `srcLang` may be 'auto' (or empty)
// when the extension couldn't detect the source on-device — older Chrome lacks
// the LanguageDetector API — in which case the model detects it per string and
// no source-specific glossary is available.
export function buildSystemInstruction(srcLang, tgtLang, glossary = GLOSSARY) {
  const auto = !srcLang || srcLang === 'auto' || srcLang === 'und';
  const gloss = auto ? null : (glossary[srcLang] || null);
  const lines = [
    'You translate short UI text strings scraped from a foreign luxury / resale',
    'fashion shopping website into the target language.',
    auto
      ? `Source language: detect it automatically (it may differ per string). Target language: ${tgtLang}.`
      : `Source language: ${srcLang}. Target language: ${tgtLang}.`,
    '',
    'Rules:',
    '- Return ONLY the translation of each input string, nothing else.',
    '- Preserve verbatim (do NOT translate): numbers, prices, currency symbols and',
    '  codes (₩, ¥, $, €, KRW, USD…), measurements and sizes (260mm, EU 38, cm),',
    '  URLs, emails, and brand / proper nouns (GUCCI, Maison Margiela).',
    '- NEVER translate currency words or units — keep them in the SOURCE script,',
    '  attached to their number: 원 / 만원 / 억 (KR), 円 / 엔 (JP), 元 / 块 (CN),',
    '  đồng / đ / triệu / tr (VN), plus symbols ₩ ¥ € £ $ ₫. For example',
    '  "1,200,000원" must stay "1,200,000원" — NOT "1,200,000 won".',
    '- If a string is purely a number, symbol, or code, return it unchanged.',
    '- Keep the meaning natural for an online shopper; do not add commentary.'
  ];
  if (gloss) {
    lines.push(
      '',
      'Apply these exact glossary renderings wherever the source term appears',
      '(they override generic translation):'
    );
    for (const [term, value] of Object.entries(gloss)) lines.push(`- ${term} → ${value}`);
  }
  return lines.join('\n');
}

// OpenAI-compatible chat-completions request with JSON-object output.
export function buildRequestBody(texts, srcLang, tgtLang, glossary = GLOSSARY, model = DEFAULT_MODEL) {
  return {
    model,
    messages: [
      { role: 'system', content: buildSystemInstruction(srcLang, tgtLang, glossary) },
      {
        role: 'user',
        content:
          'Translate each string in this JSON array. Respond with a JSON object of ' +
          'the form {"translations": [ ... ]} whose array has the same length and ' +
          'order as the input — element i is the translation of input i.\n' +
          'Input: ' + JSON.stringify(texts)
      }
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 8192
  };
}

// Pull the string array out of a chat-completions response. Accepts either a bare
// JSON array or a {"translations": [...]} object. Throws only if neither is found
// (not on length — see parseTranslations).
export function parseArray(data) {
  const content = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;
  if (typeof content !== 'string') throw new Error('llm: no content in response');
  let parsed;
  try { parsed = JSON.parse(content); }
  catch (e) { throw new Error('llm: response was not valid JSON', { cause: e }); }
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.translations) ? parsed.translations : null);
  if (!arr) throw new Error('llm: response had no translations array');
  return arr.map((s) => (typeof s === 'string' ? s : String(s)));
}

// Strict variant: also require the result to align 1:1 with the input.
export function parseTranslations(data, expectedLength) {
  const arr = parseArray(data);
  if (arr.length !== expectedLength) {
    throw new Error(`llm: expected ${expectedLength} translations, got ${arr.length}`);
  }
  return arr;
}

export function usageTokens(data) {
  return Number(data && data.usage && data.usage.total_tokens) || 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// POST with retry/backoff on transient upstream failures (rate-limit bursts).
// Non-retryable statuses (400/401/403) throw at once.
async function postWithRetry(url, init, fetchImpl, retries, retryDelayMs) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try { res = await fetchImpl(url, init); }
    catch (e) { lastErr = e; if (attempt < retries) await sleep(retryDelayMs * (attempt + 1)); continue; }
    if (res.ok) return res;
    const detail = res.text ? await res.text().catch(() => '') : '';
    if (RETRYABLE.has(res.status) && attempt < retries) {
      lastErr = new Error(`llm: HTTP ${res.status} ${String(detail).slice(0, 200)}`);
      await sleep(retryDelayMs * (attempt + 1));
      continue;
    }
    throw new Error(`llm: HTTP ${res.status} ${String(detail).slice(0, 200)}`);
  }
  throw lastErr || new Error('llm: request failed after retries');
}

// One API call for a batch, returning the raw (un-length-checked) array.
async function requestBatch(texts, o) {
  const res = await postWithRetry(o.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
    body: JSON.stringify(buildRequestBody(texts, o.srcLang, o.tgtLang, undefined, o.model))
  }, o.fetchImpl, o.retries, o.retryDelayMs);
  const data = await res.json();
  return { translations: parseArray(data), tokens: usageTokens(data) };
}

// Translate a batch, guaranteeing 1:1 alignment. Models occasionally drop an
// item from a batch; on a length mismatch we split the batch in half and retry
// each half (smaller batches align reliably), so only a genuinely unalignable
// single item ever surfaces an error for the caller to fall back on.
async function alignedTranslate(texts, o) {
  const { translations, tokens } = await requestBatch(texts, o);
  if (translations.length === texts.length) return { translations, tokens };
  if (texts.length <= 1) {
    throw new Error(`llm: expected ${texts.length} translations, got ${translations.length}`);
  }
  const mid = Math.floor(texts.length / 2);
  const a = await alignedTranslate(texts.slice(0, mid), o);
  const b = await alignedTranslate(texts.slice(mid), o);
  // Include this failed parent call's `tokens`: the provider already billed for
  // the misaligned attempt, so quota must reflect parent + both retried halves,
  // not just the halves. Dropping `tokens` here would undercount real cost.
  return { translations: a.translations.concat(b.translations), tokens: tokens + a.tokens + b.tokens };
}

// Translate a batch of strings. `fetchImpl` is injectable for tests.
export async function translateTexts(texts, opts = {}) {
  if (!Array.isArray(texts) || !texts.length) return { translations: [], tokens: 0 };
  const o = {
    model: DEFAULT_MODEL, endpoint: DEFAULT_ENDPOINT, fetchImpl: fetch,
    retries: 2, retryDelayMs: 500, ...opts
  };
  if (!o.apiKey) throw new Error('missing LLM_API_KEY');
  return alignedTranslate(texts, o);
}
