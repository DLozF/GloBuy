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
import { collectTextNodes, writeTranslation, revertAll, observe } from './dom-walker.js';
import { annotateRoot, removeAnnotations } from './currency.js';
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
  seenCcy: null,    // WeakSet — tracks already-annotated currency nodes
  observer: null,   // MutationObserver from observe()
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
        state.seenText.add(node);
      }
    });
  }
}

/** Translate (if applicable) and annotate prices and sizes under a root. */
async function processRoot(root) {
  await translateRoot(root);
  if (state.ctx) annotateRoot([root], state.ctx);
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
  state.seenCcy = new WeakSet();

  // Currency rates can apply even when translation is unavailable.
  const table = await getRates();
  state.rates = table;
  state.ctx = table
    ? {
        fromHint: '',
        target: settings.targetCurrency,
        seen: state.seenCcy,
        convert: (from, to) => chrome.runtime.sendMessage({ type: 'convert', from, to }),
      }
    : null;

  if (!apiSupported()) {
    reportStatus(STATUS_KIND.UNSUPPORTED_API);
    if (state.ctx) annotateRoot([document.body], state.ctx);
    state.observer = observe((added) => {
      if (added.length) processRoots(added).catch(() => {});
    });
    return;
  }

  // Detect the page language from a text sample.
  const sample = (document.body.innerText || '').slice(0, 1200);
  const source = await detectLanguage(sample);
  state.sourceLang = source;
  if (state.ctx) state.ctx.fromHint = source || '';

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

  // Start the observer BEFORE the initial scan so mutations from the site's
  // hydration/reconciliation that happen mid-batch are caught immediately.
  state.observer = observe((added, changed) => {
    const toProcess = new Set(added.filter(n => n.isConnected));
    for (const n of changed) {
      if (!n.isConnected) continue;
      if (n._ltTrans !== undefined && n.nodeValue !== n._ltTrans) {
        n.nodeValue = n._ltTrans;                     // re-apply cached translation
      } else if (n._ltTrans === undefined && n._ltOrig === undefined) {
        const parent = n.parentNode;                  // site mutated unseen content
        if (parent) toProcess.add(parent);
      }
    }
    if (toProcess.size) processRoots([...toProcess]).catch(() => {});
  });

  await processRoot(document.body);
  if (state.translator || !translationNeeded) reportStatus(STATUS_KIND.READY);
}

export function stop() {
  if (state.observer) { state.observer.disconnect(); state.observer = null; }
  hideActivationButton();
  revertAll();
  removeAnnotations(document);
  state.running = false;
  state.translator = null;
  state.sourceLang = null;
  state.ctx = null;
  state.seenText = null;
  state.seenSize = null;
  state.seenCcy = null;
  state.observer = null;
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
