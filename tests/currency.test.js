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

test('inferSourceCurrency: Vietnamese -> VND (language and .vn TLD)', () => {
  assert.equal(ccy().inferSourceCurrency('vi'), 'VND');
  assert.equal(ccy({ location: { hostname: 'shop.example.vn' } }).inferSourceCurrency('en'), 'VND');
});

test('findPrices: Vietnamese đ / ₫ with dot-thousands grouping', () => {
  const C = ccy();
  const a = C.findPrices('1.500.000đ', 'vi');
  assert.equal(a[0].currency, 'VND');
  assert.equal(a[0].amount, 1500000);
  const b = C.findPrices('₫500.000', 'vi');
  assert.equal(b[0].currency, 'VND');
  assert.equal(b[0].amount, 500000);
});

test('findPrices: bare dot-grouped numbers convert only for VND locale', () => {
  const C = ccy();
  // VND-inferred site: bare "7.000" / "1.500.000" are prices.
  const a = C.findPrices('7.000', 'vi', 'VND');
  assert.equal(a.length, 1);
  assert.equal(a[0].amount, 7000);
  assert.equal(C.findPrices('1.500.000', 'vi', 'VND')[0].amount, 1500000);
  // KRW-inferred site (comma-grouping): a dot-grouped number is NOT a bare price.
  assert.equal(C.findPrices('1.500.000', 'ko', 'KRW').length, 0);
});

test('parseAmount via findPrices: dot-thousands and mixed EU grouping', () => {
  const C = ccy();
  assert.equal(C.findPrices('€2.350', 'en')[0].amount, 2350);      // was mis-parsed as 2.35
  assert.equal(C.findPrices('€1.234,56', 'en')[0].amount, 1234.56); // EU decimal
  assert.equal(C.findPrices('$1,234.56', 'en')[0].amount, 1234.56); // US decimal
  assert.equal(C.findPrices('₩1,200,000', 'ko')[0].amount, 1200000); // unchanged
});
