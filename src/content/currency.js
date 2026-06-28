// Price detection + inline currency annotation.
//
// Scans text nodes for prices, asks the service worker to convert them, and
// appends the converted amount right next to the original, e.g.
//   ₩1,200,000 (≈ $870)

const SYMBOL_CCY = {
  '₩': 'KRW', '€': 'EUR', '£': 'GBP', '₹': 'INR', '₫': 'VND', '฿': 'THB'
};
// Symbols shared by multiple currencies — resolved using the page language.
const AMBIGUOUS = {
  '¥': { ja: 'JPY', zh: 'CNY', _default: 'JPY' },
  '$': { _default: 'USD' }
};
// Currency-name suffixes that follow the amount (CJK + Vietnamese đ/₫, which
// are written after the number, e.g. "500.000đ").
const SUFFIX_CCY = [
  ['원', 'KRW'], ['엔', 'JPY'], ['円', 'JPY'], ['元', 'CNY'], ['위안', 'CNY'],
  ['đ', 'VND'], ['₫', 'VND']
];
const DISPLAY_SYMBOL = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', KRW: '₩', CNY: '¥', INR: '₹', VND: '₫'
};
const NO_DECIMALS = new Set(['JPY', 'KRW', 'CNY', 'VND']);

function resolveSymbol(sym, hint) {
  if (AMBIGUOUS[sym]) return AMBIGUOUS[sym][hint] || AMBIGUOUS[sym]._default;
  return SYMBOL_CCY[sym] || null;
}

// Infer the page's source currency so bare, unmarked numbers (e.g. a listing
// that just shows "2,500,000") can still be converted. Returns null when we
// can't tell — which keeps bare-number conversion OFF for non-CJK sites.
const LANG_CCY = { ko: 'KRW', ja: 'JPY', zh: 'CNY', vi: 'VND' };
const TLD_CCY = { kr: 'KRW', jp: 'JPY', cn: 'CNY', hk: 'HKD', tw: 'TWD', vn: 'VND' };
const LOCALE_CCY = { KR: 'KRW', JP: 'JPY', CN: 'CNY', HK: 'HKD', TW: 'TWD', VN: 'VND' };
let _inferred, _inferredFor;

export function inferSourceCurrency(hint) {
  if (_inferredFor === hint) return _inferred;
  let ccy = LANG_CCY[hint] || null;
  if (!ccy) {
    const tld = (location.hostname || '').split('.').pop().toLowerCase();
    ccy = TLD_CCY[tld] || null;
  }
  if (!ccy) {
    const meta = document.querySelector('meta[property="og:locale"]');
    const region = ((meta && meta.getAttribute('content')) || '').split(/[_-]/)[1];
    if (region) ccy = LOCALE_CCY[region.toUpperCase()] || null;
  }
  _inferredFor = hint;
  _inferred = ccy;
  return ccy;
}

function parseAmount(raw) {
  let s = raw.replace(/[\s\u00a0]/g, '');
  const hasComma = s.indexOf(',') !== -1;
  const hasDot = s.indexOf('.') !== -1;
  if (hasComma && hasDot) {
    // The right-most separator is the decimal point; the other is thousands.
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else if (hasComma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot) {
    // Groups of exactly 3 (e.g. 1.500.000 / 2.350) = thousands; else decimal.
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  const v = parseFloat(s);
  return isFinite(v) ? v : null;
}

const NUM = '(\\d[\\d.,\\s\\u00a0]*\\d|\\d)';

// Compiled once — these were rebuilt (~8 RegExp compilations) on every text
// node before. `g` regexes are stateful, so each use resets `.lastIndex`.
const SYM_RE = new RegExp('([₩$€£¥₹₫฿])\\s?' + NUM, 'g');
const CODE_RE = new RegExp(NUM + '\\s?(USD|EUR|GBP|JPY|KRW|CNY|INR|VND|THB)\\b', 'gi');
const SUFFIX_RE = SUFFIX_CCY.map(function (e) { return [new RegExp(NUM + '\\s?' + e[0], 'g'), e[1]]; });
const BARE_RE = /(?<![\d., ])(\d{1,3}(?:,\d{3})+)(?![\d., ])/g;
const BARE_DOT_RE = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+)(?![\d.,])/g;

// Units that follow a number but mean it's NOT a price (counts, dates, sizes),
// so bare-number inference doesn't convert e.g. "1,234명" view counts. CJK
// units need no word boundary (they aren't ASCII \w); ASCII units must not run
// into another letter (so "1,000 grams" isn't mistaken for a "g" unit).
const NON_PRICE_UNIT = /^\s*(?:[명회개점건년월일위등]|(?:mm|cm|km|kg|ml|g)(?![a-z]))/i;

// Returns non-overlapping prices: [{start, end, amount, currency}]
// `inferredCurrency` (optional): when set, bare comma-grouped numbers with no
// explicit currency marker are treated as that currency.
export function findPrices(text, hint, inferredCurrency) {
  const matches = [];
  let m;

  SYM_RE.lastIndex = 0;
  while ((m = SYM_RE.exec(text))) {
    const ccy = resolveSymbol(m[1], hint);
    const amt = parseAmount(m[2]);
    if (ccy && amt != null) {
      matches.push({ start: m.index, end: m.index + m[0].length, amount: amt, currency: ccy });
    }
  }

  CODE_RE.lastIndex = 0;
  while ((m = CODE_RE.exec(text))) {
    const amt = parseAmount(m[1]);
    if (amt != null) {
      matches.push({ start: m.index, end: m.index + m[0].length, amount: amt, currency: m[2].toUpperCase() });
    }
  }

  for (const [re, ccy] of SUFFIX_RE) {
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const amt = parseAmount(m[1]);
      if (amt != null) {
        matches.push({ start: m.index, end: m.index + m[0].length, amount: amt, currency: ccy });
      }
    }
  }

  // Bare comma-grouped numbers (no marker), tagged with the inferred currency.
  if (inferredCurrency) {
    BARE_RE.lastIndex = 0;
    while ((m = BARE_RE.exec(text))) {
      if (NON_PRICE_UNIT.test(text.slice(m.index + m[0].length))) continue;
      const amt = parseAmount(m[1]);
      if (amt != null) {
        matches.push({ start: m.index, end: m.index + m[0].length, amount: amt, currency: inferredCurrency });
      }
    }
  }

  // Dot-grouped bare numbers, only for dot-grouping locales (VND).
  if (inferredCurrency === 'VND') {
    BARE_DOT_RE.lastIndex = 0;
    while ((m = BARE_DOT_RE.exec(text))) {
      if (NON_PRICE_UNIT.test(text.slice(m.index + m[0].length))) continue;
      const amt = parseAmount(m[1]);
      if (amt != null) {
        matches.push({ start: m.index, end: m.index + m[0].length, amount: amt, currency: inferredCurrency });
      }
    }
  }

  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let lastEnd = -1;
  for (const mm of matches) {
    if (mm.start >= lastEnd) { out.push(mm); lastEnd = mm.end; }
  }
  return out;
}

// A node is "pure price" when its text has no letters outside the detected
// price spans — i.e. nothing to translate. Those can be converted *before* the
// translation pass (no surrounding words to mangle), so the prominent price
// shows its conversion immediately instead of waiting for translation.
function isPurePrice(text, prices) {
  let rest = '';
  let cursor = 0;
  for (const p of prices) { rest += text.slice(cursor, p.start); cursor = p.end; }
  rest += text.slice(cursor);
  return !/\p{L}/u.test(rest);
}

function format(amount, ccy) {
  const sym = DISPLAY_SYMBOL[ccy] || '';
  const digits = NO_DECIMALS.has(ccy) ? 0 : 2;
  const n = amount.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return sym ? sym + n : n + ' ' + ccy;
}

function gatherNodes(roots, seen) {
  const nodes = [];
  for (const r of roots) {
    if (r.nodeType === Node.TEXT_NODE) {
      if (!seen.has(r) && r.nodeValue && /\d/.test(r.nodeValue)) nodes.push(r);
      continue;
    }
    if (r.nodeType !== Node.ELEMENT_NODE && r.nodeType !== Node.DOCUMENT_NODE) continue;
    const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (seen.has(n)) return NodeFilter.FILTER_REJECT;
        if (!n.nodeValue || !/\d/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-lt-skip]')) return NodeFilter.FILTER_REJECT;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = w.nextNode())) nodes.push(n);
  }
  return nodes;
}

// Rate cache across annotate calls (observer batches) for the page session —
// KRW->USD is fetched once and reused for every price, instead of a
// service-worker round-trip per price. Target-currency changes reload the page
// (fresh content script -> fresh cache), so this can't serve a stale target.
const _rateCache = new Map(); // "FROM>TGT" -> rate number (failed fetches are not cached)

// opts: { fromHint, target, seen (WeakSet), convert(from,to)->Promise<{rate}> }
export async function annotate(roots, opts) {
  const { fromHint, seen, convert } = opts;
  const tgt = (opts.target || 'USD').toUpperCase();
  // pureOnly: handle only standalone-price nodes (no surrounding translatable
  // text). Used for the early pass that runs before translation.
  const pureOnly = !!opts.pureOnly;
  const inferred = inferSourceCurrency(fromHint);
  const nodes = gatherNodes(roots, seen);

  // Pass 1: detect prices and collect currencies still needed. Nodes are marked
  // seen only after a successful annotation (pass 2) so a failed rate fetch
  // can be retried on the next observer pass.
  const priced = [];
  const need = new Set();
  for (const node of nodes) {
    if (seen.has(node)) continue;
    const text = node.nodeValue;
    const prices = findPrices(text, fromHint, inferred);
    if (!prices.length) continue;
    if (pureOnly && !isPurePrice(text, prices)) continue;
    priced.push({ node, text, prices });
    for (const p of prices) {
      if (p.currency !== tgt && !_rateCache.has(p.currency + '>' + tgt)) need.add(p.currency);
    }
  }
  if (!priced.length) return;

  // Fetch each distinct rate once, in parallel.
  await Promise.all([...need].map(async (from) => {
    const key = from + '>' + tgt;
    try {
      const res = await convert(from, tgt);
      if (res && typeof res.rate === 'number') _rateCache.set(key, res.rate);
    } catch (e) { /* leave uncached so the next pass retries */ }
  }));

  // Pass 2: build annotations synchronously from the cached rates.
  for (const { node, text, prices } of priced) {
    if (!node.parentNode || node.nodeValue !== text) continue; // changed under us
    const converted = prices.map((p) => {
      if (p.currency === tgt) return null;
      const r = _rateCache.get(p.currency + '>' + tgt);
      return r != null ? p.amount * r : null;
    });
    if (!converted.some((c) => c != null)) continue;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    const pushText = (s) => {
      const tn = document.createTextNode(s);
      tn._ltSkip = true;        // already final — don't translate/re-scan
      seen.add(tn);
      frag.appendChild(tn);
    };

    prices.forEach((p, idx) => {
      if (p.start > cursor) pushText(text.slice(cursor, p.start));
      pushText(text.slice(p.start, p.end));
      if (converted[idx] != null) {
        const span = document.createElement('span');
        span.className = 'lt-ccy';
        span.setAttribute('data-lt-skip', '');
        span.style.cssText = 'color:#9a6b00;font-size:0.92em;white-space:nowrap;';
        span.textContent = ' (≈ ' + format(converted[idx], tgt) + ')';
        frag.appendChild(span);
      }
      cursor = p.end;
    });
    if (cursor < text.length) pushText(text.slice(cursor));

    node.parentNode.replaceChild(frag, node);
  }
}

export function removeAnnotations(doc) {
  const spans = doc.querySelectorAll('span.lt-ccy');
  for (const s of spans) {
    s.remove();
  }
}

export const annotateRoot = annotate;

// For backward compatibility (globalThis namespace)
globalThis.LuxeCurrency = {
  annotate,
  findPrices,
  inferSourceCurrency,
  removeAnnotations
};
