// Service worker: currency-rate fetching + caching.
//
// Runs in the background so rate requests aren't subject to page CORS and can
// be shared/cached across tabs. Frankfurter (free, no key) is the primary
// source; open.er-api.com is a free/no-key fallback that covers currencies
// Frankfurter omits — notably VND, which Frankfurter returns "not found" for.
const RATE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const ENDPOINTS = [
  (from, to) => `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`,
  (from, to) => `https://api.frankfurter.app/latest?base=${from}&symbols=${to}`,
  (from) => `https://open.er-api.com/v6/latest/${from}` // returns all rates; read .rates[to]
];

async function fetchRate(from, to) {
  for (const build of ENDPOINTS) {
    try {
      const res = await fetch(build(from, to));
      if (!res.ok) continue;
      const data = await res.json();
      const rate = data && data.rates && data.rates[to];
      if (typeof rate === 'number') return rate;
    } catch (e) {
      // try next endpoint
    }
  }
  return null;
}

async function getRate(from, to) {
  from = String(from || '').toUpperCase();
  to = String(to || '').toUpperCase();
  if (!from || !to) return null;
  if (from === to) return 1;

  const key = `rate:${from}:${to}`;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && Date.now() - cached.ts < RATE_TTL_MS) return cached.rate;

  const rate = await fetchRate(from, to);
  if (rate != null) {
    await chrome.storage.local.set({ [key]: { rate, ts: Date.now() } });
  }
  return rate;
}

// --- Premium translation (LLM, via the hosted proxy) ----------------------
//
// The proxy holds the LLM API key and enforces a free per-install quota. The
// extension authenticates with an anonymous install token only. A user-supplied
// key (BYOK) is forwarded so the proxy can bill it and skip the free cap; the
// provider key itself never lives in the extension.
const DEFAULT_PROXY_URL = 'https://luxe-translate-proxy.zol1th.workers.dev/translate';

async function getInstallToken() {
  const { installToken } = await chrome.storage.local.get('installToken');
  if (installToken) return installToken;
  const t = (crypto.randomUUID && crypto.randomUUID()) ||
    String(Date.now()) + Math.random().toString(16).slice(2);
  await chrome.storage.local.set({ installToken: t });
  return t;
}

// Returns { translations } on success, or { fallback: true, error } so the
// content script reverts that batch to the on-device translator.
async function premiumTranslate({ srcLang, tgtLang, texts }) {
  if (!Array.isArray(texts) || !texts.length) return { translations: [] };
  const { proxyUrl, userKey } = await chrome.storage.local.get(['proxyUrl', 'userKey']);
  const token = await getInstallToken();
  const body = { token, srcLang, tgtLang, texts };
  if (userKey) body.userKey = userKey;
  let res;
  try {
    res = await fetch(proxyUrl || DEFAULT_PROXY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    return { fallback: true, error: 'network' };
  }
  if (res.status === 402) { chrome.storage.local.set({ premiumRemaining: 0 }); return { fallback: true, error: 'quota_exceeded' }; }
  if (!res.ok) return { fallback: true, error: 'upstream' };
  let data;
  try { data = await res.json(); } catch (e) { return { fallback: true, error: 'parse' }; }
  if (!Array.isArray(data.translations)) return { fallback: true, error: 'parse' };
  // Persist for the popup, which is usually closed during translation passes and
  // so never sees the live 'premium' status messages.
  if (typeof data.remaining === 'number') chrome.storage.local.set({ premiumRemaining: data.remaining });
  return { translations: data.translations, remaining: data.remaining, pro: data.pro };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'convert') {
    getRate(msg.from, msg.to).then((rate) => sendResponse({ rate }));
    return true; // async
  }
  if (msg && msg.type === 'premiumTranslate') {
    premiumTranslate(msg).then(sendResponse);
    return true; // async
  }
  // 'status' messages are for any open popup; nothing to do here.
  return false;
});
