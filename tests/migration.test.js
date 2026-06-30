// Verifies the one-time "default sites OFF" migration in src/background.js:
// it clears any remembered per-host enables exactly once, preserves other
// settings, and never wipes the user's later choices on subsequent installs.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Minimal chrome.storage + runtime mock. get() is used only with string keys in
// background.js, which is all we need here.
function makeChrome() {
  const sync = {};
  const local = {};
  const bucket = (b) => ({
    get: async (key) => (typeof key === 'string' ? { [key]: b[key] } : {}),
    set: async (obj) => { Object.assign(b, obj); },
  });
  let onInstalled = null;
  const chrome = {
    storage: { sync: bucket(sync), local: bucket(local) },
    runtime: {
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: (cb) => { onInstalled = cb; } },
    },
  };
  return { chrome, sync, local, fireInstalled: () => onInstalled && onInstalled() };
}

// Evaluate background.js as a script with `chrome` injected; node globals
// (fetch, setTimeout, AbortController, crypto…) resolve naturally.
function loadBackground(chrome) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src/background.js'), 'utf8');
  new Function('chrome', code)(chrome);
}

// Let the (un-awaited) async migration settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

test('migration clears enabledHosts and forces autoTranslate off, preserving other settings', async () => {
  const env = makeChrome();
  env.sync.settings = {
    targetLang: 'ko',
    targetCurrency: 'JPY',
    enabledHosts: { 'mercari.com': true, 'chanel.com': true },
    autoTranslate: true,
    glossaryEnabled: true,
  };
  loadBackground(env.chrome);
  env.fireInstalled();
  await flush();

  assert.deepStrictEqual(env.sync.settings.enabledHosts, {}, 'all hosts cleared');
  assert.strictEqual(env.sync.settings.autoTranslate, false, 'autoTranslate forced off');
  assert.strictEqual(env.sync.settings.targetLang, 'ko', 'unrelated setting preserved');
  assert.strictEqual(env.sync.settings.targetCurrency, 'JPY', 'unrelated setting preserved');
  assert.strictEqual(env.local.migratedDefaultOff, true, 'migration flag set');
});

test('migration runs only once — later per-site choices survive', async () => {
  const env = makeChrome();
  env.local.migratedDefaultOff = true; // already migrated
  env.sync.settings = { enabledHosts: { 'farfetch.com': true }, autoTranslate: false };
  loadBackground(env.chrome);
  env.fireInstalled();
  await flush();

  assert.deepStrictEqual(
    env.sync.settings.enabledHosts,
    { 'farfetch.com': true },
    'a host the user enabled after migration is not wiped',
  );
});

test('fresh install with no settings just sets the flag', async () => {
  const env = makeChrome();
  loadBackground(env.chrome);
  env.fireInstalled();
  await flush();

  assert.strictEqual(env.local.migratedDefaultOff, true, 'flag set');
  assert.strictEqual(env.sync.settings, undefined, 'no settings fabricated');
});
