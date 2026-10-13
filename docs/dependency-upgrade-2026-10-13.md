# 统一构建与依赖升级记录（2026-10-13）

本轮将六个发布包统一到 tsdown，按兼容优先策略评估根工作区、发布包、
示例、文档、optional/peer 依赖和限定范围的 override。示例继续使用各宿主
构建器，文档继续使用 Astro；公开 API、导出路径和模块格式保持原有契约。

以下版本已按批准的兼容策略升级。本地检查与目标矩阵验收已完成，支付宝、
抖音 IDE/真机以及提交推送后的远端工作流状态单独记录，不沿用历史结果作为
本轮通过证据。

## tsdown 构建边界

| 发布包                     | 原构建器 | 本轮构建器 | 保留的代码入口                           |
| -------------------------- | -------- | ---------- | ---------------------------------------- |
| `@weapp-stylex/core`       | tsc      | tsdown     | ESM `dist/index.js`、`dist/index.d.ts`   |
| `@weapp-stylex/weapp-vite` | tsc      | tsdown     | ESM `dist/index.js`、`dist/index.d.ts`   |
| `@weapp-stylex/compiler`   | tsdown   | tsdown     | ESM/CJS 与对应声明                       |
| `@weapp-stylex/taro`       | tsdown   | tsdown     | ESM/CJS、公开 loader 和内部 Webpack 入口 |
| `@weapp-stylex/uni-app`    | tsdown   | tsdown     | ESM/CJS 与对应声明                       |
| `weapp-stylex`             | tsdown   | tsdown     | 原有七个代码入口、ESM/CJS 与对应声明     |

core 使用 `platform: 'neutral'`、`target: 'es2022'`；weapp-vite 使用 Node
平台和 `target: 'node22'`。两包固定原有 `.js` / `.d.ts` 扩展名并清理旧产物，
没有新增 CJS 入口。聚合包保留 `cjsDefault: false`，tsc 继续负责类型检查。
不启用 `isolatedDeclarations`。

依赖、optional 依赖和框架 peer 保持 external。官方 runtime、Babel、SWC
addon 和框架宿主不会内联到产物；根 runtime 入口不会加载构建工具。

两个迁移包均启用 JS 与声明 sourcemap。core 是纯 external 转导出，tsdown
会省略没有可映射代码的 map；验收检查转导出及无悬空 `sourceMappingURL`。
weapp-vite 的实际代码产物则检查 JS/dts map、源码路径和源码内容。

## 本轮依赖升级

| 范围                      | 依赖                     | 升级前  | 升级后          |
| ------------------------- | ------------------------ | ------- | --------------- |
| 根工作区                  | pnpm                     | 12.10.1 | 12.11.2         |
| 根工作区                  | repoctl                  | 5.10.0  | 5.10.3          |
| 全部发布包构建            | tsdown                   | 0.23.0  | 0.23.1          |
| 测试工具链                | Vitest / coverage-v8     | 5.0.3   | 5.0.4，同步升级 |
| Node 类型声明             | `@types/node`            | 26.6.4  | 26.6.5          |
| Vue 示例类型检查          | vue-tsc                  | 3.3.12  | 3.3.13          |
| 编译器、宿主依赖 override | PostCSS                  | 8.5.29  | 8.5.30          |
| 原生、Wevu 示例和开发宿主 | weapp-vite / Wevu        | 7.4.0   | 7.5.0           |
| headless 交互             | `@mpcore/test`           | 0.1.15  | 1.0.0           |
| 编译器 optional addon     | `@stylexswc/rs-compiler` | 0.19.0  | 0.19.1          |
| 文档站                    | Nimbus                   | 0.17.0  | 0.18.0          |
| 工具链 override           | Prettier                 | 3.9.9   | 3.9.10          |
| 限定范围 override         | `uuid@>=14`              | 14.0.2  | 14.0.3          |

沿用各依赖原有的精确锁定、`^` 或 `~` 声明方式。其余已经是最新兼容版本的
直接依赖保持原值。GitHub Actions 仍固定完整 commit SHA；
`actions/create-github-app-token` 的目标 v3.3.0 对应
`64ab729a6294000f5aa4a4bc0b73d1f32bc45510`。

## 保留版本与理由

| 依赖组                     | 保留版本                       | 理由                                                                                                       |
| -------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| TypeScript                 | 6.0.3                          | TypeScript 7 从根入口移除旧 Compiler API；repoctl、Astro check、TypeScript ESLint 及仓库的相关使用尚未迁移 |
| 官方 StyleX runtime/plugin | 0.19.1                         | 官方编译与 runtime 保持同版本                                                                              |
| 共享编译器和 Taro 的 Babel | 7.29.7                         | 与官方 StyleX、Taro 的 Babel 7 编译链一致；不套用 weapp-vite 的 Babel 8 presets                            |
| Taro 全套平台包            | 4.3.0                          | React/Vue 3、三小程序平台和 H5 采用同版本宿主包                                                            |
| Taro Vite / Webpack        | 4.5.14 / 5.91.0                | 遵循宿主 runner 的约束，不跨主版本覆盖                                                                     |
| Taro React / React DOM     | 18.3.1                         | 保留 React 18 配套 runtime 与类型                                                                          |
| Taro Vite 插件             | React 4.7.0 / Vue 4.6.2        | 兼容其 Vite 4 构建链                                                                                       |
| Taro Vue JSX Babel 插件    | 1.5.0                          | 新版的 ESM-only / Babel 8 边界不适合现有同步 CJS 配置                                                      |
| DCloud Vue 3 平台包        | `3.0.0-alpha-5030120260930001` | 保持当前 vue3 通道整套精确对齐，使用 DCloud 配套 SFC parser                                                |
| uni-app Vite / Vue         | 5.2.8 / 3.4.21                 | 遵循 DCloud 精确宿主约束                                                                                   |
| DCloud types               | 3.4.31                         | uni-app peer 精确要求；新版 3.4.32 不匹配                                                                  |
| weapp-vite 公共 peer       | `>=7.4.0 <8`                   | 示例升到 7.5，不缩小既有 7.4 兼容范围；分别验收                                                            |
| Vite 8 scoped override     | 8.3.4                          | 仅影响 Vite 8 组，保留 Taro Vite 4 和 uni-app Vite 5                                                       |
| ATTW 的 TypeScript 例外    | 5.9.3                          | 类型诊断工具自己的兼容依赖，不替换仓库 TypeScript 6                                                        |

repoctl 维护的分组继续表达这些有意的版本差异。遇到不兼容候选时保留该组，
记录约束和失败证据，不通过全局 override 或降低测试要求接受升级。

## SWC、缓存与宿主兼容

SWC 版本标识从编译器的 optionalDependencies 派生，缓存指纹与实际固定的
addon 版本保持一致。默认 Babel 和 runtime 仍不加载 native addon；
缺少 optional 安装时 Babel 可用，auto 保留受控回退行为。

raw SFC 继续使用 Babel。0.19.1 尚无经过验证的上游修复可避免移除只在 Vue
模板中使用的绑定和组件导入，不因 addon 小版本升级取消该保护。

weapp-vite 7.5 仍需独立的 Babel 8 package extension；7.4 extension 保留给
最低宿主验收。extension 只限定到对应 weapp-vite 版本，不改变共享编译器的
Babel 7 解析。最低宿主检查使用隔离安装与打包产物，覆盖原生/Wevu 四目标
及 H5 开发模块请求，独立于现有 integration 套件执行。

## repoctl 与 Nimbus 迁移

repoctl 受管资产需通过官方预览和三方合并审查。项目自有目标矩阵、CI、
依赖分组和限定范围 override 应保留；任何会把框架 Vite/Babel 组统一的
默认修改不应应用。5.10.3 官方预览保存于 `artifacts/repoctl-5.10.3-plan.json`；
通过官方应用 API 选择可应用项，保留 workspace override、定制 CI 和
`repoctl.config.ts`。CI 没有受管 baseline，配置文件的本地依赖分组与上游新增
release hook 发生重叠，均保留项目实现。应用采用 Renovate 的七天等待和 strict
内部检查设置，受管 release Action 继续固定完整 SHA。

Nimbus 0.18.0 的实际官方 dry-run 没有必需源码迁移，只返回八条 optional
review：图片缩放、Markdown features、数学渲染、nested llms scopes、page action
搜索摘录、404 head、starter 组件修正和版本切换器。本站只使用
`docsCollection()`，没有 API 集合或版本切换器。官方
`migrate --yes --json` 已通过，只将 `nimbus.json` reviewed baseline 推进到
0.18.0；`UPSTREAM.md` 同步审查结果。预览和应用 JSON 保存在
`artifacts/nimbus-0.18-dry-run.json` 与 `artifacts/nimbus-0.18-apply.json`。

项目自有布局、导航、主题和搜索继续保留。现有 404 已输出 noindex，搜索按钮
已声明 `type="button"`；项目没有需要移除的 Nimbus/Sätteri override 或 patch。
`[section]/llms.txt.ts` 保留顶层索引，不添加会与其冲突的可选 `[...section]`
路由。没有引入图片缩放、数学等可选功能。

## Node 与验证状态

私有仓库和文档 engines 为 `^22.22.3 || ^24.16.0 || >=26.3.0`，开发/CI
使用 Node 22.23.3、24.21.0。发布包 engines 继续保持
`^22.22.1 || >=24.11.0`，在 Node 22.22.1、24.11.0 上独立验收六个 tarball
的导出文件、类型与 ESM/CJS API，不在旧 Node 下运行要求更高的仓库工具链。

| 验证组                                       | 本轮状态                                                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| frozen install                               | 初始 pnpm 12.10.1 与升级后 pnpm 12.11.2 冻结安装均已通过                                                                                                                                   |
| tsdown 迁移构建、类型与 tarball              | 迁移提交 `a49b22a`：六包构建、类型检查及打包消费者已通过                                                                                                                                   |
| 分阶段依赖与宿主检查                         | 工具链阶段六包构建及 92 个测试通过；编译器阶段 70 个测试及 integration（含打包检查）通过；最低 weapp-vite/Wevu 7.4 的 Babel/auto 原生和 Wevu 四目标共八份产物、类型及 H5 实时 CSS 检查通过 |
| 根 lint/build/typecheck/test、脚本测试、deps | Node 24.21.0 根 build（28 份产物和文档）、lint、typecheck、deps 通过；Node 22.23.3/24.21.0 各 92 个单测及全仓类型检查通过；Node 24.21.0 脚本 23 个测试通过；lint 保留 8 条非阻塞警告       |
| Babel/auto integration 与 28 份产物 CSS 对比 | Node 24.21.0 两种模式 integration（含打包消费者）通过；有序 Babel/auto 构建的 28 份产物全部通过检查，每份 CSS 完全一致，两个模式的原生/Wevu headless 交互均通过                            |
| 七份 H5 生产/开发、主题/Shadow DOM/headless  | Babel/auto 各七份 H5 的生产与开发浏览器检查全部通过；覆盖原生、Wevu、Taro React/Vue 3 两个 builder 和 uni-app；报告 `artifacts/h5/{babel,auto}/report.json` 的自有资源全部关闭             |
| 文档 API、站点、MD/MDX、llms、Pagefind       | Nimbus 迁移/check、lint（含生产 build）、typecheck、check:site 和 12 个测试已通过；60 个 HTML 页面、58 个文档页面、两种语言的搜索索引                                                      |
| 文档生产浏览器交互                           | Node 24.21.0 headless 通过双语 Pagefind、快捷键/焦点、代码复制、主题持久化、语言切换、桌面/移动布局和无 JS 内容；所有测试资源已关闭                                                        |
| repo doctor/check                            | Node 24.21.0 doctor 为 156 pass、102 warn、0 fail；deps check 与 `repo check --full` 的 lint/typecheck/test/build 全部通过                                                                 |
| 两版本 Node 与最低消费者                     | Node 22.23.3/24.21.0 单测和类型检查通过；Node 22.22.1/24.11.0 的六个打包消费者及真实 omit-optional 安装检查均通过                                                                          |
| 七份微信真实 IDE                             | 完整 auto 重试七份全部通过，官方稳定版 2.02.2608080、SDK 3.17.4；首次 Babel 尝试的 DevTools 内部错误仍保留，详见下方记录                                                                   |
| 支付宝、抖音开发工具与真机                   | 待验收，不以构建或 H5 检查替代                                                                                                                                                             |
| 推送后的 CI 与文档工作流                     | 本地验收完成，待提交推送后确认远端结果与链接                                                                                                                                               |

文档阶段在本机 Node 24.18.0 / pnpm 12.11.2 执行，符合升级后的私有
workspace engines；随后根构建和类型检查已在 Node 24.21.0 通过，指定 Node 的
Node 22.23.3 全仓类型检查也已通过；最终文档 `check:site` 与 12 个测试也在
Node 24.21.0 通过。远端工作流仍待提交推送后确认。
`check:site` 覆盖 58 个文档页面、290 个源码锚点、142 个自定义组件，API
检查覆盖 13 个公开入口、24 个声明条件、83 个导出和双语 144 个章节。
Astro check 的 47 个文件为零错误、警告与提示。官方 Nimbus check 的 env、
structure、migrations、authoring、types 五组全部通过，零 findings。
文档日志为 `artifacts/docs-0.18-{lint,typecheck,check-site,test}.log`，官方
完整检查为 `artifacts/nimbus-0.18-check.json`。

生产浏览器检查由 `corepack pnpm exec node scripts/test-docs-browser.mjs` 执行，
使用一个自有 headless browser 和工作页面，分别检查英文、中文及移动视口；
再关闭原 context 并验证无 JavaScript 的正文、代码和语言链接。报告为
`artifacts/docs-browser/report.json`，测试关闭自有 context/browser/server 后
记录资源状态。该脚本接入独立 `.github/workflows/docs.yml` 文档工作流，
使用 Node 24.21.0，补充静态站点契约检查。

## 重试与资源记录

早先 auto 构建与完整 repo check 重写同一产物目录时，examples 检查报告
Taro React Webpack 缺少 StyleX 样式，H5 检查在原生首帧等候 `#stylex-root`
超时。这两次失败分别保存在 `artifacts/examples-auto-node24.log` 与
`artifacts/h5-auto-node24.log`，不能作为本轮验收通过。后续先独立完成 Babel
基线采集（`artifacts/examples-babel-node24-ordered.log`），再有序重建 auto，
检查产物、CSS 与浏览器行为。有序 Babel/auto 的 28 份产物已全部通过，
每份 CSS 完全一致，两个模式的原生/Wevu headless 交互均通过。随后独立的
auto H5 浏览器重跑七份生产与开发检查全部通过，和先前 Babel 的七份通过
结果分别记录；所有自有静态服务器、开发服务与 headless browser 均已关闭。

微信 IDE 首次 Babel 尝试完成原生样式结构和交互检查后，日志捕获 DevTools
内部 `routeDone` 的 `webviewId` 缺失，suite 按错误检查失败并关闭自有资源。
失败报告保留在 `artifacts/ide-first-attempt-2026-10-13.json`。随后完整 auto
重试于 2026-10-13 执行，原生、Wevu、Taro React 两个 builder、Taro Vue 3
两个 builder、uni-app 共七份均通过。报告为 `artifacts/ide/report.json`，
各产物截图与日志位于 `artifacts/ide/run-1791857629382/`。

该次验收核对官方版本源，安装版与最新稳定版同为 2.02.2608080，SDK 为
3.17.4，继续使用已授权 AppID。七个自有项目窗口 s81–s87、web contents 与
对应 automator 端口均已关闭；用户原有项目保持原有资源归属。支付宝、抖音
IDE 与真机验收仍待实际执行。

2026-10-09 的依赖与性能记录、2026-10-12 的真实 IDE 记录保留原日期和环境，
不改写为本轮结果。本轮通过 `corepack pnpm change` 记录受影响发布包，
构建迁移与依赖升级分开提交，不发布 npm。
