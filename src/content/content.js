// Orchestrates translation + currency conversion for the page.
(function () {
  const HOST = location.hostname;
  const DEFAULTS = {
    autoTranslate: true,
    targetLanguage: (navigator.language || 'en').split('-')[0],
    targetCurrency: 'USD',
    glossaryEnabled: true,
    sizeEnabled: true
  };

  const langBase = (l) => (l || '').split('-')[0].toLowerCase();

  let settings = Object.assign({}, DEFAULTS);
  let enabled = false;
  let translator = null;
  let reverseTranslator = null;      // target -> source, for search queries
  let srcLang = null;
  let tgtLang = 'en';
  let observer = null;
  let running = false;
  let showingOriginal = false;
  let titleRecord = null;            // { orig, trans } for document.title
  let searchInstalled = false;

  const seenText = new WeakSet();   // text nodes handled by translation
  const seenCcy = new WeakSet();    // text nodes handled by currency
  const seenSize = new WeakSet();   // text nodes handled by size conversion
  const seenAttr = new WeakMap();    // element -> Set<attr> handled by translation
  const attrRecords = [];            // { el, attr, orig, trans } for show-original
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

  // A representative sample for language detection. The top of a product page is
  // usually header/nav/brand names (often Latin/numeric), so detecting from the
  // first slice of innerText can misfire and bail the whole page. Instead, take
  // the LONGEST text blocks (the real description/body content) so the page's
  // actual language dominates the sample.
  function detectionSample() {
    let texts = [];
    try {
      const nodes = LuxeWalker.collectTextNodes(document.body, new WeakSet());
      texts = nodes.map((n) => (n.nodeValue || '').trim()).filter((t) => t.length >= 4);
    } catch (e) { /* fall back below */ }
    texts.sort((a, b) => b.length - a.length);
    let s = '';
    for (const t of texts) { s += t + ' '; if (s.length > 3000) break; }
    s = s.trim();
    return s || pageSample();
  }

  function glossFor() {
    if (!settings.glossaryEnabled) return null;
    return (globalThis.LUXE_GLOSSARY && globalThis.LUXE_GLOSSARY[srcLang]) || null;
  }

  function notify(state, extra) {
    try {
      // Read lastError in the callback so a closed popup doesn't log
      // "Could not establish connection" noise to the console.
      chrome.runtime.sendMessage({ type: 'status', state, extra, host: HOST }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) { /* extension context may be gone */ }
  }

  async function ensureTranslator() {
    if (!LuxeTranslator.apiAvailable()) { notify('unavailable'); return false; }
    if (!srcLang) srcLang = langBase(await LuxeTranslator.detectLanguage(detectionSample()));
    if (!srcLang || srcLang === 'und') { notify('nolang'); return false; }
    if (srcLang === tgtLang) { notify('same'); return false; }
    try {
      translator = await LuxeTranslator.getTranslator(srcLang, tgtLang, (loaded) => notify('downloading', loaded));
      return true;
    } catch (e) {
      // Chrome requires a user gesture to *start* the on-device model download
      // (availability "downloadable"/"downloading"). Auto-running on page load
      // has no gesture, so defer: create the translator on the user's first
      // interaction, then translate. Once the model is cached, this path is
      // skipped on later visits.
      if (e && e.name === 'NotAllowedError') {
        armGestureInit();
        notify('needsgesture');
        return false;
      }
      console.warn('[Luxe] translator init failed', e);
      notify('pairunavailable');
      return false;
    }
  }

  let gestureArmed = false;
  function armGestureInit() {
    if (gestureArmed) return;
    gestureArmed = true;
    const cleanup = () => {
      window.removeEventListener('pointerdown', handler, true);
      window.removeEventListener('keydown', handler, true);
      gestureArmed = false;
    };
    const handler = async () => {
      cleanup();
      if (!enabled) return;
      // Within the gesture's transient activation, retry creation (kicks off the
      // model download) and run the full translation pass.
      if (await ensureTranslator()) await runTranslatePasses();
    };
    window.addEventListener('pointerdown', handler, true);
    window.addEventListener('keydown', handler, true);
  }

  async function translateNodes(nodes) {
    const gloss = glossFor();
    const failed = [];

    // `collectFailures`: on the first pass, a node whose translation throws is
    // re-queued (NOT marked seen) so the gentler retry pass can pick it up. This
    // is the fix for "some nodes randomly stay untranslated": a transient failure
    // no longer permanently marks the node done.
    async function pass(list, pool, collectFailures) {
      let i = 0;
      async function worker() {
        while (i < list.length) {
          const node = list[i++];
          if (seenText.has(node) || node._ltSkip) continue;
          const original = node.nodeValue;
          // Protect any prices in this node so the translator leaves them intact
          // (e.g. doesn't turn ₩/원 into the word "won") — otherwise the currency
          // module can't detect and convert them afterwards.
          let priceLiterals = null;
          if (globalThis.LuxeCurrency && /\d/.test(original)) {
            const inferred = LuxeCurrency.inferSourceCurrency(srcLang);
            priceLiterals = LuxeCurrency
              .findPrices(original, srcLang, inferred)
              .map((p) => original.slice(p.start, p.end));
            if (!priceLiterals.length) priceLiterals = null;
          }
          let translated;
          try {
            translated = await LuxeTranslator.translateText(translator, original, gloss, priceLiterals);
          } catch (e) {
            if (collectFailures) failed.push(node); // retry later; leave unseen
            continue;
          }
          seenText.add(node);
          // Only apply if the node text hasn't changed underneath us.
          if (translated && translated !== original && node.nodeValue === original) {
            originals.set(node, original);
            translatedVals.set(node, translated);
            node.nodeValue = showingOriginal ? original : translated;
          }
        }
      }
      await Promise.all(Array.from({ length: pool }, worker));
    }

    await pass(nodes, 6, true);
    if (failed.length) await pass(failed, 2, false); // gentler retry for stragglers
  }

  async function translateAttrs(targets) {
    const gloss = glossFor();
    const POOL = 6;
    let i = 0;
    async function worker() {
      while (i < targets.length) {
        const { el, attr, value } = targets[i++];
        let set = seenAttr.get(el);
        if (!set) { set = new Set(); seenAttr.set(el, set); }
        if (set.has(attr)) continue;
        let translated;
        try {
          translated = await LuxeTranslator.translateText(translator, value, gloss, null);
        } catch (e) {
          continue; // leave unmarked so a later pass can retry
        }
        set.add(attr);
        if (translated && translated !== value && el.getAttribute(attr) === value) {
          attrRecords.push({ el, attr, orig: value, trans: translated });
          el.setAttribute(attr, showingOriginal ? value : translated);
        }
      }
    }
    await Promise.all(Array.from({ length: POOL }, worker));
  }

  async function translateTitle() {
    if (titleRecord) return;
    const t = document.title;
    if (!t || !t.trim() || !/\p{L}/u.test(t)) return;
    let translated;
    try {
      translated = await LuxeTranslator.translateText(translator, t, glossFor(), null);
    } catch (e) {
      return; // titleRecord stays null so the next run retries
    }
    if (translated && translated !== t) {
      titleRecord = { orig: t, trans: translated };
      document.title = showingOriginal ? t : translated;
    }
  }

  async function processTranslate(roots) {
    if (!translator) return;
    let nodes = [];
    let attrTargets = [];
    for (const r of roots) {
      nodes = nodes.concat(LuxeWalker.collectTextNodes(r, seenText));
      attrTargets = attrTargets.concat(LuxeWalker.collectAttrTargets(r, seenAttr));
    }
    if (nodes.length) await translateNodes(nodes);
    if (attrTargets.length) await translateAttrs(attrTargets);
  }

  async function processSizes(roots) {
    if (!settings.sizeEnabled || !globalThis.LuxeSizes) return;
    await LuxeSizes.annotate(roots, { seen: seenSize });
  }

  // Reverse translator (target -> source) for search-query translation.
  async function ensureReverseTranslator() {
    if (reverseTranslator) return true;
    if (!srcLang || srcLang === tgtLang) return false;
    try {
      reverseTranslator = await LuxeTranslator.getTranslator(tgtLang, srcLang);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function translateQuery(text) {
    if (!reverseTranslator) return text;
    // Keep ALL-CAPS tokens (likely brand names — GUCCI, CHANEL, LV) verbatim
    // rather than transliterating them into something the catalog won't match.
    const brands = text.match(/\b[A-Z][A-Z0-9]{1,}\b/g);
    try {
      return await LuxeTranslator.translateText(reverseTranslator, text, null, brands);
    } catch (e) {
      return text; // submit the original query rather than failing the search
    }
  }

  async function setupSearch() {
    if (searchInstalled || !globalThis.LuxeSearch) return;
    if (!(await ensureReverseTranslator())) return;
    LuxeSearch.install({ translateQuery });
    searchInstalled = true;
  }

  async function processCurrency(roots) {
    await LuxeCurrency.annotate(roots, {
      fromHint: srcLang || langBase(settings.targetLanguage),
      target: settings.targetCurrency,
      seen: seenCcy,
      convert: (from, to) => chrome.runtime.sendMessage({ type: 'convert', from, to })
    });
  }

  // Translation passes that need a ready `translator`. Shared by run() and the
  // deferred gesture handler in armGestureInit().
  async function runTranslatePasses() {
    if (!translator) return;
    const roots = [document.body].filter(Boolean);
    await processTranslate(roots);
    await translateTitle();
    await setupSearch();
  }

  async function run() {
    if (running) return;
    running = true;
    notify('starting');
    const ok = await ensureTranslator();
    const roots = [document.body].filter(Boolean);
    if (ok) await runTranslatePasses();
    await processCurrency(roots); // currency runs even if translation is unavailable
    await processSizes(roots);    // sizes run even if translation is unavailable

    if (!observer) {
      observer = LuxeWalker.observe(async (added) => {
        if (!enabled) return;
        if (translator) await processTranslate(added);
        await processCurrency(added);
        await processSizes(added);
        // Newly annotated nodes default to visible; hide them if we're currently
        // showing originals.
        if (showingOriginal) setAnnotationsVisible(false);
      });
    }
    notify('done');
    running = false;
  }

  // Currency/size conversions are additive annotations, not translated text, so
  // "show original" (and disable) should hide them too — and bring them back
  // when translation is re-shown.
  function setAnnotationsVisible(visible) {
    const spans = document.querySelectorAll('span.lt-ccy, span.lt-size');
    for (const s of spans) s.style.display = visible ? '' : 'none';
  }

  function setShowOriginal(on) {
    showingOriginal = !!on;
    for (const [node, orig] of originals) {
      node.nodeValue = on ? orig : (translatedVals.get(node) ?? node.nodeValue);
    }
    for (const r of attrRecords) {
      const want = on ? r.orig : r.trans;
      if (r.el.getAttribute(r.attr) !== want) r.el.setAttribute(r.attr, want);
    }
    if (titleRecord) document.title = on ? titleRecord.orig : titleRecord.trans;
    setAnnotationsVisible(!on);
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
