# @weapp-stylex/compiler

weapp-stylex 的共享构建核心：使用官方 StyleX Babel 插件转换模块，维护模块规则和主题依赖，预处理 Vue SFC，并规划 WXSS 产物。提供 ESM 和 CommonJS 入口。

应用项目优先使用 `@weapp-stylex/weapp-vite`、`@weapp-stylex/taro` 或 `@weapp-stylex/uni-app`；本包供构建适配器使用。

```bash
pnpm add -D @weapp-stylex/compiler
```

```ts
import { createVitePlugins, StylexSession } from '@weapp-stylex/compiler'

const session = new StylexSession()
const plugins = createVitePlugins(session)
```

支持普通共享样式模块、别名、workspace 源码及官方 `tokens.stylex.ts` 主题约定。保持 StyleX 单位语义，关闭 CSS Layers、specificity polyfill 和 runtime CSS 注入。

要求 Node.js `^22.22.1 || >=24.11.0`。API、生命周期和适配器契约见 [weapp-stylex](https://github.com/weapp-stylex/weapp-stylex)。

MIT License。
