import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'TRANSLATE — Luxury/Resale Translator + Currency',
  description:
    'Fully translates foreign luxury/resale sites with Chrome on-device AI and converts prices inline to your currency.',
  version: '0.1.0',
  minimum_chrome_version: '138',
  permissions: ['storage'],
  host_permissions: ['<all_urls>', 'https://api.frankfurter.dev/*'],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.js'],
      css: ['src/styles/overlay.css'],
      run_at: 'document_idle',
    },
  ],
  background: {
    service_worker: 'src/background/service-worker.js',
    type: 'module',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'TRANSLATE',
  },
  icons: {
    16: 'public/icons/icon-16.png',
    32: 'public/icons/icon-32.png',
    48: 'public/icons/icon-48.png',
    128: 'public/icons/icon-128.png',
  },
});
