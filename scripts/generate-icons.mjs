import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = 'E:\\Downloads Pictures\\globuy-icon.svg';
const outDir = resolve(__dirname, '../public/icons');
const svg = readFileSync(svgPath);

const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  await sharp(svg)
    .resize(size, size)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toFile(`${outDir}/icon-${size}.png`);
  console.log(`Generated icon-${size}.png`);
}
