# weapp-stylex

Official StyleX runtime and build adapters for WeChat, Alipay and Douyin mini-programs and H5: native
Page/Component, Wevu, Taro React/Vue 3 and uni-app Vue 3.

```bash
pnpm add weapp-stylex
```

| Import                               | API                                                |
| ------------------------------------ | -------------------------------------------------- |
| `weapp-stylex` / `weapp-stylex/core` | Official StyleX runtime and types                  |
| `weapp-stylex/weapp-vite`            | `stylexCompiler()` and `createStylex()`            |
| `weapp-stylex/taro`                  | Default Taro plugin and `stylexTaro`               |
| `weapp-stylex/uni-app`               | `stylexUniApp()`                                   |
| `weapp-stylex/compiler`              | Shared compilation sessions and platform CSS tools |
| `weapp-stylex/taro/loader`           | Webpack loader                                     |

All entries provide ESM, CJS and corresponding TypeScript declarations. The
default runtime entry imports only `@weapp-stylex/core`; it does not load build
tools. Framework packages are optional peers. Install the host framework for
the adapter you use, following its supported version constraints.

```ts
// styles.ts
import * as stylex from 'weapp-stylex'

export const styles = stylex.create({
  root: { padding: 16, marginTop: '12rpx' },
  active: { opacity: 0.6 },
})
```

For native projects, use `stylexCompiler` from `weapp-stylex/weapp-vite` in
`weapp.compilerPlugins`. For Wevu, register both fields returned by
`createStylex()`. For uni-app, register `stylexUniApp()` after `uni()`.

Taro's plugin resolver expects package names or absolute paths, so resolve the
subpath explicitly in `config/index.ts`:

```ts
import { defineConfig } from '@tarojs/cli'

export default defineConfig({
  framework: 'react',
  compiler: { type: 'vite' },
  plugins: [require.resolve('weapp-stylex/taro')],
})
```

Both Taro Vite and Webpack 5 are supported. Existing `@weapp-stylex/*` packages
remain available for projects that prefer installing only one adapter.

Documentation: [English](https://stylex.weapp.dev/en/) ·
[中文](https://stylex.weapp.dev/zh/).

## Platforms

Build adapters infer WeChat, Alipay, Douyin or H5 from the active host. Their optional compiler `target` uses `weapp`, `alipay`, `tt` or `web` and must match that host. The root/core runtime stays unchanged. Mini-programs receive platform style companions; H5 receives browser CSS through its adapter. See the [configuration guide](https://stylex.weapp.dev/configuration/) for commands, units and Web delivery.
