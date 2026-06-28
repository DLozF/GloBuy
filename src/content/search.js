// Search-query translation.
//
// Lets the user type a query in their own language (e.g. English) into the
// site's search box and submit it in the site's language. Uses a reverse
// (target -> source) translator supplied by content.js.
//
// Works by intercepting Enter / form-submit in the capture phase, translating
// the query, writing it back, then re-dispatching the submit with a one-shot
// bypass flag so our own re-submit passes straight through.
(function () {
  // Hangul, Kana, CJK ideographs, and fullwidth forms — i.e. the scripts these
  // sites use. If the query already contains them, the user is typing in the
  // site's language, so translating would mangle it.
  const CJK = /[　-ヿ㐀-鿿가-힯＀-￯]/;

  // Translate only a query that is in the user's (Latin) language and not
  // already (partly) in the site's language — fixes mixed queries like
  // "GUCCI 가방" being reverse-translated into nonsense.
  function shouldTranslateQuery(v) {
    return /[A-Za-z]/.test(v) && !CJK.test(v);
  }

  let translateQuery = null;
  let shouldTranslate = shouldTranslateQuery;
  let installed = false;

  const INPUT_SEL = [
    'input[type="search"]',
    'input[name*="search" i]',
    'input[name*="query" i]',
    'input[name="q" i]',
    'input[id*="search" i]',
    'input[id*="query" i]'
  ].join(',');

  function isMatch(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (!['text', 'search', ''].includes(type)) return false;
    if (el.matches(INPUT_SEL)) return true;
    if (el.closest('[role="search"]')) return true;
    const f = el.form;
    if (f) {
      const hay = (f.getAttribute('action') || '') + ' ' + (f.getAttribute('name') || '') + ' ' + (f.className || '');
      if (/search/i.test(hay)) return true;
    }
    return false;
  }

  function submitForm(form) {
    form.__ltBypass = true;
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
  }

  function handle(input, ev) {
    if (!translateQuery || !isMatch(input)) return;
    const val = input.value;
    if (!val || !shouldTranslate(val)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    Promise.resolve(translateQuery(val))
      .then((t) => {
        input.value = t || val;
        const form = input.form;
        if (form) submitForm(form);
        else {
          input.__ltBypass = true;
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        }
      })
      .catch(() => { /* leave the original query untouched */ });
  }

  function onKeydown(e) {
    if (e.key !== 'Enter') return;
    const input = e.target;
    if (input && input.__ltBypass) { input.__ltBypass = false; return; }
    handle(input, e);
  }

  function onSubmit(e) {
    const form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    if (form.__ltBypass) { form.__ltBypass = false; return; }
    let input = form.querySelector(INPUT_SEL);
    if (!input) input = Array.from(form.querySelectorAll('input')).find(isMatch);
    if (!input) return;
    handle(input, e);
  }

  function install(opts) {
    if (installed) return;
    if (!opts || typeof opts.translateQuery !== 'function') return;
    translateQuery = opts.translateQuery;
    if (typeof opts.shouldTranslate === 'function') shouldTranslate = opts.shouldTranslate;
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('submit', onSubmit, true);
    installed = true;
  }

  globalThis.LuxeSearch = { install, shouldTranslateQuery };
})();
