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
  // Mondopoint foot length (mm) -> US size. Linear: each 10mm ≈ one US size.
  // Men's and women's scales are offset by ~1.5 US sizes for the same foot
  // length, so when a gender signal is present we use that scale; otherwise we
  // fall back to the unisex approximation (240mm ≈ US 6, i.e. mm/10 - 18), which
  // leans to men's/unisex footwear.
  const MM_OFFSET = { women: 16.5, men: 18, unisex: 18 };
  const shoeFromMm = (mm, gender) => mm / 10 - MM_OFFSET[gender || 'unisex'];
  // EU numeric -> US. The men's/women's conversions differ by ~2.5 sizes; the
  // unisex fallback (EU − 32) sits between them and matches both women's apparel
  // and unisex footwear closely enough given the "≈".
  const EU_OFFSET = { women: 30.5, men: 33, unisex: 32 };
  const usFromEu = (eu, gender) => eu - EU_OFFSET[gender || 'unisex'];

  const round05 = (n) => Math.round(n * 2) / 2;
  const fmtUS = (n, gender) => {
    const tag = gender === 'women' ? 'W ' : gender === 'men' ? 'M ' : '';
    return 'US ' + tag + (Number.isInteger(n) ? n : n.toFixed(1));
  };

  // Infer a gender signal from nearby text so the size scale can branch. Returns
  // 'women' | 'men' | null. Ambiguous (both, or neither) -> null, which keeps the
  // unisex approximation. CJK tokens are matched as whole words (avoiding bare
  // 男/女, which appear inside many unrelated words).
  const WOMEN_RE = /\b(?:wom[ae]n['’]?s?|ladies|female)\b/i;
  const MEN_RE = /\b(?:m[ae]n['’]?s?|male)\b/i;
  const WOMEN_CJK = /(여성|여자|우먼|レディース|婦人|女性|女款)/;
  const MEN_CJK = /(남성|남자|メンズ|紳士|男性|男款)/;
  function detectGender(text) {
    if (!text) return null;
    const women = WOMEN_RE.test(text) || WOMEN_CJK.test(text);
    const men = MEN_RE.test(text) || MEN_CJK.test(text);
    if (women === men) return null; // both or neither -> ambiguous
    return women ? 'women' : 'men';
  }

  // Returns non-overlapping sizes: [{start, end, label}]. `gender` (optional:
  // 'women' | 'men') branches the conversion scale and label; omit for unisex.
  function findSizes(text, gender) {
    const matches = [];
    let m;

    // Shoe length in millimetres (e.g. 240mm – 320mm).
    const mmRe = /(\d{3})\s?mm\b/gi;
    while ((m = mmRe.exec(text))) {
      const mm = parseInt(m[1], 10);
      if (mm < 200 || mm > 340) continue;
      const us = round05(shoeFromMm(mm, gender));
      if (us >= 3 && us <= 17) matches.push({ start: m.index, end: m.index + m[0].length, label: fmtUS(us, gender) });
    }

    // Shoe length in centimetres (e.g. 24cm, 26.5cm).
    const cmRe = /(2\d(?:\.\d)?)\s?cm\b/gi;
    while ((m = cmRe.exec(text))) {
      const cm = parseFloat(m[1]);
      const us = round05(shoeFromMm(cm * 10, gender));
      if (us >= 3 && us <= 17) matches.push({ start: m.index, end: m.index + m[0].length, label: fmtUS(us, gender) });
    }

    // Explicit EU/EUR marker (e.g. EU 38, EUR40).
    const euRe = /\bEU(?:R)?\s?(\d{2}(?:\.\d)?)\b/gi;
    while ((m = euRe.exec(text))) {
      const eu = parseFloat(m[1]);
      if (eu < 30 || eu > 54) continue;
      const us = round05(usFromEu(eu, gender));
      if (us >= 0 && us <= 24) matches.push({ start: m.index, end: m.index + m[0].length, label: fmtUS(us, gender) });
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
      // Look at the surrounding element's text for a gender label (e.g. a
      // "Women's Sneakers" heading in the same card) so the scale can branch.
      const ctx = (node.parentElement && node.parentElement.textContent) || text;
      const gender = detectGender(ctx);
      const sizes = findSizes(text, gender);
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
        span.style.cssText = 'color:#9a6b00;font-size:0.92em;white-space:nowrap;cursor:help;';
        span.title = gender
          ? `Approximate ${gender}'s size — conversion varies by brand`
          : 'Approximate size — conversion varies by brand and gender';
        span.textContent = ' (≈ ' + sz.label + ')';
        frag.appendChild(span);
        cursor = sz.end;
      });
      if (cursor < text.length) pushText(text.slice(cursor));

      node.parentNode.replaceChild(frag, node);
    }
  }

  globalThis.LuxeSizes = { annotate, findSizes, detectGender };
})();
