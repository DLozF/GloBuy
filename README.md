# Globuy

A Chrome extension (Manifest V3) that **fully translates foreign luxury/resale
shopping sites** and **converts prices to your currency, inline** — built for
American shoppers browsing Korean, Japanese, Chinese, and Vietnamese sites (e.g.
`wiselux.co.kr`) where Google Translate only does half the job.

## Why it's different from "just use Google Translate"

Google Translate fails on these sites in two distinct ways. Globuy fixes
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

It also goes beyond on-page text:

- **Full coverage** — translates input **placeholders**, image **alt**, `title`
  tooltips, `aria-label`, button labels, and the **browser tab title**.
  *(`src/content/dom-walker.js`)*
- **Inline size conversion** — KR/JP/EU clothing & shoe sizes shown in US next to
  the original: `260mm (≈ US 8)`, `EU 38 (≈ US 6)`. Approximate, always marked
  with `≈`. *(`src/content/sizes.js`)*
- **Search in English** — type a query in your language; it's translated into the
  site's language on submit. *(`src/content/search.js`)*

## Architecture

- **Default tier: no backend, $0 running cost, fully on-device.**
- **Translation:** Chrome's built-in **on-device Translator + LanguageDetector
  APIs** (Chrome 138+) — free, local, no API key.
- **Premium tier (planned for v2 — disabled in v1):** a future opt-in toggle will
  route translation through a hosted proxy (a Cloudflare Worker in `proxy/`) to an
  OpenAI-compatible LLM (currently **DeepSeek**) for higher jargon quality — the
  engine is config-driven (`LLM_BASE_URL`/`LLM_MODEL`). The proxy holds the API
  key and enforces a free monthly quota; the extension authenticates with an
  anonymous install token. **v1 ships on-device only:** this code is present in
  the repo but feature-flagged off, the popup exposes no Premium UI, and **no
  page text ever leaves your device** — see [PRIVACY.md](./PRIVACY.md). When
  enabled in v2 it will fall back to on-device automatically if the quota is out
  or the proxy is unreachable.
  *(`proxy/`, `src/content/translator.js` → `translateRemote`, `src/background.js`
  → `premiumTranslate`)*
- **Currency:** [Frankfurter](https://frankfurter.dev) API — free, no key — with
  `open.er-api.com` as a keyless fallback for currencies Frankfurter omits (e.g.
  VND). Fetched in the service worker (avoids page CORS): the rate endpoints are
  **raced** with a timeout (fastest source wins), cached 12h and served
  **stale-while-revalidate** so conversions never block on the network, and
  concurrent lookups are coalesced. **Standalone prices convert before the
  translation pass** (`pureOnly`), so the price-in-your-currency appears
  immediately even while a slow Premium translation is still running.

```
manifest.json
src/
  background.js            Service worker: currency-rate fetch + cache
  content/
    content.js            Orchestrates translation + currency + sizes + search
    dom-walker.js         Text-node + attribute collection + MutationObserver
    translator.js         Translator/LanguageDetector wrapper + glossary
    currency.js           Price detection + inline annotation
    sizes.js              KR/JP/EU -> US size detection + inline annotation
    search.js             Search-box interception + reverse-query translation
  data/glossary.js        Luxury jargon per source language (ko, ja, zh, vi)
  popup/                  Toggle, target language/currency, glossary, sizes, show-original
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
  - Toggle **Convert sizes to US**
  - **Show original** text without losing the translation
- In any search box, type your query in your own language and submit — it's sent
  to the site in the site's language.

## Roadmap

- **Premium tier (planned for v2):** opt-in OpenAI-compatible LLM backend
  (currently **DeepSeek**) via a hosted proxy (`proxy/`) for best-in-class jargon
  quality, with a free monthly quota, BYOK fallback, and automatic fall-back to
  on-device. Disabled in v1 (on-device only). Swap providers via
  `LLM_BASE_URL`/`LLM_MODEL`. See **Architecture** above and
  [PRIVACY.md](./PRIVACY.md).
- Premium follow-ups: paid subscription (Stripe) for the proxy, plus listing
  summaries and in-image OCR.
- Custom glossary editor and per-site source-language override.

## Known limitations

- Number parsing handles both comma- and dot-grouped amounts (`₩1,200,000`,
  `$1,234.56`, `€2.350`, `1.234,56`, `1.500.000đ`), but a **bare, unmarked**
  dot-grouped number is only treated as a price on dot-grouping locales (e.g.
  VND) — elsewhere it's left alone to avoid misreading a decimal as thousands.
- Size conversion is **approximate** (charts vary by brand/gender). It uses a
  gender-specific scale when a women's/men's signal is nearby and a unisex
  approximation otherwise, and triggers only on explicit `mm`/`cm`/`EU`
  markers — a bare number is never converted.
- **Text baked into images** (common in resale product descriptions) can't be
  translated without OCR — planned for the Premium tier (see Roadmap).
- Translation runs in the top frame only (`all_frames: false`); content inside
  iframes is not translated.
