# taro-vue3

Taro 4.3 Vue 3 的 StyleX 微信示例。独立 `src/styles/shared.ts` 同时提供具名和默认导出，`styles/index.ts` 转导出，页面、组件及普通分包共享样式。主题直接导入 `tokens.stylex.ts`；主页面按钮演示条件合并、主题切换和动态宽度。

从仓库根目录运行：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter '@weapp-stylex/*' build
corepack pnpm --filter taro-vue3 build
corepack pnpm --filter taro-vue3 typecheck
```

产物：`dist/weapp-webpack / dist/weapp-vite`（相对于本示例目录）。在微信开发者工具打开对应产物目录。数值 `16` 为 `16px`，显式 `'12rpx'` 保持 rpx。

单独验证 builder：`corepack pnpm --filter taro-vue3 build:webpack` 或 `build:vite`。默认顺序构建两份独立产物。

真实验收前设置 `WEAPP_STYLEX_APPID`，重新构建以注入真实 AppID；设置 `WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH` 后在根目录执行 `corepack pnpm test:ide`。默认 touristappid 仅供打开示例，不计为真实 IDE 验收。

全仓产物及原生/Wevu headless 验证：`corepack pnpm test:examples`。接入配置和版本边界见 [根 README](../../README.md)。
