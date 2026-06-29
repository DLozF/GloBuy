// Orchestrates one site's translation + currency pass and keeps it live as the
// page mutates. Runs entirely in the content script (the Translator API needs a
// document). Status is reported to the popup via runtime messages.

import { MSG, STATUS_KIND } from '../shared/messages.js';
import {
  apiSupported,
  detectLanguage,
  availabilityFor,
  ensureTranslator,
  translateBatch,
} from './translator.js';
import { collectTextNodes, writeTranslation, revertAll } from './dom-walker.js';
import { annotateRoot, removeAnnotations } from './currency.js';
import { startObserver, stopObserver } from './observer.js';
import { showActivationButton, hideActivationButton } from './activation.js';
import '../data/glossary.js';
import './sizes.js';
import './search.js';

const BATCH_SIZE = 50;

const state = {
  running: false,
  settings: null,
  sourceLang: null,
  translator: null,
  rates: null,
  ctx: null,
  seenText: null,   // WeakSet — tracks already-translated text nodes
  seenSize: null,   // WeakSet — tracks already-annotated size nodes
};

function reportStatus(kind, extra = {}) {
  try {
    chrome.runtime.sendMessage({ type: MSG.STATUS, kind, ...extra }).catch(() => {});
  } catch {
    /* no receiver open */
  }
}

async function getRates() {
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG.GET_RATES });
    return res?.ok ? res.table : null;
  } catch {
    return null;
  }
}

/** Translate the text nodes under a root in order-preserving batches. */
async function translateRoot(root) {
  if (!state.translator || !state.sourceLang) return;
  const gloss = state.settings?.glossaryEnabled
    ? (globalThis.GLOBUY_GLOSSARY?.[state.sourceLang] || null)
    : null;
  const nodes = collectTextNodes(root, state.seenText);
  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const slice = nodes.slice(i, i + BATCH_SIZE);
    const texts = slice.map((n) => n.nodeValue);
    const out = await translateBatch(
      texts,
      state.sourceLang,
      state.settings.targetLang,
      state.translator,
      gloss,
      state.settings?.glossaryEnabled ?? true,
    );
    slice.forEach((node, j) => {
      if (node.isConnected && out[j] != null && out[j] !== node.nodeValue) {
        writeTranslation(node, out[j]);
      }
    });
  }
}

/** Translate (if applicable) and annotate prices and sizes under a root. */
async function processRoot(root) {
  await translateRoot(root);
  if (state.ctx) annotateRoot(root, state.ctx);
  if (state.settings?.sizeEnabled && globalThis.GlobuySizes) {
    await globalThis.GlobuySizes.annotate([root], { seen: state.seenSize });
  }
}

async function processRoots(roots) {
  for (const root of roots) {
    await processRoot(root);
  }
}

/** Reverse-translate a search query from the target language back to the source. */
async function reverseTranslateQuery(text) {
  if (!state.translator || !state.sourceLang) return text;
  try {
    const { translator } = await ensureTranslator(state.settings.targetLang, state.sourceLang);
    const [out] = await translateBatch([text], state.settings.targetLang, state.sourceLang, translator, null);
    return out || text;
  } catch {
    return text;
  }
}

export async function start(settings) {
  if (state.running) return;
  state.running = true;
  state.settings = settings;
  state.seenText = new WeakSet();
  state.seenSize = new WeakSet();

  // Currency rates can apply even when translation is unavailable.
  const table = await getRates();
  state.rates = table;
  const tldParts = location.hostname.split('.');
  state.ctx = table
    ? {
        rates: table.rates,
        targetCurrency: settings.targetCurrency,
        sourceLang: '',
        tld: tldParts[tldParts.length - 1] || '',
        locale: navigator.language,
      }
    : null;

  if (!apiSupported()) {
    reportStatus(STATUS_KIND.UNSUPPORTED_API);
    if (state.ctx) annotateRoot(document.body, state.ctx);
    startObserver(processRoots);
    return;
  }

  // Detect the page language from a text sample.
  const sample = (document.body.innerText || '').slice(0, 1200);
  const source = await detectLanguage(sample);
  state.sourceLang = source;
  if (state.ctx) state.ctx.sourceLang = source || '';

  const target = settings.targetLang;
  const translationNeeded = source && source !== target;

  if (translationNeeded) {
    const avail = await availabilityFor(source, target);
    if (avail === 'available') {
      const { translator } = await ensureTranslator(source, target);
      state.translator = translator;
    } else if (avail === 'downloadable' || avail === 'downloading') {
      // Model download requires a user gesture; surface the activation button.
      reportStatus(STATUS_KIND.NEEDS_ACTIVATION);
      showActivationButton(async (onDownload) => {
        const { translator } = await ensureTranslator(source, target, { onDownload });
        state.translator = translator;
        reportStatus(STATUS_KIND.READY);
        await processRoot(document.body);
      });
    } else {
      reportStatus(STATUS_KIND.UNSUPPORTED_LANG, { source, target });
    }
  }

  if (globalThis.GlobuySearch && state.sourceLang && state.sourceLang !== target) {
    globalThis.GlobuySearch.install({ translateQuery: (q) => reverseTranslateQuery(q) });
  }

  await processRoot(document.body);
  if (state.translator || translationNeeded === false) reportStatus(STATUS_KIND.READY);
  startObserver(processRoots);
}

export function stop() {
  stopObserver();
  hideActivationButton();
  revertAll();
  removeAnnotations(document);
  state.running = false;
  state.translator = null;
  state.sourceLang = null;
  state.ctx = null;
  state.seenText = null;
  state.seenSize = null;
  reportStatus(STATUS_KIND.IDLE);
}

export function isRunning() {
  return state.running;
}

export function showOriginal(show) {
  if (show) {
    revertAll();
    removeAnnotations(document);
  } else {
    // Re-run to re-apply translations
    if (state.running) processRoot(document.body).catch(() => {});
  }
}
