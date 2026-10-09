# @weapp-stylex/weapp-vite

将官方 StyleX 编译为原生微信小程序和 Wevu 的 WXSS。要求 weapp-vite `>=7.4.0 <8`。

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
