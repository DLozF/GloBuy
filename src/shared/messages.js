// Message type constants shared between content scripts, the service worker, and the popup.

export const MSG = {
  // popup -> content: enable translation/conversion on the current tab
  ENABLE_SITE: 'ENABLE_SITE',
  // popup -> content: disable and revert the current tab
  DISABLE_SITE: 'DISABLE_SITE',
  // popup -> content: re-run the pipeline (e.g. target language/currency changed)
  RERUN: 'RERUN',
  // content -> service worker: request the cached Frankfurter rate table (base EUR)
  GET_RATES: 'GET_RATES',
  // content -> popup/service worker: report status (download progress, unsupported, etc.)
  STATUS: 'STATUS',
};

// Status kinds carried by MSG.STATUS payloads.
export const STATUS_KIND = {
  UNSUPPORTED_API: 'UNSUPPORTED_API', // Translator/LanguageDetector missing
  UNSUPPORTED_LANG: 'UNSUPPORTED_LANG', // language pair not available
  DOWNLOADING: 'DOWNLOADING', // model download in progress (with progress 0..1)
  READY: 'READY', // translator ready / pass complete
  NEEDS_ACTIVATION: 'NEEDS_ACTIVATION', // waiting for a user gesture to download the model
  IDLE: 'IDLE', // not running on this tab
};
