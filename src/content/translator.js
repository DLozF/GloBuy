import { applyGlossary } from './glossary/index.js';
import { getSettings } from '../shared/settings.js';

// Private Use Area codepoints (U+E000+) are passed through untouched by
// machine translation, so we use them as sentinels to protect glossary terms.
const PUA_START = 0xE000;
const BATCH_DELIM = String.fromCharCode(0xF8FF);
const cache = new Map(); // "src->tgt" -> Promise<Translator>

const debug = (...args) => {
  if (globalThis.GLOBUY_DEBUG) console.warn('[GloBuy]', ...args);
};

// Glossary -> sorted [{match,value}] entries
const glossEntriesCache = new WeakMap();

function glossEntries(gloss) {
  if (!gloss) return [];
  let e = glossEntriesCache.get(gloss);
  if (!e) {
    e = Object.keys(gloss).map((k) => ({ match: k, value: gloss[k] }));
    e.sort((a, b) => b.match.length - a.match.length);
    glossEntriesCache.set(gloss, e);
  }
  return e;
}

function buildEntries(gloss, protectLiterals) {
  const base = glossEntries(gloss);
  if (!protectLiterals || !protectLiterals.length) return base;
  const lits = protectLiterals.map((lit) => ({ match: lit, value: lit }));
  return base.length ? base.concat(lits) : lits;
}

export function apiSupported() {
  return typeof self !== 'undefined' && 'Translator' in self;
}

export function detectorAvailable() {
  return typeof self !== 'undefined' && 'LanguageDetector' in self;
}

export async function detectLanguage(sample) {
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

export async function availabilityFor(source, target) {
  if (!apiSupported()) return 'unavailable';
  try {
    return await Translator.availability({ sourceLanguage: source, targetLanguage: target });
  } catch {
    return 'unavailable';
  }
}

export async function getTranslator(src, tgt, onProgress) {
  const key = src + '->' + tgt;
  if (cache.has(key)) return cache.get(key);

  const p = (async () => {
    const availability = await Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
    if (availability === 'unavailable') throw new Error('language pair unavailable: ' + key);
    const opts = { sourceLanguage: src, targetLanguage: tgt };
    if (availability !== 'available' && typeof onProgress === 'function') {
      opts.monitor = (m) => {
        m.addEventListener('downloadprogress', (e) => onProgress(e.loaded));
      };
    }
    const t = await Translator.create(opts);
    t._ltCache = new Map();
    return t;
  })();

  cache.set(key, p);
  try {
    return await p;
  } catch (e) {
    cache.delete(key);
    throw e;
  }
}

export async function ensureTranslator(source, target, options = {}) {
  const { onDownload } = options;
  const translator = await getTranslator(source, target, onDownload);
  return { translator };
}

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

export async function translateText(translator, text, gloss, protectLiterals) {
  const { text: prepared, map } = protect(text, buildEntries(gloss, protectLiterals));
  return restore(await translateRaw(translator, prepared), map);
}

// ESM Export version called by pipeline.js
export async function translateBatch(texts, srcLang, tgtLang, translator) {
  const settings = await getSettings();
  const gloss = settings.glossaryEnabled
    ? (globalThis.GLOBUY_GLOSSARY && globalThis.GLOBUY_GLOSSARY[srcLang]) || null
    : null;

  const inferred = globalThis.GlobuyCurrency ? globalThis.GlobuyCurrency.inferSourceCurrency(srcLang) : null;

  const items = texts.map((text) => {
    const protectLiterals = (globalThis.GlobuyCurrency && /\d/.test(text))
      ? globalThis.GlobuyCurrency.findPrices(text, srcLang, inferred).map((p) => text.slice(p.start, p.end))
      : null;
    return { text, protectLiterals };
  });

  const memo = translator._ltCache;
  const results = new Array(items.length);
  const pending = []; // { idx, prepared, map }

  for (let i = 0; i < items.length; i++) {
    const { text, protectLiterals } = items[i];

    // If glossary is enabled and there is a direct whole-node match, use it!
    if (settings.glossaryEnabled) {
      const direct = applyGlossary(text, srcLang);
      if (direct) {
        results[i] = direct;
        continue;
      }
    }

    const { text: prepared, map } = protect(text, buildEntries(gloss, protectLiterals));
    if (memo && memo.has(prepared)) { results[i] = restore(memo.get(prepared), map); continue; }
    pending.push({ idx: i, prepared, map });
  }

  if (!pending.length) return results;

  const perItem = async () => {
    for (const p of pending) {
      try { results[p.idx] = restore(await translateRaw(translator, p.prepared), p.map); }
      catch (e) { /* leave undefined */ }
    }
    return results;
  };

  let joinedOut;
  try {
    joinedOut = await translateOnce(translator, pending.map((p) => p.prepared).join(BATCH_DELIM));
  } catch (e) {
    return perItem();
  }

  const parts = joinedOut.split(BATCH_DELIM);
  if (parts.length !== pending.length) return perItem();
  for (let j = 0; j < pending.length; j++) {
    const p = pending[j];
    const part = parts[j].trim();
    if (memo) { if (memo.size >= 5000) memo.clear(); memo.set(p.prepared, part); }
    results[p.idx] = restore(part, p.map);
  }
  return results;
}

// Old version for testing (global compatibility)
async function translateBatchOld(translator, items, gloss) {
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
      catch (e) { /* leave undefined */ }
    }
    return results;
  };

  let joinedOut;
  try {
    joinedOut = await translateOnce(translator, pending.map((p) => p.prepared).join(BATCH_DELIM));
  } catch (e) {
    return perItem();
  }
  const parts = joinedOut.split(BATCH_DELIM);
  if (parts.length !== pending.length) return perItem();
  for (let j = 0; j < pending.length; j++) {
    const p = pending[j];
    const part = parts[j].trim();
    if (memo) { if (memo.size >= 5000) memo.clear(); memo.set(p.prepared, part); }
    results[p.idx] = restore(part, p.map);
  }
  return results;
}

// --- Premium backend (cloud LLM, via the service worker → hosted proxy) ---
const remoteCache = new Map();
function remoteMemo(src, tgt) {
  const key = src + '->' + tgt;
  let m = remoteCache.get(key);
  if (!m) { m = new Map(); remoteCache.set(key, m); }
  return m;
}

export async function translateRemote(items, srcLang, tgtLang) {
  const memo = remoteMemo(srcLang, tgtLang);
  const results = new Array(items.length);
  const need = [];
  const idxsByText = new Map();
  for (let i = 0; i < items.length; i++) {
    const text = items[i] && items[i].text;
    if (!text) continue;
    if (memo.has(text)) { results[i] = memo.get(text); continue; }
    if (idxsByText.has(text)) { idxsByText.get(text).push(i); }
    else { idxsByText.set(text, [i]); need.push(text); }
  }
  if (!need.length) return { ok: true, results };

  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: 'premiumTranslate', srcLang, tgtLang, texts: need });
  } catch (e) { return { ok: false, reason: 'error' }; }

  if (!resp || resp.fallback || resp.error ||
      !Array.isArray(resp.translations) || resp.translations.length !== need.length) {
    const reason = (resp && resp.error === 'quota_exceeded') ? 'quota' : 'error';
    return { ok: false, reason };
  }
  for (let j = 0; j < need.length; j++) {
    const text = need[j];
    const tr = resp.translations[j];
    if (memo.size >= 5000) memo.clear();
    memo.set(text, tr);
    for (const idx of idxsByText.get(text)) results[idx] = tr;
  }
  return { ok: true, results, remaining: resp.remaining, pro: resp.pro };
}

// For backward compatibility (globalThis namespace)
globalThis.GlobuyTranslator = {
  apiAvailable: apiSupported,
  detectorAvailable,
  detectLanguage,
  getTranslator,
  translateText,
  translateBatch: translateBatchOld,
  translateRemote
};
