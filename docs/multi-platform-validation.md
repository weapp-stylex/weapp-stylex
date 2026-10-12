# 多平台实现与验收（2026-10-12）

本轮将已有五种框架接入扩展到微信、支付宝、抖音和 H5。每个目标包含七份产物：原生、Wevu、Taro React/Vue 3 各两个 builder，以及 uni-app Vue 3，共 28 份。此前的[多框架记录](multi-framework-validation.md)与[微信 IDE 记录](ide-validation-2026-10-09.md)保留原日期结果，不代表新平台的设备验收。

## 实现边界

共享 compiler 使用 `weapp`、`alipay`、`tt`、`web` 四个目标；适配器从活动宿主推断并拒绝冲突配置。小程序输出分别使用 WXML/WXSS、AXML/ACSS、TTML/TTSS。默认 token 变量映射到 `page`，主题 class 保留。原有 `WxssEmitter()` 和默认微信行为兼容。

H5 保留浏览器 `:root`。Taro 与 uni-app 输出带内容 hash 的独立 CSS，并通过 HTML link 交付；原生/Wevu 将 CSS 接入 weapp-vite Web runtime 的页面与组件样式 metadata，页面提供默认变量，组件可继承页面主题。官方 StyleX runtime 根入口保持纯 runtime，不加入构建依赖或 CSS 注入。

原生支付宝组件按 Component2 契约声明 `props` 与 `deriveDataFromProps(nextProps)`，在创建和更新前从新属性同步主题样式，同时保留初始 `data`。生命周期签名与调用时机参考支付宝官方 [mini-types](https://github.com/ant-mini-program/mini-types/blob/master/types/component.d.ts)；微信、抖音继续使用 `properties` observer。

数值与显式 px 保留官方单位语义，仅静态 rpx 按宿主 H5 策略转换；动态值使用 px、rem、vw 等浏览器标准单位。H5 开发更新允许完整刷新。示例使用相对 base/publicPath，浏览器验收从 `/stylex-preview/` 子路径访问，覆盖外部 stylesheet 路径。

Taro H5 开发服务使用绝对 `publicPath: '/'`，生产构建使用 `'./'` 以支持子路径部署。Webpack dev middleware 直接以 publicPath 挂载资产，相对路径会导致脚本请求落入 HTML fallback。开发输出追加 `-dev` 后缀，避免宿主清空或写入同路径而污染生产产物。React Webpack dev 所需的 optional Fast Refresh 插件及 runtime 作为示例开发依赖显式声明。

Taro Webpack H5 dev 设置 `client.overlay: { warnings: false, errors: true }`。auto 后端主动保留 Babel 的兼容提示仍输出到终端与 console，避免预期 warning 浮层拦截页面交互；实际编译错误继续显示浮层。

weapp-vite 7.4 Web runtime 仍属实验性，目前不编译 Wevu JSX 渲染函数。Wevu 示例通过宿主 `weapp.autoImportComponents.resolvers`，根据活动 runtime 为 H5 选择等价 SFC，小程序保留原 TSX fixture；resolver 提供真实组件路径与 sourceType。示例应用不声明 `sideEffects: false`，保留页面与组件的注册调用。该语法限制属于宿主能力边界，不能通过额外引入 Vue DOM runtime 消除。

该 Web runtime 在 scan 阶段缓存 SFC 时可能早于 Vite 原始源码转换。适配器为宿主所属的 Web component 请求选择原始源码身份，并在宿主编译后调用共享 `StylexSession.transformCompiledSfcScript()`；metadata 归属原物理 `.vue`，保留原始 SFC 规则，重放依赖并组合 script map。生成脚本在默认/auto 模式仍使用 Babel，模板、宏、生命周期和独立 template/style 模块继续由宿主管理；这不是任意编译失败后的回退路径。

weapp-vite 7.4 CLI 的开发编排路径曾返回就绪但未启动 HTTP 服务。示例 `dev:h5` 使用公开 compiler context 合并 Web 配置，解析宿主自己的 Vite 版本启动服务，并显式处理 SIGINT/SIGTERM 与 watcher 清理；不额外启动 MCP。原生开发端口已实际请求验证 HTTP 200，并在关闭后核对监听端口消失。

## 自动验收入口

在 Node 24.18.0、Corepack pnpm 12.10.1 上执行本地验证；CI 为 Node 22.22.1 与 24.18.0 设置独立目标任务。Babel 和 `WEAPP_STYLEX_BACKEND=auto` 顺序运行，分别检查产物并比较规范化后的 CSS。原始 SFC 与主题仍使用 Babel。

| 入口                                                        | 覆盖内容                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `corepack pnpm build`                                       | 包、文档和 28 份平台产物                                                                      |
| `corepack pnpm exec node scripts/build-examples.mjs alipay` | 单目标七份产物，CI 在独立 checkout 中隔离输出                                                 |
| `corepack pnpm test:examples`                               | 28 份输出的扩展名、token、共享 class、单位、分包及无多余平台资产；微信原生/Wevu headless 交互 |
| `WEAPP_STYLEX_TARGET=alipay corepack pnpm test:examples`    | 单目标产物验证                                                                                |
| `corepack pnpm test:h5`                                     | 七种 H5 生产与开发模式的真实 headless Chromium 交互、主题、动态值、样式编辑和子路径部署       |
| `corepack pnpm test:integration`                            | 模块图、watch 生命周期、缓存恢复、CSS 清理与输出所有权                                        |
| `corepack pnpm --filter docs check:site`                    | 双语 API、站点路由、锚点、Markdown/MDX、搜索与 AI 索引                                        |

## 本轮实际结果

| 验证                                                                               | 状态 | 权威日志或报告                                                                                            |
| ---------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------- |
| Babel 四目标、七条框架/builder 链路，共 28 份生产产物                              | 通过 | `artifacts/build-babel-final.log`、`artifacts/examples-babel-final.log`                                   |
| Babel 与 auto 微信原生/Wevu headless 交互                                          | 通过 | `artifacts/examples-babel-final.log`、`artifacts/examples-auto-final.log`                                 |
| Babel 七条 H5 链路的生产与开发浏览器交互，共 14 组                                 | 通过 | `artifacts/h5-babel-final.log`、`artifacts/h5/babel/report.json`                                          |
| 92 项单元测试                                                                      | 通过 | `artifacts/test-final.log`                                                                                |
| 14 项 Node 脚本测试                                                                | 通过 | `artifacts/node-tests-final.log`                                                                          |
| Babel 与 auto 集成：三小程序目标、Vue-loader、watch/cache、H5 生命周期、打包消费者 | 通过 | `artifacts/integration-babel-final.log`、`artifacts/integration-auto-final.log`                           |
| auto 四目标共 28 份生产产物，逐产物 CSS 与 Babel 完全一致                          | 通过 | `artifacts/build-auto-final.log`、`artifacts/examples-auto-final.log`                                     |
| auto 七条 H5 生产/开发浏览器交互，共 14 组                                         | 通过 | `artifacts/h5-auto-final.log`、`artifacts/h5/auto/report.json`                                            |
| 双语文档 build、lint、typecheck、API/站点验证                                      | 通过 | `artifacts/docs-build-multiplatform.log`、`artifacts/docs-api-final.log`、`artifacts/docs-site-final.log` |

Babel 与 auto H5 报告均包含原生、Wevu、Taro React/Vue 3 各两个 builder 以及 uni-app 七条链路，每种后端全部 production/development 为 `passed`，共 28 组浏览器验收；浏览器为 headless，两份报告的静态服务、浏览器和七个开发服务的 `resources.closed` 均为 `true`。验收覆盖首次样式、条件合并、主题切换、Shadow DOM 主题继承、动态值、静态 rpx 与数值 px、分包导航、样式及 token 编辑恢复、生产子路径部署。结束后复核 shared/token 源码恢复，未残留测试修改。

28 份产物检查在 Babel 和 auto 两种模式均覆盖目标扩展名、token、共享 class、单位、分包和平台资产隔离；auto 的 28 份 CSS 与保存的 Babel 基线逐份完全一致。Taro 与 uni-app H5 均交付非空 hash CSS 与 HTML link。文档最新检查为 29 对双语页面、58 个页面、13 个公开入口、83 个 API 导出和两语言各 144 个 API 章节。上述本地日志不将构建或浏览器通过提升为小程序 IDE、真机或远端 CI 通过。

根级冻结依赖安装、lint（0 错误、8 项既有警告）、typecheck、`test:deps`、`repo deps check`、`repo check` 与 `repo check --full` 均通过；doctor 结果为 118 pass、140 suggestions、0 fail，`git diff --check` 通过。对应日志依次为 `artifacts/install-final.log`、`artifacts/lint-final.log`、`artifacts/typecheck-final.log`、`artifacts/deps-final.log`、`artifacts/repo-deps-final.log`、`artifacts/repo-check-final.log`、`artifacts/repo-check-full-final.log`、`artifacts/doctor-final.log`。最新 docs API/站点重跑仍通过：13 公开入口、83 导出、每语言 144 API 章节与 58 页面。

## IDE 与设备待验收

本机已安装支付宝开发者工具 3.10.10（`com.ant.miniprogram`）和抖音开发者工具 4.5.6（`ide.micro.app.bytedance`）。当前会话未配置这些平台的真实项目 AppID、身份与项目授权，因此支付宝/抖音 IDE 和设备运行验收仍待完成。需要验证组件属性更新、隔离样式与主题、动态 CSS 变量、分包导航及宿主基础库兼容性。

微信七份产物继续使用 `test:ide` 的全局串行 automator 流程，需要真实 `WEAPP_STYLEX_APPID`、显式 `WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH`、登录和服务端口。本轮未用 tourist mode 替代真实项目验收。缺少项目或身份前提记录为 pending；历史单份通过不提升为本轮完整 suite 通过。

本轮使用 `corepack pnpm change` 记录 compiler、三个适配器与 facade 的 minor 变更意图，不手动修改版本、不发布 npm。其余小程序平台、独立分包、Vue 2、uni-app x、WXML `sx` 语法和 stateful HMR 继续留在后续范围。
