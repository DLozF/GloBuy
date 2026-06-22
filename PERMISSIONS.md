# Permissions — Luxe Translate

This extension follows least privilege. Below is every permission it requests
and why, plus the permissions it deliberately does **not** request.

## `host_permissions: ["<all_urls>"]` and content-script `matches: ["<all_urls>"]`

**Why it's required.** Luxe Translate's purpose is to translate and convert
prices on *whatever* foreign luxury/resale shopping site you choose to visit
(Korean, Japanese, Chinese, Vietnamese, …). These sites are countless and can't
be enumerated in advance, so the content script must be eligible to run on any
site.

**How it's constrained in practice.**

- Translation only does work on a site when you have auto-translate on, or you've
  explicitly enabled that site from the popup. It is off per-site by default once
  you toggle it off.
- All translation is **on-device**; page content never leaves your browser.
- The script runs in the **top frame only** (`all_frames: false`).

## `storage`

Persists your settings (target language/currency, per-site enable state, glossary
and size toggles) via `chrome.storage.sync`, and caches fetched currency rates
(12-hour TTL) via `chrome.storage.local` so prices aren't re-fetched constantly.

## `tabs`

The popup reads the **active tab's URL** to show the current host and to
remember your per-site on/off choice, and it sends messages to / reloads the
active tab when you change settings. This is the minimum needed to drive the
content script for the page you're looking at.

## Network access

The background service worker fetches exchange rates from public, keyless APIs
(`frankfurter.dev`, `frankfurter.app`, `open.er-api.com`). Only currency codes
are sent — never prices, page content, or identifiers. See
[PRIVACY.md](./PRIVACY.md).

## Permissions we intentionally do NOT request

- **`activeTab`** — redundant. Broad `host_permissions` already covers the active
  tab, so the temporary, gesture-scoped access `activeTab` grants adds nothing.
- **`scripting`** — unused. Content scripts are declared **statically** in
  `manifest.json`; the extension never injects scripts dynamically at runtime, so
  it needs no programmatic injection permission.
