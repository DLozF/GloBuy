// Popup: reads/writes settings and drives the active tab's content script.
const $ = (id) => document.getElementById(id);

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'KRW', 'CNY', 'INR', 'CAD', 'AUD', 'CHF', 'HKD', 'SGD'];
const LANGUAGES = [
  ['en', 'English'], ['ko', 'Korean'], ['ja', 'Japanese'], ['zh', 'Chinese'],
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['ru', 'Russian'], ['ar', 'Arabic']
];

const DEFAULTS = { targetLanguage: 'en', targetCurrency: 'USD', glossaryEnabled: true, autoTranslate: true };

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
  if (!st) return 'Open a normal web page to use Luxe Translate.';
  if (!st.apiAvailable) return 'On-device translator unavailable — update to Chrome 138+.';
  if (st.srcLang && st.srcLang !== st.tgtLang) return `Detected ${st.srcLang.toUpperCase()} → ${st.tgtLang.toUpperCase()}.`;
  if (st.srcLang && st.srcLang === st.tgtLang) return 'Page is already in your language.';
  return 'Ready.';
}

async function init() {
  fillSelect($('lang'), LANGUAGES);
  fillSelect($('ccy'), CURRENCIES);

  const { settings = {}, siteState = {} } = await chrome.storage.sync.get(['settings', 'siteState']);
  const s = Object.assign({}, DEFAULTS, settings);
  $('lang').value = s.targetLanguage;
  $('ccy').value = s.targetCurrency;
  $('gloss').checked = s.glossaryEnabled;

  const tab = await activeTab();
  const host = hostOf(tab && tab.url);
  $('host').textContent = host || '—';
  $('enable').checked = host in siteState ? !!siteState[host] : s.autoTranslate;

  const st = tab ? await send(tab.id, { type: 'getState' }) : null;
  $('status').textContent = statusText(st);

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
  $('gloss').addEventListener('change', saveSettings);
  $('orig').addEventListener('change', async (e) => {
    await send(tab.id, { type: 'showOriginal', value: e.target.checked });
  });
}

document.addEventListener('DOMContentLoaded', init);
