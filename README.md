# Luxe Translate

A Chrome extension (Manifest V3) that **fully translates foreign luxury/resale
shopping sites** and **converts prices to your currency, inline** — built for
American shoppers browsing Korean, Japanese, and Chinese sites (e.g.
`wiselux.co.kr`) where Google Translate only does half the job.

## Why it's different from "just use Google Translate"

Google Translate fails on these sites in two distinct ways. Luxe Translate fixes
both:

1. **Coverage** — Google translates the header but misses prices, buttons, and
   items loaded as you scroll. We walk **every** text node and use a
   `MutationObserver` to catch scroll-loaded items, search results, and SPA
   navigations. *(`src/content/dom-walker.js`)*
2. **Word quality** — generic engines mangle luxury jargon. A curated **luxury
   glossary** enforces the right terms (`정품` → **Authentic**, `빈티지` →
   **Vintage**, `S급` → **Grade S (Like New)**, etc.) on top of machine
   translation. *(`src/data/glossary.js`, `src/content/translator.js`)*

Plus inline currency conversion next to every price:
`₩1,200,000 (≈ $870)`. *(`src/content/currency.js`)*

## Architecture

- **No backend, $0 running cost.**
- **Translation:** Chrome's built-in **on-device Translator + LanguageDetector
  APIs** (Chrome 138+) — free, local, no API key.
- **Currency:** [Frankfurter](https://frankfurter.dev) API — free, no key.
  Fetched and cached (12h) in the service worker to avoid page CORS.

```
manifest.json
src/
  background.js            Service worker: currency-rate fetch + cache
  content/
    content.js            Orchestrates translation + currency on the page
    dom-walker.js         Text-node collection + MutationObserver
    translator.js         Translator/LanguageDetector wrapper + glossary
    currency.js           Price detection + inline annotation
  data/glossary.js        Luxury jargon per source language (ko, ja, zh)
  popup/                  Toggle, target language, target currency, show-original
icons/                    16 / 48 / 128 px
```

## Requirements

- **Google Chrome 138+** with built-in AI enabled. The on-device translation
  model downloads on first use (one-time, may take a minute). If unavailable,
  the popup tells you to update Chrome — currency conversion still works.

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this project folder.
4. Pin the extension and open any foreign site (e.g. `https://wiselux.co.kr/`).

## Usage

- It auto-translates supported foreign sites on load.
- Click the toolbar icon to:
  - Toggle translation **for the current site**
  - Choose the **target language** and **target currency** (changing these
    reloads the page for a clean re-pass)
  - Toggle the **luxury glossary**
  - **Show original** text without losing the translation

## Roadmap (Phase 2)

- **Search-query translation:** type English, submit in the site's language.
- **Claude "Premium" tier:** swap the translation backend in `translator.js` for
  best-in-class jargon quality (adds a small backend + API key).
- Broader currency coverage for currencies Frankfurter doesn't support.

## Known limitations

- European-style decimals where `.` is a thousands separator (e.g. `€2.350`) may
  be parsed as `2.35`. Fine for the comma-separated KRW/JPY/CNY target sites.
- Translation runs in the top frame only (`all_frames: false`).
