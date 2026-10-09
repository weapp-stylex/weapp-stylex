# @weapp-stylex/compiler

## 0.1.1

### Patch Changes

- Upgrade magic-string to 1.4.3 for Vue SFC sourcemap generation and use named exports to keep both CJS and ESM compiler entrypoints working; retain official StyleX compilation semantics.

- 识别 weapp-stylex 聚合入口的样式与主题导入；宿主框架 peer 改为可选，Taro 插件和 loader 增加具名导出供双格式聚合入口复用。

## 0.1.0

### Minor Changes

- 支持共享 StyleX 模块、Vue SFC 预处理和跨模块主题；新增 Taro Vite/Webpack 与 uni-app 微信适配，统一 WXSS 输出及缓存清理。

### Patch Changes

- 补充 npm 包安装与框架接入说明，统一公开发布配置并启用 GitHub Actions OIDC 发布。
