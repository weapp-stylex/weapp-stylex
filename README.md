# weapp-stylex

StyleX 编译适配层，面向使用 `weapp-vite` 构建的原生微信小程序。

首版坚持原生 `Page/Component + WXML/WXSS + TypeScript`，在构建阶段调用官方
`@stylexjs/babel-plugin`，将原子样式收集为 WXSS，并把 WXSS 按页面、组件和普通
分包输出目录注入。运行时不需要 React、Vue、wevu 或自定义 WXML 属性。

## 包

- `@weapp-stylex/core`：重新导出官方 StyleX API 和类型，可使用 `create`、`attrs`、
  `props`、`defineVars`、`createTheme` 等 API。
- `@weapp-stylex/weapp-vite`：提供 `stylexCompiler()`，实现 `weapp.compilerPlugins`
  协议。
- `examples/wechat-native`：可导入微信开发者工具的原生示例，覆盖页面、组件、主题
  数据和普通分包。

## 安装

```bash
pnpm add @weapp-stylex/core
pnpm add -D @weapp-stylex/weapp-vite
```

在 `vite.config.ts` 中注册编译器：

```ts
import { defineConfig } from 'weapp-vite/config';
import { stylexCompiler } from '@weapp-stylex/weapp-vite';

export default defineConfig({
  weapp: {
    srcRoot: 'src',
    compilerPlugins: [stylexCompiler()],
  },
});
```

## WXML 用法

StyleX 的 `create()` 在编译时移除，WXML 应该使用 `attrs(...).class` 暴露的字符串：

```ts
import * as stylex from '@weapp-stylex/core';

const styles = stylex.create({
  root: {
    padding: 16,
    backgroundColor: 'white',
  },
  active: {
    opacity: 0.6,
  },
});

const sx = {
  root: stylex.attrs(styles.root).class,
  active: stylex.attrs(styles.active).class,
};

Page({
  data: {
    sx,
    active: false,
  },
});
```

```xml
<view class="{{sx.root}} {{active ? sx.active : ''}}">
  <text>StyleX in Mini Program</text>
</view>
```

多样式合并同样由官方编译器处理：

```ts
const className = stylex.attrs(styles.root, active && styles.active).class;
```

## 产物规则

插件接管导入 `@weapp-stylex/core` 或 `@stylexjs/stylex` 的 JS/TS 源码，收集 Babel
metadata 中的原子规则，并以 `sx` 为 class 前缀聚合去重。输出固定使用：

- `legacyDisableLayers: true`
- `useLayers: false`
- 不生成 `@layer` 或 `:not(#\\#)` specificity polyfill

每个有小程序输出的目录生成 `stylex.wxss`，同目录现有 WXSS 会获得：

```css
@import "./stylex.wxss";
```

如果构建没有任何 WXSS 入口，则生成根目录 `app.wxss` 作为全局入口。独立分包暂不
作为首版稳定兼容承诺。

## 验证

```bash
pnpm install
pnpm test
pnpm build
pnpm --filter @weapp-stylex/weapp-vite test
pnpm --filter wechat-native build
pnpm --filter wechat-native test:headless
```

将 `examples/wechat-native` 导入微信开发者工具时，项目根目录是该目录，构建产物
位于 `dist/`。真实 DevTools 验收应记录稳定版版本、基础库、AppID、截图与日志路径，
并在同一测试项目中复用一个 automator，使用 `reLaunch` 切换页面。

## 当前边界

- 原生 WXML 中不支持 `<view sx="root">`、WXML 直接调用 StyleX 函数或从 WXML 反推
  TS 样式模块。
- 首版用完整构建处理样式更新，不提供 stateful HMR 补丁。
- 只承诺微信主包、页面、组件和普通分包；多平台与独立分包留给后续版本。

## License

MIT
