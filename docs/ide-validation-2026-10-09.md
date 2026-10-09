# 微信开发者工具验收 · 2026-10-09

七种产物的真实运行断言已分别通过；**单轮七份全部通过的 suite 仍待验收**。完整重跑发生 IDE 模拟器启动故障，不将局部成功、重新打开后的恢复或 headless 结果写成完整 suite 通过。[结构化记录](validation/ide-2026-10-09.json)保留这一区别。当前本地 `artifacts/ide/report.json` 为失败记录。

## 实际环境

- 用户指定的 AppID：`wx6ffee4673b257014`，来源为 weapp-tailwindcss 的 `starter/weapp-vite/project.config.json`。每次使用隔离产物副本，同步 AppID、miniprogramRoot 和两个条件页，不修改来源仓库配置。
- CLI：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`，与 weapp-vite 的 `e2e/utils/devtoolsCli.ts` 选择一致。安装和实际 `Tool.getInfo` 都为 Stable **2.02.2608080**。
- 官方核对来源：[下载页](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)及[官方版本配置](https://devtools.wxqcloud.qq.com.cn/WechatWebDev/nightly/versions/config.json)。各轮 UTC 查询时间记录在 JSON 的 `officialChecks`；没有改用 RC 或旧版。
- 实际基础库：**3.17.4**，由 `Tool.getInfo` 和 `systemInfo` 双重记录。IDE 标记此基础库处于灰度，稳定版指工具渠道；不宣称基础库也是稳定渠道。
- Node 24.18.0、Corepack pnpm 12.10.1、macOS arm64。`wv ide doctor --json` 确认已登录和服务端口 19355；默认 11069 上没有连接的警告不代表专属 automator 端口失败。

## 运行结果与证据

以下前六份来自 `artifacts/ide/run-1791533874324`，uni-app 来自单独串行的 `artifacts/ide/run-1791534136167`。每份只启动一次 automator；没有并发验收，也没有在同一份 suite 中重启 automator 来切页。

| 产物                 | 实际运行断言     | 窗口 | 专属端口 | 证据子目录      |
| -------------------- | ---------------- | ---- | -------- | --------------- |
| 原生                 | 通过             | s48  | 见 JSON  | 0-wechat-native |
| Wevu                 | 通过             | s50  | 见 JSON  | 1-wechat-wevu   |
| Taro React / Webpack | 通过             | s52  | 见 JSON  | 2-taro-react    |
| Taro React / Vite    | 通过             | s53  | 见 JSON  | 3-taro-react    |
| Taro Vue / Webpack   | 通过             | s54  | 见 JSON  | 4-taro-vue3     |
| Taro Vue / Vite      | 通过             | s55  | 见 JSON  | 5-taro-vue3     |
| uni-app Vue 3        | 通过，局部 suite | s57  | 58021    | 6-uni-vue3      |

每份先 `reLaunch('/pages/index/index')`，检查共享页面/组件 class、内联 class 与 8px 间距、条件 opacity 0.6、主题背景切换、动态宽度 120px，再截图 `index.png`。随后 `reLaunch('/subpackage/detail/index')` 检查普通分包 class，再截图 `subpackage.png`。各目录保存 `console.json`、`native.log` 和隔离 `project/`；完整路径见 JSON。截图、原始日志和产物保存在本地忽略目录，结构化摘要随代码提交。

## 本轮修复与失败记录

真实 IDE 捕获 Taro Vue / Webpack 内联 `stylex.create()` 漏编译。Vue-loader 为 block 请求重新读取原始 SFC，旧适配器排除 `?vue` 请求，导致 setup 在运行时调用 create。现改为在 Vue-loader 选择 block 前预处理原始文档，固定 loader ident 去重克隆规则，同时保留未知 custom block 的默认忽略行为。Vite 虚拟脚本仍跳过，原始 SFC 的 auto 后端仍保留 Babel。

新增真实 Vue-loader + Webpack 集成测试，执行编译后的 setup，覆盖双脚本、共享样式、外部 script、模板、style、custom block、sourcemap、磁盘恢复、源码修改和移除引用后的旧规则清理。Babel 与 auto 均通过。七份产物检查增加 `margin-top:8px`，IDE 不再只依赖共享样式来判断 SFC 成功。

失败记录全部保留：

- `run-1791531700181`：Taro Vue / Webpack runtime create 首错、诊断与精确清理恢复。
- `run-1791532968815`、`run-1791533349781`：前六份通过，uni-app 冷启动 `simulator launch failed`。同产物重开后交互通过的记录单独保存，原失败未改写。
- `run-1791533683651`：官方 `engine build` 返回 `Cannot GET /engine/build`，未启动 automator。精确 close 和端口检查完成，但没有可关联的原生窗口记录，原清理错误保留；不声称已证明某个窗口销毁。此方案未纳入最终实现。
- `run-1791533874324`：前六份通过，最后 `cli open` 在 preparing 阶段超时，未取得原生窗口身份。后续单独 uni-app 成功只标为 partial。
- `run-1791534166378`：最后完整重跑的第一个原生项目已打开，但等待原生 page-ready 失败，日志捕获通用 simulator launch failure。窗口 s58、端口 58411 均已关闭，没有启动 automator。

最终 harness 在 macOS 先用同一 CLI 打开项目，等待属于该项目的原生 page-ready，再在同一窗口启用一次 automator。CLI open 最多等待 60 秒，原生就绪最多 45 秒；失败仍报错并清理，不自动将启动错误转成通过。此流程改善了孤立 uni-app 验收，但共享宿主连续完整运行的可靠性仍有环境限制。

## 资源边界

选取的七份成功记录都核对了专属 TCP 端口关闭、`native-window-closed` 和 `webcontents-destroyed`，之后才启动下一份。本轮最后失败项目也完成三项清理。suite lock 和临时连接均已释放。早期崩溃窗口 s19 已精确 close，证据保存在原目录的 `cleanup-recovery.json`。

曾由 `wv open` 启动的本任务 MCP 进程 PID 92284 / 端口 14734 已精确停止并核对端口释放。没有创建浏览器标签页。既有 weapp-vite `app-lifecycle-wevu-ts` 窗口及其他任务项目保留；没有全局 quit、按进程名 kill、删除共享 lease 或修改登录数据。无法关联原生身份的两次 CLI 准备失败保留为未确认分配，而非宣称原生清理通过。

## 可复现入口

```bash
WEAPP_STYLEX_BACKEND=auto \
WEAPP_STYLEX_APPID=wx6ffee4673b257014 \
WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH=/Applications/wechatwebdevtools.app/Contents/MacOS/cli \
corepack pnpm test:ide
```

在 macOS 使用 caffeinate 包裹长 suite。`WEAPP_STYLEX_IDE_START_AT` 仅用于局部诊断，结果写 `partial-N.json`，绝不能作为完整通过。无 IDE 的 CI 通过 `node --test scripts/ide-native-journal.test.mjs` 验证归属、外部窗口隔离、轮换和启动前关闭等生命周期记录。

frozen install、lint、包和七份构建、typecheck、57 个单测、4 个原生日志归属测试、test:deps、Babel/auto integration 与 examples、双语文档和 repoctl 全量检查通过。审计仍为既有 72 项：4 critical、20 high、38 moderate、10 low。本轮不发布 npm，也不合并 release PR。
