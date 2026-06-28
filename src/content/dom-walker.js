// DOM traversal + dynamic-content watcher.
//
// Collects translatable text nodes and notifies on newly added content so
// scroll-loaded items, search results, and SPA navigations get translated too
// (the core fix for the "Google only translates part of the page" problem).

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE',
  'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'TEMPLATE'
]);

// A text node that is ONLY a currency symbol/word: machine translation turns a
// lone "원" into "circle" (out of context it means circle, not won), so leave
// these untranslated. Phrases like "배송비 4,000원" still translate normally.
const CCY_ONLY = /^[\s ]*(?:₩|￦|¥|€|£|\$|원|엔|円|元|위안|달러|유로|엔화)[\s ]*$/;

export function shouldSkipEl(el) {
  if (!el) return true;
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  if (el.closest && el.closest('[data-lt-skip]')) return true;
  return false;
}

// Collect qualifying text nodes under `root`. `seen` is a WeakSet of nodes
// already handled, so re-runs (from the observer) skip prior work.
export function collectTextNodes(root, seen) {
  const out = [];
  if (!root) return out;

  const scope = root.nodeType === Node.TEXT_NODE ? (root.parentNode || root) : root;
  if (scope.nodeType !== Node.ELEMENT_NODE && scope.nodeType !== Node.DOCUMENT_NODE) {
    return out;
  }

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node._ltSkip) return NodeFilter.FILTER_REJECT;
      if (seen && seen.has(node)) return NodeFilter.FILTER_REJECT;
      const v = node.nodeValue;
      if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
      // Must contain an actual letter — pure numbers/symbols/prices are left
      // for the currency module.
      if (!/\p{L}/u.test(v)) return NodeFilter.FILTER_REJECT;
      // A standalone currency word/symbol — leave for the currency module.
      if (CCY_ONLY.test(v)) return NodeFilter.FILTER_REJECT;
      if (shouldSkipEl(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let n;
  while ((n = walker.nextNode())) out.push(n);
  return out;
}

// Elements that may carry user-visible text in attributes (the MVP only
// touched text nodes, so these stayed in the source language). We deliberately
// do NOT touch meta[name=description]: it isn't shown on the page, and
// rewriting it would alter what the site reports to crawlers / share previews.
const ATTR_SELECTOR =
  '[placeholder],[title],[alt],[aria-label],' +
  'input[type="submit"],input[type="button"],input[type="reset"]';

function attrsFor(el) {
  const list = [];
  for (const a of ['placeholder', 'title', 'alt', 'aria-label']) {
    if (el.hasAttribute(a)) list.push(a);
  }
  if (el.tagName === 'INPUT') {
    const t = (el.getAttribute('type') || '').toLowerCase();
    if (t === 'submit' || t === 'button' || t === 'reset') list.push('value');
  }
  return list;
}

// Collect translatable attributes under `root`. `seenAttr` is a
// WeakMap<Element, Set<attr>> of (element, attribute) pairs already handled,
// so observer re-runs skip prior work. Returns [{ el, attr, value }].
export function collectAttrTargets(root, seenAttr) {
  const out = [];
  if (!root) return out;
  const scope = root.nodeType === Node.TEXT_NODE ? (root.parentNode || root) : root;
  if (scope.nodeType !== Node.ELEMENT_NODE && scope.nodeType !== Node.DOCUMENT_NODE) {
    return out;
  }
  const candidates = new Set();
  if (scope.nodeType === Node.ELEMENT_NODE && scope.matches && scope.matches(ATTR_SELECTOR)) {
    candidates.add(scope);
  }
  if (scope.querySelectorAll) {
    for (const el of scope.querySelectorAll(ATTR_SELECTOR)) candidates.add(el);
  }
  for (const el of candidates) {
    if (shouldSkipEl(el)) continue;
    const done = seenAttr && seenAttr.get(el);
    for (const attr of attrsFor(el)) {
      if (done && done.has(attr)) continue;
      const v = el.getAttribute(attr);
      if (v && v.trim() && /\p{L}/u.test(v)) out.push({ el, attr, value: v });
    }
  }
  return out;
}

// Watch for content changes. Calls back with (added, changed):
//  - `added`:   newly inserted nodes (elements/text), minus our own annotations
//  - `changed`: text nodes whose value was edited in place (characterData) —
//               data-bound site frameworks revert our translations this way,
//               and without watching characterData we'd never re-apply.
//
// Mutations are COALESCED: a chatty page (lazy grids, skeleton fills, framework
// re-renders) can deliver dozens of mutation records in a burst. Rather than run
// a heavy translate/convert pass per record, we accumulate them and fire one
// callback when the main thread next goes idle (requestIdleCallback), falling
// back to a ~100ms debounced setTimeout where idle callbacks aren't available.
export function observe(callback) {
  let pendingAdded = [];
  let pendingChanged = [];
  const supportsIdle = typeof requestIdleCallback === 'function';
  let timer = null;

  function flush() {
    timer = null;
    if (!pendingAdded.length && !pendingChanged.length) return;
    const added = pendingAdded;
    const changed = pendingChanged;
    pendingAdded = [];
    pendingChanged = [];
    callback(added, changed);
  }

  function schedule() {
    if (supportsIdle) {
      if (timer == null) timer = requestIdleCallback(flush, { timeout: 500 });
    } else {
      if (timer != null) clearTimeout(timer); // debounce: ride out the burst
      timer = setTimeout(flush, 100);
    }
  }

  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'characterData') {
        const n = m.target;
        if (n && n.nodeType === Node.TEXT_NODE && !n._ltSkip) pendingChanged.push(n);
        continue;
      }
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.classList && node.classList.contains('lt-ccy')) continue;
          if (node.hasAttribute && node.hasAttribute('data-lt-skip')) continue;
          pendingAdded.push(node);
        } else if (node.nodeType === Node.TEXT_NODE) {
          if (node._ltSkip) continue;
          pendingAdded.push(node);
        }
      }
    }
    if (pendingAdded.length || pendingChanged.length) schedule();
  });
  obs.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
  return obs;
}

export function writeTranslation(node, translated) {
  if (node._ltOrig === undefined) {
    node._ltOrig = node.nodeValue;
  }
  node._ltTrans = translated;
  node.nodeValue = translated;
}

export function revertAll() {
  const root = document.body || document.documentElement;
  if (root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      if (n._ltTrans === undefined) continue;
      if (n._ltOrig !== undefined && n.nodeValue !== n._ltOrig) {
        n.nodeValue = n._ltOrig;
      }
    }
    for (const el of root.querySelectorAll('*')) {
      const trans = el._ltAttrTrans;
      if (!trans) continue;
      const orig = el._ltAttrOrig || {};
      for (const attr in trans) {
        if (orig[attr] !== undefined && el.getAttribute(attr) !== orig[attr]) {
          el.setAttribute(attr, orig[attr]);
        }
      }
    }
  }
}

// Global exposure for CommonJS tests loading via loadModule
globalThis.GlobuyWalker = {
  collectTextNodes,
  collectAttrTargets,
  observe,
  shouldSkipEl,
  writeTranslation,
  revertAll
};
