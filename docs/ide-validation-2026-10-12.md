# 微信开发者工具验收 · 2026-10-12

七种微信产物在**同一轮完整、串行的 auto suite 中全部通过**。最终运行 `run-1791798851471` 的 `status` 为 `passed`、`scope` 为 `full`，七份产物均通过运行断言，七个专属端口和原生窗口均已关闭。[结构化记录](validation/ide-2026-10-12.json)保留本轮结果及前三次失败；[10-09 记录](ide-validation-2026-10-09.md)保持原日期结论。

## 实际环境

- 使用与 10-09 相同的用户指定 AppID：`wx6ffee4673b257014`，来源为 weapp-tailwindcss 的 `starter/weapp-vite/project.config.json`。每份使用隔离产物副本，同步 AppID、`miniprogramRoot` 和两个条件页，不修改来源项目。
- 显式 CLI：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`。安装版本和七份实际 `Tool.getInfo` 均为 Stable **2.02.2608080**。
- 官方来源：[下载页](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)及[版本配置](https://devtools.wxqcloud.qq.com.cn/WechatWebDev/nightly/versions/config.json)。预检于 **2026-10-12 09:38 UTC** 核对，最终 suite 于 **09:54:11.239 UTC** 再次查询；未切换 RC、nightly 或旧版。
- 实际基础库均为 **3.17.4**，由 `Tool.getInfo` 与 `systemInfo` 双重确认。Stable 指工具渠道，基础库以实际连接值为准。
- Node **24.18.0**、Corepack pnpm **12.10.1**、macOS arm64。`wv ide doctor` 确认已登录，服务端口 **19355** 已开启；实际项目与 automator 连接由 suite 逐份验证。

## 完整运行结果

所有证据来自 `artifacts/ide/run-1791798851471`，终端日志为 `artifacts/ide-auto-ready-2026-10-12.log`。没有合并局部成功来组成完整通过。

| 产物                 | 状态 | 窗口 | 专属端口 | 证据子目录      |
| -------------------- | ---- | ---- | -------- | --------------- |
| 原生                 | 通过 | s73  | 56418    | 0-wechat-native |
| Wevu                 | 通过 | s74  | 57056    | 1-wechat-wevu   |
| Taro React / Webpack | 通过 | s75  | 57528    | 2-taro-react    |
| Taro React / Vite    | 通过 | s76  | 57954    | 3-taro-react    |
| Taro Vue / Webpack   | 通过 | s77  | 58422    | 4-taro-vue3     |
| Taro Vue / Vite      | 通过 | s78  | 58817    | 5-taro-vue3     |
| uni-app Vue 3        | 通过 | s79  | 59243    | 6-uni-vue3      |

每份只启动一次 automator。应用就绪后 `reLaunch('/pages/index/index')`，检查共享页面及组件 class、内联 StyleX class 与 `margin-top: 8px`、条件 opacity **0.6**、主题背景切换及动态宽度 **120px**，之后截图 `index.png`。再 `reLaunch('/subpackage/detail/index')` 检查普通分包 class，截图 `subpackage.png`。14 张截图均非空；七份 `console.json` 均无 error 或 exception，仅记录 `wx.getSystemInfoSync` 废弃 warning。

各目录还保留 `open.log`、`native.log`、`console.json` 和隔离 `project/`。原始证据存放于本地忽略目录，随代码保存的 JSON 使用仓库相对路径，并记录每份实际工具版本、基础库、页面就绪见证、运行日志摘要及资源清理结果。

## 应用就绪屏障与失败保留

macOS 先通过同一 CLI 打开所属项目，等待原生 simulator page-ready，再在同一窗口启用 automator。原生日志 page-ready 和自动化 socket 连接都不足以证明应用结构已完成：启用 automator 会重新编译，`Tool.getInfo`、`systemInfo` 可以先于页面结构返回。

`miniprogram-automator` 的 `reLaunch()` 在执行路由调用前先查询 `currentPage()`。本轮局部诊断在应用仍编译时触发该查询，宿主页面 metadata 为 null。现增加独立的 `application readiness` 阶段：只读 `pageStack()`，要求栈顶是 `pages/index/index`，再通过严格的 `Page.$$()` 查询到 `#stylex-root`，记录 `pageId`、路径、selector 和等待耗时，随后才执行首次 `reLaunch`。不使用会吞掉协议异常的 `Page.$()` 判断启动就绪；协议异常立即失败，运行时 error/exception 继续失败，不重试路由操作。等待上限为 45 秒。

以下原始失败均保留，状态未改写为通过：

| 运行              | 失败阶段与证据                                                                                               | 清理结果                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| run-1791797995180 | 完整 suite 的 Taro React / Webpack 在 pre-open 等待原生就绪超时；该份 automator 尚未启动，未确认产品代码原因 | s68–s70 及三个专属端口已关闭 |
| run-1791798218387 | partial-2：Taro React / Webpack 首次路由前 `currentPage()` 报宿主 `rawPath` metadata 为 null；截图仍在编译   | s71 / 52047 已关闭           |
| run-1791798330973 | partial-3：Taro React / Vite 在同一阶段复现 `rawPath` metadata 为 null                                       | s72 / 53122 已关闭           |

通用 `simulator launch failed` 也出现在随后成功的原生启动日志中，不能仅凭该日志级别判断项目配置故障。新屏障修复的是自动化与应用编译的时序边界；原 pre-open 启动失败仍单独保留。

## 资源范围与可复现入口

最终七份及前三次失败的每个所属窗口都核对了 `native-window-closed` 和 `webcontents-destroyed`，专属 TCP 端口均确认关闭。下一份在上一份清理完成后才启动，最终 `suite.lock` 不存在。只通过项目路径关闭本任务项目；清理后通过原生应用可访问性树只读复核，既有手动窗口仍保留，共享宿主未退出。未清缓存、修改登录态或关闭其他项目。

```bash
caffeinate -dimsu -- env \
  WEAPP_STYLEX_BACKEND=auto \
  WEAPP_STYLEX_APPID=wx6ffee4673b257014 \
  WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH=/Applications/wechatwebdevtools.app/Contents/MacOS/cli \
  corepack pnpm test:ide
```

`WEAPP_STYLEX_IDE_START_AT` 仅用于局部诊断，不能作为完整 suite 通过。CI 不启动真实 IDE，通过 `corepack pnpm exec node --test scripts/taro/*.test.mjs scripts/ide-*.test.mjs` 覆盖构建初始化、应用就绪与资源归属；本地 18 项脚本测试通过。

本轮真实微信 IDE suite 使用 auto 后端；Babel/auto 的构建、集成和 H5 浏览器结果另见[多平台记录](multi-platform-validation.md)。支付宝、抖音仍缺少本会话的真实项目 AppID、身份及授权，IDE 和设备验收待完成；本报告不宣称真机验收。
