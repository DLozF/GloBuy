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

  // Developer logging, off by default. Enable in the content-script console with
  // `LUXE_DEBUG = true`, or persistently per-origin via `localStorage.LUXE_DEBUG = '1'`.
  // The flag lives on globalThis so the sibling modules' loggers see it too.
  try { if (localStorage.getItem('LUXE_DEBUG') === '1') globalThis.LUXE_DEBUG = true; } catch (e) { /* localStorage may be blocked */ }
  const debug = (...args) => { if (globalThis.LUXE_DEBUG) console.warn('[Luxe]', ...args); };

  let settings = Object.assign({}, DEFAULTS);
  let enabled = false;
  let translator = null;
  let reverseTranslator = null;      // target -> source, for search queries
  let srcLang = null;
  let tgtLang = 'en';
  let observer = null;
  let running = false;
  // Serializes observer-triggered passes: each coalesced batch runs to completion
  // before the next starts, so two passes can't interleave at their await points
  // (double-translating a node, or racing currency annotation against translation).
  let obsChain = Promise.resolve();
  function enqueue(task) {
    obsChain = obsChain.then(task).catch((e) => debug('observer pass failed', e)); // best-effort; keep the queue alive
    return obsChain;
  }
  let showingOriginal = false;
  let titleRecord = null;            // { orig, trans } for document.title
  let searchInstalled = false;

  const seenText = new WeakSet();   // text nodes handled by translation
  const seenCcy = new WeakSet();    // text nodes handled by currency
  const seenSize = new WeakSet();   // text nodes handled by size conversion
  const seenAttr = new WeakMap();    // element -> Set<attr> handled by translation
  const revertCount = new WeakMap(); // node -> times the site reverted our text
  // Original/translated text is stamped directly on each node/element as expando
  // properties (text nodes: _ltOrig / _ltTrans; elements: _ltAttrOrig[attr] /
  // _ltAttrTrans[attr]) rather than held in module-level Maps. Maps keyed by node
  // are a leak on infinite-scroll/virtualized pages — they pin every node we ever
  // touched, even after the page removes it. Expandos are reclaimed with the node.

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
      debug('translator init failed', e);
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

  const CHUNK = 40; // nodes per batched translate() call

  function inViewport(node) {
    const el = node.parentElement;
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || 0) &&
           r.right > 0 && r.left < (window.innerWidth || 0);
  }

  // Prices in this node are protected so the translator leaves them intact (e.g.
  // doesn't turn ₩/원 into the word "won") — otherwise the currency module can't
  // detect and convert them afterwards.
  function priceLiteralsFor(text, inferred) {
    if (!globalThis.LuxeCurrency || !/\d/.test(text)) return null;
    const lits = LuxeCurrency.findPrices(text, srcLang, inferred).map((p) => text.slice(p.start, p.end));
    return lits.length ? lits : null;
  }

  async function translateNodes(nodes) {
    const gloss = glossFor();
    const inferred = globalThis.LuxeCurrency ? LuxeCurrency.inferSourceCurrency(srcLang) : null;

    let pending = nodes.filter((n) => !seenText.has(n) && !n._ltSkip && n.nodeValue);
    if (!pending.length) return;
    // Viewport-first: on-screen text translates before off-screen, so the page
    // the user is looking at flips to English first. The on-device model
    // serializes, so we batch many nodes per call rather than run a worker pool.
    const visible = [], rest = [];
    for (const n of pending) (inViewport(n) ? visible : rest).push(n);
    pending = visible.concat(rest);

    for (let i = 0; i < pending.length; i += CHUNK) {
      const live = pending.slice(i, i + CHUNK).filter((n) => !seenText.has(n) && !n._ltSkip);
      if (!live.length) continue;
      const items = live.map((node) => {
        const original = node.nodeValue;
        return { node, original, text: original, protectLiterals: priceLiteralsFor(original, inferred) };
      });
      let outs;
      try {
        outs = await LuxeTranslator.translateBatch(translator, items, gloss);
      } catch (e) {
        continue; // whole chunk failed; nodes stay unseen for a later retry
      }
      for (let k = 0; k < items.length; k++) {
        const { node, original } = items[k];
        const translated = outs[k];
        if (translated === undefined) continue; // failed for this item; retry later
        seenText.add(node);
        if (translated && translated !== original && node.nodeValue === original) {
          node._ltOrig = original;
          node._ltTrans = translated;
          node.nodeValue = showingOriginal ? original : translated;
        }
      }
    }
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
          (el._ltAttrOrig || (el._ltAttrOrig = {}))[attr] = value;
          (el._ltAttrTrans || (el._ltAttrTrans = {}))[attr] = translated;
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

  // Handle text nodes edited in place (characterData). Two cases on these sites:
  //  - a skeleton node populated with fresh source text after render, and
  //  - a data-bound framework reverting a node we already translated.
  // Both are translated here. Guards: ignore the echo of our own writes, skip
  // non-text/currency-only markers and skipped containers, and cap per-node
  // retries so we never get stuck in a render war.
  const CCY_ONLY = /^[\s ]*(?:₩|￦|¥|€|£|\$|원|엔|円|元|위안|달러|유로|엔화)[\s ]*$/;
  async function translateChanged(changed) {
    if (!translator || !changed || !changed.length) return;
    const batch = [];
    for (const node of changed) {
      if (node._ltSkip) continue;
      const v = node.nodeValue;
      if (!v || !v.trim()) continue;
      if (node._ltTrans === v) continue;                       // our own write
      if (!/\p{L}/u.test(v) || CCY_ONLY.test(v)) continue;     // nothing to translate
      if (LuxeWalker.shouldSkipEl(node.parentElement)) continue;
      // Only a true revert (back to the source we last translated from) counts
      // toward the cap; genuinely new content resets it, so recycled/virtualized
      // nodes keep translating instead of stalling after 3 edits.
      const isRevert = node._ltOrig === v;
      const c = isRevert ? (revertCount.get(node) || 0) : 0;
      if (isRevert && c >= 3) continue;
      revertCount.set(node, isRevert ? c + 1 : 0);
      seenText.delete(node); // allow (re)translation by translateNodes
      batch.push(node);
    }
    if (batch.length) await translateNodes(batch);
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

    // Start the observer BEFORE the initial passes. These sites lazy-render the
    // product grid right after load; if it appears during our first pass it must
    // still be caught. (Previously the observer started last, so translation
    // missed the grid while currency — which re-scans the whole body a moment
    // later — happened to catch it.)
    if (!observer) {
      observer = LuxeWalker.observe((added, changed) => {
        if (!enabled) return;
        // Hand the coalesced batch to the serial queue so it can't overlap a
        // prior batch still in flight (the observer is sync; the work is async).
        enqueue(async () => {
          if (!enabled) return;
          if (translator) await processTranslate(added);
          await processCurrency(added);
          await processSizes(added);
          // Translate text the site populated/reverted in place (skip while
          // showing originals — we want source text then).
          if (!showingOriginal) await translateChanged(changed);
          // Newly annotated nodes default to visible; hide them if we're currently
          // showing originals.
          if (showingOriginal) setAnnotationsVisible(false);
        });
      });
    }

    const roots = [document.body].filter(Boolean);
    if (ok) await runTranslatePasses();
    await processCurrency(roots); // currency runs even if translation is unavailable
    await processSizes(roots);    // sizes run even if translation is unavailable
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

  // Swap every translated text node / attribute between source and translation
  // by re-walking the live DOM and reading the per-node expandos, rather than
  // iterating a retained collection. Nodes the page has since removed simply
  // aren't visited (and stay collectable); nothing is pinned for the page's life.
  function setShowOriginal(on) {
    showingOriginal = !!on;
    const root = document.body || document.documentElement;
    if (root) {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = tw.nextNode())) {
        if (n._ltTrans === undefined) continue;
        const want = on ? n._ltOrig : n._ltTrans;
        if (want !== undefined && n.nodeValue !== want) n.nodeValue = want;
      }
      for (const el of root.querySelectorAll('*')) {
        const trans = el._ltAttrTrans;
        if (!trans) continue;
        const orig = el._ltAttrOrig || {};
        for (const attr in trans) {
          const want = on ? orig[attr] : trans[attr];
          if (want !== undefined && el.getAttribute(attr) !== want) el.setAttribute(attr, want);
        }
      }
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
