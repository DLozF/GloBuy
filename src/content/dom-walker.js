// DOM traversal + dynamic-content watcher.
//
// Collects translatable text nodes and notifies on newly added content so
// scroll-loaded items, search results, and SPA navigations get translated too
// (the core fix for the "Google only translates part of the page" problem).
(function () {
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE',
    'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'TEMPLATE'
  ]);

  function shouldSkipEl(el) {
    if (!el) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.closest && el.closest('[data-lt-skip]')) return true;
    return false;
  }

  // Collect qualifying text nodes under `root`. `seen` is a WeakSet of nodes
  // already handled, so re-runs (from the observer) skip prior work.
  function collectTextNodes(root, seen) {
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
        if (shouldSkipEl(node.parentElement)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let n;
    while ((n = walker.nextNode())) out.push(n);
    return out;
  }

  // Watch for added content. Calls back with an array of added nodes (elements
  // or text nodes), filtering out our own currency annotations to avoid loops.
  function observe(callback) {
    const obs = new MutationObserver((mutations) => {
      const added = [];
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList && node.classList.contains('lt-ccy')) continue;
            if (node.hasAttribute && node.hasAttribute('data-lt-skip')) continue;
            added.push(node);
          } else if (node.nodeType === Node.TEXT_NODE) {
            if (node._ltSkip) continue;
            added.push(node);
          }
        }
      }
      if (added.length) callback(added);
    });
    obs.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
    return obs;
  }

  globalThis.LuxeWalker = { collectTextNodes, observe, shouldSkipEl };
})();
