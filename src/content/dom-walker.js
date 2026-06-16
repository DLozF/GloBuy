// TreeWalker-based collection of translatable text nodes, plus write-back and
// revert support. State (processed / originals) is module-level so it persists
// across incremental passes driven by the MutationObserver.

const SKIP_PARENTS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'KBD', 'SAMP',
]);

// Nodes we've already translated, so re-runs and observer passes don't touch them.
const processed = new WeakSet();
// Original text keyed by node, used to revert when the user disables the site.
const originals = new WeakMap();
// Track translated nodes so revert can find them without re-walking everything.
const translatedNodes = new Set();

// Matches text that is only digits, currency symbols, whitespace and punctuation —
// nothing worth sending to the translator.
const NON_TRANSLATABLE = /^[\s\d.,:;/\\|°%+\-–—_#*~^()[\]{}<>"'`!?&@…·•]*$/u;

function shouldSkip(node) {
  if (processed.has(node)) return true;
  const value = node.nodeValue;
  if (!value || !value.trim()) return true;
  if (NON_TRANSLATABLE.test(value)) return true;

  const parent = node.parentElement;
  if (!parent) return true;
  if (SKIP_PARENTS.has(parent.tagName)) return true;
  if (parent.isContentEditable) return true;
  // Our own injected currency annotations.
  if (parent.closest('.tr-price')) return true;
  return false;
}

/** Collect translatable text nodes within a root (inclusive). */
export function collectTextNodes(root) {
  const out = [];
  // A text node passed directly (e.g. from a mutation) won't be walked, handle it.
  if (root.nodeType === Node.TEXT_NODE) {
    if (!shouldSkip(root)) out.push(root);
    return out;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = walker.nextNode())) out.push(n);
  return out;
}

/** Write a translation back to a node, remembering the original for revert. */
export function writeTranslation(node, text) {
  if (!originals.has(node)) originals.set(node, node.nodeValue);
  node.nodeValue = text;
  processed.add(node);
  translatedNodes.add(node);
}

export function isProcessed(node) {
  return processed.has(node);
}

/** Restore all translated text nodes to their original values. */
export function revertAll() {
  for (const node of translatedNodes) {
    const original = originals.get(node);
    if (original != null && node.isConnected) node.nodeValue = original;
    processed.delete(node);
  }
  translatedNodes.clear();
}
