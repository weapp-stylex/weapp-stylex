# taro-react

Taro 4.3 React 18 的 StyleX 微信示例。独立 `src/styles/shared.ts` 同时提供具名和默认导出，`styles/index.ts` 转导出，页面、组件及普通分包共享样式。主题直接导入 `tokens.stylex.ts`；主页面按钮演示条件合并、主题切换和动态宽度。

从仓库根目录运行：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter '@weapp-stylex/*' build
corepack pnpm --filter taro-react build
corepack pnpm --filter taro-react typecheck
```

产物：`dist/weapp-webpack / dist/weapp-vite`（相对于本示例目录）。在微信开发者工具打开对应产物目录。数值 `16` 为 `16px`，显式 `'12rpx'` 保持 rpx。

单独验证 builder：`corepack pnpm --filter taro-react build:webpack` 或 `build:vite`。默认顺序构建两份独立产物。

真实验收前设置 `WEAPP_STYLEX_APPID`，重新构建以注入真实 AppID；设置 `WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH` 后在根目录执行 `corepack pnpm test:ide`。默认 touristappid 仅供打开示例，不计为真实 IDE 验收。

全仓产物及原生/Wevu headless 验证：`corepack pnpm test:examples`。接入配置和版本边界见 [根 README](../../README.md)。

## 编译后端 / Backend

配置默认为 Babel；`WEAPP_STYLEX_BACKEND=auto` 为符合条件的 TS/JS 样式启用可选 SWC。主题和原始 SFC 脚本保留 Babel。

The default is Babel. Set `WEAPP_STYLEX_BACKEND=auto` for eligible TS/JS style modules; themes and raw SFC scripts stay on Babel.

## 多平台构建

`corepack pnpm build` 顺序构建微信、支付宝、抖音和 H5。可单独运行 `build:weapp`、`build:alipay`、`build:tt`、`build:h5`。`dev:h5` 启动浏览器开发服务，`WEAPP_STYLEX_PORT` 指定端口；Taro 的 `dev:h5:webpack` 使用另一个 builder。微信输出路径保持不变。

每个平台的两个 builder 串行输出到 `dist/<weapp|alipay|tt|h5>-<webpack|vite>`。
开发输出追加 `-dev`，与生产目录隔离；H5 开发资源路径为 `/`，生产资源使用 `./` 以支持子路径部署。
H5 静态 rpx 按宿主转换，数值/px 不转换；动态值使用浏览器标准单位。浏览器交互验证不替代小程序 IDE/真机验收。
