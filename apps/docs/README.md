# weapp-stylex documentation

Primary domain: [stylex.weapp.dev](https://stylex.weapp.dev/), which uses the device's time zone to infer region: Chinese for China time zones, English otherwise. A saved manual language choice takes priority. [中文](https://stylex.weapp.dev/zh/) / [English](https://stylex.weapp.dev/en/).

The original scaffold used `corepack pnpm exec repo new docs --template nimbus`, repoctl 5.9.0 and template 2.3.1. The workspace now declares repoctl 5.10.0 and uses Nimbus 0.17.0, Astro 7.3.8 and Pagefind 1.5.2. Keep `nimbus.json` and `UPSTREAM.md` for future upgrades.

English content is in `src/content/docs/`; Chinese translations have identical relative filenames under `zh/`. The 29 page pairs include existing guides, `api/`, `recipes/` and troubleshooting. The English homepage uses `slug: en`; existing guide URLs stay unchanged. `/` serves a client language selector. The client applies saved manual choice → device time zone → first browser language if the time zone is unavailable, then uses `location.replace` while preserving the query and fragment. China time zones include `Asia/Shanghai`, `Asia/Urumqi` and their IANA aliases. Other valid zones, including UTC, use English; UTC offsets alone cannot identify a region. Time zone reflects device settings, not verified physical location. No IP lookup, geolocation permission, or Worker script is needed. Development and static previews use the same code. Explicit document routes are never redirected. Without JavaScript, both language links remain usable.

The directory tree determines routes. `src/lib/navigation.ts` defines the shared bilingual groups, page order, breadcrumbs and previous/next links, and feeds desktop/mobile navigation. Add each new published page to that module and both language trees. The home and documentation layouts are separate; layouts, components, search and styles are project-owned. Theme, tabs, search and mobile navigation enhance usable static content rather than supplying otherwise missing article text.

Register MDX components in `src/components.ts` together with a `markdown.componentMap` converter in `astro.config.ts`. Current components are Aside, ApiTable, Tabs/Tab, Steps/Step and HomeHero/CardGrid/LinkCard. Keep visible captions, tab labels, step headings, table cells, code examples and card destinations available in readable Markdown and AI exports. Raw MDX exports preserve the authored component markup.

```sh
corepack pnpm --filter docs dev
corepack pnpm --filter docs lint
corepack pnpm --filter docs typecheck
corepack pnpm --filter docs build
corepack pnpm --filter docs check:api
corepack pnpm --filter docs check:site
corepack pnpm --filter docs test
corepack pnpm --filter docs preview
```

Build the public packages from the monorepo root before `check:api` or `check:site`; API coverage resolves their generated ESM/CJS declarations. `check:api` maps public exports and members to actual sections in both languages. `check:site` runs that API check and verifies published source routes, both navigation surfaces, source edit links, canonical/alternate URLs, language switching, local links, unique IDs and source anchors. It checks the complete raw MDX body and readable Markdown/AI content, including custom components, and follows section AI indexes to every page. `check:locales` checks matching source filenames.

Search requires a production build. Check Pagefind search, keyboard focus, code copying, theme selection, language switching and mobile navigation on a production preview; static artifact checks do not establish these interactions. The documentation tests cover language preference and shared navigation. Preserve each framework/IDE acceptance record's date and scope rather than treating an old or partial run as current acceptance.

Nimbus authoring lint also needs the resolved rules and route manifest. `lint:docs` builds the site first so `lint` works in a clean checkout and always checks the current configuration.

Cloudflare Workers Static Assets hosts `dist/` with a custom domain declared in `wrangler.jsonc`. This is a pure static deployment with no Worker script or per-request language handler. All visitors receive the same entry HTML; only the browser selects the destination. Use `deploy:dry-run` to inspect and `deploy` to build and upload. Authenticate with Wrangler locally; never commit credentials. See the [deployment runbook](../../docs/site-deployment.md).
