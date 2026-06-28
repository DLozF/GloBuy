// Drift guard: the proxy keeps a hand-copy of the extension's glossary
// (proxy/src/glossary.js mirrors src/data/glossary.js) because a content script
// can't import an ESM/JSON module without a build step. The two wrappers differ
// (`globalThis.GLOBUY_GLOSSARY =` vs `export const GLOSSARY =`), so the FILES can't
// be byte-identical — but their data must be. This test fails the build the
// moment the two drift, in both source text and parsed value.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadModule } = require('./helpers');

const EXT_PATH = path.join(__dirname, '..', 'src', 'data', 'glossary.js');
const PROXY_PATH = path.join(__dirname, '..', 'proxy', 'src', 'glossary.js');

// The `{ ... }` object literal, ignoring each file's assignment/export wrapper.
function objectBody(src) {
  const open = src.indexOf('{', src.indexOf('= {'));
  const close = src.lastIndexOf('}');
  return src.slice(open, close + 1);
}

test('extension and proxy glossary bodies are byte-identical', () => {
  const ext = objectBody(fs.readFileSync(EXT_PATH, 'utf8'));
  const proxy = objectBody(fs.readFileSync(PROXY_PATH, 'utf8'));
  assert.equal(
    proxy, ext,
    'proxy/src/glossary.js drifted from src/data/glossary.js — re-copy the object literal'
  );
});

test('extension and proxy glossaries parse to the same object', async () => {
  const ext = loadModule('src/data/glossary.js').GLOBUY_GLOSSARY;
  const { GLOSSARY: proxy } = await import(pathToFileURL(PROXY_PATH).href);
  assert.deepEqual(proxy, ext);
});
