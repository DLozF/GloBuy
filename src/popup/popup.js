// Popup: reads/writes settings and drives the active tab's content script.
//
// v1 ships on-device only. The Premium (cloud) translation tier is deferred to
// v2: its runtime code stays dormant in content.js/background.js/proxy, but the
// popup exposes no Premium UI and never writes premiumEnabled: true.
const $ = (id) => document.getElementById(id);

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'KRW', 'CNY', 'INR', 'VND', 'CAD', 'AUD', 'CHF', 'HKD', 'SGD'];
const LANGUAGES = [
  ['en', 'English'], ['ko', 'Korean'], ['ja', 'Japanese'], ['zh', 'Chinese'],
  ['vi', 'Vietnamese'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['ar', 'Arabic']
];

const DEFAULTS = { targetLang: 'en', targetCurrency: 'USD', glossaryEnabled: true, sizeEnabled: true, autoTranslate: false, premiumEnabled: false };

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

function statusText(st) {
  if (!st || !st.ok) return 'Open a normal web page to use GloBuy.';
  if (!st.running) return 'Ready.';
  return 'Translating…';
}

// Live status pushed from the content script (chrome.runtime sendMessage). The
// model download in particular reports progress, which we surface as a percent.
function liveStatusText(msg) {
  switch (msg.kind) {
    case 'DOWNLOADING': {
      const pct = Math.max(0, Math.min(100, Math.round((Number(msg.progress) || 0) * 100)));
      return `Downloading translation model… ${pct}%`;
    }
    case 'READY': return 'Translation complete.';
    case 'IDLE': return 'Showing original.';
    case 'UNSUPPORTED_API': return 'On-device translator unavailable — update to Chrome 138+.';
    case 'UNSUPPORTED_LANG': return 'Language pair not available on-device.';
    case 'NEEDS_ACTIVATION': return 'Click "Translate this page" button to begin.';
    default: return null;
  }
}

async function init() {
  fillSelect($('lang'), LANGUAGES);
  fillSelect($('ccy'), CURRENCIES);

  const { settings = {} } = await chrome.storage.sync.get('settings');
  const s = Object.assign({}, DEFAULTS, settings);
  $('lang').value = s.targetLang;
  $('ccy').value = s.targetCurrency;
  $('gloss').checked = s.glossaryEnabled;
  $('size').checked = s.sizeEnabled;

  const tab = await activeTab();
  const host = hostOf(tab && tab.url);
  $('host').textContent = host || '—';
  const enabledHosts = s.enabledHosts || {};
  $('enable').checked = host in enabledHosts ? !!enabledHosts[host] : s.autoTranslate;

  const st = tab ? await send(tab.id, { type: 'getState' }) : null;
  $('status').textContent = statusText(st);

  // Reflect live progress (model download %, translating, done) for this tab's host.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'STATUS' || (msg.host && msg.host !== host)) return;
    const t = liveStatusText(msg);
    if (t) $('status').textContent = t;
  });

  // --- wiring ---
  $('enable').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    const { settings: storedSettings = {} } = await chrome.storage.sync.get('settings');
    const hosts = storedSettings.enabledHosts || {};
    if (enabled) hosts[host] = true; else delete hosts[host];
    await chrome.storage.sync.set({ settings: { ...storedSettings, enabledHosts: hosts } });
    await send(tab.id, { type: enabled ? 'ENABLE_SITE' : 'DISABLE_SITE' });
    $('status').textContent = enabled ? 'Translating…' : 'Showing original.';
  });

  async function saveSettings() {
    const { settings: existing = {} } = await chrome.storage.sync.get('settings');
    const settings = {
      ...existing,
      targetLang: $('lang').value,
      targetCurrency: $('ccy').value,
      glossaryEnabled: $('gloss').checked,
      sizeEnabled: $('size').checked,
      premiumEnabled: false,
      autoTranslate: false
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
  // Glossary is applied at translate time — reload so existing text re-translates.
  $('gloss').addEventListener('change', saveAndReload);
  $('orig').addEventListener('change', async (e) => {
    await send(tab.id, { type: 'showOriginal', value: e.target.checked });
  });
}

document.addEventListener('DOMContentLoaded', init);
