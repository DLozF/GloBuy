const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers');

const sizes = () => loadModule('src/content/sizes.js').LuxeSizes;

test('findSizes: shoe length in mm', () => {
  const r = sizes().findSizes('사이즈 260mm');
  assert.equal(r.length, 1);
  assert.equal(r[0].label, 'US 8');
});

test('findSizes: shoe length in cm (with decimal)', () => {
  assert.equal(sizes().findSizes('발길이 26.5cm')[0].label, 'US 8.5');
});

test('findSizes: explicit EU marker', () => {
  assert.equal(sizes().findSizes('EU 38')[0].label, 'US 6');
  assert.equal(sizes().findSizes('EUR40')[0].label, 'US 8');
});

test('findSizes: bare numbers are never converted', () => {
  assert.equal(sizes().findSizes('상품번호 2500').length, 0);
  assert.equal(sizes().findSizes('2,500,000').length, 0);
});

test('findSizes: out-of-range values ignored', () => {
  assert.equal(sizes().findSizes('999mm').length, 0); // beyond plausible shoe length
  assert.equal(sizes().findSizes('EU 99').length, 0);
});

test('findSizes: multiple sizes in one string, non-overlapping', () => {
  const r = sizes().findSizes('240mm / EU 39');
  assert.deepEqual(r.map((s) => s.label), ['US 6', 'US 7']);
});
