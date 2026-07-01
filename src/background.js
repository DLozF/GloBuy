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

const FETCH_TIMEOUT_MS = 6000;

function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: ctrl.signal })
    .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .finally(() => clearTimeout(timer));
}

// Race all endpoints; the fastest one to return a usable rate wins. A slow or
// dead endpoint can't stall the others (Promise.any), and each is time-bounded
// so the chain never hangs on a wedged source.
async function fetchRate(from, to) {
  const attempts = ENDPOINTS.map(async (build) => {
    const data = await fetchJson(build(from, to));
    const rate = data && data.rates && data.rates[to];
    if (typeof rate !== 'number') throw new Error('no rate for ' + to);
    return rate;
  });
  try {
    return await Promise.any(attempts);
  } catch (e) {
    return null; // every endpoint failed
  }
}

const inflight = new Map(); // key -> Promise<rate|null>

// Coalesce concurrent fetches for the same pair (e.g. the early warm-up and the
// first real lookup) into a single network request.
function refreshRate(key, from, to) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const rate = await fetchRate(from, to);
    if (rate != null) await chrome.storage.local.set({ [key]: { rate, ts: Date.now() } });
    return rate;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Full EUR-base rate table for currency annotation (pipeline GET_RATES request).
let rateTableInflight = null;

async function getRateTable() {
  const KEY = 'rateTable';
  const cached = (await chrome.storage.local.get(KEY))[KEY];
  if (cached && cached.rates && (Date.now() - cached.ts < RATE_TTL_MS)) {
    return { ok: true, table: { rates: cached.rates } };
  }
  if (rateTableInflight) return rateTableInflight;
  rateTableInflight = (async () => {
    try {
      const data = await fetchJson('https://api.frankfurter.dev/v1/latest?base=EUR');
      if (!data || !data.rates) throw new Error('no rates');
      await chrome.storage.local.set({ [KEY]: { rates: data.rates, ts: Date.now() } });
      return { ok: true, table: data };
    } catch {
      return { ok: false };
    }
  })().finally(() => { rateTableInflight = null; });
  return rateTableInflight;
}

async function getRate(from, to) {
  from = String(from || '').toUpperCase();
  to = String(to || '').toUpperCase();
  if (!from || !to) return null;
  if (from === to) return 1;

  const key = `rate:${from}:${to}`;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && typeof cached.rate === 'number') {
    // Stale-while-revalidate: serve the cached rate immediately, and if it's past
    // the TTL refresh in the background so the next lookup is fresh. FX barely
    // moves intraday, so a slightly stale rate is fine and never blocks the page.
    if (Date.now() - cached.ts >= RATE_TTL_MS) refreshRate(key, from, to).catch(() => {});
    return cached.rate;
  }
  return refreshRate(key, from, to); // nothing cached — must fetch
}

// Premium (cloud) translation is deferred to v1.1: the proxy client that lived
// here was removed for the on-device-only v1 build so the shipped code contains
// no remote translation endpoint. See git history to restore it.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'convert') {
    getRate(msg.from, msg.to).then((rate) => sendResponse({ rate }));
    return true; // async
  }
  if (msg && msg.type === 'GET_RATES') {
    getRateTable().then(sendResponse);
    return true; // async
  }
  // 'status' messages are for any open popup; nothing to do here.
  // 'premiumTranslate' is intentionally unhandled in v1 (on-device only).
  return false;
});

// --- One-time migrations ---------------------------------------------------
//
// Earlier builds defaulted sites to ON (autoTranslate); the popup now defaults
// every site to OFF. Clear any remembered per-host "on" choices once so existing
// installs start fresh with all sites off. Gated by a local flag so it runs
// exactly once and never wipes the user's later per-site choices on reload.
async function runMigrations() {
  const FLAG = 'migratedDefaultOff';
  const { [FLAG]: done } = await chrome.storage.local.get(FLAG);
  if (done) return;
  const { settings } = await chrome.storage.sync.get('settings');
  if (settings) {
    await chrome.storage.sync.set({
      settings: { ...settings, enabledHosts: {}, autoTranslate: false },
    });
  }
  await chrome.storage.local.set({ [FLAG]: true });
}

chrome.runtime.onInstalled.addListener(() => { runMigrations(); });
