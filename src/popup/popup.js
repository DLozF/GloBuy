// Popup: reads/writes settings and drives the active tab's content script.
const $ = (id) => document.getElementById(id);

// Premium (cloud) translation is feature-flagged OFF for the v1 on-device-only
// build. The proxy/premium code remains in the repo as a portfolio artifact but
// the UI (toggle, API-key row, hint) and the premium code path stay dormant.
// Flip to true to re-enable the opt-in cloud tier (planned for v1.1).
const PREMIUM_ENABLED = false;

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'KRW', 'CNY', 'INR', 'VND', 'CAD', 'AUD', 'CHF', 'HKD', 'SGD'];
const LANGUAGES = [
  ['en', 'English'], ['ko', 'Korean'], ['ja', 'Japanese'], ['zh', 'Chinese'],
  ['vi', 'Vietnamese'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['ar', 'Arabic']
];

const DEFAULTS = { targetLanguage: 'en', targetCurrency: 'USD', glossaryEnabled: true, sizeEnabled: true, autoTranslate: true, premiumEnabled: false };

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}
function fillSelect(el, entries) {
  for (const e of entries) {
    const [value, label] = Array.isArray(e) ? e : [e, e];
    const o = document.createElement('option');
    o.value = value; o.textContent = label;
    el.appendChild(o);
  }
}
async function send(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); } catch (e) { return null; }
}

// The BYOK API-key row (and its hint) only make sense when Premium is on, so
// their visibility follows the premium toggle. With the feature flag off they
// stay hidden regardless (handled at init).
function syncApiKeyRow() {
  const show = PREMIUM_ENABLED && $('premium').checked;
  for (const id of ['apikey-row', 'apikey-hint']) {
    const el = $(id);
    if (el) el.style.display = show ? '' : 'none';
  }
}

function statusText(st) {
  if (!st) return 'Open a normal web page to use Globuy.';
  if (!st.apiAvailable) return 'On-device translator unavailable — update to Chrome 138+.';
  if (st.srcLang && st.srcLang !== st.tgtLang) return `Detected ${st.srcLang.toUpperCase()} → ${st.tgtLang.toUpperCase()}.`;
  if (st.srcLang && st.srcLang === st.tgtLang) return 'Page is already in your language.';
  return 'Ready.';
}

// Live status pushed from the content script (chrome.runtime sendMessage). The
// model download in particular reports progress, which we surface as a percent.
function liveStatusText(msg) {
  switch (msg.state) {
    case 'downloading': {
      const pct = Math.max(0, Math.min(100, Math.round((Number(msg.extra) || 0) * 100)));
      return `Downloading translation model… ${pct}%`;
    }
    case 'starting': return 'Translating…';
    case 'done': return 'Translation complete.';
    case 'premium': {
      if (msg.extra == null) return 'Premium translation active.';
      const k = Math.max(0, Math.round(Number(msg.extra) / 1000));
      return `Premium active — ~${k}K tokens left this month.`;
    }
    case 'quotafallback': return 'Premium quota reached — using on-device translation.';
    case 'premiumerror': return 'Premium unavailable — using on-device translation.';
    case 'needsgesture': return 'Click anywhere on the page to start translation.';
    case 'unavailable': return 'On-device translator unavailable — update to Chrome 138+.';
    case 'nolang': return 'Couldn’t detect the page language.';
    case 'same': return 'Page is already in your language.';
    case 'pairunavailable': return 'This language pair isn’t available on-device.';
    default: return null;
  }
}

async function init() {
  fillSelect($('lang'), LANGUAGES);
  fillSelect($('ccy'), CURRENCIES);

  const { settings = {}, siteState = {} } = await chrome.storage.sync.get(['settings', 'siteState']);
  const s = Object.assign({}, DEFAULTS, settings);
  $('lang').value = s.targetLanguage;
  $('ccy').value = s.targetCurrency;
  $('gloss').checked = s.glossaryEnabled;
  $('size').checked = s.sizeEnabled;
  $('premium').checked = PREMIUM_ENABLED && s.premiumEnabled;

  const { userKey = '' } = await chrome.storage.local.get('userKey');
  $('apikey').value = userKey;

  // v1 ships on-device only: hide the premium toggle, its hint, and the BYOK
  // API-key row entirely so a reviewer sees only the on-device feature set.
  // When the flag is on, the API-key row tracks the premium toggle instead.
  if (!PREMIUM_ENABLED) {
    for (const id of ['premium-row', 'premium-hint', 'apikey-row', 'apikey-hint']) {
      const el = $(id);
      if (el) el.style.display = 'none';
    }
  } else {
    syncApiKeyRow();
  }

  const tab = await activeTab();
  const host = hostOf(tab && tab.url);
  $('host').textContent = host || '—';
  $('enable').checked = host in siteState ? !!siteState[host] : s.autoTranslate;

  const st = tab ? await send(tab.id, { type: 'getState' }) : null;
  $('status').textContent = statusText(st);

  // The popup is usually closed during translation, so show the last persisted
  // quota rather than relying on a live message arriving while it's open.
  if (PREMIUM_ENABLED && s.premiumEnabled) {
    const { premiumRemaining } = await chrome.storage.local.get('premiumRemaining');
    $('status').textContent = typeof premiumRemaining === 'number'
      ? `Premium active — ~${Math.max(0, Math.round(premiumRemaining / 1000))}K tokens left this month.`
      : 'Premium translation enabled.';
  }

  // Reflect live progress (model download %, translating, done) for this tab's host.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'status' || (msg.host && msg.host !== host)) return;
    const t = liveStatusText(msg);
    if (t) $('status').textContent = t;
  });

  // --- wiring ---
  $('enable').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    const cur = (await chrome.storage.sync.get('siteState')).siteState || {};
    cur[host] = enabled;
    await chrome.storage.sync.set({ siteState: cur });
    await send(tab.id, { type: enabled ? 'apply' : 'disable' });
    $('status').textContent = enabled ? 'Translating…' : 'Showing original.';
  });

  async function saveSettings() {
    const settings = {
      targetLanguage: $('lang').value,
      targetCurrency: $('ccy').value,
      glossaryEnabled: $('gloss').checked,
      sizeEnabled: $('size').checked,
      premiumEnabled: PREMIUM_ENABLED && $('premium').checked,
      autoTranslate: true
    };
    await chrome.storage.sync.set({ settings });
    return settings;
  }

  // Language/currency changes need a clean re-pass — reload the tab so the page
  // re-translates from scratch with the new target.
  async function saveAndReload() {
    await saveSettings();
    if (tab) chrome.tabs.reload(tab.id);
    window.close();
  }

  $('lang').addEventListener('change', saveAndReload);
  $('ccy').addEventListener('change', saveAndReload);
  // Size conversion adds inline annotations, so reload to apply/remove them on
  // already-rendered content (matches the currency toggle's behavior).
  $('size').addEventListener('change', saveAndReload);
  if (PREMIUM_ENABLED) {
    // Show/hide the BYOK key row immediately, then re-pass like a target change.
    $('premium').addEventListener('change', () => { syncApiKeyRow(); saveAndReload(); });
    // BYOK key is read by the service worker on the next batch — no reload needed.
    $('apikey').addEventListener('change', async (e) => {
      await chrome.storage.local.set({ userKey: e.target.value.trim() });
    });
  }
  // Glossary is applied at translate time — reload so existing text re-translates.
  $('gloss').addEventListener('change', saveAndReload);
  $('orig').addEventListener('change', async (e) => {
    await send(tab.id, { type: 'showOriginal', value: e.target.checked });
  });
}

document.addEventListener('DOMContentLoaded', init);
