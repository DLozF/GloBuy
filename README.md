# TRANSLATE

Chrome extension (Manifest V3) that fully translates foreign luxury/resale sites and
converts prices inline to your currency.

- On-device Chrome Translator API + a luxury-jargon glossary (free, no backend)
- Full-page coverage via TreeWalker + MutationObserver (catches scroll-loaded content)
- Inline currency conversion next to prices via the free Frankfurter API

## How it works

| Piece | Responsibility |
| --- | --- |
| `src/content/` | Runs in the page. Detects the page language, translates text nodes (glossary overrides first, then the on-device model), watches for new content, and appends `≈ <price>` annotations. |
| `src/background/service-worker.js` | Fetches and caches Frankfurter rates (base EUR) once per day and serves them to tabs. |
| `src/popup/` | Per-site on/off toggle, target language, target currency, and live status. |
| `src/shared/` | Settings (`chrome.storage.sync`), message constants, currency tables. |

The Translator API only exists in a document context, so all translation runs in the
content script — the service worker is limited to currency data. The extension stays
dormant on a site until you enable it from the popup.

## Requirements

- Google Chrome **138+** (the on-device Translator/LanguageDetector APIs). The language
  model downloads on first use, which needs a user gesture — the page shows a
  **"Translate this page"** button the first time.

## Develop

```bash
npm install
npm run dev      # Vite + HMR; load dist/ as an unpacked extension
npm run build    # production build into dist/
npm test         # vitest unit tests (price parsing, currency, glossary)
```

Load in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked** →
select the `dist/` folder.

## Usage

1. Open a foreign luxury/resale listing (e.g. a French or Japanese page).
2. Click the extension icon and toggle **Translate this site** on; pick your target
   language and currency.
3. The page translates in place and prices gain an inline converted value. Scroll-loaded
   listings are translated automatically. Toggle off to revert.

Note: Frankfurter covers ~31 ECB currencies; conversions involving anything outside that
set are skipped silently.
