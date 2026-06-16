// Popup controller: per-site toggle, target language/currency, and live status.

import { MSG, STATUS_KIND } from '../shared/messages.js';
import { getSettings, setSettings, setHostEnabled } from '../shared/settings.js';
import { FRANKFURTER_SUPPORTED } from '../shared/currencies.js';

// Languages the Translator API commonly supports, shown in the target dropdown.
const LANGUAGES = [
  ['en', 'English'], ['fr', 'French'], ['it', 'Italian'], ['de', 'German'],
  ['es', 'Spanish'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ja', 'Japanese'],
  ['ko', 'Korean'], ['zh', 'Chinese'], ['ru', 'Russian'], ['ar', 'Arabic'],
  ['tr', 'Turkish'], ['pl', 'Polish'], ['sv', 'Swedish'],
];

const els = {
  host: document.getElementById('host'),
  enable: document.getElementById('enable'),
  targetLang: document.getElementById('targetLang'),
  targetCurrency: document.getElementById('targetCurrency'),
  status: document.getElementById('status'),
};

const STATUS_TEXT = {
  [STATUS_KIND.UNSUPPORTED_API]: 'On-device translation isn’t available in this Chrome.',
  [STATUS_KIND.UNSUPPORTED_LANG]: 'This language pair isn’t available for translation.',
  [STATUS_KIND.NEEDS_ACTIVATION]: 'Click “Translate this page” on the page to download the model.',
  [STATUS_KIND.READY]: 'Translating.',
  [STATUS_KIND.IDLE]: '',
};

let activeTab = null;
let host = '';

function fillSelect(select, entries, selected) {
  select.innerHTML = '';
  for (const [value, label] of entries) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === selected) opt.selected = true;
    select.appendChild(opt);
  }
}

async function sendToTab(type) {
  if (!activeTab) return;
  try {
    await chrome.tabs.sendMessage(activeTab.id, { type });
  } catch {
    /* content script not present on this page */
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  try {
    host = tab?.url ? new URL(tab.url).hostname : '';
  } catch {
    host = '';
  }
  els.host.textContent = host || 'Not a translatable page';

  const settings = await getSettings();
  fillSelect(els.targetLang, LANGUAGES, settings.targetLang);
  fillSelect(
    els.targetCurrency,
    [...FRANKFURTER_SUPPORTED].sort().map((c) => [c, c]),
    settings.targetCurrency,
  );
  els.enable.checked = Boolean(settings.enabledHosts[host]);

  const usable = Boolean(host);
  els.enable.disabled = !usable;

  els.enable.addEventListener('change', async () => {
    await setHostEnabled(host, els.enable.checked);
    await sendToTab(els.enable.checked ? MSG.ENABLE_SITE : MSG.DISABLE_SITE);
  });

  els.targetLang.addEventListener('change', async () => {
    await setSettings({ targetLang: els.targetLang.value });
    if (els.enable.checked) await sendToTab(MSG.RERUN);
  });

  els.targetCurrency.addEventListener('change', async () => {
    await setSettings({ targetCurrency: els.targetCurrency.value });
    if (els.enable.checked) await sendToTab(MSG.RERUN);
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MSG.STATUS) {
    if (message.kind === STATUS_KIND.DOWNLOADING) {
      els.status.textContent = `Downloading model… ${Math.round((message.progress || 0) * 100)}%`;
    } else {
      els.status.textContent = STATUS_TEXT[message.kind] ?? '';
    }
  }
});

init();
