// Orchestrates translation + currency conversion for the page.
(function () {
  const HOST = location.hostname;
  const DEFAULTS = {
    autoTranslate: true,
    targetLanguage: (navigator.language || 'en').split('-')[0],
    targetCurrency: 'USD',
    glossaryEnabled: true
  };

  const langBase = (l) => (l || '').split('-')[0].toLowerCase();

  let settings = Object.assign({}, DEFAULTS);
  let enabled = false;
  let translator = null;
  let srcLang = null;
  let tgtLang = 'en';
  let observer = null;
  let running = false;
  let showingOriginal = false;

  const seenText = new WeakSet();   // text nodes handled by translation
  const seenCcy = new WeakSet();    // text nodes handled by currency
  const originals = new Map();       // node -> original source text
  const translatedVals = new Map();  // node -> translated text

  async function loadSettings() {
    const stored = await chrome.storage.sync.get(['settings', 'siteState']);
    settings = Object.assign({}, DEFAULTS, stored.settings || {});
    const siteState = stored.siteState || {};
    enabled = HOST in siteState ? !!siteState[HOST] : !!settings.autoTranslate;
    tgtLang = langBase(settings.targetLanguage) || 'en';
  }

  function pageSample() {
    const t = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 1200);
  }

  function glossFor() {
    if (!settings.glossaryEnabled) return null;
    return (globalThis.LUXE_GLOSSARY && globalThis.LUXE_GLOSSARY[srcLang]) || null;
  }

  function notify(state, extra) {
    try {
      chrome.runtime.sendMessage({ type: 'status', state, extra, host: HOST });
    } catch (e) { /* popup may be closed */ }
  }

  async function ensureTranslator() {
    if (!LuxeTranslator.apiAvailable()) { notify('unavailable'); return false; }
    if (!srcLang) srcLang = langBase(await LuxeTranslator.detectLanguage(pageSample()));
    if (!srcLang || srcLang === 'und') { notify('nolang'); return false; }
    if (srcLang === tgtLang) { notify('same'); return false; }
    try {
      translator = await LuxeTranslator.getTranslator(srcLang, tgtLang, (loaded) => notify('downloading', loaded));
      return true;
    } catch (e) {
      console.warn('[Luxe] translator init failed', e);
      notify('pairunavailable');
      return false;
    }
  }

  async function translateNodes(nodes) {
    const gloss = glossFor();
    const POOL = 6;
    let i = 0;
    async function worker() {
      while (i < nodes.length) {
        const node = nodes[i++];
        if (seenText.has(node) || node._ltSkip) continue;
        const original = node.nodeValue;
        seenText.add(node);
        const translated = await LuxeTranslator.translateText(translator, original, gloss);
        // Only apply if the node text hasn't changed underneath us.
        if (translated && translated !== original && node.nodeValue === original) {
          originals.set(node, original);
          translatedVals.set(node, translated);
          node.nodeValue = showingOriginal ? original : translated;
        }
      }
    }
    await Promise.all(Array.from({ length: POOL }, worker));
  }

  async function processTranslate(roots) {
    if (!translator) return;
    let nodes = [];
    for (const r of roots) nodes = nodes.concat(LuxeWalker.collectTextNodes(r, seenText));
    if (nodes.length) await translateNodes(nodes);
  }

  async function processCurrency(roots) {
    await LuxeCurrency.annotate(roots, {
      fromHint: srcLang || langBase(settings.targetLanguage),
      target: settings.targetCurrency,
      seen: seenCcy,
      convert: (from, to) => chrome.runtime.sendMessage({ type: 'convert', from, to })
    });
  }

  async function run() {
    if (running) return;
    running = true;
    notify('starting');
    const ok = await ensureTranslator();
    const roots = [document.body].filter(Boolean);
    if (ok) await processTranslate(roots);
    await processCurrency(roots); // currency runs even if translation is unavailable

    if (!observer) {
      observer = LuxeWalker.observe(async (added) => {
        if (!enabled) return;
        if (translator) await processTranslate(added);
        await processCurrency(added);
      });
    }
    notify('done');
    running = false;
  }

  function setShowOriginal(on) {
    showingOriginal = !!on;
    for (const [node, orig] of originals) {
      node.nodeValue = on ? orig : (translatedVals.get(node) ?? node.nodeValue);
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      switch (msg.type) {
        case 'apply':
          enabled = true;
          showingOriginal = false;
          await loadSettings();
          enabled = true;
          await run();
          sendResponse({ ok: true });
          break;
        case 'disable':
          enabled = false;
          setShowOriginal(true);
          sendResponse({ ok: true });
          break;
        case 'showOriginal':
          setShowOriginal(msg.value);
          sendResponse({ ok: true });
          break;
        case 'settingsChanged':
          await loadSettings();
          sendResponse({ ok: true });
          break;
        case 'getState':
          sendResponse({
            enabled,
            srcLang,
            tgtLang,
            host: HOST,
            apiAvailable: LuxeTranslator.apiAvailable()
          });
          break;
        default:
          sendResponse({ ok: false });
      }
    })();
    return true; // async response
  });

  (async function init() {
    await loadSettings();
    if (enabled) run();
  })();
})();
