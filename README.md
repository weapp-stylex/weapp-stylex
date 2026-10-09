# weapp-stylex

<p align="center">
  <img src="assets/brand/logo.svg" width="160" alt="weapp-stylex logo" />
</p>

把官方 StyleX 编译为微信小程序 WXSS。支持原生 Page/Component、Wevu、Taro React、Taro Vue 3 和 uni-app Vue 3；Taro 可使用 Vite 或 Webpack 5。

中英文文档：[stylex.weapp.dev](https://stylex.weapp.dev/)（客户端按系统时区推断地区并选择语言，手动选择优先） · [中文指南](https://stylex.weapp.dev/zh/) · [English](https://stylex.weapp.dev/en/)。

样式可以定义在普通 `styles.ts` 中，通过具名导出、默认导出、barrel、路径别名或 workspace 源码包复用。编译后保留导出的样式映射，多个消费者继续调用官方 `attrs()` / `props()` 合并样式。

标识采用 A1「双轨环抱 · 原轨精修」；全部设计方案、SVG、PNG 和交互预览见 [品牌素材](assets/brand/README.md)。

## 包与接入方式

推荐安装聚合包，再按框架从独立子路径导入：

```bash
pnpm add weapp-stylex
```

`weapp-stylex` / `weapp-stylex/core` 导出官方 runtime；`weapp-stylex/weapp-vite`、
`weapp-stylex/taro`、`weapp-stylex/uni-app` 导出构建适配器；
`weapp-stylex/compiler` 与 `weapp-stylex/taro/loader` 提供底层构建入口。
所有入口包含 ESM/CJS 和对应类型声明。根入口只加载 runtime，框架宿主作为可选
peer，使用对应适配器时安装其支持的宿主版本。七份示例均使用聚合入口。

| 包                         | 用途                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| `@weapp-stylex/core`       | 薄封装官方 runtime，导出 API、类型和主题能力                              |
| `@weapp-stylex/compiler`   | 共享转换 session、SFC 预处理、依赖记录、CSS 聚合和 WXSS 输出规划；ESM/CJS |
| `@weapp-stylex/weapp-vite` | 原生 `stylexCompiler()`；原生/Wevu `createStylex()`                       |
| `@weapp-stylex/taro`       | Taro 默认插件，自动接入当前 builder；ESM/CJS，独立 `./loader` 入口        |
| `@weapp-stylex/uni-app`    | `stylexUniApp()`，在 `uni()` 后注册                                       |

也可以只安装需要的拆分包，继续使用原有 `@weapp-stylex/*` 导入：

```bash
pnpm add @weapp-stylex/core
pnpm add -D @weapp-stylex/weapp-vite # 或 @weapp-stylex/taro / @weapp-stylex/uni-app
```

本仓库的示例通过 `workspace:*` 使用本地包，不需要发布即可构建。公开包通过 GitHub Actions 的 `release.yml` 使用 npm OIDC trusted publishing 发布，并生成 provenance。

版本、OIDC 配置及恢复流程见 [npm 发布](docs/npm-release.md)。

## 编译提速

默认仍使用官方 Babel，现有配置自动获得 AST 复用、并发任务合并、token 和转换缓存优化。所有适配器统一支持 `backend: 'babel' | 'auto' | 'swc'`：

```ts
stylexCompiler({ backend: 'auto' })
createStylex({ backend: 'auto' }) // Wevu
stylexUniApp({ backend: 'auto' })
// Taro plugins:
const plugins = [[require.resolve('weapp-stylex/taro'), { backend: 'auto' }]]
```

`auto` 为已验证的常规 TS/JS 样式使用可选 `@stylexswc/rs-compiler@0.19.0`；主题、编译期导入、runtime 子路径、非空 Babel 自定义配置和未验证的表达式保留 Babel。原始 Vue SFC 脚本保留 Babel，以保护只在模板中使用的变量和组件导入。原生模块首次需要时才加载，不要求 Rust；缺失时 auto 回退，强制 swc 明确报错。普通语法和编译错误不会被隐藏。

示例可通过 `WEAPP_STYLEX_BACKEND=auto` 切换。配置、回退与性能测量见[中文说明](https://stylex.weapp.dev/zh/performance/)和[English](https://stylex.weapp.dev/performance/)。可复现 benchmark：`corepack pnpm exec node scripts/benchmark.mjs --full`；完整构建收益与单文件编译收益分别报告。

## 共享样式与官方 runtime

普通样式文件不需要特殊文件名：

```ts
// styles.ts
import * as stylex from 'weapp-stylex'

export const styles = stylex.create({
  root: { padding: 16, marginTop: '12rpx' },
  active: { opacity: 0.6 },
  meter: (width: number) => ({ width, height: 12 }),
})
export default styles
```

```ts
// styles/index.ts（可选 barrel）
export { default, styles } from '../styles'
```

```ts
// 页面/组件
import * as stylex from 'weapp-stylex'
import { styles } from './styles'

const attrs = stylex.attrs(styles.root, active && styles.active)
const meter = stylex.attrs(styles.meter(80))
```

数值保持 StyleX 的单位语义：`padding: 16` 输出 `16px`，需要响应式小程序单位时写 `'16rpx'`。StyleX WXSS 在框架尺寸转换之后输出，不会再次 px→rpx。动态样式由官方 runtime 生成 CSS 自定义属性，Vue/原生同时绑定 `.class` 和 `.style`。

跨模块变量使用官方 `tokens.stylex.ts` 约定，定义、引用和 `createTheme()` 均**直接导入 token 文件**：

```ts
// tokens.stylex.ts
import * as stylex from 'weapp-stylex'

export const tokens = stylex.defineVars({ surface: 'white', text: '#172033' })
```

```ts
// themes.ts
import * as stylex from 'weapp-stylex'
import { tokens } from './tokens.stylex'

export const darkTheme = stylex.createTheme(tokens, {
  surface: '#172033',
  text: 'white',
})
```

样式引用 `tokens.surface`，消费者将 `darkTheme` 与样式一起传入 `attrs()` / `props()`。宿主 resolver 预解析别名及 workspace 路径，官方 custom module resolution 使用规范化文件身份生成一致的变量哈希。默认变量选择器 `:root` 映射为 `page`，主题 class 保留；隔离组件应把对应主题 class 也绑定在自身根节点。

官方编译器移除 token 的 JS 导入后，适配器仍会收集其默认变量 CSS 和依赖，并保存在消费者 metadata 中，支持缓存恢复和主题文件更新。

## 原生微信 / Wevu

只使用原生 TS/JS 时，原有 API 保持可用：

```ts
import { stylexCompiler } from 'weapp-stylex/weapp-vite'
import { defineConfig } from 'weapp-vite/config'

export default defineConfig({
  weapp: { srcRoot: 'src', compilerPlugins: [stylexCompiler()] },
})
```

Wevu Vue SFC 使用工厂的两个入口，让 Vite 在 SFC 编译前处理脚本，并让 compilerPlugin 输出 WXSS：

```ts
import { createStylex } from 'weapp-stylex/weapp-vite'
import { defineConfig } from 'weapp-vite/config'

const stylex = createStylex()
export default defineConfig({
  plugins: stylex.vitePlugins,
  weapp: { srcRoot: 'src', compilerPlugins: [stylex.compilerPlugin] },
})
```

同一个工厂的两个字段共享 session；不要同时注册另一个 `stylexCompiler()`。SFC 可包含 `<script>` 和 `<script setup>`，模板、宏、生命周期及 `<style>` 仍由 Wevu 处理。

原生 WXML 显式绑定 data：

```ts
import * as stylex from 'weapp-stylex'
import { styles } from './styles'

Page({
  data: {
    sx: stylex.attrs(styles.root),
    meter: stylex.attrs(styles.meter(80)),
  },
})
```

```xml
<view class="{{sx.class}}" style="{{sx.style}}">
  <view class="{{meter.class}}" style="{{meter.style}}" />
</view>
```

Wevu 从 `wevu` 导入 `computed` / `ref`；Taro Vue 与 uni-app 从 `vue` 导入：

```vue
<script setup lang="ts">
import * as stylex from 'weapp-stylex'
import { computed, ref } from 'wevu'
import { styles } from './styles'

const active = ref(false)
const attrs = computed(() =>
  stylex.attrs(styles.root, active.value && styles.active),
)
</script>

<template>
  <view :class="attrs.class" :style="attrs.style" @tap="active = !active" />
</template>
```

## Taro React / Vue 3

在 Taro 配置中注册插件，`compiler.type` 可为 `vite` 或 `webpack5`：

Taro 插件名解析不支持 package 子路径，需通过 `require.resolve()` 传入绝对路径。

```ts
import { defineConfig } from '@tarojs/cli'

export default defineConfig({
  framework: 'react', // 或 vue3
  compiler: { type: 'vite' },
  plugins: [require.resolve('weapp-stylex/taro')],
})
```

React 使用官方 `props()`：

```tsx
import { View } from '@tarojs/components'
import * as stylex from 'weapp-stylex'
import { styles } from './styles'

export function Card({ active }: { active: boolean }) {
  return (
    <View {...stylex.props(styles.root, active && styles.active)}>StyleX</View>
  )
}
```

Vue 使用上面的 `computed`、`:class`、`:style` 写法，并从 `vue` 导入响应式 API。Taro 插件通过公开的 `modifyViteConfig` / `modifyWebpackChain` 接入；Webpack pre-loader 在 Babel/Vue 编译前执行，metadata 存在模块 `buildInfo`，可从 filesystem cache 恢复。

## uni-app Vue 3

```ts
import uniImport from '@dcloudio/vite-plugin-uni'
import { defineConfig } from 'vite'
import { stylexUniApp } from 'weapp-stylex/uni-app'

// 官方 CLI 的 CommonJS default 在 ESM 配置中可能嵌套一层。
const uni
  = (uniImport as unknown as { default?: typeof uniImport }).default ?? uniImport
export default defineConfig({ plugins: [uni(), ...stylexUniApp()] })
```

使用 `uni build -p mp-weixin`。适配器采用 DCloud 插件解析到的 Vue compiler，避免将共享核心的 Vue 3.5 解析器与 uni-app 的 Vue 3.4 内部 API 混用。

## 输出和 watch

所有适配器固定 `sx` 前缀，关闭 runtime CSS 注入、CSS Layers 和浏览器 specificity polyfill。`importSources`、`babel` 配置继续支持；平台必需的前缀、runtime 注入和层输出限制不能被覆盖。

每个样式输出目录生成一份 `stylex.wxss`，其他 WXSS 添加 `@import "./stylex.wxss";`。没有本地 WXSS 的页面/组件补充同名入口，没有任何入口时补充 `app.wxss`。重建会替换模块规则、保留未变化的缓存、按当前模块图删除不再引用的规则，并清理插件生成的过期文件和 import。用户同名 `stylex.wxss` 明确报错，首次无 StyleX 的构建不改变产物。

优先使用宿主 emission API。weapp-vite 7.4 对新增 bundle key 的限制通过文件输出兼容；其他 WXSS 资产仍由宿主写出。watcher 最终关闭时释放状态，构建的 `closeBundle` 不清空活动 watcher。这里保证完整重建的一致性，不提供 stateful HMR 补丁。

## 示例与验证

| Workspace       | 已配置版本                                              | 微信产物                                |
| --------------- | ------------------------------------------------------- | --------------------------------------- |
| `wechat-native` | weapp-vite 7.4.0 / Vite 8.3.4                           | `dist`                                  |
| `wechat-wevu`   | wevu 7.4.0 / weapp-vite 7.4.0                           | `dist`，含 SFC 和 JSX 组件              |
| `taro-react`    | Taro 4.3.0 / React 18.3.1                               | `dist/weapp-webpack`、`dist/weapp-vite` |
| `taro-vue3`     | Taro 4.3.0 / Vue 3.5.43                                 | `dist/weapp-webpack`、`dist/weapp-vite` |
| `uni-vue3`      | DCloud vue3 `3.0.0-alpha-5030120260930001` / Vue 3.4.21 | `dist/build/mp-weixin`                  |

Taro 使用 Vite 4.5.14 / Webpack 5.91.0，uni-app 固定 Vite 5.2.8；没有全局 Vite 主版本 override。各示例都包含共享样式、多消费者、条件合并、主题、动态值、少量内联样式和普通分包。每个示例的 README 提供单独构建命令。

Node.js 要求 `^22.22.1 || >=24.11.0`；CI 验证 22.22.1、24.18.0。pnpm 从 `packageManager` 读取（12.10.1）。

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:deps
corepack pnpm test:integration
corepack pnpm test:examples
corepack pnpm exec repo deps check
corepack pnpm exec repo doctor
corepack pnpm exec repo check --full
corepack pnpm audit --json
corepack pnpm test:ide
```

`test:integration` 使用真实原生模块图、Vite watcher 和 Webpack filesystem cache；`test:examples` 检查七份产物并运行原生/Wevu `@mpcore/test` 逻辑树和交互断言。IDE suite 全局串行，每份产物只启动一次 automator，以 `reLaunch` 切页，先断言再截图。

IDE 验收需设置 `WEAPP_STYLEX_APPID`（真实 AppID）和 `WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH`（选定的官方稳定版 CLI），先登录并开启服务端口。构建脚本从环境注入 AppID；测试在独立产物副本同步 AppID 和条件页，不改动用户已打开的项目。日志、截图、版本和资源清理记录写入 `artifacts/ide`；缺环境时返回退出码 2 并明确标记 pending。

本轮实际验证、审计残留和 IDE 状态见 [多框架验收记录](docs/multi-framework-validation.md)。以前的依赖升级记录见 [2026-10-08 依赖升级](docs/dependency-upgrade-2026-10-08.md)。

## 支持边界

本轮限微信主包、页面、组件和普通分包。独立分包、其他平台、Vue 2、uni-app x、WXML `sx` 属性和 stateful HMR 留给后续版本。token 文件需遵循官方命名与直接导入约定；编译器不解析 WXML，也不从模板反推样式。

MIT License。
