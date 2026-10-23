# Upstream source

This template adapts the static empty starter from [Cloudflare Nimbus](https://github.com/cloudflare/nimbus), released under the MIT license (see `LICENSE`).

- Starter tag: `templates-v0.7.9`
- Starter commit: `aae348048a8c659f84c39696ee6b20c2ad2f5ae2`
- Nimbus package: `@cloudflare/nimbus-docs@0.18.0` (reviewed 2026-10-13)
- Astro: `7.3.8`

Nimbus declares Astro `>=7.2.6 <8`; the private documentation workspace follows the upgraded toolchain range `^22.23.4 || ^24.22.1 || >=26.12.1`. Published weapp-stylex libraries retain the separate `^22.22.1 || >=24.11.0` consumer floor. Builds, Astro diagnostics and TypeScript checks use the repository's TypeScript `6.0.3` and Vite `8.3.4` constraints. Resolved dependencies are recorded in the monorepo's root `pnpm-lock.yaml`; generated projects use their own root workspace lockfile.

Agent endpoint routes and the content-loading approach come from that starter. The bilingual layout, navigation, search interface, examples and workspace checks are repoctl adaptations. These files are maintained locally; generating a project never downloads the upstream starter.

The local head component emits page-specific language metadata because the upstream head uses the site-wide locale. Client scripts are emitted as external assets so Astro does not inline them before Vite finalizes Pagefind's dynamic import.

The package version and starter tag were checked against published package metadata. `nimbus.json` records the reviewed package API baseline. The original full starter was not copied wholesale, so upstream starter diffs are not a claim that every local file is an unmodified upstream component.

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

The workspace uses repoctl `6.0.1` for managed asset upgrades and the `stylex`
documentation site registration. This does not change the original starter
provenance or advance the Nimbus migration baseline. Main snapshots target
`preview.stylex.weapp.dev`; complete stable release records target
`stylex.weapp.dev`. Both channels keep Nimbus/Astro static output and the local
UI. Deployment origins and indexing rules are build inputs, so metadata,
Markdown/AI discovery and static checks use the selected channel consistently.
