# @weapp-stylex/core

官方 StyleX runtime 的薄封装，提供 `create`、`attrs`、`props`、`defineVars`、`createTheme` 及类型。需要搭配构建适配器将样式编译为微信小程序 WXSS。

```bash
pnpm add @weapp-stylex/core
```

```ts
// styles.ts
import * as stylex from '@weapp-stylex/core'

export const styles = stylex.create({
  root: { padding: 16 },
  active: { opacity: 0.6 },
})
```

```ts
import * as stylex from '@weapp-stylex/core'
import { styles } from './styles'

const attrs = stylex.attrs(styles.root)
```

原生 WXML 将 `attrs.class` / `attrs.style` 放入 data；Vue 使用显式 `:class` / `:style`；Taro React 使用 `stylex.props()`。数值 `16` 保持 `16px`，需要 rpx 时显式写 `'16rpx'`。

构建适配器与完整示例见 [weapp-stylex](https://github.com/weapp-stylex/weapp-stylex)。当前支持微信主包、页面、组件及普通分包。

MIT License。
