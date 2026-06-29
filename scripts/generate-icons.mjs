import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Use a repo-relative, cross-platform path for the source SVG. Put the SVG in `assets/globuy-icon.svg`.
const svgPath = resolve(__dirname, '../assets/globuy-icon.svg');
const outDir = resolve(__dirname, '../public/icons');

// Ensure output directory exists
mkdirSync(outDir, { recursive: true });

const svg = readFileSync(svgPath);

const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  await sharp(svg)
    .resize(size, size)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toFile(resolve(outDir, `icon-${size}.png`));
  console.log(`Generated icon-${size}.png`);
}
