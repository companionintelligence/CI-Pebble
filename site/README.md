# pebble.ci.computer

Static landing/setup page for Companion Pebble, meant to be deployed to
Cloudflare Pages at `pebble.ci.computer`. It's plain HTML — no build step,
no framework, no dependency on anything else in this repo.

## What's here

- `index.html` — the whole site. Self-contained (inline CSS, no external
  requests), so it works as a Cloudflare Pages "direct upload" project.
- `../wrangler.toml` (repo root) — points `wrangler pages deploy` at this
  directory.
- `../.github/workflows/deploy-pebble-site.yml` — deploys this directory
  to Cloudflare Pages on every push to `main` that touches `site/**`.

## Why this isn't deployed yet

Deploying and wiring up the domain needs a Cloudflare account and DNS
control over `ci.computer` — neither of which this session had credentials
for. What's shipped here is the deployable artifact and the CI to deploy
it; someone with Cloudflare access needs to do the one-time setup below.

## One-time setup (needs a Cloudflare account owner)

1. **Create the Pages project**, once, from the Cloudflare dashboard or CLI:
   ```bash
   npx wrangler pages project create ci-pebble
   ```
2. **Add two GitHub Actions secrets** on this repo
   (`companionintelligence/CI-Pebble` → Settings → Secrets and variables →
   Actions):
   - `CLOUDFLARE_API_TOKEN` — create one at
     <https://dash.cloudflare.com/profile/api-tokens> scoped to
     `Cloudflare Pages:Edit` for the target account.
   - `CLOUDFLARE_ACCOUNT_ID` — found on the right sidebar of any zone
     overview page in the Cloudflare dashboard.
3. **Push to `main`** (or run the workflow manually via
   Actions → Deploy pebble.ci.computer → Run workflow). That publishes
   `site/` to the `ci-pebble` Pages project.
4. **Attach the custom domain**: in the Cloudflare dashboard, open the
   `ci-pebble` Pages project → Custom domains → add `pebble.ci.computer`.
   Cloudflare will create the DNS record automatically since `ci.computer`
   is already on Cloudflare.

## Manual deploy (no GitHub Actions)

```bash
cd CI-Pebble
npx wrangler pages deploy site --project-name=ci-pebble
```

Requires `wrangler login` (or `CLOUDFLARE_API_TOKEN` in the environment)
first.
