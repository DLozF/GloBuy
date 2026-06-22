// jsdom tests for the inline-annotation DOM output of currency.annotate and
// sizes.annotate (the pure detection helpers are covered separately). These
// load the real modules with a jsdom document so replaceChild / fragment
// building runs for real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadModule } = require('./helpers');

function jsdomWindow() {
  const win = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://shop.co.kr/' }).window;
  // The modules reference NodeFilter as a bare global inside createTreeWalker.
  global.NodeFilter = win.NodeFilter;
  return win;
}
function currency(win) {
  return loadModule('src/content/currency.js', { document: win.document, location: win.location, Node: win.Node }).LuxeCurrency;
}
function sizes(win) {
  return loadModule('src/content/sizes.js', { document: win.document, Node: win.Node }).LuxeSizes;
}

test('currency.annotate: appends a converted amount span inline, keeping the original', async () => {
  const win = jsdomWindow();
  const doc = win.document;
  const C = currency(win);
  const div = doc.createElement('div');
  div.textContent = '가격 ₩1,200,000';
  doc.body.appendChild(div);

  await C.annotate([div], {
    fromHint: 'ko',
    target: 'USD',
    seen: new WeakSet(),
    convert: async () => ({ rate: 0.000725 }) // 1,200,000 * 0.000725 = 870
  });

  const span = div.querySelector('span.lt-ccy');
  assert.ok(span, 'a .lt-ccy span was inserted');
  assert.match(span.textContent, /\$870/);
  assert.equal(span.getAttribute('data-lt-skip'), ''); // marked so it isn't re-scanned
  assert.match(div.textContent, /₩1,200,000/);          // original price preserved
});

test('currency.annotate: no span when the rate is unavailable', async () => {
  const win = jsdomWindow();
  const doc = win.document;
  const C = currency(win);
  const div = doc.createElement('div');
  div.textContent = '₩1,200,000';
  doc.body.appendChild(div);

  await C.annotate([div], {
    fromHint: 'ko', target: 'USD', seen: new WeakSet(),
    convert: async () => ({ rate: null })
  });

  assert.equal(div.querySelector('span.lt-ccy'), null);
  assert.equal(div.textContent, '₩1,200,000');
});

test('sizes.annotate: appends a US size span with the approximate tooltip', async () => {
  const win = jsdomWindow();
  const doc = win.document;
  const S = sizes(win);
  const div = doc.createElement('div');
  div.textContent = '사이즈 260mm';
  doc.body.appendChild(div);

  await S.annotate([div], { seen: new WeakSet() });

  const span = div.querySelector('span.lt-size');
  assert.ok(span, 'a .lt-size span was inserted');
  assert.match(span.textContent, /≈ US 8\b/);
  assert.match(span.title, /approximate/i);
  assert.match(div.textContent, /260mm/); // original size preserved
});

test('sizes.annotate: branches the scale when a gender label shares the element', async () => {
  const win = jsdomWindow();
  const doc = win.document;
  const S = sizes(win);
  const div = doc.createElement('div');
  div.textContent = '여성 스니커즈 EU 38';
  doc.body.appendChild(div);

  await S.annotate([div], { seen: new WeakSet() });

  const span = div.querySelector('span.lt-size');
  assert.ok(span);
  assert.match(span.textContent, /US W 7\.5/); // women's scale, not unisex US 6
  assert.match(span.title, /women/);
});
