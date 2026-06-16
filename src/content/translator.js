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

  // Replace glossary source terms with sentinels before translation.
  function protect(text, gloss) {
    if (!gloss) return { text, map: null };
    let out = text;
    const map = [];
    // Longer terms first so e.g. "정품인증" wins over "정품".
    const terms = Object.keys(gloss).sort((a, b) => b.length - a.length);
    for (const term of terms) {
      if (map.length >= 200) break;
      if (out.indexOf(term) === -1) continue;
      const token = String.fromCodePoint(PUA_START + map.length);
      out = out.split(term).join(token);
      map.push({ token, value: gloss[term] });
    }
    return { text: out, map: map.length ? map : null };
  }

  function restore(text, map) {
    if (!map) return text;
    let out = text;
    for (const { token, value } of map) out = out.split(token).join(value);
    return out;
  }

  async function translateText(translator, text, gloss) {
    const { text: prepared, map } = protect(text, gloss);
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
