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

- Node.js `^22.22.1 || >=24.11.0` (CI: 22.22.1 and 24.18.0)
- pnpm (run `corepack enable` so the declared workspace version is used)
- CLI output is English by default; `--lang zh-CN` or `REPOCTL_LANG=zh-CN` selects Simplified Chinese

## Scope

This workspace adapts official StyleX to WeChat mini-programs: native
Page/Component, Wevu, Taro React/Vue 3 (Vite and Webpack 5), and uni-app Vue 3.
The shared `@weapp-stylex/compiler` owns transformation, module metadata,
resolver identities, SFC maps and WXSS planning. Keep adapters thin.
The public `weapp-stylex` facade exposes runtime APIs at the root and adapters
through explicit subpaths. Keep build tools out of the root runtime entry;
framework host peers remain optional but retain their supported version ranges.
The private root workspace is named `weapp-stylex-workspace`.

## Development

- Use `corepack pnpm` with the declared package manager version.
- Run `corepack pnpm install --frozen-lockfile` before verification.
- Run `corepack pnpm lint`, `build`, `typecheck`, `test`, `test:deps`,
  `test:integration`, and `test:examples` from the root.
- `build` produces seven WeChat artifacts. Taro's two builders run in sequence
  into separate directories. CI tests Node 22.22.1 and 24.18.0.
- `test:examples` checks all artifacts and runs native/Wevu headless interactions.
- `test:ide` is a globally serial suite. Supply a real `WEAPP_STYLEX_APPID` and
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
  default :root variable selectors to page, retaining theme classes.
- Native WXML binds attrs class/style through Page/Component data. Wevu and Vue
  use computed plus explicit :class/:style. Taro React uses props() on View.
- Process raw SFC scripts before framework compilation; retain templates,
  macros, lifecycle and styles, compose sourcemaps, skip duplicate virtual
  script requests. For uni-app use DCloud's matching SFC parser.
- Replace metadata per transformed module, retain unchanged cached modules,
  prune unreachable graph nodes, and release session state on final watcher
  shutdown. closeBundle alone must not clear an active watcher.
- Use host emission APIs; weapp-vite 7.4 uses a file-output compatibility path
  for new bundle keys. Generate missing page/component WXSS companions, track
  ownership, reject user filename conflicts and remove only owned stale files
  and imports. An initial build with no StyleX must remain unchanged.

## Dependency isolation

Keep Babel 7 in the shared StyleX compiler; do not apply weapp-vite's Babel 8
presets to it. Weapp-vite/Wevu use Vite 8; Taro 4.3.0 uses Vite 4 and Webpack
5.91.0; uni-app's aligned vue3 channel uses Vite 5.2.8 and Vue 3.4.21. Declare
intentional dependency groups in repoctl.config.ts instead of unifying these
incompatible major versions with global overrides. See docs for audit limits.

## Release boundary

Use `corepack pnpm change` to record package changes; do not hand-increment
versions or publish npm as part of implementation tasks. Independent
subpackages, other platforms, Vue 2, uni-app x, WXML sx syntax and stateful HMR
remain future work.
