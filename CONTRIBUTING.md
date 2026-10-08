# Contributing to weapp-stylex

Use Node.js `^22.22.1 || >=24.11.0` and enable Corepack so pnpm uses the
version declared in `packageManager`. Run `pnpm install --frozen-lockfile`.

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
