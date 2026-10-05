// Checks the built site in site/ (what Cloudflare Pages serves). No dependencies: `node --test test/`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const read = (p) => readFileSync(join(SITE, p), 'utf8');
const home = read('index.html');
const notFound = read('404.html');

const anchors = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
  href: (m[1].match(/href="([^"]*)"/) || [])[1],
  attrs: m[1],
  text: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
}));
const links = anchors(home);
const to = (href) => links.filter((l) => l.href === href);

test('the header logo and the footer link back to ci.computer', () => {
  const brand = links.filter((l) => /class="brand"/.test(l.attrs));
  assert.equal(brand.length, 2, 'header and footer lockups are links');
  for (const l of brand) {
    assert.equal(l.href, 'https://ci.computer');
    assert.match(l.attrs, /aria-label="Companion Intelligence home"/);
  }
  const footer = home.slice(home.indexOf('<footer'));
  assert.ok(anchors(footer).some((l) => l.href === 'https://ci.computer' && l.text === 'Companion Intelligence'));
});

test('Buy callout: "Buy Companion Core" links to ci.computer/core in the header, hero, needs band and footer', () => {
  const buy = to('https://ci.computer/core');
  assert.ok(buy.length >= 4, `found ${buy.length}`);
  for (const l of buy) assert.equal(l.text, 'Buy Companion Core');
  assert.ok(!links.some((l) => /\/store\/p\/core/.test(l.href || '')), 'use /core exactly as written, not the store path');
  assert.match(home.slice(0, home.indexOf('<main')), /href="https:\/\/ci\.computer\/core"/, 'a Buy button sits in the header');
  assert.match(home.slice(home.indexOf('class="hero"'), home.indexOf('id="need"')), /href="https:\/\/ci\.computer\/core"/, 'and in the hero');
});

test('Download callout: "Download Companion" links to ci.computer/download in the hero, needs band and footer', () => {
  const dl = to('https://ci.computer/download');
  assert.ok(dl.length >= 3, `found ${dl.length}`);
  for (const l of dl) assert.equal(l.text, 'Download Companion');
  assert.match(home.slice(home.indexOf('class="hero"'), home.indexOf('id="need"')), /href="https:\/\/ci\.computer\/download"/);
});

test('Docs links go to the matching docs page; API keys and the privacy policy are linked', () => {
  const docs = 'https://docs.ci.computer/docs/apps-available/first-party-apps/pebble-os';
  assert.ok(to(docs).length >= 3, 'header, hero and footer');
  assert.ok(to(docs + '#roadmap').length === 1, 'the roadmap link goes to the docs page');
  assert.ok(to('https://docs.ci.computer/docs/connect/api-keys').length === 1);
  assert.ok(to('https://ci.computer/privacy-policy').length >= 2);
  assert.ok(to('https://ci.computer/gg').length >= 2, 'Discord, for preview access');
});

test('nothing links into the private CI-Pebble repository', () => {
  assert.ok(!/github\.com\/companionintelligence/i.test(home + notFound), 'the repo is private; a public link is a 404');
});

test('links to ci.computer open in the same tab; any new tab uses rel=noopener', () => {
  for (const l of links) {
    if (/^https:\/\/([a-z]+\.)?ci\.computer/.test(l.href || '')) assert.doesNotMatch(l.attrs, /target=/, l.href);
    if (/target="_blank"/.test(l.attrs)) assert.match(l.attrs, /rel="[^"]*noopener/, l.href);
  }
});

test('the page says it is a developer preview and not yet installable', () => {
  assert.match(home, /Developer preview\.<\/strong> Not yet available to install/);
  assert.doesNotMatch(home, /Ten minutes/i, 'no unsourced timing claim');
  assert.doesNotMatch(home, /Built on Rebble/, 'overstates the Rebble relationship');
  assert.match(home, /<h2>Planned, not in v1\.0\.<\/h2>/);
  assert.doesNotMatch(home, /class="tag">(next|later)</, 'roadmap tags must not read as near-term');
});

test('privacy section separates the app (no analytics) from the website (analytics)', () => {
  assert.match(home, /The app has no analytics and no third party/);
  assert.match(home, /This website, not the app, uses Google Analytics and Cloudflare Web Analytics/);
  assert.doesNotMatch(home, /This app has no analytics/);
});

test('every local asset the pages reference exists', () => {
  for (const [name, html] of [['index.html', home], ['404.html', notFound]]) {
    for (const m of html.matchAll(/(?:href|src)="([^"#?]+)"/g)) {
      const ref = m[1];
      if (/^(https?:|mailto:|data:)/.test(ref)) continue;
      const path = ref.startsWith('/') ? ref.slice(1) : ref;
      assert.ok(existsSync(join(SITE, path)), `${name} references ${ref}`);
    }
  }
});

test('metadata: canonical, social image, icons, a theme-color per scheme, manifest', () => {
  assert.match(home, /<link rel="canonical" href="https:\/\/pebble\.ci\.computer\/">/);
  assert.match(home, /<meta property="og:image" content="https:\/\/pebble\.ci\.computer\/assets\/og-image\.png">/);
  assert.match(home, /<meta name="theme-color" content="#f3faf7" media="\(prefers-color-scheme: light\)">/);
  assert.match(home, /<meta name="theme-color" content="#041620" media="\(prefers-color-scheme: dark\)">/);
  assert.match(home, /rel="icon" href="assets\/icon-48\.png" type="image\/png" sizes="48x48"/);
  assert.match(home, /rel="apple-touch-icon" href="assets\/apple-touch-icon\.png" sizes="180x180"/);
  assert.match(home, /rel="preload" href="assets\/brand\/manrope\.woff2" as="font" type="font\/woff2" crossorigin/);
  const manifest = JSON.parse(read('site.webmanifest'));
  assert.equal(manifest.name, 'Companion Memory for Pebble');
  for (const icon of manifest.icons) assert.ok(existsSync(join(SITE, icon.src.slice(1))), icon.src);
  assert.match(notFound, /<meta name="robots" content="noindex">/);
  assert.match(notFound, /rel="apple-touch-icon"/);
});

test('JSON-LD parses, has a complete Organization with a PNG logo, and invents no offer or rating', () => {
  const m = home.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  const graph = JSON.parse(m[1])['@graph'];
  const org = graph.find((n) => n['@type'] === 'Organization');
  const app = graph.find((n) => n['@type'] === 'SoftwareApplication');
  assert.equal(org['@id'], 'https://ci.computer/#organization');
  assert.equal(org.url, 'https://ci.computer');
  assert.match(org.logo.url, /\.png$/);
  assert.ok(existsSync(join(SITE, org.logo.url.replace('https://pebble.ci.computer/', ''))));
  assert.equal(app.softwareVersion, '1.0');
  assert.deepEqual(app.publisher, { '@id': org['@id'] });
  assert.ok(!('offers' in app) && !('aggregateRating' in app));
});

test('404 page links back to ci.computer and to the home page', () => {
  const l = anchors(notFound);
  assert.ok(l.some((a) => a.href === 'https://ci.computer' && /ci\.computer/.test(a.text)));
  assert.ok(l.some((a) => a.href === '/'));
  assert.match(notFound, /prefers-color-scheme/, 'follows the system theme like the home page');
});

test('sitemap and robots agree with the canonical URL', () => {
  const sitemap = read('sitemap.xml');
  assert.match(sitemap, /<loc>https:\/\/pebble\.ci\.computer\/<\/loc>/);
  const lastmod = sitemap.match(/<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/)[1];
  assert.ok(!Number.isNaN(Date.parse(lastmod)));
  assert.match(read('robots.txt'), /Sitemap: https:\/\/pebble\.ci\.computer\/sitemap\.xml/);
});

test('_headers: a CSP that still lets Google Analytics and Cloudflare analytics work, and no framing', () => {
  const headers = read('_headers');
  const csp = headers.match(/Content-Security-Policy: (.+)/)[1];
  for (const needle of ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://static.cloudflareinsights.com', 'https://cloudflareinsights.com']) {
    assert.ok(csp.includes(needle), needle);
  }
  // Hosts the production GA4 stream really beacons to (seen as CSP errors in the live console).
  const connect = csp.match(/connect-src ([^;]+)/)[1].split(' ');
  for (const host of ['https://analytics.google.com', 'https://stats.g.doubleclick.net', 'https://www.google.com']) {
    assert.ok(connect.includes(host), `connect-src allows ${host}`);
  }
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /Permissions-Policy: /);
});

test('deploy notes are not published with the site', () => {
  assert.ok(!existsSync(join(SITE, 'README.md')));
  assert.ok(existsSync(join(ROOT, 'docs/site-deploy.md')));
});

test('accessibility and layout guards in the page source', () => {
  assert.match(home, /<a class="skip" href="#top">/);
  assert.match(home, /<nav aria-label="Primary">/);
  assert.match(home, /<nav aria-label="Footer">/);
  assert.match(home, /<button class="theme" id="theme" type="button" aria-pressed="false">/);
  assert.match(home, /<ol class="steps" role="list">/);
  assert.equal((home.match(/<pre tabindex="0" role="region" aria-label="[^"]+">/g) || []).length, 2, 'scrollable code is keyboard reachable');
  assert.match(home, /role="group" aria-label="The app running on a Pebble Time and a Pebble Time Round"/);
  assert.match(home, /<figcaption>Pebble Time Round<\/figcaption>/);
  assert.match(home, /ol\.steps \{[^}]*grid-template-columns: minmax\(0, 1fr\)/, 'a wide <pre> must not widen the grid on phones');
  assert.match(home, /ol\.steps li \{ min-width: 0;/);
  assert.match(home, /var\(--ci-button-foreground, var\(--teal-50\)\)/, 'primary button label stays light even though tokens.css lacks --ci-button-foreground');
  for (const m of home.matchAll(/<img\b[^>]*>/g)) assert.match(m[0], /width="\d+" height="\d+"/, 'images reserve their space');
});

test('no em or en dashes in the page source', () => {
  for (const f of ['site-src/index.template.html', 'site/404.html']) {
    assert.doesNotMatch(readFileSync(join(ROOT, f), 'utf8'), /[–—]/, f);
  }
});

test('inline scripts are Rocket Loader proof (data-cfasync="false")', () => {
  assert.ok(home.indexOf('<script data-cfasync="false">') < home.indexOf('<style>'), 'theme script runs before first paint');
  assert.equal((home.match(/<script>/g) || []).length, 0, 'no inline script is left for Rocket Loader to defer');
});

test('inject-ga: tags carry data-cfasync, are idempotent, and the committed site stays ID-free', () => {
  assert.doesNotMatch(home + notFound, /googletagmanager\.com\/gtag/);
  const dir = mkdtempSync(join(tmpdir(), 'pebble-ga-'));
  try {
    cpSync(SITE, dir, { recursive: true });
    const run = (id) => execFileSync('node', [join(ROOT, 'scripts/inject-ga.mjs'), dir], { env: { ...process.env, GA_MEASUREMENT_ID: id }, encoding: 'utf8' });
    assert.match(run('not-an-id'), /nothing to do/);
    assert.doesNotMatch(readFileSync(join(dir, 'index.html'), 'utf8'), /gtag/);
    assert.match(run('G-TEST1234'), /injected into 2 file/);
    assert.match(run('G-TEST1234'), /injected into 0 file/);
    for (const f of ['index.html', '404.html']) {
      const html = readFileSync(join(dir, f), 'utf8');
      assert.equal(html.split('googletagmanager.com/gtag/js').length - 1, 1, `${f}: exactly one snippet after two runs`);
      assert.match(html, /<script async data-cfasync="false" src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-TEST1234">/);
      assert.match(html, /<script data-cfasync="false">\nwindow\.dataLayer/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
