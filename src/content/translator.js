// Thin wrapper over Chrome's on-device Translator + LanguageDetector APIs, with
// instance caching, a glossary fast-path, and bounded concurrency. These APIs live
// on `self` in the page document, so this only runs in the content script.

import { applyGlossary } from './glossary/index.js';

const MAX_CONCURRENCY = 5;

// Cache Translator instances per language pair; create() is relatively expensive.
const instances = new Map(); // key: `${source}->${target}` -> Translator
let detector = null;

export function apiSupported() {
  return typeof self !== 'undefined' && 'Translator' in self && 'LanguageDetector' in self;
}

/** Detect the dominant language of a text sample; returns a language subtag or null. */
export async function detectLanguage(sample) {
  if (!('LanguageDetector' in self)) return null;
  try {
    if (!detector) detector = await self.LanguageDetector.create();
    const results = await detector.detect(sample);
    const top = results?.[0];
    if (!top || top.detectedLanguage === 'und') return null;
    return top.detectedLanguage;
  } catch {
    return null;
  }
}

/** Check availability for a language pair without creating (and downloading) a model. */
export async function availabilityFor(source, target) {
  try {
    return await self.Translator.availability({
      sourceLanguage: source,
      targetLanguage: target,
    });
  } catch {
    return 'unavailable';
  }
}

/**
 * Ensure a Translator for the given pair exists.
 * @returns {Promise<{translator: any|null, availability: string}>}
 * `onDownload(progress)` is called with 0..1 while the model downloads.
 */
export async function ensureTranslator(source, target, { onDownload } = {}) {
  const key = `${source}->${target}`;
  if (instances.has(key)) return { translator: instances.get(key), availability: 'available' };

  const availability = await self.Translator.availability({
    sourceLanguage: source,
    targetLanguage: target,
  });
  if (availability === 'unavailable') return { translator: null, availability };

  const translator = await self.Translator.create({
    sourceLanguage: source,
    targetLanguage: target,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        if (onDownload) onDownload(e.loaded);
      });
    },
  });
  instances.set(key, translator);
  return { translator, availability };
}

/** Translate a single string, preferring a glossary override over machine translation. */
async function translateOne(text, source, target, translator) {
  const override = applyGlossary(text, source);
  if (override != null) return override;
  try {
    return await translator.translate(text);
  } catch {
    return text; // leave the original on failure rather than blanking the node
  }
}

/** Translate an array of strings with bounded concurrency, preserving order. */
export async function translateBatch(texts, source, target, translator) {
  const results = new Array(texts.length);
  let cursor = 0;

  async function worker() {
    while (cursor < texts.length) {
      const i = cursor++;
      results[i] = await translateOne(texts[i], source, target, translator);
    }
  }

  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, texts.length) }, worker);
  await Promise.all(workers);
  return results;
}
