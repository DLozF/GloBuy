import { describe, it, expect } from 'vitest';
import {
  parseAmount,
  resolveCode,
  convert,
  findPrices,
} from '../src/content/currency.js';

describe('parseAmount', () => {
  it('parses European grouping (dot thousands, comma decimal)', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1 234,56')).toBe(1234.56);
    expect(parseAmount('12,50')).toBe(12.5);
  });

  it('parses US grouping (comma thousands, dot decimal)', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('12.50')).toBe(12.5);
  });

  it('treats a separator + 3 digits as thousands, not decimal', () => {
    expect(parseAmount('1,234')).toBe(1234);
    expect(parseAmount('1.234')).toBe(1234);
  });

  it('parses plain integers', () => {
    expect(parseAmount('1234')).toBe(1234);
  });
});

describe('resolveCode', () => {
  it('maps unambiguous symbols', () => {
    expect(resolveCode('€')).toBe('EUR');
    expect(resolveCode('£')).toBe('GBP');
    expect(resolveCode('CHF')).toBe('CHF');
  });

  it('resolves ISO codes when supported', () => {
    expect(resolveCode('USD')).toBe('USD');
    expect(resolveCode('XYZ')).toBe(null);
  });

  it('disambiguates the dollar sign by TLD then default', () => {
    expect(resolveCode('$')).toBe('USD');
    expect(resolveCode('$', { tld: 'ca' })).toBe('CAD');
  });

  it('disambiguates the yen/yuan sign by source language', () => {
    expect(resolveCode('¥', { sourceLang: 'ja' })).toBe('JPY');
    expect(resolveCode('¥', { sourceLang: 'zh' })).toBe('CNY');
  });

  it('disambiguates the krone/krona sign by source language', () => {
    expect(resolveCode('kr', { sourceLang: 'sv' })).toBe('SEK');
    expect(resolveCode('kr', { sourceLang: 'da' })).toBe('DKK');
  });
});

describe('convert', () => {
  const rates = { EUR: 1, USD: 1.1, GBP: 0.85 };

  it('converts through the EUR base', () => {
    expect(convert(100, 'EUR', 'USD', rates)).toBeCloseTo(110);
    expect(convert(110, 'USD', 'EUR', rates)).toBeCloseTo(100);
  });

  it('returns the amount unchanged for same currency', () => {
    expect(convert(50, 'USD', 'USD', rates)).toBe(50);
  });

  it('returns null for unknown currencies', () => {
    expect(convert(50, 'EUR', 'JPY', rates)).toBe(null);
  });
});

describe('findPrices', () => {
  it('detects symbol-before and symbol-after prices', () => {
    expect(findPrices('$1,234.56', {})).toEqual([{ code: 'USD', amount: 1234.56 }]);
    expect(findPrices('1 234,56 €', {})).toEqual([{ code: 'EUR', amount: 1234.56 }]);
  });

  it('detects multiple prices in one string', () => {
    expect(findPrices('was €100 now €80', {})).toEqual([
      { code: 'EUR', amount: 100 },
      { code: 'EUR', amount: 80 },
    ]);
  });
});
