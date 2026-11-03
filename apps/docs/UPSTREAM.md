# Upstream source

This template adapts the static empty starter from [Cloudflare Nimbus](https://github.com/cloudflare/nimbus), released under the MIT license (see `LICENSE`).

- Starter tag: `templates-v0.7.9`
- Starter commit: `aae348048a8c659f84c39696ee6b20c2ad2f5ae2`
- Nimbus package: `@cloudflare/nimbus-docs@0.19.2` (reviewed 2026-11-03)
- Astro: `7.4.5`

Nimbus declares Astro `>=7.2.6 <8`; the private documentation workspace follows the upgraded toolchain range `^22.23.4 || ^24.22.1 || >=26.12.1`. Published weapp-stylex libraries retain the separate `^22.22.1 || >=24.11.0` consumer floor. Builds, Astro diagnostics and TypeScript checks use the repository's TypeScript `6.0.3` and scoped Vite `8.3.5` constraint, which satisfies Astro 7.4.5's `^8.3.5` requirement. Resolved dependencies are recorded in the monorepo's root `pnpm-lock.yaml`; generated projects use their own root workspace lockfile.

Agent endpoint routes and the content-loading approach come from that starter. The bilingual layout, navigation, search interface, examples and workspace checks are repoctl adaptations. These files are maintained locally; generating a project never downloads the upstream starter.

The local head component emits page-specific language metadata because the upstream head uses the site-wide locale. Client scripts are emitted as external assets so Astro does not inline them before Vite finalizes Pagefind's dynamic import.

The package version and starter tag were checked against published package metadata. `nimbus.json` records the reviewed package API baseline. The original full starter was not copied wholesale, so upstream starter diffs are not a claim that every local file is an unmodified upstream component.

## Nimbus 0.19.2 API review

The installed 0.19.2 CLI's official `nimbus-docs migrate --dry-run --json`
reported no source migrations or errors from 0.18.1, and listed 18 review
entries. Its initial blocked status and exit code 1 indicate that the reviews
had not yet been acknowledged. The review-required `changelog-release-notes`
entry explicitly permits sites without the changelog recipe to skip it; this
site has no changelog collection or recipe routes. After reviewing every entry,
`nimbus-docs migrate --yes --json` recorded 0.19.2 and changed only `nimbus.json`.
The dry-run and application logs are retained as `docs-migrate-*.log` under
`artifacts/dependency-upgrade/`.

The project-owned bilingual UI, whole-site Pagefind provider, static rendering,
top-level section indexes and Markdown/MDX endpoints remain in use. The site
owns its deployment domains, so agent discovery remains enabled. There are no
API collections, remote MCP server, partial builds, Nimbus changelog, generated
OG-card routes or copied starter sidebar components to migrate. The optional
starter redesign, share cards and other new features were reviewed without
adopting them. `ApiFieldView.anchor` and
`AgentApiPublication.markdownUrl` becoming optional do not affect local code,
which consumes neither API type.

`nimbus-docs check --json` reports no findings, errors or warnings and resolves
the docs collection to `/`. It reports partial static readiness because the
deployment-specific `site` value is computed; the production build validates
that value. On Node 26.13.0 and pnpm 12.16.1, the production build, Astro and
TypeScript diagnostics, 16 documentation tests, and Nimbus lint passed.
`check:site` verified 58 pages, 294 source anchors, 142 custom component usages,
both navigation surfaces, metadata, Markdown/MDX, AI indexes and search assets.
Its API check covered 13 public entries and 85 exports in both locales. These
checks retain the original assertions; browser interaction acceptance is
recorded separately. Validation logs are retained as `docs-*.log` under
`artifacts/dependency-upgrade/`.

## Nimbus 0.18.1 API review

The official `nimbus-docs migrate --dry-run --json` reported no migrations,
optional reviews or errors from 0.18.0 to 0.18.1. After that review,
`nimbus-docs migrate --yes --json` advanced the recorded baseline to 0.18.1
without source changes. Project-owned layouts, navigation, components and
static agent endpoint routes retain the decisions below. Migration diagnostics
are retained in `artifacts/dependency-upgrade-2026-10-15/`.

## Nimbus 0.18.0 API review

The official `nimbus-docs migrate --dry-run --json` reported no required source
migrations from 0.17.0 to 0.18.0. Its eight optional reviews cover image zoom,
Markdown features, math rendering, nested llms scopes, page-action search
excerpts, the 404 head, starter component fixes and the version switcher.
After reviewing those items, `nimbus-docs migrate --yes --json` advanced the
recorded baseline to 0.18.0 without changing source files.

The production site remains static and its only collection uses
`docsCollection()`. It has no API collections or docs version switcher. The
project-owned layout and components are retained rather than replaced by starter
copies. The local 404 already emits `noindex`; search buttons explicitly use
`type="button"`. Browser interaction is validated separately from the migration.

No optional features were adopted. In particular, the existing
`src/pages/[section]/llms.txt.ts` continues to serve top-level section indexes;
it is not combined with the optional `[...section]` route. Markdown processor
features and math settings are unchanged. There are no Nimbus-specific Sätteri
overrides or patches to remove.

Nimbus continues to generate `/.well-known/ard.json`,
`/.well-known/ai-catalog.json`, Markdown and Pagefind output. Production checks
must retain the project-owned `_headers` security and caching rules and the
stable robots policy. Preview builds add channel-specific noindex and crawler directives while retaining Pagefind search. There is no workspace `skills/` directory to publish.

## Local documentation UI

The homepage, five-group bilingual navigation, article layout, theme selector,
search dialog and progressive enhancement are maintained by this project.
Navigation comes from `src/lib/navigation.ts`; Nimbus still owns content loading,
static routes, Markdown conversion, AI discovery and the production Pagefind index.
Static SVG icons come from `@phosphor-icons/core@2.1.1`. Authored components and
styles should be reviewed separately from future Nimbus starter migrations.

## repoctl deployment integration

The workspace uses repoctl `6.3.2` for managed asset upgrades and the `stylex`
documentation site registration. This does not change the original starter
provenance or advance the Nimbus migration baseline. Main snapshots target
`preview.stylex.weapp.dev`; complete stable release records target
`stylex.weapp.dev`. Both channels keep Nimbus/Astro static output and the local
UI. Deployment origins and indexing rules are build inputs, so metadata,
Markdown/AI discovery and static checks use the selected channel consistently.
