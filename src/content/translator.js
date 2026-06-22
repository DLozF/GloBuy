// Wrapper over Chrome's built-in on-device Translator + LanguageDetector APIs,
// with luxury-glossary enforcement. Exposes `LuxeTranslator` on globalThis.
//
// The translation backend is isolated here on purpose: swapping in a Claude
// "Premium" tier later means replacing `getTranslator`/`translateText`, not the
// page-walking or currency code.
(function () {
  // Private Use Area codepoints (U+E000+) are passed through untouched by
  // machine translation, so we use them as sentinels to protect glossary terms.
  const PUA_START = 0xE000;
  // A separate PUA codepoint (well above the protection sentinels, which top out
  // ~U+E190 at the 400-entry cap) used to join many nodes into one translate()
  // call and split the result back apart — see translateBatch.
  const BATCH_DELIM = String.fromCharCode(0xF8FF);
  const cache = new Map(); // "src->tgt" -> Promise<Translator>
  // Developer logging, gated by the LUXE_DEBUG flag (off by default — see content.js).
  const debug = (...args) => { if (globalThis.LUXE_DEBUG) console.warn('[Luxe]', ...args); };
  // Glossary -> sorted [{match,value}] entries, built once per glossary object
  // instead of rebuilt+resorted on every node.
  const glossEntriesCache = new WeakMap();

  function glossEntries(gloss) {
    if (!gloss) return [];
    let e = glossEntriesCache.get(gloss);
    if (!e) {
      e = Object.keys(gloss).map((k) => ({ match: k, value: gloss[k] }));
      e.sort((a, b) => b.match.length - a.match.length); // longest match first
      glossEntriesCache.set(gloss, e);
    }
    return e;
  }

  // Pre-sorted glossary entries + per-node price literals. Glossary terms (CJK
  // words) and price literals (digits/symbols) don't overlap, so appending the
  // literals keeps longest-first ordering effectively intact without re-sorting.
  function buildEntries(gloss, protectLiterals) {
    const base = glossEntries(gloss);
    if (!protectLiterals || !protectLiterals.length) return base;
    const lits = protectLiterals.map((lit) => ({ match: lit, value: lit }));
    return base.length ? base.concat(lits) : lits;
  }

  const apiAvailable = () => typeof self !== 'undefined' && 'Translator' in self;
  const detectorAvailable = () => typeof self !== 'undefined' && 'LanguageDetector' in self;

  async function detectLanguage(sample) {
    if (!detectorAvailable() || !sample) return null;
    try {
      if ((await LanguageDetector.availability()) === 'unavailable') return null;
      const detector = await LanguageDetector.create();
      const results = await detector.detect(sample.slice(0, 4000));
      if (results && results.length) {
        const top = results.find((r) => r.detectedLanguage && r.detectedLanguage !== 'und') || results[0];
        return top.detectedLanguage || null;
      }
    } catch (e) {
      debug('language detection failed', e);
    }
    return null;
  }

  async function getTranslator(src, tgt, onProgress) {
    const key = src + '->' + tgt;
    if (cache.has(key)) return cache.get(key);

    const p = (async () => {
      const availability = await Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
      if (availability === 'unavailable') throw new Error('language pair unavailable: ' + key);
      const opts = { sourceLanguage: src, targetLanguage: tgt };
      if (availability !== 'available' && typeof onProgress === 'function') {
        // First use downloads the on-device model — surface progress.
        opts.monitor = (m) => {
          m.addEventListener('downloadprogress', (e) => onProgress(e.loaded));
        };
      }
      const t = await Translator.create(opts);
      // Per-pair cache of translate() outputs (see translateText). Listing pages
      // repeat the same labels across many cards; this translates each once.
      t._ltCache = new Map();
      return t;
    })();

    cache.set(key, p);
    try {
      return await p;
    } catch (e) {
      cache.delete(key); // allow retry
      throw e;
    }
  }

  // Replace protected substrings with sentinels before translation. `entries`
  // is [{ match, value }] pre-ordered longest-match-first (see buildEntries):
  // glossary terms map to their preferred English; prices map to themselves.
  function protect(text, entries) {
    if (!entries || !entries.length) return { text, map: null };
    let out = text;
    const map = [];
    for (const { match, value } of entries) {
      if (map.length >= 400) break;
      if (!match || out.indexOf(match) === -1) continue;
      const token = String.fromCodePoint(PUA_START + map.length);
      out = out.split(match).join(token);
      map.push({ token, value });
    }
    return { text: out, map: map.length ? map : null };
  }

  function restore(text, map) {
    if (!map) return text;
    let out = text;
    for (const { token, value } of map) out = out.split(token).join(value);
    return out;
  }

  // One translate() call with retry for transient failures (model warming up /
  // momentarily busy). Throws only after retries so the caller can re-queue
  // rather than silently mark work done. No caching — used directly for the
  // batch join (a unique mega-string not worth caching).
  async function translateOnce(translator, prepared) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await translator.translate(prepared);
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
    }
    throw lastErr || new Error('translate failed');
  }

  // Cache-wrapped single translate, keyed by the protected string (a pure
  // function of it), bounded so infinite-scroll pages can't grow it unbounded.
  async function translateRaw(translator, prepared) {
    const memo = translator._ltCache;
    if (memo && memo.has(prepared)) return memo.get(prepared);
    const out = await translateOnce(translator, prepared);
    if (memo) {
      if (memo.size >= 5000) memo.clear();
      memo.set(prepared, out);
    }
    return out;
  }

  // `gloss` is the per-language glossary object (term -> English) or null.
  // `protectLiterals` is an array of substrings (e.g. detected prices) to keep
  // verbatim through translation.
  async function translateText(translator, text, gloss, protectLiterals) {
    const { text: prepared, map } = protect(text, buildEntries(gloss, protectLiterals));
    return restore(await translateRaw(translator, prepared), map);
  }

  // Translate many text nodes in ONE translate() call (the on-device model
  // serializes, so per-call overhead — not concurrency — is the cost). Each
  // item is { text, protectLiterals }. Returns translated strings aligned to
  // `items`; an entry is undefined only if that item ultimately failed.
  async function translateBatch(translator, items, gloss) {
    const memo = translator._ltCache;
    const results = new Array(items.length);
    const pending = []; // { idx, prepared, map }
    for (let i = 0; i < items.length; i++) {
      const { text, protectLiterals } = items[i];
      const { text: prepared, map } = protect(text, buildEntries(gloss, protectLiterals));
      if (memo && memo.has(prepared)) { results[i] = restore(memo.get(prepared), map); continue; }
      pending.push({ idx: i, prepared, map });
    }
    if (!pending.length) return results;

    const perItem = async () => {
      for (const p of pending) {
        try { results[p.idx] = restore(await translateRaw(translator, p.prepared), p.map); }
        catch (e) { /* leave undefined — caller leaves the node untranslated */ }
      }
      return results;
    };

    // Fast path: one call for the whole chunk, joined by a reserved delimiter.
    let joinedOut;
    try {
      joinedOut = await translateOnce(translator, pending.map((p) => p.prepared).join(BATCH_DELIM));
    } catch (e) {
      return perItem();
    }
    const parts = joinedOut.split(BATCH_DELIM);
    if (parts.length !== pending.length) return perItem(); // delimiter misaligned
    for (let j = 0; j < pending.length; j++) {
      const p = pending[j];
      // Some models pad the delimiter with spaces ("A <delim> B"), so each split
      // part can carry stray leading/trailing whitespace — trim it before restore.
      const part = parts[j].trim();
      if (memo) { if (memo.size >= 5000) memo.clear(); memo.set(p.prepared, part); }
      results[p.idx] = restore(part, p.map);
    }
    return results;
  }

  globalThis.LuxeTranslator = {
    apiAvailable,
    detectorAvailable,
    detectLanguage,
    getTranslator,
    translateText,
    translateBatch
  };
})();
