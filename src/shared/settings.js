// Settings persistence over chrome.storage.sync, with sensible defaults.

const STORAGE_KEY = 'settings';

/** Base language subtag of the browser UI language, e.g. "en-US" -> "en". */
export function uiLangBase() {
  try {
    const ui = chrome.i18n.getUILanguage();
    return (ui || 'en').split('-')[0].toLowerCase();
  } catch {
    return 'en';
  }
}

export function defaultSettings() {
  return {
    targetLang: uiLangBase(),
    targetCurrency: 'USD',
    // "manual" = dormant until the user enables a host; the per-host map gates activation.
    mode: 'manual',
    enabledHosts: {},
    glossaryEnabled: true,
    sizeEnabled: true,
  };
}

export async function getSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return { ...defaultSettings(), ...(stored[STORAGE_KEY] || {}) };
}

export async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}

export async function isHostEnabled(host) {
  const { enabledHosts } = await getSettings();
  return Boolean(enabledHosts[host]);
}

export async function setHostEnabled(host, enabled) {
  const current = await getSettings();
  const enabledHosts = { ...current.enabledHosts };
  if (enabled) enabledHosts[host] = true;
  else delete enabledHosts[host];
  return setSettings({ enabledHosts });
}

/** Subscribe to settings changes; returns an unsubscribe function. */
export function onChanged(cb) {
  const listener = (changes, area) => {
    if (area === 'sync' && changes[STORAGE_KEY]) {
      cb({ ...defaultSettings(), ...(changes[STORAGE_KEY].newValue || {}) });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
