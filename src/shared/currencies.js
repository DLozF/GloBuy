// Currency symbol/code helpers shared by the currency-conversion pipeline.

// Currencies covered by Frankfurter (ECB reference set). Conversions outside this
// set are skipped silently.
export const FRANKFURTER_SUPPORTED = new Set([
  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP',
  'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR',
  'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
]);

// Unambiguous symbol -> ISO code. Ambiguous symbols ($, ¥, kr) are resolved
// contextually in currency.js (resolveCode) and intentionally omitted here.
export const SYMBOL_TO_CODE = {
  '€': 'EUR',
  '£': 'GBP',
  '₩': 'KRW',
  '₺': 'TRY',
  '₪': 'ILS',
  '฿': 'THB',
  '₱': 'PHP',
  '₹': 'INR',
  'zł': 'PLN',
  'Kč': 'CZK',
  'Ft': 'HUF',
  'R$': 'BRL',
  'CHF': 'CHF',
};

// Codes that may appear written out literally next to an amount.
export const CODE_TOKENS = new Set([...FRANKFURTER_SUPPORTED]);

/**
 * Format an amount in the given currency for display, falling back gracefully
 * when Intl can't resolve the code.
 */
export function formatMoney(amount, code, locale = undefined) {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: amount >= 100 ? 0 : 2,
    }).format(amount);
  } catch {
    const rounded = amount >= 100 ? Math.round(amount) : Math.round(amount * 100) / 100;
    return `${rounded} ${code}`;
  }
}
