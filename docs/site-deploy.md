# Deploying pebble.ci.computer

The site is a static page on Cloudflare Pages (direct upload, project `ci-pebble`, output directory
`site/`, see `wrangler.toml`). This file is deliberately not inside `site/`, so it is never published.

## How the page is built

`site/` is committed, and most of it is generated. Edit the sources, then run `npm run brand:sync`:

| You change | What gets regenerated |
|---|---|
| `site-src/index.template.html` (copy tokens like `{{products.memory.name}}` are filled from `vendor/brand/copy.json`) | `site/index.html` |
| `vendor/brand/` (a new pinned CI-Common bundle, see `scripts/vendor-brand.sh`) | `site/assets/brand/*`, `site/site.webmanifest` |
| `assets/appstore/icon/*.png` (drawn by `scripts/render-icons.mjs`) | `site/assets/icon-48.png`, `icon-512.png`, `apple-touch-icon.png` |

`npm run brand:check` fails if anything under `site/` drifted from its source, and CI runs it on every PR.
`npm test` also checks the built page: the links back to ci.computer, the Buy and Download callouts, the docs
link, the JSON-LD, the CSP and the sitemap.

Hand-edited files in `site/`: `404.html`, `robots.txt`, `sitemap.xml` (bump `<lastmod>` when the page content
changes), `_headers` (security headers and the CSP) and `_redirects`. `assets/og-image.png` and
`assets/screens/` are committed images.

## What happens on deploy

`.github/workflows/deploy-pebble-site.yml` runs on every push to `main` that touches `site/**`, on the injector,
`wrangler.toml` or the workflow itself, and on manual dispatch. It runs the tests and the brand check first,
then:

1. `node scripts/inject-ga.mjs site` adds Google Analytics 4 to every HTML file's `<head>`. It reads the repo
   variable `GA_MEASUREMENT_ID` and does nothing if it is unset or not a `G-XXXX` ID, so the committed HTML never
   carries an ID. It is idempotent, and both tags carry `data-cfasync="false"` so Rocket Loader leaves them alone.
2. `wrangler pages deploy site --project-name=ci-pebble` uploads the result.

**Changing `GA_MEASUREMENT_ID` does not redeploy.** After `gh variable set GA_MEASUREMENT_ID --body G-XXXX
--repo companionintelligence/CI-Pebble`, run the workflow by hand (Actions, Deploy pebble.ci.computer, Run
workflow, or `gh workflow run deploy-pebble-site.yml`).

## One-time setup (needs a Cloudflare account owner)

1. Create the Pages project: `npx wrangler pages project create ci-pebble`.
2. Add two repo secrets (Settings, Secrets and variables, Actions):
   - `CLOUDFLARE_API_TOKEN`, scoped to `Cloudflare Pages:Edit` for the account.
   - `CLOUDFLARE_ACCOUNT_ID`, the account that owns the `ci-pebble` project and the `ci.computer` zone.
3. Attach the custom domain: Pages project `ci-pebble`, Custom domains, add `pebble.ci.computer`. DNS is created
   automatically because `ci.computer` is on Cloudflare.

## Manual deploy

```bash
npm run brand:sync && npm test
GA_MEASUREMENT_ID=G-XXXX node scripts/inject-ga.mjs site   # optional; edits site/ in place, do not commit it
npx wrangler pages deploy site --project-name=ci-pebble
```

## Zone settings this repo cannot set

These live in the Cloudflare dashboard for the `ci.computer` zone and affect every subdomain:

- **HSTS** (SSL/TLS, Edge Certificates). `site/_headers` does not set it, on purpose.
- **Rocket Loader** (Speed, Optimization). The page has only a few tiny scripts, so it can be turned off. If it
  stays on, the inline scripts here are marked `data-cfasync="false"` so the theme script still runs before paint.
- **Web Analytics auto-injection.** Cloudflare adds its beacon at the zone, which is why the CSP allows
  `static.cloudflareinsights.com` and why the page's privacy section names it.
