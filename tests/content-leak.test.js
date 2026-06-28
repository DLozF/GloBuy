// Memory-retention test for content.js.
//
// The orchestrator used to keep two Maps keyed by text node (originals /
// translatedVals) plus an attrRecords array — so on virtualized / infinite
// scroll pages, every node it ever translated stayed pinned for the page's
// life even after the page removed it. State now lives on the nodes themselves
// (_ltOrig / _ltTrans expandos), so a removed node is reclaimed normally.
//
// This loads the REAL content.js + dom-walker.js under jsdom (translator /
// currency / sizes are stubbed), translates a batch of nodes, removes them
// (simulating virtual scroll), and asserts that nothing strongly retains them:
// WeakRefs to the removed nodes clear after a forced GC. Requires --expose-gc
// (the test script passes it); skips cleanly otherwise.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const src = (rel) => {
  let code = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  code = code.replace(/import\s+[\s\S]*?\s+from\s+['"].*?['"];?/g, '');
  code = code.replace(/\bexport\s+(function|const|let|var|class|async\s+function)\b/g, '$1');
  code = code.replace(/\bexport\s+{[^}]*};?/g, '');
  return code;
};
const evalGlobal = (code) => (0, eval)(code); // run in global scope; bare names -> global

function setupEnv() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>제목</title></head><body></body></html>',
    { url: 'https://example.com/', pretendToBeVisual: true }
  );
  const { window } = dom;

  // Expose the DOM globals content.js / dom-walker.js reference as bare names.
  for (const k of ['window', 'document', 'Node', 'NodeFilter', 'MutationObserver', 'Element', 'HTMLElement']) {
    global[k] = window[k];
  }
  global.window = window;
  global.document = window.document;
  Object.defineProperty(global, 'location', { value: window.location, configurable: true });
  Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
  global.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 0);
  global.cancelIdleCallback = (id) => clearTimeout(id);

  // Stub chrome: capture the message listener, no-op everything else.
  let listener = null;
  global.chrome = {
    storage: {
      sync: { get: async () => ({ settings: { autoTranslate: false, targetLanguage: 'en' }, siteState: {} }) },
      local: { get: async () => ({}), set: async () => {} }
    },
    runtime: {
      lastError: undefined,
      onMessage: { addListener: (fn) => { listener = fn; } },
      sendMessage: (_msg, cb) => { if (typeof cb === 'function') cb(); return Promise.resolve({ rate: null }); }
    },
    tabs: {}
  };

  // Stub the heavy collaborators; keep the real dom-walker for collection/observe.
  global.LuxeTranslator = {
    apiAvailable: () => true,
    detectorAvailable: () => true,
    detectLanguage: async () => 'ko',
    getTranslator: async () => ({}),
    translateText: async (_tr, text) => String(text).toUpperCase(),
    translateBatch: async (_tr, items) => items.map((it) => it.text.toUpperCase())
  };
  global.LuxeCurrency = { annotate: async () => {}, findPrices: () => [], inferSourceCurrency: () => null };
  global.LuxeSizes = { annotate: async () => {} };
  global.LuxeSearch = { install: () => {} };

  evalGlobal(src('src/content/dom-walker.js')); // real -> global.LuxeWalker
  evalGlobal(src('src/content/content.js'));     // real orchestrator (auto-init: enabled=false -> no run)

  const apply = () => new Promise((resolve) => listener({ type: 'apply' }, {}, resolve));
  const showOriginal = (value) => new Promise((resolve) => listener({ type: 'showOriginal', value }, {}, resolve));
  return { window, apply, showOriginal };
}

// Force several MutationObserver delivery cycles, then GC. jsdom keeps a
// transient registration on a removed subtree until the observer's next
// delivery, so a throwaway mutation each cycle lets those clear before we
// measure retention.
const flush = async (doc) => {
  for (let i = 0; i < 12; i++) {
    const probe = doc.createElement('div');
    doc.body.appendChild(probe);
    probe.remove();
    await new Promise((r) => setTimeout(r, 0));
    global.gc();
  }
};

function addRows(doc, body, prefix, n) {
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const div = doc.createElement('div');
    div.textContent = `${prefix} item ${i}`;
    body.appendChild(div);
    nodes.push(div.firstChild);
  }
  return nodes;
}

test('virtual scroll: removed translated nodes are not retained', async (t) => {
  if (typeof global.gc !== 'function') { t.skip('run with node --expose-gc'); return; }
  const { window, apply } = setupEnv();
  const doc = window.document;
  const body = doc.body;

  // Insert and translate a large batch — enough that the old Map-keyed design
  // (which pinned every translated node) would retain all of them here.
  const N = 120;
  let batch1 = addRows(doc, body, 'alpha', N);
  await apply();
  assert.ok(batch1.every((n) => n._ltTrans !== undefined), 'batch1 should be translated');
  assert.equal(batch1[0].nodeValue, batch1[0]._ltTrans, 'translated value applied to node');

  const refs = batch1.map((n) => new WeakRef(n));

  // Virtual scroll recycles them out of the DOM, then renders a fresh screen.
  for (const n of batch1) { const el = n.parentNode; if (el) el.remove(); }
  batch1 = null;
  let batch2 = addRows(doc, body, 'beta', N);
  await apply();
  assert.ok(batch2.every((n) => n._ltTrans !== undefined), 'batch2 should be translated');
  batch2 = null;

  await flush(doc);

  // Retention must be O(1), not O(N): with the old Map-keyed design this would
  // be ~N. jsdom itself keeps a single transient reference to the last-removed
  // subtree (disconnected), so we allow a tiny constant rather than exactly 0.
  const retained = refs.filter((r) => r.deref() !== undefined).length;
  assert.ok(retained <= 2, `${retained}/${refs.length} removed nodes still retained — expected O(1), not O(N)`);
});

test('show original re-walks the DOM and swaps only live nodes', async (t) => {
  const { window, apply, showOriginal } = setupEnv();
  const doc = window.document;
  const body = doc.body;

  const rows = addRows(doc, body, 'gamma', 5);
  await apply();
  const orig0 = rows[0]._ltOrig;
  const trans0 = rows[0]._ltTrans;
  assert.equal(rows[0].nodeValue, trans0);

  await showOriginal(true);
  assert.equal(rows[0].nodeValue, orig0, 'shows original after toggle');

  // Remove a node, then toggle back: the removed node must not throw / resurrect.
  const removed = rows[1];
  removed.parentNode.remove();
  await showOriginal(false);
  assert.equal(rows[0].nodeValue, trans0, 'shows translation again');
  assert.equal(removed.isConnected, false, 'removed node stays removed');
});
