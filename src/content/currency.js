// Price detection + inline currency annotation.
//
// Scans text nodes for prices, asks the service worker to convert them, and
// appends the converted amount right next to the original, e.g.
//   ₩1,200,000 (≈ $870)
(function () {
  const SYMBOL_CCY = {
    '₩': 'KRW', '€': 'EUR', '£': 'GBP', '₹': 'INR', '₫': 'VND', '฿': 'THB'
  };
  // Symbols shared by multiple currencies — resolved using the page language.
  const AMBIGUOUS = {
    '¥': { ja: 'JPY', zh: 'CNY', _default: 'JPY' },
    '$': { _default: 'USD' }
  };
  // CJK currency-name suffixes.
  const SUFFIX_CCY = [
    ['원', 'KRW'], ['엔', 'JPY'], ['円', 'JPY'], ['元', 'CNY'], ['위안', 'CNY']
  ];
  const DISPLAY_SYMBOL = {
    USD: '$', EUR: '€', GBP: '£', JPY: '¥', KRW: '₩', CNY: '¥', INR: '₹'
  };
  const NO_DECIMALS = new Set(['JPY', 'KRW', 'CNY', 'VND']);

  function resolveSymbol(sym, hint) {
    if (AMBIGUOUS[sym]) return AMBIGUOUS[sym][hint] || AMBIGUOUS[sym]._default;
    return SYMBOL_CCY[sym] || null;
  }

  function parseAmount(raw) {
    const cleaned = raw.replace(/[\s ,]/g, '');
    const v = parseFloat(cleaned);
    return isFinite(v) ? v : null;
  }

  const NUM = '(\\d[\\d.,\\s\\u00a0]*\\d|\\d)';

  // Returns non-overlapping prices: [{start, end, amount, currency}]
  function findPrices(text, hint) {
    const matches = [];
    let m;

    const symRe = new RegExp('([₩$€£¥₹₫฿])\\s?' + NUM, 'g');
    while ((m = symRe.exec(text))) {
      const ccy = resolveSymbol(m[1], hint);
      const amt = parseAmount(m[2]);
      if (ccy && amt != null) {
        matches.push({ start: m.index, end: m.index + m[0].length, amount: amt, currency: ccy });
      }
    }

    const codeRe = new RegExp(NUM + '\\s?(USD|EUR|GBP|JPY|KRW|CNY|INR|VND|THB)\\b', 'gi');
    while ((m = codeRe.exec(text))) {
      const amt = parseAmount(m[1]);
      if (amt != null) {
        matches.push({ start: m.index, end: m.index + m[0].length, amount: amt, currency: m[2].toUpperCase() });
      }
    }

    for (const [suf, ccy] of SUFFIX_CCY) {
      const re = new RegExp(NUM + '\\s?' + suf, 'g');
      while ((m = re.exec(text))) {
        const amt = parseAmount(m[1]);
        if (amt != null) {
          matches.push({ start: m.index, end: m.index + m[0].length, amount: amt, currency: ccy });
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

  // opts: { fromHint, target, seen (WeakSet), convert(from,to)->Promise<{rate}> }
  async function annotate(roots, opts) {
    const { fromHint, seen, convert } = opts;
    const tgt = (opts.target || 'USD').toUpperCase();
    const nodes = gatherNodes(roots, seen);

    for (const node of nodes) {
      if (seen.has(node)) continue;
      const text = node.nodeValue;
      const prices = findPrices(text, fromHint);
      if (!prices.length) continue;
      seen.add(node);

      const converted = [];
      for (const p of prices) {
        if (p.currency === tgt) { converted.push(null); continue; }
        let rate = null;
        try {
          const res = await convert(p.currency, tgt);
          rate = res && typeof res.rate === 'number' ? res.rate : null;
        } catch (e) { /* leave unconverted */ }
        converted.push(rate != null ? p.amount * rate : null);
      }
      if (!converted.some((c) => c != null)) continue;
      if (!node.parentNode) continue;

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

  globalThis.LuxeCurrency = { annotate, findPrices };
})();
