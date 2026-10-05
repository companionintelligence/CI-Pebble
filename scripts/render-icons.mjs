#!/usr/bin/env node
/**
 * render-icons.mjs: store icons and the watch launcher icon, drawn from the CI-Common mark.
 *
 *   node scripts/render-icons.mjs        needs `playwright` (any global install) and Chromium
 *
 * Reads vendor/brand only. Tile colours are the canon dark and light backgrounds, never literals.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V = join(ROOT, 'vendor/brand');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const tokens = JSON.parse(readFileSync(join(V, 'tokens/tokens.json'), 'utf8'));
const svg = (f) => readFileSync(join(V, 'logos', f), 'utf8').replace(/<\?xml[^>]*>/, '');
const color = svg('mark-tight.svg');
const mono = svg('mark-mono.svg');

const tile = (size, bg, mark, scale = 0.6, extra = '') => `<!doctype html><body style="margin:0;background:transparent">
  <div style="width:${size}px;height:${size}px;border-radius:${size * 0.22}px;background:${bg};display:grid;place-items:center;${extra}">
    <div style="width:${size * scale}px;height:${size * scale}px">${mark.replace('<svg', '<svg style="width:100%;height:100%;display:block"')}</div>
  </div></body>`;

const out = join(ROOT, 'assets/appstore/icon');
const menu = join(ROOT, 'resources/images');
mkdirSync(out, { recursive: true });
mkdirSync(menu, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
async function shot(html, size, path) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(html);
  await page.screenshot({ path, omitBackground: true });
  await page.close();
  console.log('wrote', path.replace(ROOT + '/', ''));
}

for (const s of [48, 96, 144, 512]) await shot(tile(s, tokens.dark.background.hex, color), s, join(out, `icon-${s}.png`));
// Apple touch icon: full bleed (iOS applies its own rounded mask and paints transparency black).
await shot(tile(180, tokens.dark.background.hex, color, 0.6, 'border-radius:0;'), 180, join(out, 'icon-touch-180.png'));
for (const s of [144, 512]) await shot(tile(s, tokens.light.background.hex, color, 0.6, `box-shadow:inset 0 0 0 ${Math.max(1, s / 96)}px ${tokens.light.border.hex};`), s, join(out, `icon-light-${s}.png`));
// Aplite and Pebble 2 are 1-bit: flat black mark on white, no tile radius tricks.
for (const s of [48, 96]) await shot(tile(s, '#ffffff', mono.replace(/currentColor/g, '#000000'), 0.74, 'border-radius:0;'), s, join(out, `icon-mono-${s}.png`));
// Launcher icon: black mark on transparent, 25x25 (the SDK recolours and dithers it per platform).
await shot(`<!doctype html><body style="margin:0;background:transparent"><div style="width:25px;height:25px">${mono.replace(/currentColor/g, '#000000').replace('<svg', '<svg style="width:100%;height:100%;display:block"')}</div></body>`, 25, join(menu, 'menu-icon.png'));
await browser.close();
