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
  const cache = new Map(); // "src->tgt" -> Promise<Translator>

  const apiAvailable = () => typeof self !== 'undefined' && 'Translator' in self;
  const detectorAvailable = () => typeof self !== 'undefined' && 'LanguageDetector' in self;

  async function detectLanguage(sample) {
    if (!detectorAvailable() || !sample) return null;
    try {
      if ((await LanguageDetector.availability()) === 'unavailable') return null;
      const detector = await LanguageDetector.create();
      const results = await detector.detect(sample.slice(0, 1000));
      if (results && results.length) {
        const top = results.find((r) => r.detectedLanguage && r.detectedLanguage !== 'und') || results[0];
        return top.detectedLanguage || null;
      }
    } catch (e) {
      console.warn('[Luxe] language detection failed', e);
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
      return Translator.create(opts);
    })();

    cache.set(key, p);
    try {
      return await p;
    } catch (e) {
      cache.delete(key); // allow retry
      throw e;
    }
  }

  // Replace protected substrings with sentinels before translation.
  // `entries` is [{ match, value }]: glossary terms map to their preferred
  // English; prices map to themselves (so they survive translation intact).
  function protect(text, entries) {
    if (!entries || !entries.length) return { text, map: null };
    let out = text;
    const map = [];
    // Longest match first so e.g. "정품인증" wins over "정품".
    const sorted = entries.slice().sort((a, b) => b.match.length - a.match.length);
    for (const { match, value } of sorted) {
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

  // `gloss` is the per-language glossary object (term -> English) or null.
  // `protectLiterals` is an array of substrings (e.g. detected prices) to keep
  // verbatim through translation.
  async function translateText(translator, text, gloss, protectLiterals) {
    const entries = [];
    if (gloss) for (const k of Object.keys(gloss)) entries.push({ match: k, value: gloss[k] });
    if (protectLiterals) for (const lit of protectLiterals) entries.push({ match: lit, value: lit });
    const { text: prepared, map } = protect(text, entries);
    try {
      const translated = await translator.translate(prepared);
      return restore(translated, map);
    } catch (e) {
      return text; // on failure, leave the original untouched
    }
  }

  globalThis.LuxeTranslator = {
    apiAvailable,
    detectorAvailable,
    detectLanguage,
    getTranslator,
    translateText
  };
})();
