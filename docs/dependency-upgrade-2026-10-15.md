# 兼容依赖升级记录（2026-10-15）

本轮审查全部 workspace 的直接依赖、optional/peer 依赖、锁文件和 GitHub
Actions，采用兼容 patch/minor 升级策略。沿用原来的精确、`^`、`~` 声明方式，
不新增安全 override，不修改发布版本号或公开 API、导出路径和模块格式。

## 接受的升级

| 依赖                                                   | 升级前  | 升级后  |
| ------------------------------------------------------ | ------- | ------- |
| execa                                                  | 10.1.0  | 10.1.1  |
| Playwright                                             | 1.64.0  | 1.64.1  |
| Turbo                                                  | 2.11.7  | 2.11.8  |
| Vitest / coverage-v8                                   | 5.0.4   | 5.0.5   |
| Vue SFC compiler / Taro Vue runtime                    | 3.5.43  | 3.5.44  |
| Nimbus                                                 | 0.18.0  | 0.18.1  |
| Wrangler                                               | 4.149.0 | 4.151.0 |
| actions/create-github-app-token（自动 release intent） | 3.2.0   | 3.3.0   |

Vitest 5.0.5 在实施期间发布，与 coverage-v8 同步升级以满足精确 peer。
Action 固定完整 SHA `64ab729a6294000f5aa4a4bc0b73d1f32bc45510`，与现有
release workflow 一致。compiler 的 patch intent 由 `corepack pnpm change`
生成，发布由现有 release 流程处理。

Nimbus 官方 dry-run 和 apply 均无迁移、optional review 或错误；只将
`nimbus.json` reviewed baseline 推进到 0.18.1，并同步 `UPSTREAM.md`。
静态站点、项目自有布局、双语导航、组件及 agent endpoint 路由继续保留。

## 保留的版本边界

沿用[上轮兼容评估](./dependency-upgrade-2026-10-13.md)的宿主隔离：

- 共享编译器与 Taro 保持 Babel 7；官方 StyleX runtime/plugin 和可选 SWC
  addon 保持 0.19.1，TypeScript 保持 6.0.3。
- weapp-vite/Wevu 保持 7.4.0。7.5.0 的 Linux 虚拟模块指纹问题未被本轮
  重新接受，公开 peer 保持 `>=7.4.0 <8`。
- Taro 全套保持 4.3.0，使用 Vite 4.5.14 / Webpack 5.91.0、React 18。
  Webpack runner 对 5.91.0 是精确 peer，不能直接更新到 5.111.1。
- uni-app 保持同一 DCloud alpha 通道、Vite 5.2.8、Vue 3.4.21。
  `@dcloudio/types` 保持通道要求的 3.4.31，未接受 3.4.32。
- miniprogram-automator 保持 0.12.1。0.13.0 仍依赖旧 Jimp/ws，不能据此
  声称其传递风险已消除；升级需要独立的 IDE 验收。

现有 semver 范围的 `outdated --compatible` 返回 `{}`。28 项固定版本
检查全部通过，peer 检查结果与升级前完全一致。其余最新版本涉及上述精确
宿主约束或 Babel、React、Vite、TypeScript 等主版本迁移，留待专项评估。
GitHub Actions 的升级后远程 outdated 查询遇到 GitHub 443 超时，未将其
记为通过；本轮目标 Action 使用已有 release workflow 的完整 SHA。

## 安全审计

升级前后均为 **4 critical / 21 high / 40 moderate / 10 low**。
按 advisory ID、模块和已安装版本比较，受影响集合完全一致。审计输出中的
路径枚举有变化；逐条与两份锁文件的图核对后，实际新增风险路径为 0。

遗留问题主要在固定的 Taro/uni/automator 依赖链：旧版 Jimp/minimist、
Taro 的 Swiper、CLI 下载解压工具、Webpack/dev-server，以及 uni-app 的
Vite、Vue server-renderer、Intlify 和 Express。部分修复需要跨主版本，
部分没有已发布修复。本轮没有执行 `audit --fix` 或新增 override，审计
非零退出不能解释为漏洞已修复，也不以升级后总数不变替代路径比对。

## 验证

本地使用 Node 24.21.0、Corepack pnpm 12.11.2。详细诊断保存在忽略跟踪的
`artifacts/dependency-upgrade-2026-10-15/`。

| 验证                                              | 状态                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 冻结安装、changeset check、依赖隔离               | 通过                                                                                         |
| root lint / typecheck                             | 通过；lint 0 错误、8 条既有警告                                                              |
| Vitest / Node 脚本测试                            | 92 / 35 个测试通过                                                                           |
| Babel build / examples                            | 28 份产物及 native/Wevu headless 交互通过                                                    |
| Babel / auto integration                          | 通过；含两种模式的本机打包消费者和真实 omit-optional 安装                                    |
| Babel / auto H5、auto examples 与 CSS 对比        | 通过；两种后端各七份生产/开发 H5，全部 28 份 auto CSS 与 Babel 完全一致                      |
| 最低 weapp-vite/Wevu 7.4.0 宿主                   | Babel/auto 各八份产物、类型和 H5 开发检查通过                                                |
| Node 22.22.1 / 24.11.0 隔离消费者                 | 同一组六个 tarball 均通过；含导出、类型、ESM/CJS 隔离、sourcemap 和省略 SWC addon 的真实安装 |
| 文档 build / lint / typecheck / API / site / test | 通过；58 文档页、83 导出、12 个文档测试                                                      |
| 文档生产浏览器交互                                | 通过；双语搜索、快捷键/焦点、复制、主题持久化、语言切换、桌面/移动布局、无 JavaScript 内容   |
| repo doctor / deps check / check                  | 通过；完整 repo check --full 通过，doctor 145 pass、113 warn、0 fail                         |
| 微信 IDE                                          | 待验收：未设置真实 AppID 和显式 stable DevTools CLI；预检退出 2                              |

本轮不推送、发布或部署。Node 22.23.3 与 Linux 的完整 CI 矩阵仍由后续
CI 执行，本地结果不替代远端验证。

浏览器使用 Playwright 1.64.1 对应的官方 Chromium 156.0.8078.4 / revision
1248，安装到本任务的独立缓存。初次启动的最小页面、H5 截图和文档点击
曾因动画帧/稳定性等待超时失败，日志保留。安装结束后默认参数连续三次
通过动画帧、点击和截图，H5 Babel 与文档随后原样重跑通过。1.64.0 与
1.64.1 使用相同 browser revision；没有更换旧浏览器、追加 launch 参数、
放宽超时或修改断言。该次暂态现象的具体平台原因尚未确定。
