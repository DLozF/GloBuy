// Background service worker: fetches and caches Frankfurter exchange rates and
// relays simple messages. The Translator API is NOT available here (no document /
// worker support), so all translation happens in the content script.

import { MSG } from '../shared/messages.js';

const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest?base=EUR';

/** Frankfurter publishes around 16:00 CET; key the cache by the current CET date. */
function cetDateKey(now = new Date()) {
  // CET/CEST is UTC+1/+2; using a fixed +1 offset is enough to bucket by working day.
  const cet = new Date(now.getTime() + 60 * 60 * 1000);
  return `rates:${cet.toISOString().slice(0, 10)}`;
}

async function getRates() {
  const key = cetDateKey();
  const cached = await chrome.storage.local.get(key);
  if (cached[key]) return cached[key];

  const res = await fetch(FRANKFURTER_URL);
  if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
  const data = await res.json();

  // Normalize to a base-EUR table that also contains EUR itself.
  const table = { base: 'EUR', date: data.date, rates: { EUR: 1, ...data.rates } };

  // Drop stale keys, keep only today's entry.
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter((k) => k.startsWith('rates:') && k !== key);
  if (stale.length) await chrome.storage.local.remove(stale);
  await chrome.storage.local.set({ [key]: table });

  return table;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MSG.GET_RATES) {
    getRates()
      .then((table) => sendResponse({ ok: true, table }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep the channel open for the async response
  }
  return false;
});
