# @weapp-stylex/taro

Taro 4.3 微信/支付宝/抖音小程序与 H5 的 StyleX 插件，支持 React / Vue 3 与 Vite / Webpack 5。提供 ESM、CommonJS 及独立 `./loader` 入口。

```bash
pnpm add @weapp-stylex/core
pnpm add -D @weapp-stylex/taro
```

```ts
import { defineConfig } from '@tarojs/cli'

export default defineConfig({
  framework: 'react', // 或 vue3
  compiler: { type: 'vite' }, // 或 webpack5
  plugins: ['@weapp-stylex/taro'],
})
```

React 在 `View` 上使用 `stylex.props()`；Vue 3 使用 computed 及显式 `:class` / `:style`。样式可从普通 `styles.ts` 导入，跨模块主题使用直接导入的 `tokens.stylex.ts`。

要求 Node.js `^22.22.1 || >=24.11.0`、Taro service `>=4.3.0 <4.4.0`。示例使用 Vite 4.5.14 / Webpack 5.91.0。数值保持 px，rpx 需显式字符串。支持 `TARO_ENV=weapp`、`alipay`、`tt` 与 `h5`。

完整配置与双 builder 示例见 [weapp-stylex](https://github.com/weapp-stylex/weapp-stylex)。

MIT License。

构建使用 tsdown，保留 ESM/CJS、独立 loader 与内部 Webpack 入口；Taro、Webpack 和共享编译器保持 external。

## Platforms

The adapter infers WeChat (`weapp`), Alipay (`alipay`), Douyin (`tt`) or H5 (`h5`) from Taro, for both Vite and Webpack 5. Mini-programs emit matching platform style companions. H5 emits an external CSS asset with a content hash and an owned HTML stylesheet link. Numeric/px values keep official semantics; static rpx follows Taro's H5 dimensions and dynamic values use browser units. Optional compiler `target` must match the active host.
