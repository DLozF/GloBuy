const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers');

const T = loadModule('src/content/translator.js').LuxeTranslator;
const DELIM = String.fromCharCode(0xF8FF);
const items = (...texts) => texts.map((text) => ({ text, protectLiterals: null }));

test('translateBatch: one translate() call for the whole chunk', async () => {
  let calls = 0;
  const tr = { _ltCache: new Map(), translate: async (s) => { calls++; return s.toUpperCase(); } };
  const out = await T.translateBatch(tr, items('ab', 'cd', 'ef'), null);
  assert.deepEqual(out, ['AB', 'CD', 'EF']);
  assert.equal(calls, 1); // batched, not 3 calls
});

test('translateBatch: falls back to per-item when the delimiter is lost', async () => {
  let calls = 0;
  // a translator that drops the delimiter -> split count mismatch -> fallback
  const tr = { _ltCache: new Map(), translate: async (s) => { calls++; return s.split(DELIM).join(''); } };
  const out = await T.translateBatch(tr, items('ab', 'cd', 'ef'), null);
  assert.deepEqual(out, ['ab', 'cd', 'ef']); // each item still resolved
  assert.equal(calls, 4); // 1 failed batch + 3 per-item
});

test('translateBatch: trims parts when a model pads the delimiter with spaces', async () => {
  let calls = 0;
  // A translator that uppercases and surrounds the delimiter with spaces.
  const tr = {
    _ltCache: new Map(),
    translate: async (s) => { calls++; return s.toUpperCase().split(DELIM).join(' ' + DELIM + ' '); }
  };
  const out = await T.translateBatch(tr, items('ab', 'cd', 'ef'), null);
  assert.deepEqual(out, ['AB', 'CD', 'EF']); // stray padding trimmed off
  assert.equal(calls, 1); // still one batched call, not a per-item fallback
});

test('translateBatch: cache hit avoids re-translating', async () => {
  let calls = 0;
  const tr = { _ltCache: new Map(), translate: async (s) => { calls++; return s.toUpperCase(); } };
  await T.translateBatch(tr, items('xy'), null);
  calls = 0;
  const out = await T.translateBatch(tr, items('xy'), null);
  assert.deepEqual(out, ['XY']);
  assert.equal(calls, 0);
});

test('translateBatch: glossary terms are protected and restored', async () => {
  // stub "translation" uppercases; Korean/PUA pass through, so we only verify
  // that the protected glossary term is swapped to its English value.
  const tr = { _ltCache: new Map(), translate: async (s) => s };
  const out = await T.translateBatch(tr, items('정품 가방'), { '정품': 'Authentic' });
  assert.equal(out[0], 'Authentic 가방');
});

test('translateText: single-node path still works', async () => {
  const tr = { _ltCache: new Map(), translate: async (s) => s.toUpperCase() };
  assert.equal(await T.translateText(tr, 'hello', null, null), 'HELLO');
});
