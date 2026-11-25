// Turns scripts/icon.svg into the PNG icons phones need.
// Run with:  npm run icons   (only needed when the icon design changes)
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const src = new URL('./icon.svg', import.meta.url);
const out = new URL('../public/icons/', import.meta.url);
await mkdir(out, { recursive: true });

const sizes = { 'apple-touch-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 };
for (const [name, size] of Object.entries(sizes)) {
  await sharp(src.pathname.replace(/^\/([A-Z]:)/, '$1'), { density: 300 }).resize(size, size).png().toFile(new URL(name, out).pathname.replace(/^\/([A-Z]:)/, '$1'));
  console.log(`made ${name} (${size}px)`);
}
