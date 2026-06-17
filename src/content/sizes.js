// Inline clothing/shoe size conversion (KR/JP/EU -> US).
//
// Sibling to currency.js: scans text nodes for sizes that carry an unambiguous
// marker and appends the US equivalent right next to the original, e.g.
//   260mm (≈ US 8)   ·   EU 38 (≈ US 6)
//
// Conversions are deliberately approximate (footwear and apparel charts vary by
// brand and gender) and are always shown with a "≈ US". Detection is
// conservative — a bare number is never converted; only explicit units (mm/cm)
// or an EU/EUR marker trigger an annotation.
(function () {
  // Mondopoint foot length (mm) -> US size. Linear: each 10mm ≈ one US size,
  // 240mm ≈ US 6. (US = mm/10 - 18.)
  const shoeFromMm = (mm) => mm / 10 - 18;
  // EU numeric -> US. For this audience (luxury apparel/footwear in the EU 34–46
  // band) US ≈ EU − 32 lines up for both women's apparel and unisex footwear
  // closely enough given the "≈".
  const usFromEu = (eu) => eu - 32;

  const round05 = (n) => Math.round(n * 2) / 2;
  const fmtUS = (n) => 'US ' + (Number.isInteger(n) ? n : n.toFixed(1));

  // Returns non-overlapping sizes: [{start, end, label}]
  function findSizes(text) {
    const matches = [];
    let m;

    // Shoe length in millimetres (e.g. 240mm – 320mm).
    const mmRe = /(\d{3})\s?mm\b/gi;
    while ((m = mmRe.exec(text))) {
      const mm = parseInt(m[1], 10);
      if (mm < 200 || mm > 340) continue;
      const us = round05(shoeFromMm(mm));
      if (us >= 3 && us <= 17) matches.push({ start: m.index, end: m.index + m[0].length, label: fmtUS(us) });
    }

    // Shoe length in centimetres (e.g. 24cm, 26.5cm).
    const cmRe = /(2\d(?:\.\d)?)\s?cm\b/gi;
    while ((m = cmRe.exec(text))) {
      const cm = parseFloat(m[1]);
      const us = round05(shoeFromMm(cm * 10));
      if (us >= 3 && us <= 17) matches.push({ start: m.index, end: m.index + m[0].length, label: fmtUS(us) });
    }

    // Explicit EU/EUR marker (e.g. EU 38, EUR40).
    const euRe = /\bEU(?:R)?\s?(\d{2}(?:\.\d)?)\b/gi;
    while ((m = euRe.exec(text))) {
      const eu = parseFloat(m[1]);
      if (eu < 30 || eu > 54) continue;
      const us = round05(usFromEu(eu));
      if (us >= 0 && us <= 24) matches.push({ start: m.index, end: m.index + m[0].length, label: fmtUS(us) });
    }

    matches.sort((a, b) => a.start - b.start || b.end - a.end);
    const out = [];
    let lastEnd = -1;
    for (const mm of matches) {
      if (mm.start >= lastEnd) { out.push(mm); lastEnd = mm.end; }
    }
    return out;
  }

  function gatherNodes(roots, seen) {
    const nodes = [];
    for (const r of roots) {
      if (r.nodeType === Node.TEXT_NODE) {
        if (!r._ltSkip && !seen.has(r) && r.nodeValue && /\d/.test(r.nodeValue)) nodes.push(r);
        continue;
      }
      if (r.nodeType !== Node.ELEMENT_NODE && r.nodeType !== Node.DOCUMENT_NODE) continue;
      const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (n._ltSkip || seen.has(n)) return NodeFilter.FILTER_REJECT;
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

  // opts: { seen (WeakSet) }
  async function annotate(roots, opts) {
    const { seen } = opts;
    const nodes = gatherNodes(roots, seen);

    for (const node of nodes) {
      if (seen.has(node)) continue;
      const text = node.nodeValue;
      const sizes = findSizes(text);
      if (!sizes.length) continue;
      seen.add(node);
      if (!node.parentNode) continue;

      const frag = document.createDocumentFragment();
      let cursor = 0;
      const pushText = (s) => {
        const tn = document.createTextNode(s);
        tn._ltSkip = true;        // already final — don't translate/re-scan
        seen.add(tn);
        frag.appendChild(tn);
      };

      sizes.forEach((sz) => {
        if (sz.start > cursor) pushText(text.slice(cursor, sz.start));
        pushText(text.slice(sz.start, sz.end));
        const span = document.createElement('span');
        span.className = 'lt-size';
        span.setAttribute('data-lt-skip', '');
        span.style.cssText = 'color:#9a6b00;font-size:0.92em;white-space:nowrap;';
        span.textContent = ' (≈ ' + sz.label + ')';
        frag.appendChild(span);
        cursor = sz.end;
      });
      if (cursor < text.length) pushText(text.slice(cursor));

      node.parentNode.replaceChild(frag, node);
    }
  }

  globalThis.LuxeSizes = { annotate, findSizes };
})();
