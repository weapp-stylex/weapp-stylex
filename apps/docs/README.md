# weapp-stylex documentation

Primary domain: [stylex.weapp.dev](https://stylex.weapp.dev/), which uses the device's time zone to infer region: Chinese for China time zones, English otherwise. A saved manual language choice takes priority. [中文](https://stylex.weapp.dev/zh/) / [English](https://stylex.weapp.dev/en/).

Created with `corepack pnpm exec repo new docs --template nimbus` using repoctl 5.9.0 and template 2.3.1. This workspace uses Nimbus 0.17.0, Astro 7.3.8 and Pagefind 1.5.2. Keep `nimbus.json` and `UPSTREAM.md` for future upgrades.

English content is in `src/content/docs/`; Chinese translations have identical relative filenames under `zh/`. The English homepage uses `slug: en`; other English guides retain their root-level routes. `/` serves a client language selector. The client applies saved manual choice → device time zone → first browser language if the time zone is unavailable, then uses `location.replace` while preserving the query and fragment. China time zones include `Asia/Shanghai`, `Asia/Urumqi` and their IANA aliases. Other valid zones, including UTC, use English; UTC offsets alone cannot identify a region. Time zone reflects device settings, not verified physical location. No IP lookup, geolocation permission, or Worker script is needed. Development and static previews use the same code. Explicit document routes are never redirected. Without JavaScript, both language links remain usable. The framework and compiler contracts are documented in both languages. The layout, components and styles are project-owned.

```sh
corepack pnpm --filter docs dev
corepack pnpm --filter docs lint
corepack pnpm --filter docs typecheck
corepack pnpm --filter docs build
corepack pnpm --filter docs check:site
corepack pnpm --filter docs test
corepack pnpm --filter docs preview
```

Search requires the production build. `check:site` verifies language metadata, canonical/alternate URLs, local links and anchors, Markdown exports and AI/search assets.

Nimbus authoring lint also needs the resolved rules and route manifest. `lint:docs` builds the site first so `lint` works in a clean checkout and always checks the current configuration.

Cloudflare Workers Static Assets hosts `dist/` with a custom domain declared in `wrangler.jsonc`. This is a pure static deployment with no Worker script or per-request language handler. All visitors receive the same entry HTML; only the browser selects the destination. Use `deploy:dry-run` to inspect and `deploy` to build and upload. Authenticate with Wrangler locally; never commit credentials. See the [deployment runbook](../../docs/site-deployment.md).
