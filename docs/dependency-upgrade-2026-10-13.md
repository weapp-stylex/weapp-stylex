# 统一构建与依赖升级记录（2026-10-13）

本轮将六个发布包统一到 tsdown，按兼容优先策略评估根工作区、发布包、
示例、文档、optional/peer 依赖和限定范围的 override。示例继续使用各宿主
构建器，文档继续使用 Astro；公开 API、导出路径和模块格式保持原有契约。

本轮采用已批准的兼容策略。weapp-vite/Wevu 7.5.0 虽通过本地验证，推送后
在 Linux 主集成任务失败，因此该版本组保留 7.4.0。其余已完成升级的版本
见下表。保留 7.4.0 后的构建、样式、H5、宿主、doctor 和完整 repo check
均已通过；七份微信产物在串行诊断轮次中逐份通过，未取得单次完整 IDE
suite 通过。本文记录本地证据与候选失败链接，修正提交的远端结果从 main
工作流查询；支付宝、抖音 IDE/真机仍待单独验收。

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

| 范围                      | 依赖                     | 升级前  | 升级后                           |
| ------------------------- | ------------------------ | ------- | -------------------------------- |
| 根工作区                  | pnpm                     | 12.10.1 | 12.11.2                          |
| 根工作区                  | repoctl                  | 5.10.0  | 5.10.3                           |
| 全部发布包构建            | tsdown                   | 0.23.0  | 0.23.1                           |
| 测试工具链                | Vitest / coverage-v8     | 5.0.3   | 5.0.4，同步升级                  |
| Node 类型声明             | `@types/node`            | 26.6.4  | 26.6.5                           |
| Vue 示例类型检查          | vue-tsc                  | 3.3.12  | 3.3.13                           |
| 编译器、宿主依赖 override | PostCSS                  | 8.5.29  | 8.5.30                           |
| 原生、Wevu 示例和开发宿主 | weapp-vite / Wevu        | 7.4.0   | 保留 7.4.0；7.5.0 已评估，未接受 |
| headless 交互             | `@mpcore/test`           | 0.1.15  | 1.0.0                            |
| 编译器 optional addon     | `@stylexswc/rs-compiler` | 0.19.0  | 0.19.1                           |
| 文档站                    | Nimbus                   | 0.17.0  | 0.18.0                           |
| 工具链 override           | Prettier                 | 3.9.9   | 3.9.10                           |
| 限定范围 override         | `uuid@>=14`              | 14.0.2  | 14.0.3                           |

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
| weapp-vite 公共 peer       | `>=7.4.0 <8`                   | 保留既有公开范围，仓库开发/示例宿主固定 7.4.0；不将单个候选版本的部分通过写成完整验收                      |
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

weapp-vite 7.4 的 Babel 8 package extension 保留；7.5 候选的独立 extension
随该组退回而移除。extension 只限定到实际使用的宿主版本，不改变共享
编译器的 Babel 7 解析。最低宿主检查使用隔离安装与打包产物，覆盖
原生/Wevu 四目标及 H5 开发模块请求，独立于现有 integration 套件执行。

## weapp-vite / Wevu 7.5.0 未接受

初次升级提交 `f4a2673` 的 macOS 本地检查通过，但远端 Linux 主验证暴露
weapp-vite 7.5.0 的 `buildTestArtifact()` 问题。宿主无条件执行
`captureWatchDependencies`，将合成的虚拟模块 ID 交给 `path.resolve` / `stat`
生成指纹，产生 `ENAMETOOLONG`。该失败可在没有 StyleX 的原生构建中复现，
位于宿主测试 API 的依赖捕获边界，不能通过适配器处理解决。

[失败任务日志](https://github.com/weapp-stylex/weapp-stylex/actions/runs/38336664366/job/115098177364)
保留实际证据。该轮的四目标 × 两个 Node 共八个平台任务（包括两个 H5）、
最低 Node 打包消费者和文档工作流通过，但两个主集成任务失败，CI 整体仍为
失败。文档工作流记录为 [Documentation 38336664385](https://github.com/weapp-stylex/weapp-stylex/actions/runs/38336664385)。

依据批准规则“出现无法兼容的候选版本时，保留该版本组原值并记录失败证据”，
最终将 weapp-vite 和 Wevu 一起保留在 7.4.0。没有修改上游包、缩短路径、
替换公开测试 API、应用全局 override 或降低断言来接受 7.5.0。公开 peer
继续保持 `>=7.4.0 <8`；已通过的平台编译结果说明此故障的实际范围，但不足
以接受整个开发宿主版本组升级。

## 最低宿主开发更新测试的同步修正

初次远端 Node 22 的最低宿主 auto 测试还暴露一项测试时序问题：旧测试在
原始 watcher `change` 事件之后等待固定 20ms，再仅请求共享样式模块。
文件通知早于 Vite 的异步失效和环境 HMR 完成，固定时长不能证明更新已
处理，单独请求旧模块也不能代表页面 reload 会加载的完整图。

测试现在先确认源码已实际注册至 watcher，再通过 post `handleHotUpdate`
识别本次 token 文件变更，等待宿主原有 `hotUpdateEnvironments` 完成所有
环境的 HMR。随后从宿主页面入口重新加载模块图，并继续断言脚本没有未编译
StyleX 调用、页面与组件主题从 orange 变为 purple、旧值消失且 revision
增加。原有断言保留，超时仍报错；没有主动失效模块、轮询重编译或使用更长
sleep 掩盖问题。

该同步修正之后，最低 weapp-vite/Wevu 7.4.0 的 Babel 和 auto 各八份产物、
类型与 H5 实时 CSS 在 Node 22.23.3、24.21.0 都已通过。该问题属于本项目
新测试的同步边界，与 7.5.0 的宿主虚拟 ID 指纹错误分别处理。

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

### 初次 7.5.0 候选轮次

初次候选涉及原生/Wevu 的完整本地验收使用 weapp-vite/Wevu 7.5.0。
构建、两种 integration、28 份 CSS 对比、H5 和七份 IDE 在 macOS 上通过。
Node 22.23.3/24.21.0 的本地单测和类型检查、最低 Node 消费者及文档检查
也通过。doctor 当时为 156 pass、102 warn、0 fail，full check 通过。
这些结果按当时环境保留，但没有代替最终 7.4.0 的重跑。

推送 `f4a2673` 后，八个平台任务、最低消费者和 Documentation 通过，两个
Linux 主任务失败，CI 整体失败。宿主版本组和 token 测试同步分别按上述
原因处理。

### 保留 7.4.0 后的最终本地验证

最低 Node 消费者复核发现此前 tarball 早于宿主回退，adapter manifest 的
开发依赖仍为 7.5.0。六包已从保留 7.4.0 的最终状态重新打包，确认 manifest
中的开发宿主为 7.4.0，未手动编辑 dist。两个库最低 Node 的独立消费者均已
重新通过；旧消费者日志只保留在初次候选轮次。

| 验证组                   | 最终 7.4.0 结果                                                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| frozen install、deps     | pnpm 12.11.2 冻结安装、限定 override 检查和 repo deps check 通过                                                                                                                                                                                                |
| tsdown 迁移              | 六包构建、声明、导出目标、模块格式与 sourcemap 验收通过；迁移独立提交为 `a49b22a`                                                                                                                                                                               |
| 根 build                 | Node 24.21.0 全仓构建通过，包含六个库、文档与 28 份示例产物                                                                                                                                                                                                     |
| 根 lint/typecheck/test   | Node 24.21.0 最终 lint 零错误、8 条既有警告；全仓 typecheck 与 92 个单测通过；最终 lint 日志 `artifacts/lint-host-retained-final-node24.log`                                                                                                                    |
| 脚本测试                 | Node 22.23.3 与 24.21.0 各 35 个测试、5 个 suite 全部通过，零失败、跳过或取消；日志 `artifacts/scripts-host-retained-final-node{22,24}.log`                                                                                                                     |
| Babel/auto integration   | 两种模式通过，包含无宿主安装、native addon 缺失、真实 omit-optional 消费者及缓存检查                                                                                                                                                                            |
| examples 与样式对比      | 两种模式的 28 份产物全部通过，每份 CSS 完全一致；原生/Wevu headless 交互均通过                                                                                                                                                                                  |
| 七份 H5                  | Babel/auto 各七份生产与开发检查通过，全部自有服务器和浏览器资源关闭                                                                                                                                                                                             |
| 最低宿主矩阵             | Node 22.23.3/24.21.0 的 Babel/auto 原生和 Wevu 四目标各八份产物、类型和 H5 实时 CSS 全部通过                                                                                                                                                                    |
| 最低 Node 消费者         | 最终六个 tarball 在 Node 22.22.1/24.11.0 重新通过导出目标、optional 宿主、ESM/CJS runtime 隔离、编译、公开类型、ESM sourcemap 和实际 addon-omitted 安装检查；adapter manifest 确认开发宿主 7.4.0                                                                |
| 文档                     | check:site 通过 58 个页面；API 检查通过 13 个入口、24 个声明条件、83 个导出和双语 144 个章节；Nimbus reviewed baseline 保持 0.18.0                                                                                                                              |
| repo doctor/check        | Node 24.21.0 doctor 为 156 pass、102 warn、0 fail；最终 `repo check --full` 退出码为 0，包含 28 份产物构建；日志 `artifacts/check-host-retained-full-node24.log`                                                                                                |
| 七份微信 IDE             | 最终 auto 产物在串行诊断轮次中逐份通过；汇总 `artifacts/ide-host-retained-acceptance-2026-10-13.json` 为 `passed-per-artifact`，`singleFullSuitePassed: false`；全部自有窗口、web contents 与端口关闭                                                           |
| 支付宝、抖音 IDE/真机    | 待验收，不以构建或 H5 检查替代                                                                                                                                                                                                                                  |
| 修正提交的 CI/文档工作流 | 最新 main 状态见 [CI](https://github.com/weapp-stylex/weapp-stylex/actions/workflows/ci.yml?query=branch%3Amain) 与 [Documentation](https://github.com/weapp-stylex/weapp-stylex/actions/workflows/docs.yml?query=branch%3Amain)；初次 `f4a2673` 的失败证据保留 |

最终消费者日志为 `artifacts/test-package-host-retained-node22.22.1.log` 与
`artifacts/test-package-host-retained-node24.11.0.log`，对应保留组重新打包的
全部六个产物。

文档阶段在本机 Node 24.18.0 / pnpm 12.11.2 执行，符合升级后的私有
workspace engines；初次候选的根构建、类型检查与文档复验随后在指定 Node
上通过。保留 7.4.0 后的最终本地检查见独立验收表和逐份 IDE 证据；修正提交
的实际远端结果以 main 工作流为准。
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

## 初次候选的重试与资源记录

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
两个 builder、uni-app 共七份均通过。该次候选报告为
`artifacts/ide/run-1791857629382/report.json`，截图与日志位于同一 run 目录。

该次验收核对官方版本源，安装版与最新稳定版同为 2.02.2608080，SDK 为
3.17.4，继续使用已授权 AppID。七个自有项目窗口 s81–s87、web contents 与
对应 automator 端口均已关闭；用户原有项目保持原有资源归属。支付宝、抖音
IDE 与真机验收仍待实际执行。

## 保留 7.4.0 后的 IDE 重试

保留组首次完整 auto suite 的原生检查通过，随后 Wevu automator 在已连接
环境中等待响应超时。第二次尝试在原生的已连接环境再次超时，截图中页面
正常渲染。两次 suite 均按错误失败并关闭自有资源，报告分别保留为
`artifacts/ide-host-retained-first-attempt-2026-10-13.json` 与
`artifacts/ide-host-retained-second-attempt-2026-10-13.json`。所有 H5 资源
关闭且没有其他构建时继续执行串行复验，后续保留组的逐份结果独立汇总，
不使用先前 7.5.0 候选轮次代替。

已确认一项 IDE 启动同步边界：CLI 预先打开项目后首次原生页面 ready，
`automator.launch()` 会再触发页面 reload。预打开阶段的 ready 不能证明
第二个 runtime 已就绪，过早发送 `App.enableLog` 会在连接存在时超时。
第三次尝试虽前三份通过，第四份又触发 SDK `checkVersion` 的 `.split`
时序错误，报告保留为
`artifacts/ide-host-retained-third-attempt-2026-10-13.json`。仅在 SDK launch
返回后等待页面也不足够，因为 SDK 内部已经连接并开始检查版本。

最终助手以 native journal 的操作前 checkpoint 标识本次启动，使用选定
CLI 的 `auto` 命令启用对应项目和端口，等待只属于本任务窗口的新增
page-ready，然后调用公开 `sdk.connect()`。SDK 的正常版本检查保留，环境
RPC 在连接后执行。CLI 的 stdout/stderr 在成功和失败时都保留；CLI、native
就绪或协议错误仍向上报错，没有重启回退、延迟或应用错误过滤。

脚本回归覆盖 CLI 参数/证据、就绪前禁止连接、失败时禁止连接与传播，以及
操作前历史、其他窗口、尚未有窗口归属的 checkpoint、日志截断/rollover、
部分记录和其他 journal 的 checkpoint。Node 22.23.3 与 24.21.0 的全部
35 个脚本测试、5 个 suite 已通过。第四次完整尝试的原生与 Wevu 通过，
随后 Taro React Webpack 在预打开 CLI `open` 阶段失败，尚未进入 auto、
版本检查和 SDK 连接；该次三个自有资源均已关闭，报告保留为
`artifacts/ide-host-retained-fourth-attempt-2026-10-13.json`。

第五次完整尝试以直接 auto 启动作诊断，原生通过后 Wevu 在结构就绪阶段的
`App.getPageStack` 超时，此前版本、账号和系统查询已成功；该次两个自有
资源关闭。第六次从 Taro React 开始，两个 builder 通过，随后 Taro Vue
Webpack 预打开就绪失败。第七次以直接 auto 从 Taro Vue 开始，两个 builder
通过，随后 uni-app 未达到本次 native 就绪门禁。这些失败仍分别保留在
`artifacts/ide-host-retained-{fifth,sixth,seventh}-attempt-2026-10-13.json`，
全部自有资源关闭。直接启动仅用于诊断，macOS 默认仍保留原预打开流程。

最后使用预打开流程单独验收 uni-app 通过，报告
`artifacts/ide/run-1791860867510/report.json` 的实际状态为 `partial`，范围
为第七份产物。最终七份未重新构建的 auto 产物均有通过证据，汇总报告为
`artifacts/ide-host-retained-acceptance-2026-10-13.json`，状态
`passed-per-artifact`、`singleFullSuitePassed: false`。失败的完整/部分
suite 保留原状态，没有将逐份汇总改写成单次完整 suite 通过。

| 最终保留组产物     | 通过证据              | run 目录                                          |
| ------------------ | --------------------- | ------------------------------------------------- |
| 原生               | 第四次报告            | `artifacts/ide/run-1791860260822/0-wechat-native` |
| Wevu               | 第四次报告            | `artifacts/ide/run-1791860260822/1-wechat-wevu`   |
| Taro React Webpack | 第六次报告            | `artifacts/ide/run-1791860594996/2-taro-react`    |
| Taro React Vite    | 第六次报告            | `artifacts/ide/run-1791860594996/3-taro-react`    |
| Taro Vue 3 Webpack | 第七次报告            | `artifacts/ide/run-1791860733630/4-taro-vue3`     |
| Taro Vue 3 Vite    | 第七次报告            | `artifacts/ide/run-1791860733630/5-taro-vue3`     |
| uni-app Vue 3      | 最后一次 partial 报告 | `artifacts/ide/run-1791860867510/6-uni-vue3`      |

保留组核对最新官方稳定版 2.02.2608080、SDK 3.17.4，继续使用已授权
AppID；结构、交互、主路由/分包和 runtime 无错误断言保留。各轮自有窗口、
web contents 和 automator 端口均关闭，用户无关的 `app-lifecycle-wevu-ts`
项目保持打开。支付宝、抖音 IDE 与真机验收仍待实际执行。

2026-10-09 的依赖与性能记录、2026-10-12 的真实 IDE 记录保留原日期和环境，
不改写为本轮结果。本轮通过 `corepack pnpm change` 记录受影响发布包，
构建迁移与依赖升级分开提交，不发布 npm。
