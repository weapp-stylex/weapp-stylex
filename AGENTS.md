# weapp-stylex

## Create packages and apps

```bash
pnpm exec repo templates
pnpm exec repo new <name> --template <key>
```

| Intent                   | Template key  |
| ------------------------ | ------------- |
| Vue / full-stack web app | `vue-hono`    |
| API / Hono service       | `hono-server` |
| TypeScript library / SDK | `tsdown`      |
| Vue component library    | `vue-lib`     |
| Documentation site       | `vitepress`   |
| CLI                      | `cli`         |

Preview without writing files: `pnpm exec repo new <name> --template <key> --dry-run`.

## Create a new project

If the user asks you to create a new business project, do not add it inside an
existing unrelated repository. Use a new or empty directory outside the repoctl
source checkout. Start a new workspace with:

```bash
pnpm create repoctl@latest <dir> -- --yes --templates <keys>
cd <dir>
corepack enable
pnpm install
pnpm exec repo init
pnpm exec repo doctor
```

## Verify

```bash
pnpm exec repo doctor
pnpm exec repo check
```

## Do not

- Do not add packages by copying folders. Use `repo new`.
- Do not hand-edit managed root configs that `repo init` / `repo upgrade` own.
- Do not invent publish versions by hand. Use `pnpm change` for publishable packages.

## Requirements

- Private workspace/docs Node.js `^22.23.4 || ^24.22.1 || >=26.12.1`
  (CI: 22.23.4 and 24.22.1). Published libraries retain
  `^22.22.1 || >=24.11.0`; verify isolated consumers on Node 22.22.1 and 24.11.0.
- repoctl is pinned to `6.0.1`; pnpm is pinned to `12.11.2` (run `corepack enable` so the declared workspace version is used)
- CLI output is English by default; `--lang zh-CN` or `REPOCTL_LANG=zh-CN` selects Simplified Chinese

## Git hooks

Lefthook reads `lefthook.yml`. Keep pre-commit jobs sequential: ESLint fixes, Stylelint fixes (including Vue style blocks), then one `repo verify staged-typecheck` call. Use `stage_fixed: true` for fixes and `glob_matcher: doublestar` for root and nested files. Do not call `repo verify pre-commit` from inside the Lefthook configuration.

## Scope

This workspace adapts official StyleX to WeChat, Alipay, Douyin and H5: native
Page/Component, Wevu, Taro React/Vue 3 (Vite and Webpack 5), and uni-app Vue 3.
The shared `@weapp-stylex/compiler` owns transformation, module metadata,
resolver identities, SFC maps and platform stylesheet planning. Keep adapters thin.
The public `weapp-stylex` facade exposes runtime APIs at the root and adapters
through explicit subpaths. Keep build tools out of the root runtime entry;
framework host peers remain optional but retain their supported version ranges.
The private root workspace is named `weapp-stylex-workspace`.

## Development

- Use `corepack pnpm` with the declared package manager version.
- Run `corepack pnpm install --frozen-lockfile` before verification.
- Run `corepack pnpm lint`, `build`, `typecheck`, `test`, `test:deps`,
  `test:integration`, and `test:examples` from the root.
- `build` produces 28 artifacts: seven per target (WeChat, Alipay, Douyin, H5). Taro's two builders run in sequence
  into separate directories. CI tests Node 22.23.4 and 24.22.1.
- All six publishable libraries use tsdown. Core and weapp-vite remain ESM-only;
  compiler, Taro, uni-app and the facade retain ESM/CJS and declarations.
  Keep runtime and build-tool entries separate and verify their declared formats in isolated consumers.
- `test:examples` checks all artifacts and runs native/Wevu headless interactions.
- `test:h5` validates seven production and development browser artifacts headlessly.
  Static rpx follows each host policy; numeric/px values remain px and dynamic values
  use browser-standard units. Do not enable official runtime CSS injection.
- `test:ide` filters the matrix to WeChat and is a globally serial suite. Supply a real `WEAPP_STYLEX_APPID` and
  explicit `WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH`. Check the official stable version,
  login and service port. Use one automator per artifact, `reLaunch` between
  routes, structure assertions before screenshots, and close only owned
  project resources. Missing prerequisites are pending acceptance, not a pass.

## Compiler and framework contract

- Keep official StyleX runtime/compiler semantics. Ordinary style modules may
  export compiled objects through named/default exports and barrels. Consumers
  merge them using official `attrs()` or `props()`.
- Cross-module variables use directly imported `tokens.stylex.ts`; resolve via
  the host and canonicalize physical module identities before hashing.
- Preserve StyleX units: numeric 16 is 16px; write '16rpx' explicitly.
- Disable layers, specificity polyfills and runtime CSS injection. Rewrite
  default :root variable selectors to page only for mini-programs; retain :root on
  H5 and host-specific Shadow DOM inheritance, retaining theme classes.
- Native WXML binds attrs class/style through Page/Component data. Wevu and Vue
  use computed plus explicit :class/:style. Taro React uses props() on View.
- Process raw SFC scripts before framework compilation; retain templates,
  macros, lifecycle and styles, compose sourcemaps, skip duplicate virtual
  script requests in Vite. Webpack Vue-loader rereads raw SFCs for inline block
  requests: preprocess them before block selection, deduplicate cloned loaders
  with a stable ident, and retain unknown custom-block behavior. For uni-app use
  DCloud's matching SFC parser.
- Replace metadata per transformed module, retain unchanged cached modules,
  prune unreachable graph nodes, and release session state on final watcher
  shutdown. closeBundle alone must not clear an active watcher.
- Use host emission APIs; weapp-vite 7.4 uses a file-output compatibility path
  for new bundle keys. Generate missing page/component native stylesheet companions, track
  ownership, reject user filename conflicts and remove only owned stale files
  and imports. An initial build with no StyleX must remain unchanged.

## Compilation backends

- Default to official Babel. `backend: 'auto'` uses SWC only for the verified AST subset;
  `swc` rejects unsupported inputs. Never catch arbitrary transform failures as fallbacks.
- Keep `@stylexswc/rs-compiler` optional, pinned and lazy. Runtime and default Babel must
  not load the native addon. Themes, compiler imports, custom Babel options, rejected
  runtime subpaths and raw Vue SFC scripts stay on Babel. The pinned SWC 0.19.1 has
  no verified upstream fix for template-only binding removal; preserve this guard.
- Keep caches session-owned, generation-safe, with concurrent token work coalesced.
  Replay watch dependencies on cache hits. Preserve Webpack host cache identity.
- Run examples and integration in Babel and `WEAPP_STYLEX_BACKEND=auto` modes. Benchmark
  with `corepack pnpm exec node scripts/benchmark.mjs --full`; assert calls, report timings.

## Dependency isolation

Keep Babel 7 in the shared StyleX compiler; do not apply weapp-vite's Babel 8
presets to it. Weapp-vite/Wevu use Vite 8; Taro 4.3.0 uses Vite 4 and Webpack
5.91.0; uni-app's aligned vue3 channel uses Vite 5.2.8 and Vue 3.4.21. Declare
intentional dependency groups in repoctl.config.ts instead of unifying these
incompatible major versions with global overrides. See docs for audit limits.
Keep weapp-vite/Wevu at 7.4.0: the evaluated 7.5.0 host test API fails on Linux
while fingerprinting synthetic virtual module IDs. Reconsider after an upstream
fix is verified; do not patch the host or weaken integration checks to upgrade.
Keep TypeScript 6.0.3 until the toolchain supports TypeScript 7 and the legacy
Compiler API consumers are migrated: TypeScript 7 removes those APIs from its
root entry and exposes separate unstable API modules.

## Release boundary

Use `corepack pnpm change` to record package changes; do not hand-increment
versions or publish npm as part of implementation tasks. Independent
subpackages, platforms beyond WeChat/Alipay/Douyin/H5, Vue 2, uni-app x, WXML sx syntax and stateful HMR
remain future work.

## Nightly and documentation channels

- Configure nightly through `commands.release.nightly` and synchronize managed workflows with `repo upgrade`. The npm provider uses `snapshot-nightly`, every day at 19:17 UTC (03:17 Asia/Shanghai), in the existing `release.yml` with npm OIDC. Never consume release intents, change stable versions or advance `latest` for a snapshot.
- `commands.docs.sites.stylex` owns the six-package documentation site. Main updates deploy `preview` to `preview.stylex.weapp.dev`; completed stable releases deploy `stable` to `stylex.weapp.dev`. Keep the existing Nimbus/Astro site, project-owned layout and bilingual routes.
- Keep `repoctl-docs.yml` and `repoctl-docs-deploy.yml` managed. Preserve the project-owned documentation checks. `docs:build` must verify the frozen source before upload; `docs:deploy:preview` and `docs:deploy:stable` are internal provider adapters, not manual deployment entrypoints.
- Use GitHub environments `docs-stylex-preview` and `docs-stylex-stable`, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Never copy a temporary local Wrangler OAuth credential into CI or log tokens.
- Deploy stable only from a complete repoctl stable release record and the managed concurrency group. Keep the existing production Worker until the first eligible record is available; do not fabricate a baseline or publish npm merely to activate documentation. Retry failed deployments with the same release record instead of republishing packages.
- Keep channel origins consistent across metadata, AI exports and validation. Preview is public but unindexed; retain its Pagefind search. Do not replace the managed stable path with a direct `wrangler deploy` command.
