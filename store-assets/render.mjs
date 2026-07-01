// Renders the Chrome Web Store image assets from HTML to exact-dimension PNGs
// using headless Chrome. The Inter font is inlined as a base64 data URI so the
// typography is pixel-perfect with no async font fetch at screenshot time.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SRC = join(__dir, 'src');
const OUT = join(__dir, 'out');
const TMP = join(__dir, '.tmp');

// One asset per target dimension required by the Chrome Web Store.
const ASSETS = [
  { html: 'promo-tile.html', out: 'promo-tile-440x280.png', w: 440, h: 280 },
  { html: 'marquee.html', out: 'marquee-1400x560.png', w: 1400, h: 560 },
  { html: 'shot-1-translate.html', out: 'screenshot-1-translate-1280x800.png', w: 1280, h: 800 },
  { html: 'shot-2-currency.html', out: 'screenshot-2-currency-1280x800.png', w: 1280, h: 800 },
  { html: 'shot-3-sizes.html', out: 'screenshot-3-sizes-1280x800.png', w: 1280, h: 800 },
  { html: 'shot-4-privacy.html', out: 'screenshot-4-privacy-1280x800.png', w: 1280, h: 800 },
  { html: 'frame-template.html', out: 'frame-template-1280x800.png', w: 1280, h: 800 },
];

const fontB64 = readFileSync(join(SRC, 'inter-latin.woff2')).toString('base64');
const fontDataUri = `data:font/woff2;base64,${fontB64}`;

mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const only = process.argv.slice(2); // optional: render a subset by html name
for (const a of ASSETS) {
  if (only.length && !only.some((o) => a.html.includes(o))) continue;
  const raw = readFileSync(join(SRC, a.html), 'utf8');
  // Files with an inlined-font placeholder are rendered from a temp copy with
  // the base64 font injected. Files without it are rendered in place so their
  // relative assets (shared CSS, the woff2 sibling) resolve via file://.
  let renderPath = join(SRC, a.html);
  if (raw.includes('__INTER_FONT__')) {
    renderPath = join(TMP, a.html);
    writeFileSync(renderPath, raw.replaceAll('__INTER_FONT__', fontDataUri));
  }
  const outPath = join(OUT, a.out);
  // Supersample: render at 3x device pixels, then high-quality downscale to the
  // exact store dimension. Sharper text and edges than a flat 1x screenshot.
  const SCALE = 3;
  const hiPath = join(TMP, `2x-${a.out}`);
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--force-device-scale-factor=${SCALE}`,
    `--window-size=${a.w},${a.h}`,
    `--screenshot=${hiPath}`,
    `--virtual-time-budget=1500`,
    `file://${renderPath}`,
  ], { stdio: 'ignore' });
  // sips -z takes height then width.
  execFileSync('/usr/bin/sips', ['-z', String(a.h), String(a.w), hiPath, '--out', outPath], { stdio: 'ignore' });
  console.log(`rendered ${a.out} (${a.w}x${a.h}, supersampled ${SCALE}x)`);
}
rmSync(TMP, { recursive: true, force: true });
