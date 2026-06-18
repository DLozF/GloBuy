const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers');

const ccy = (opts) => loadModule('src/content/currency.js', opts).LuxeCurrency;

test('findPrices: explicit symbol', () => {
  const p = ccy().findPrices('₩1,200,000', 'ko');
  assert.equal(p.length, 1);
  assert.equal(p[0].currency, 'KRW');
  assert.equal(p[0].amount, 1200000);
});

test('findPrices: 원 suffix', () => {
  const p = ccy().findPrices('850,000원', 'ko');
  assert.equal(p[0].currency, 'KRW');
  assert.equal(p[0].amount, 850000);
});

test('findPrices: ambiguous ¥ resolved by language hint', () => {
  assert.equal(ccy().findPrices('¥5,000', 'ja')[0].currency, 'JPY');
  assert.equal(ccy().findPrices('¥5,000', 'zh')[0].currency, 'CNY');
});

test('findPrices: ISO code', () => {
  const p = ccy().findPrices('1,000 USD', 'ko');
  assert.equal(p[0].currency, 'USD');
  assert.equal(p[0].amount, 1000);
});

test('findPrices: bare number only converts with an inferred currency', () => {
  assert.equal(ccy().findPrices('2,500,000', 'ko', null).length, 0);
  const p = ccy().findPrices('2,500,000', 'ko', 'KRW');
  assert.equal(p[0].currency, 'KRW');
  assert.equal(p[0].amount, 2500000);
});

test('findPrices: bare-number guards skip counts/dates/units/years/phones', () => {
  for (const s of ['1,234명', '1,000개', '3,200점', '2,024년', '1,500ml', '2,500 km', '2024', '010-1234-5678']) {
    assert.equal(ccy().findPrices(s, 'ko', 'KRW').length, 0, `should skip: ${s}`);
  }
});

test('findPrices: marked price wins over the bare sub-match', () => {
  const p = ccy().findPrices('850,000원', 'ko', 'KRW');
  assert.equal(p.length, 1);
  assert.equal(p[0].currency, 'KRW');
});

test('inferSourceCurrency: language hint', () => {
  const C = ccy();
  assert.equal(C.inferSourceCurrency('ko'), 'KRW');
  assert.equal(C.inferSourceCurrency('ja'), 'JPY');
  assert.equal(C.inferSourceCurrency('zh'), 'CNY');
});

test('inferSourceCurrency: TLD fallback when language is unknown', () => {
  const C = ccy({ location: { hostname: 'shop.example.co.kr' } });
  assert.equal(C.inferSourceCurrency('en'), 'KRW');
});

test('inferSourceCurrency: og:locale fallback', () => {
  const C = ccy({
    location: { hostname: 'example.com' },
    document: { querySelector: (s) => (s.includes('og:locale') ? { getAttribute: () => 'ja_JP' } : null) }
  });
  assert.equal(C.inferSourceCurrency('en'), 'JPY');
});

test('inferSourceCurrency: null when nothing matches (keeps bare conversion off)', () => {
  const C = ccy({ location: { hostname: 'example.com' } });
  assert.equal(C.inferSourceCurrency('en'), null);
});
