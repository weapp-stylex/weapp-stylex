# weapp-stylex documentation

Primary domain: [stylex.weapp.dev](https://stylex.weapp.dev/). [中文](https://stylex.weapp.dev/zh/) / [English](https://stylex.weapp.dev/).

Created with `corepack pnpm exec repo new docs --template nimbus` using repoctl 5.9.0 and template 2.3.1. This workspace uses Nimbus 0.16.0, Astro 7.3.7 and Pagefind 1.5.2. Keep `nimbus.json` and `UPSTREAM.md` for future upgrades.

English content is in `src/content/docs/`; Chinese translations have identical relative filenames under `zh/`. The framework and compiler contracts are documented in both languages. The layout, components and styles are project-owned.

```sh
corepack pnpm --filter docs dev
corepack pnpm --filter docs lint
corepack pnpm --filter docs typecheck
corepack pnpm --filter docs build
corepack pnpm --filter docs check:site
corepack pnpm --filter docs preview
```

Search requires the production build. `check:site` verifies language metadata, canonical/alternate URLs, local links and anchors, Markdown exports and AI/search assets.

Cloudflare Workers Static Assets hosts `dist/` with a custom domain declared in `wrangler.jsonc`. Use `deploy:dry-run` to inspect and `deploy` to build and upload. Authenticate with Wrangler locally; never commit credentials. See the [deployment runbook](../../docs/site-deployment.md).
