// Service worker: currency-rate fetching + caching.
//
// Runs in the background so rate requests aren't subject to page CORS and can
// be shared/cached across tabs. Rates come from Frankfurter (free, no key).
const RATE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const ENDPOINTS = [
  (from, to) => `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`,
  (from, to) => `https://api.frankfurter.app/latest?base=${from}&symbols=${to}`
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'convert') {
    getRate(msg.from, msg.to).then((rate) => sendResponse({ rate }));
    return true; // async
  }
  // 'status' messages are for any open popup; nothing to do here.
  return false;
});
