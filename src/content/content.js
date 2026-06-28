// Orchestrates translation + currency conversion for the page.
(function () {
  const HOST = location.hostname;
  const DEFAULTS = {
    autoTranslate: true,
    targetLanguage: (navigator.language || 'en').split('-')[0],
    targetCurrency: 'USD',
    glossaryEnabled: true,
    sizeEnabled: true,
    premiumEnabled: false
  };

  // Premium (cloud) translation is feature-flagged OFF for the v1 on-device-only
  // build. The premium code path below stays in source but is unreachable while
  // this is false: it's the only place usePremium is set, so every `if (usePremium)`
  // branch (translateNodes, translateAttrs, translateTitle, translateQuery) is
  // dead and the on-device path is the only one that runs. Flip to true for v1.1.
  const PREMIUM_ENABLED = false;

  const langBase = (l) => (l || '').split('-')[0].toLowerCase();

  // Developer logging, off by default. Enable in the content-script console with
  // `GLOBUY_DEBUG = true`, or persistently per-origin via `localStorage.GLOBUY_DEBUG = '1'`.
  // The flag lives on globalThis so the sibling modules' loggers see it too.
  try { if (localStorage.getItem('GLOBUY_DEBUG') === '1') globalThis.GLOBUY_DEBUG = true; } catch (e) { /* localStorage may be blocked */ }
  const debug = (...args) => { if (globalThis.GLOBUY_DEBUG) console.warn('[GloBuy]', ...args); };

  let settings = Object.assign({}, DEFAULTS);
  let enabled = false;
  let translator = null;
  let usePremium = false;            // route node/attr/title text through the cloud LLM
  let fallbackTranslator = null;     // on-device, lazily created when a premium batch falls back
  let premiumNotified = false;       // surface "using on-device" only once per run

  // Quota exhaustion is permanent for the session — stop hitting the proxy.
  function handlePremiumFailure(reason) {
    if (!premiumNotified) {
      notify(reason === 'quota' ? 'quotafallback' : 'premiumerror');
      premiumNotified = true;
    }
    if (reason === 'quota') usePremium = false;
  }
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
      const nodes = GlobuyWalker.collectTextNodes(document.body, new WeakSet());
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
    return (globalThis.GLOBUY_GLOSSARY && globalThis.GLOBUY_GLOSSARY[srcLang]) || null;
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
    usePremium = false;
    premiumNotified = false;
    const premium = PREMIUM_ENABLED && settings.premiumEnabled;
    // Language detection (a separate, lightweight on-device API) runs for both
    // tiers — when it works it picks the right glossary and currency hint. But
    // premium must NOT depend on it: older Chrome (premium's target audience)
    // may lack the on-device LanguageDetector entirely. So when detection can't
    // name the language, on-device bails ('nolang') but premium sends
    // srcLang:'auto' and lets the proxy detect the source itself.
    if (!srcLang) srcLang = langBase(await GlobuyTranslator.detectLanguage(detectionSample()));
    if (srcLang && srcLang !== 'und' && srcLang === tgtLang) { notify('same'); return false; }
    if (!srcLang || srcLang === 'und') {
      if (!premium) { notify('nolang'); return false; }
      srcLang = 'auto'; // the proxy's system prompt detects the source language
    }

    if (premium) {
      // The LLM call goes through the service worker; no on-device model to
      // download. A truthy sentinel keeps the `if (!translator)` guards happy.
      usePremium = true;
      translator = { premium: true };
      notify('premium');
      return true;
    }

    if (!GlobuyTranslator.apiAvailable()) { notify('unavailable'); return false; }
    try {
      translator = await GlobuyTranslator.getTranslator(srcLang, tgtLang, (loaded) => notify('downloading', loaded));
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

  // Lazily create the on-device translator so a premium batch that fails (quota
  // exhausted, network/upstream error) can still be translated. Returns false if
  // on-device is unavailable (no built-in AI, or it needs a user gesture).
  async function ensureFallbackTranslator() {
    if (fallbackTranslator) return true;
    if (!GlobuyTranslator.apiAvailable() || !srcLang || srcLang === tgtLang) return false;
    try {
      fallbackTranslator = await GlobuyTranslator.getTranslator(srcLang, tgtLang);
      return true;
    } catch (e) {
      return false;
    }
  }

  const CHUNK = 40; // nodes per batched on-device translate() call
  const REMOTE_CHUNK = 90; // larger batches for premium — network round-trips dominate

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
    if (!globalThis.GlobuyCurrency || !/\d/.test(text)) return null;
    const lits = GlobuyCurrency.findPrices(text, srcLang, inferred).map((p) => text.slice(p.start, p.end));
    return lits.length ? lits : null;
  }

  async function translateNodes(nodes) {
    const gloss = glossFor();
    const inferred = globalThis.GlobuyCurrency ? GlobuyCurrency.inferSourceCurrency(srcLang) : null;

    let pending = nodes.filter((n) => !seenText.has(n) && !n._ltSkip && n.nodeValue);
    if (!pending.length) return;
    // Viewport-first: on-screen text translates before off-screen, so the page
    // the user is looking at flips to English first. The on-device model
    // serializes, so we batch many nodes per call rather than run a worker pool.
    const visible = [], rest = [];
    for (const n of pending) (inViewport(n) ? visible : rest).push(n);
    pending = visible.concat(rest);

    const step = usePremium ? REMOTE_CHUNK : CHUNK;
    for (let i = 0; i < pending.length; i += step) {
      const live = pending.slice(i, i + step).filter((n) => !seenText.has(n) && !n._ltSkip);
      if (!live.length) continue;
      const items = live.map((node) => {
        const original = node.nodeValue;
        return { node, original, text: original, protectLiterals: priceLiteralsFor(original, inferred) };
      });
      let outs;
      if (usePremium) {
        const r = await GlobuyTranslator.translateRemote(items, srcLang, tgtLang);
        if (r.ok) {
          outs = r.results;
          notify('premium', r.remaining);
        } else {
          handlePremiumFailure(r.reason);
          if (!(await ensureFallbackTranslator())) continue;
          try { outs = await GlobuyTranslator.translateBatch(fallbackTranslator, items, gloss); }
          catch (e) { continue; }
        }
      } else {
        try {
          outs = await GlobuyTranslator.translateBatch(translator, items, gloss);
        } catch (e) {
          continue; // whole chunk failed; nodes stay unseen for a later retry
        }
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

  // Apply a translated attribute value to an element. Shared by both backends;
  // an `undefined` translation (item failed) is left unmarked for a later retry.
  function applyAttr(el, attr, value, translated) {
    let set = seenAttr.get(el);
    if (!set) { set = new Set(); seenAttr.set(el, set); }
    if (set.has(attr) || translated === undefined) return;
    set.add(attr);
    if (translated && translated !== value && el.getAttribute(attr) === value) {
      (el._ltAttrOrig || (el._ltAttrOrig = {}))[attr] = value;
      (el._ltAttrTrans || (el._ltAttrTrans = {}))[attr] = translated;
      el.setAttribute(attr, showingOriginal ? value : translated);
    }
  }

  async function translateAttrs(targets) {
    if (!targets.length) return;
    if (usePremium) {
      const r = await GlobuyTranslator.translateRemote(targets.map((t) => ({ text: t.value })), srcLang, tgtLang);
      if (r.ok) {
        for (let i = 0; i < targets.length; i++) applyAttr(targets[i].el, targets[i].attr, targets[i].value, r.results[i]);
        return;
      }
      handlePremiumFailure(r.reason);
      if (!(await ensureFallbackTranslator())) return;
      return translateAttrsOnDevice(targets, fallbackTranslator);
    }
    return translateAttrsOnDevice(targets, translator);
  }

  async function translateAttrsOnDevice(targets, tr) {
    const gloss = glossFor();
    const POOL = 6;
    let i = 0;
    async function worker() {
      while (i < targets.length) {
        const { el, attr, value } = targets[i++];
        const seen = seenAttr.get(el);
        if (seen && seen.has(attr)) continue;
        let translated;
        try {
          translated = await GlobuyTranslator.translateText(tr, value, gloss, null);
        } catch (e) {
          continue; // leave unmarked so a later pass can retry
        }
        applyAttr(el, attr, value, translated);
      }
    }
    await Promise.all(Array.from({ length: POOL }, worker));
  }

  async function translateTitle() {
    if (titleRecord) return;
    const t = document.title;
    if (!t || !t.trim() || !/\p{L}/u.test(t)) return;
    let translated;
    if (usePremium) {
      const r = await GlobuyTranslator.translateRemote([{ text: t }], srcLang, tgtLang);
      if (r.ok) translated = r.results[0];
      else {
        handlePremiumFailure(r.reason);
        if (await ensureFallbackTranslator()) {
          try { translated = await GlobuyTranslator.translateText(fallbackTranslator, t, glossFor(), null); }
          catch (e) { return; }
        } else return;
      }
    } else {
      try {
        translated = await GlobuyTranslator.translateText(translator, t, glossFor(), null);
      } catch (e) {
        return; // titleRecord stays null so the next run retries
      }
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
      nodes = nodes.concat(GlobuyWalker.collectTextNodes(r, seenText));
      attrTargets = attrTargets.concat(GlobuyWalker.collectAttrTargets(r, seenAttr));
    }
    if (nodes.length) await translateNodes(nodes);
    if (attrTargets.length) await translateAttrs(attrTargets);
  }

  async function processSizes(roots) {
    if (!settings.sizeEnabled || !globalThis.GlobuySizes) return;
    await GlobuySizes.annotate(roots, { seen: seenSize });
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
      if (GlobuyWalker.shouldSkipEl(node.parentElement)) continue;
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
    if (!srcLang || srcLang === tgtLang) return false;
    if (reverseTranslator) return true;
    if (settings.premiumEnabled && usePremium) return true;
    try {
      reverseTranslator = await GlobuyTranslator.getTranslator(tgtLang, srcLang);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function translateQuery(text) {
    // Reverse-translating the query needs a known source language; skip premium
    // when the source was left to the proxy ('auto') — there's no target to give.
    if (settings.premiumEnabled && usePremium && srcLang && srcLang !== 'auto') {
      const r = await GlobuyTranslator.translateRemote([{ text }], tgtLang, srcLang);
      if (r.ok && r.results[0]) return r.results[0];
      handlePremiumFailure(r.reason);
    }
    if (!reverseTranslator) {
      if (!srcLang || srcLang === tgtLang) return text;
      try {
        reverseTranslator = await GlobuyTranslator.getTranslator(tgtLang, srcLang);
      } catch (e) {
        return text;
      }
    }
    // Keep ALL-CAPS tokens (likely brand names — GUCCI, CHANEL, LV) verbatim
    // rather than transliterating them into something the catalog won't match.
    const brands = text.match(/\b[A-Z][A-Z0-9]{1,}\b/g);
    try {
      return await GlobuyTranslator.translateText(reverseTranslator, text, null, brands);
    } catch (e) {
      return text; // submit the original query rather than failing the search
    }
  }

  async function setupSearch() {
    if (searchInstalled || !globalThis.GlobuySearch) return;
    // 'auto' means the source language is unknown to us (proxy-detected), so
    // there's nothing to reverse-translate the query into — leave search alone.
    if (!srcLang || srcLang === tgtLang || srcLang === 'auto') return;
    if (!(await ensureReverseTranslator())) return;
    GlobuySearch.install({ translateQuery });
    searchInstalled = true;
  }

  async function processCurrency(roots, extra) {
    await GlobuyCurrency.annotate(roots, Object.assign({
      fromHint: srcLang || langBase(settings.targetLanguage),
      target: settings.targetCurrency,
      seen: seenCcy,
      convert: (from, to) => chrome.runtime.sendMessage({ type: 'convert', from, to })
    }, extra));
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

  // Warm the source->target FX rate as early as possible (before the slow
  // translation pass) so the later currency annotation doesn't block on a fetch.
  // inferSourceCurrency resolves from TLD / og:locale even before language
  // detection, covering the common resale TLDs (.kr/.jp/.cn/.vn). Fire-and-forget;
  // the service worker caches it so processCurrency hits a warm cache.
  function warmRate() {
    try {
      if (!globalThis.GlobuyCurrency) return;
      const from = GlobuyCurrency.inferSourceCurrency(srcLang);
      const to = (settings.targetCurrency || 'USD').toUpperCase();
      if (from && from !== to) {
        chrome.runtime.sendMessage({ type: 'convert', from, to }, () => { void chrome.runtime.lastError; });
      }
    } catch (e) { /* best-effort */ }
  }

  async function run() {
    if (running) return;
    running = true;
    notify('starting');
    warmRate();                       // kick off the FX fetch (TLD-based) up front
    const ok = await ensureTranslator();
    warmRate();                       // again now that srcLang is known (language-based)

    // Start the observer BEFORE the initial passes. These sites lazy-render the
    // product grid right after load; if it appears during our first pass it must
    // still be caught. (Previously the observer started last, so translation
    // missed the grid while currency — which re-scans the whole body a moment
    // later — happened to catch it.)
    if (!observer) {
      observer = GlobuyWalker.observe((added, changed) => {
        if (!enabled) return;
        // Hand the coalesced batch to the serial queue so it can't overlap a
        // prior batch still in flight (the observer is sync; the work is async).
        enqueue(async () => {
          if (!enabled) return;
          await processCurrency(added, { pureOnly: true }); // standalone prices first
          if (translator) await processTranslate(added);
          await processSizes(added);
          await processCurrency(added);
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
    // Standalone prices first — convert them before the (possibly slow) translation
    // pass so the most important info shows immediately; mixed nodes follow below.
    await processCurrency(roots, { pureOnly: true });
    if (ok) await runTranslatePasses();
    await processSizes(roots);    // sizes before currency — currency marks _ltSkip
    await processCurrency(roots); // full pass: mixed nodes (+ any pure ones that failed)
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
          showingOriginal = false;
          await loadSettings();
          // loadSettings() recomputes `enabled` from stored siteState; the popup
          // only sends 'apply' after enabling this site, so force it on here.
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
            apiAvailable: GlobuyTranslator.apiAvailable()
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
