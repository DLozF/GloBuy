# Privacy Policy — Globuy

_Last updated: 2026-06-24_

Globuy is built to do its job **without collecting, storing, or
transmitting your personal data**. In its **default mode** there is no backend
server, no account, no analytics, no tracking, and no ads. An **optional Premium
translation** mode (off by default) uses a cloud translation service — what it
sends, and only when, is described below.

## What the extension does with your data

### Page content stays on your device (default mode)
By default, translation runs entirely **on-device** using Chrome's built-in
Translator and LanguageDetector (on-device AI) APIs. The text of the pages you
visit — product names, descriptions, search queries you type — is translated
locally in your browser and **is never sent to us or to any third party**.

### Premium translation (opt-in — page text leaves your device)
If you turn on **Premium translation** in the popup, the extension sends the page
text selected for translation to our translation proxy, which forwards it to a
third-party LLM translation provider (currently **DeepSeek**) to produce
higher-quality translations. This mode is **off by default** and only does
anything while you have explicitly enabled it.

When Premium is on, each translation request sends:

- the **text to be translated** (product names, descriptions, seller notes, and
  the page title/attributes), batched;
- the detected **source language** and your **target language**;
- an **anonymous install identifier** (a random token generated in your browser)
  used only to meter the free monthly quota — it is not tied to your identity;
- **optionally**, if you choose to supply your own DeepSeek API key, that key, so
  the proxy can bill your key instead of the shared quota.

The proxy does not require an account and does not log page text for any purpose
beyond fulfilling the translation request. **URLs you visit, browsing history,
and identifiers beyond the anonymous quota token are not sent.** Currency and
size conversion remain on-device regardless of this setting. You can turn Premium
off at any time to return to fully on-device translation.

### Currency conversion sends only a currency pair
To show converted prices, the extension needs exchange rates. It sends **only a
pair of three-letter currency codes** (for example `KRW` and `USD`) to public,
keyless exchange-rate APIs:

- `frankfurter.dev` / `frankfurter.app`
- `open.er-api.com` (fallback, for currencies Frankfurter omits)

**No prices, amounts, page content, URLs, or identifiers are included** in these
requests — just the currencies. Rates are cached locally for 12 hours to
minimize even these requests. Requests are made from the extension's background
service worker, not from the pages you visit.

### Settings are stored in your browser
Your preferences — target language, target currency, per-site on/off, glossary
and size toggles — are saved with `chrome.storage.sync`. This is stored in your
own browser profile and, if you have Chrome Sync enabled, synced across your own
devices by Google. **It is never sent to the developer.**

## What we do NOT do

- We do **not** collect, sell, rent, or share any personal information.
- We do **not** use analytics, telemetry, advertising, or fingerprinting.
- We do **not** transmit the contents of the pages you browse anywhere **in the
  default on-device mode**. Page text leaves your device **only** if you opt in to
  Premium translation (see above) — sent to our proxy and the third-party LLM
  provider — and only the text being translated.

## Permissions

See [PERMISSIONS.md](./PERMISSIONS.md) for a per-permission justification,
including why broad host access is required.

## Contact

Questions about this policy can be sent to the project maintainer via the
extension's listing or repository.
