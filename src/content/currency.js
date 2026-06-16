// Price detection, locale-aware amount parsing, currency resolution, conversion,
// and inline annotation. The pure functions (parseAmount, resolveCode, convert)
// are exported for unit testing; annotateRoot performs the DOM mutation.

import {
  FRANKFURTER_SUPPORTED,
  SYMBOL_TO_CODE,
  formatMoney,
} from '../shared/currencies.js';

const ISO_CODES = [...FRANKFURTER_SUPPORTED];

// Currency tokens that may sit next to an amount. Order matters: multi-char
// tokens (R$, ISO codes) must precede single chars in the alternation.
const SYMBOLS = '[€£¥$₩₺₪฿₱₹]';
const WORD_TOKENS = ['R\\$', 'zł', 'Kč', 'Ft', 'CHF', 'kr', ...ISO_CODES].join('|');
const TOKEN = `(?:${SYMBOLS}|${WORD_TOKENS})`;
// Greedy digit groups joined by space/dot/comma separators: matches 1.234,56 /
// 1,234.56 / 1 234,56 / 1234 / 12.50 in full. parseAmount infers the decimal mark.
const NUMBER = '\\d+(?:[ \\u00a0.,]\\d+)*';

// Two ordered alternatives: symbol-before-amount and amount-before-symbol.
export const PRICE_RE = new RegExp(
  `(${TOKEN})\\s?(${NUMBER})|(${NUMBER})\\s?(${TOKEN})`,
  'gu',
);

const TLD_DOLLAR = { ca: 'CAD', au: 'AUD', nz: 'NZD', sg: 'SGD', hk: 'HKD', mx: 'MXN' };
const KR_BY_LANG = { da: 'DKK', nb: 'NOK', nn: 'NOK', no: 'NOK', sv: 'SEK', is: 'ISK' };

/** Resolve a currency token to an ISO code, disambiguating $, ¥, and kr by context. */
export function resolveCode(token, { sourceLang = '', tld = '', defaultDollar = 'USD' } = {}) {
  const t = token.trim();
  if (SYMBOL_TO_CODE[t]) return SYMBOL_TO_CODE[t];
  if (/^[A-Z]{3}$/.test(t)) return FRANKFURTER_SUPPORTED.has(t) ? t : null;
  if (t === '$') return TLD_DOLLAR[tld] || defaultDollar;
  if (t === '¥') return sourceLang === 'zh' ? 'CNY' : 'JPY';
  if (t === 'kr') return KR_BY_LANG[sourceLang] || TLD_DOLLAR[tld] || 'SEK';
  return null;
}

/** Parse a localized numeric string into a Number, inferring the decimal separator. */
export function parseAmount(str) {
  let s = str.replace(/[\s ]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  let decimalSep = null;
  if (lastComma !== -1 && lastDot !== -1) {
    decimalSep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma !== -1) {
    const frac = s.length - lastComma - 1;
    // A single comma followed by 1–2 digits reads as a decimal; otherwise thousands.
    decimalSep = s.indexOf(',') === lastComma && frac <= 2 ? ',' : null;
  } else if (lastDot !== -1) {
    const frac = s.length - lastDot - 1;
    decimalSep = s.indexOf('.') === lastDot && frac <= 2 ? '.' : null;
  }

  if (decimalSep) {
    const thousandSep = decimalSep === ',' ? '.' : ',';
    s = s.split(thousandSep).join('');
    s = s.replace(decimalSep, '.');
  } else {
    s = s.replace(/[.,]/g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Convert an amount between currencies using a base-EUR rate table. */
export function convert(amount, from, to, rates) {
  if (from === to) return amount;
  const rFrom = rates[from];
  const rTo = rates[to];
  if (!rFrom || !rTo) return null;
  return (amount / rFrom) * rTo;
}

/** Extract { code, amount } price matches from a string. */
export function findPrices(text, ctx) {
  const matches = [];
  PRICE_RE.lastIndex = 0;
  let m;
  while ((m = PRICE_RE.exec(text)) !== null) {
    const token = m[1] ?? m[4];
    const number = m[2] ?? m[3];
    const code = resolveCode(token, ctx);
    const amount = parseAmount(number);
    if (code && amount != null) matches.push({ code, amount });
  }
  return matches;
}

// Text nodes already annotated, so re-runs / observer passes don't duplicate spans.
const annotated = new WeakSet();

/**
 * Walk text nodes under `root` and append an "≈ <converted>" span after any node
 * that contains a convertible price.
 */
export function annotateRoot(root, ctx) {
  const { rates, targetCurrency, locale } = ctx;
  if (!rates || !FRANKFURTER_SUPPORTED.has(targetCurrency)) return;

  const nodes = [];
  if (root.nodeType === Node.TEXT_NODE) {
    nodes.push(root);
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (annotated.has(node)) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p || p.closest('.tr-price')) return NodeFilter.FILTER_REJECT;
        return node.nodeValue && /\d/.test(node.nodeValue)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
  }

  for (const node of nodes) {
    if (annotated.has(node)) continue;
    annotated.add(node);
    const prices = findPrices(node.nodeValue, ctx);
    let after = node;
    for (const { code, amount } of prices) {
      if (code === targetCurrency) continue;
      const converted = convert(amount, code, targetCurrency, rates);
      if (converted == null) continue;
      const span = document.createElement('span');
      span.className = 'tr-price';
      span.textContent = ` ≈ ${formatMoney(converted, targetCurrency, locale)}`;
      after.after(span);
      after = span;
    }
  }
}

/** Remove every injected price annotation from the document. */
export function removeAnnotations(rootDoc = document) {
  rootDoc.querySelectorAll('.tr-price').forEach((el) => el.remove());
}
