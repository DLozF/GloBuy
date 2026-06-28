# Privacy Policy — Globuy

_Last updated: 2026-06-26_

Globuy is built to do its job **without collecting, storing, or
transmitting your personal data**. There is no backend server, no account, no
analytics, no tracking, and no ads. **In this version, all translation runs
on-device** and no page content ever leaves your browser. A future **optional
Premium translation** tier is described below as "coming soon" — it is **not
active in this version** and sends nothing anywhere until a later release ships
it and you explicitly turn it on.

## What the extension does with your data

### Page content stays on your device
Translation runs entirely **on-device** using Chrome's built-in Translator and
LanguageDetector (on-device AI) APIs. The text of the pages you visit — product
names, descriptions, search queries you type — is translated locally in your
browser and **is never sent to us or to any third party**.

### Premium translation (coming soon — not active in this version)
A future release will add an **optional Premium translation** tier for
higher-quality translations of luxury/resale jargon. **It is not present in this
version**: the extension ships on-device only, there is no Premium toggle, and
no page text leaves your device. The description below documents how that tier
will work so this policy is ready when it ships — until then nothing in it
applies.

When it ships, Premium will be **off by default** and will only do anything
while you have explicitly turned it on. With Premium on, the extension would send
the page text selected for translation to our translation proxy, which forwards
it to a third-party LLM translation provider (currently **DeepSeek**) to produce
higher-quality translations. Each translation request would send:

- the **text to be translated** (product names, descriptions, seller notes, and
  the page title/attributes), batched;
- the detected **source language** and your **target language**;
- an **anonymous install identifier** (a random token generated in your browser)
  used only to meter the free monthly quota — it is not tied to your identity;
- **optionally**, if you choose to supply your own DeepSeek API key, that key, so
  the proxy can bill your key instead of the shared quota.

The proxy would not require an account and would not log page text for any
purpose beyond fulfilling the translation request. **URLs you visit, browsing
history, and identifiers beyond the anonymous quota token would not be sent.**
Currency and size conversion would remain on-device regardless of this setting,
and you would be able to turn Premium off at any time to return to fully
on-device translation. Again: none of this is active in the current version.

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
- We do **not** transmit the contents of the pages you browse anywhere. This
  version is on-device only; page text never leaves your device. The future
  Premium tier described above is **not active in this version** and would only
  ever transmit page text after a later release ships it and you explicitly opt
  in.

## Permissions

See [PERMISSIONS.md](./PERMISSIONS.md) for a per-permission justification,
including why broad host access is required.

## Contact

Questions about this policy can be sent to the project maintainer via the
extension's listing or repository.
