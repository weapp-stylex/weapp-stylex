# @weapp-stylex/weapp-vite

将官方 StyleX 编译为原生小程序和 Wevu 的微信/支付宝/抖音样式及 H5 CSS。要求 weapp-vite `>=7.4.0 <8`。

```bash
pnpm add @weapp-stylex/core
pnpm add -D @weapp-stylex/weapp-vite
```

原生 TS/JS 使用 `stylexCompiler()`：

```ts
import { stylexCompiler } from '@weapp-stylex/weapp-vite'
import { defineConfig } from 'weapp-vite/config'

export default defineConfig({
  weapp: { srcRoot: 'src', compilerPlugins: [stylexCompiler()] },
})
```

Wevu SFC 注册同一工厂的两个字段，以共享编译 session：

```ts
import { createStylex } from '@weapp-stylex/weapp-vite'
import { defineConfig } from 'weapp-vite/config'

const stylex = createStylex()
export default defineConfig({
  plugins: stylex.vitePlugins,
  weapp: { srcRoot: 'src', compilerPlugins: [stylex.compilerPlugin] },
})
```

支持共享 `styles.ts`、条件合并、主题和动态 style。原生通过 data 绑定 `attrs.class` / `attrs.style`；Wevu 使用 computed 及显式 `:class` / `:style`。

完整示例与支持边界见 [weapp-stylex](https://github.com/weapp-stylex/weapp-stylex)。数值 `16` 输出 `16px`，rpx 需显式字符串。

MIT License。

## Platforms

Native and Wevu hosts infer WeChat, Alipay, Douyin or Web from their active platform. Use both `createStylex()` fields for cross-platform builds and provide a Web `index.html` importing `/@weapp-vite/web/entry`. The Web runtime receives page/component CSS metadata, preserves page defaults and allows component theme inheritance through Shadow DOM. Numeric/px values keep official semantics; only static rpx follows the host policy. The upstream Web runtime is experimental; the example uses an equivalent SFC for the mini-program JSX fixture.
