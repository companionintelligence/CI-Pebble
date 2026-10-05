#!/usr/bin/env node
/**
 * inject-ga.mjs: injects the Google Analytics 4 (gtag.js) snippet into the
 * <head> of every HTML file under a directory (default: site/).
 *
 *   GA_MEASUREMENT_ID=G-XXXX node scripts/inject-ga.mjs [dir]
 *
 * No-op unless GA_MEASUREMENT_ID matches /^G-[A-Z0-9]+$/, so the committed HTML
 * stays ID-free. Idempotent: files already carrying the snippet are skipped.
 * Both tags carry data-cfasync="false" so Cloudflare Rocket Loader leaves them alone
 * (it would otherwise defer them past first paint). Node built-ins only.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const id = (process.env.GA_MEASUREMENT_ID || '').trim();
if (!/^G-[A-Z0-9]+$/.test(id)) {
  console.log('inject-ga: GA_MEASUREMENT_ID unset or invalid, nothing to do');
  process.exit(0);
}

const MARK = 'googletagmanager.com/gtag/js';
const snippet =
  `<script async data-cfasync="false" src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>\n` +
  `<script data-cfasync="false">\n` +
  `window.dataLayer = window.dataLayer || [];\n` +
  `function gtag(){dataLayer.push(arguments);}\n` +
  `gtag('js', new Date());\n` +
  `gtag('config', '${id}');\n` +
  `</script>\n`;

function* htmlFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* htmlFiles(p);
    else if (/\.html?$/i.test(e.name)) yield p;
  }
}

let changed = 0;
for (const f of htmlFiles(process.argv[2] || 'site')) {
  const src = readFileSync(f, 'utf8');
  if (src.includes(MARK) || !/<\/head>/i.test(src)) continue;
  writeFileSync(f, src.replace(/<\/head>/i, () => snippet + '</head>'));
  changed++;
}
console.log(`inject-ga: ${id} injected into ${changed} file(s)`);
