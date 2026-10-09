# @weapp-stylex/uni-app

uni-app Vue 3 微信小程序的 StyleX Vite 适配器。提供 ESM 和 CommonJS 入口。

```bash
pnpm add @weapp-stylex/core
pnpm add -D @weapp-stylex/uni-app
```

在 `uni()` 后注册插件：

```ts
import uniImport from '@dcloudio/vite-plugin-uni'
import { stylexUniApp } from '@weapp-stylex/uni-app'
import { defineConfig } from 'vite'

const uni
  = (uniImport as unknown as { default?: typeof uniImport }).default ?? uniImport
export default defineConfig({ plugins: [uni(), ...stylexUniApp()] })
```

使用 `uni build -p mp-weixin`。Vue 通过 computed 和显式 `:class` / `:style` 绑定官方 `attrs()` 的结果；支持共享样式和直接导入 `tokens.stylex.ts` 的主题。

要求 Node.js `^22.22.1 || >=24.11.0`。当前兼容 DCloud Vue 3 通道 `3.0.0-alpha-5030120260930001`，示例固定 Vite 5.2.8 / Vue 3.4.21。采用 DCloud 配套 SFC parser，数值保持 px，rpx 需显式字符串。

完整示例和支持边界见 [weapp-stylex](https://github.com/weapp-stylex/weapp-stylex)。

MIT License。
