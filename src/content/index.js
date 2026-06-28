// Content-script entry point. Stays dormant until the host is enabled (via the
// popup), then drives the translation + currency pipeline. Always listens for popup
// messages so it can be toggled live.

import { MSG } from '../shared/messages.js';
import { getSettings, isHostEnabled } from '../shared/settings.js';
import { start, stop, isRunning } from './pipeline.js';

const host = location.hostname;

async function maybeStart() {
  if (isRunning()) return;
  const settings = await getSettings();
  await start(settings);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case MSG.ENABLE_SITE:
        await maybeStart();
        break;
      case MSG.DISABLE_SITE:
        stop();
        break;
      case MSG.RERUN:
        stop();
        await maybeStart();
        break;
      default:
        break;
    }
    sendResponse?.({ ok: true, running: isRunning() });
  })();
  return true; // async response
});

// Auto-start if this host was already enabled in a previous session.
isHostEnabled(host).then((enabled) => {
  if (enabled) maybeStart();
});
