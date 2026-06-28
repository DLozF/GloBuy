// Debounced MutationObserver that feeds newly added subtrees back into the
// pipeline, catching scroll-loaded / lazily-rendered content. Our own writes are
// ignored downstream via the processed/annotated guards in dom-walker and currency.

let observer = null;
let pending = new Set();
let timer = null;
const DEBOUNCE_MS = 300;

export function startObserver(onRoots) {
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'characterData') {
        pending.add(m.target);
        continue;
      }
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
          // Skip our own injected annotation spans.
          if (node.classList?.contains('lt-ccy') || node.classList?.contains('lt-size')) continue;
          pending.add(node);
        }
      }
    }
    if (pending.size && timer == null) {
      timer = setTimeout(flush, DEBOUNCE_MS);
    }
  });
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  function flush() {
    timer = null;
    const roots = [...pending].filter((n) => n.isConnected);
    pending = new Set();
    if (roots.length) onRoots(roots);
  }
}

export function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  pending = new Set();
}
