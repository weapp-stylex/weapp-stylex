# Contributing to weapp-stylex

Use Node.js `^22.23.4 || ^24.22.1 || >=26.12.1` and enable Corepack so pnpm uses the
version declared in `packageManager`. The default development runtime is Node
`26.13.0` (`.node-version`), with pnpm `12.16.1`. Node 26 no longer bundles
Corepack: run `npm install --global corepack@0.36.0` followed by `corepack enable`.
Run `pnpm install --frozen-lockfile`. CI also covers Node 22.23.4 and 24.22.2;
published package consumers retain their separate minimum Node requirements.

Before opening a pull request, run:

```bash
pnpm lint
pnpm build
pnpm typecheck
pnpm test
pnpm test:deps
pnpm --filter wechat-native test:headless
pnpm exec repo deps check
pnpm exec repo doctor
pnpm exec repo check --full
pnpm audit --json
```

Build before running typechecks and headless tests: the example consumes the
library packages' `dist` exports and tests the built mini-program artifact.
Keep StyleX runtime and Babel plugin versions aligned. The adapter compiles with
Babel 7; weapp-vite's own Babel 8 toolchain must resolve independently.

Changes to publishable packages require a native pnpm change intent:

```bash
pnpm change @weapp-stylex/weapp-vite --bump patch --summary 'Describe the user-visible change'
```

Use Conventional Commits. Do not manually assign release versions or publish
packages as part of routine dependency maintenance. Keep the native WXML data
binding contract and WeChat compatibility boundary documented in `README.md`.

Report bugs at https://github.com/weapp-stylex/weapp-stylex/issues.
