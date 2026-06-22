# Privacy Policy — Luxe Translate

_Last updated: 2026-06-22_

Luxe Translate is built to do its job **without collecting, storing, or
transmitting your personal data**. There is no backend server, no account, no
analytics, no tracking, and no ads.

## What the extension does with your data

### Page content stays on your device
Translation runs entirely **on-device** using Chrome's built-in Translator and
LanguageDetector (on-device AI) APIs. The text of the pages you visit — product
names, descriptions, search queries you type — is translated locally in your
browser and **is never sent to us or to any third party**.

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
- We do **not** transmit the contents of the pages you browse anywhere.

## Permissions

See [PERMISSIONS.md](./PERMISSIONS.md) for a per-permission justification,
including why broad host access is required.

## Contact

Questions about this policy can be sent to the project maintainer via the
extension's listing or repository.
