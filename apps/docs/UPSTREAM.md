# Upstream source

This template adapts the static empty starter from [Cloudflare Nimbus](https://github.com/cloudflare/nimbus), released under the MIT license (see `LICENSE`).

- Starter tag: `templates-v0.7.9`
- Starter commit: `aae348048a8c659f84c39696ee6b20c2ad2f5ae2`
- Nimbus package: `@cloudflare/nimbus-docs@0.17.0` (reviewed 2026-10-09)
- Astro: `7.3.8`

Nimbus declares Astro `>=7.2.6 <8`; Astro requires Node `>=22.12.0`, so this workspace retains the repository baseline `^22.22.1 || >=24.11.0`. Builds, Astro diagnostics and TypeScript checks use the repository's TypeScript `6.0.3` and Vite `8.3.4` constraints. Resolved dependencies are recorded in the monorepo's root `pnpm-lock.yaml`; generated projects use their own root workspace lockfile.

Agent endpoint routes and the content-loading approach come from that starter. The bilingual layout, navigation, search interface, examples and workspace checks are repoctl adaptations. These files are maintained locally; generating a project never downloads the upstream starter.

The local head component emits page-specific language metadata because the upstream head uses the site-wide locale. Client scripts are emitted as external assets so Astro does not inline them before Vite finalizes Pagefind's dynamic import.

The package version and starter tag were checked against published package metadata. `nimbus.json` records the reviewed package API baseline. The original full starter was not copied wholesale, so upstream starter diffs are not a claim that every local file is an unmodified upstream component.

## Nimbus 0.17.0 API review

The production site is static and its only collection uses `docsCollection()`.
The page-helper migration therefore preserves all English and Chinese pages.
There are no API collections, query-addressed API versions, or copied API layout
components; the API sample, catalog, version-id and version-switcher reviews do
not require project edits.

Neither `public/` nor `src/pages/` owns the new `/.well-known/ard.json` and
`/.well-known/ai-catalog.json` routes. Nimbus may generate them for the public
documentation. The production output must retain the project-owned `_headers`
security and caching rules alongside the generated discovery headers. There is
no `skills/` directory in this workspace to publish on upgrade.

The existing robots policy and locally maintained layout, sidebar and Pagefind
integration are retained. Optional Content Signals, WebMCP search, request
rendering, API query versions and starter component replacements are not adopted
as part of this dependency update. The reviewed baseline was advanced using
`nimbus-docs migrate --yes --json` after checking these migration requirements.

## Local documentation UI

The homepage, five-group bilingual navigation, article layout, theme selector,
search dialog and progressive enhancement are maintained by this project.
Navigation comes from `src/lib/navigation.ts`; Nimbus still owns content loading,
static routes, Markdown conversion, AI discovery and the production Pagefind index.
Static SVG icons come from `@phosphor-icons/core@2.1.1`. Authored components and
styles should be reviewed separately from future Nimbus starter migrations.
