# 依赖升级记录（2026-10-08）

本次按最新兼容稳定版核对全部 workspace 的直接依赖，刷新间接依赖，并修复
原本没有覆盖源码的校验入口。公共 API、StyleX 编译行为和微信支持范围保持既有契约。

## 工具链与直接依赖

| 范围         | 依赖                     | 升级前声明  | 升级后声明  | 结果                                             |
| ------------ | ------------------------ | ----------- | ----------- | ------------------------------------------------ |
| 根目录       | pnpm                     | 12.9.1      | 12.10.1     | 更新 packageManager                              |
| 根目录       | repoctl                  | ^5.8.0      | ^5.8.1      | 更新                                             |
| 根目录       | @commitlint/cli          | ^21.2.3     | ^21.2.3     | 已是最新兼容稳定版                               |
| 根目录       | @eslint/config-inspector | ^3.5.0      | ^3.5.0      | 保留                                             |
| 根目录       | @mpcore/test             | 0.1.15      | 0.1.15      | 保留                                             |
| 根目录       | @types/node              | ^26.6.4     | ^26.6.4     | 保留                                             |
| 根目录       | @vitest/coverage-v8      | ~5.0.3      | ~5.0.3      | 保留                                             |
| 根目录       | eslint                   | ^10.12.0    | ^10.12.0    | 保留                                             |
| 根目录       | execa                    | ^10.1.0     | ^10.1.0     | 保留                                             |
| 根目录       | husky                    | ^9.1.7      | ^9.1.7      | 保留                                             |
| 根目录       | lint-staged              | ^17.6.0     | ^17.6.0     | 保留                                             |
| 根目录       | only-allow               | ^1.2.2      | ^1.2.2      | 保留                                             |
| 根目录       | stylelint                | ^17.16.0    | ^17.16.0    | 保留                                             |
| 根目录       | tailwindcss              | ^4.3.3      | ^4.3.3      | 保留                                             |
| 根目录       | tsd                      | ^0.33.0     | ^0.33.0     | 保留                                             |
| 根目录       | tsdown                   | 0.23.0      | 0.23.0      | 保留                                             |
| 根目录       | turbo                    | ^2.11.7     | ^2.11.7     | 保留                                             |
| 根目录       | typescript               | ^6.0.3      | 6.0.3       | 与 workspace override 对齐，暂不升级到 7.0.2     |
| 根目录       | vitest                   | ~5.0.3      | ~5.0.3      | 保留                                             |
| 根目录       | yaml                     | ^2.9.1      | ^2.9.1      | 保留                                             |
| core、编译器 | @stylexjs/stylex         | 0.19.1      | 0.19.1      | 与插件保持同版本                                 |
| 编译器       | @stylexjs/babel-plugin   | 0.19.1      | 0.19.1      | 已是最新稳定版                                   |
| 编译器       | @babel/core              | ^7.26.9     | ^7.29.7     | 提高 Babel 7 最低版本，锁定解析值原本已为 7.29.7 |
| 编译器       | @types/babel__core       | ^7.20.5     | ^7.20.5     | 保留 Babel 7 类型                                |
| 编译器、示例 | weapp-vite（dev）        | 7.4.0       | 7.4.0       | 已是最新稳定版                                   |
| 编译器       | weapp-vite（peer）       | >=7.4.0 <8  | >=7.4.0 <8  | 保留公开兼容范围                                 |
| 示例         | @weapp-stylex/core       | workspace:* | workspace:* | 保留工作区引用                                   |
| 示例         | @weapp-stylex/weapp-vite | workspace:* | workspace:* | 保留工作区引用                                   |

`pnpm outdated -r --include-workspace-root --format json` 只列出 Babel 8 和
TypeScript 7；两者均是有意保留的兼容例外，其他直接依赖已没有可更新的稳定版。
TypeScript 7 超出 repoctl 当前声明的支持范围。StyleX 编译器继续使用 Babel 7。
保留 `@arethetypeswrong/core>typescript: 5.9.3` 的独立兼容例外。

开发环境 Node 范围由 `>=22.12.0` 调整为 `^22.22.1 || >=24.11.0`。
CI 使用 Node `22.22.1`、`24.18.0`，pnpm 从 `packageManager` 读取。

## 受管资产与间接依赖

先通过 pnpm 升级 repoctl，再预览并应用 repoctl 生成的升级计划。模板及受管基线
从 `2.3.0` 同步到 `2.3.1`，release 工作流使用模板的新 action 固定提交。
微信专用 CI 因没有上游基线被 repoctl 标记为 `baseline-missing`，升级时保留该文件；
其 Node 矩阵、校验步骤和 action 版本由项目单独维护。没有覆盖成通用 monorepo CI。

执行兼容范围内的 workspace update。锁文件中 139 个包名的版本集合发生变化，
其中包含父依赖刷新后移除旧版本的去重结果，完整解析图保存在 `pnpm-lock.yaml`。
主要变更如下：

| 间接依赖                        | 升级前  | 升级后 |
| ------------------------------- | ------- | ------ |
| @icebreakers/monorepo           | 5.8.0   | 5.8.1  |
| @icebreakers/monorepo-templates | 2.3.0   | 2.3.1  |
| weapp-vite 使用的 @babel/core   | 8.0.6   | 8.0.7  |
| @babel/preset-env               | 8.0.6   | 8.0.7  |
| @babel/preset-typescript        | 8.0.1   | 8.0.7  |
| weapp-tailwindcss               | 5.5.11  | 5.5.12 |
| weapp-style-injector            | 1.0.6   | 1.0.7  |
| simple-git                      | 3.36.0  | 4.0.2  |
| @simple-git/argv-parser         | 1.1.1   | 2.0.1  |
| tinypool                        | 2.1.0   | 2.2.0  |
| katex                           | 0.16.47 | 0.19.0 |

weapp-vite 7.4.0 的 Babel 8 presets 通过 peer resolution 错误复用了本项目编译器的
Babel 7。使用限定到 `weapp-vite@7.4.0` 的 `packageExtensions` 补充
`@babel/core: ^8.0.7`，保持两条编译链独立；没有全局替换 Babel 主版本。
兼容检查实际使用 weapp-vite 的 Babel 8 和 TypeScript preset 执行类型剥离。

仍保留两类上游 peer 警告：repoctl 的部分 `@pnpm/*` 包要求 logger 1001，
实际上游使用 1100；devframe 1.1.0 要求 `@devframes/agentic` 1.1.0，
实际解析为 1.2.3。本次没有扩大 override 范围；相关工具校验和原生构建通过。

## 安全 override 和审计

刷新父依赖后仍未获得修复，保留以下局部 override：

| Selector                         | 固定版本 | 兼容验证                                                         |
| -------------------------------- | -------- | ---------------------------------------------------------------- |
| @icebreakers/monorepo>simple-git | 4.0.2    | named simpleGit API；配置读取、状态、远端、日志，与原生 Git 对照 |
| oxfmt>tinypool                   | 2.2.0    | 双线程 CLI 格式化 TS、Vue、Markdown，然后检查产物格式            |
| micromark-extension-math>katex   | 0.19.0   | Markdown 行内、块级公式输出 KaTeX HTML，无解析错误               |

验证入口为 `pnpm test:deps`，临时格式化目录在 `try/finally` 中清理。
这三个 override 均通过验证，无需回退。argv-parser 随 simple-git 更新，未独立覆盖。

审计从 **8 项（4 critical、3 high、1 low）** 降至
**1 high，0 critical、0 moderate、0 low**。已修复 simple-git/argv-parser、
tinypool、KaTeX 对应的 7 项公告。

唯一残留是开发依赖 `braces@3.0.3` 的
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)，
深层嵌套模式可能导致栈耗尽拒绝服务。截至本次审计没有已发布修复版，
返回 `patched_versions: null`。相关路径来自 Stylelint、tsd 和 weapp-vite 的
构建依赖；因此 `pnpm audit --json` 返回退出码 1，不能声称审计零问题。

## 校验入口和验收

- `lint` 从空根项目的 `tsc -b` 改为实际的 `eslint .`，修复全仓 76 个错误。
- `typecheck` 检查独立工具配置，并调用全部 workspace 的类型检查。
- 编译器的独立 typecheck 配置包含源码、测试和 Vitest 配置；示例 `rootDir`
  改为项目目录，允许检查 `vite.config.ts`。
- headless 使用异步主入口，保持 `finally` 关闭测试项目，并用跨平台 URL 转路径。
- README、示例和源码格式统一，贡献文档同步项目的实际命令与 Node 要求。

本地 Node 24.18.0、pnpm 12.10.1 验收：

| 命令                                        | 结果                                             |
| ------------------------------------------- | ------------------------------------------------ |
| pnpm install --frozen-lockfile              | 通过                                             |
| pnpm lint                                   | 通过；0 错误，4 项非阻塞上游/模板警告            |
| pnpm build                                  | 库、编译器和原生示例通过                         |
| pnpm typecheck                              | 工具配置及 3 个 workspace 通过                   |
| pnpm test                                   | 7/7 单测通过                                     |
| pnpm --filter @weapp-stylex/weapp-vite test | 7/7 通过                                         |
| pnpm test:deps                              | 通过，覆盖三个 override 和 Babel 版本隔离        |
| pnpm --filter wechat-native test:headless   | 页面、组件、条件 class、普通分包和 WXSS 断言通过 |
| pnpm exec repo deps check                   | 通过                                             |
| pnpm exec repo doctor                       | 无阻塞失败，保留项目定制的资产漂移提示           |
| pnpm exec repo check --full                 | lint/typecheck/test/build 全部通过               |
| pnpm audit --json                           | 已取得有效报告，残留上述 1 high                  |

单测同时覆盖确定的 sx class、attrs class 字符串、多样式合并、CSS 去重、无 layer
及 specificity polyfill、WXSS 输出和相对 import、无 StyleX 时不改变产物、文件名冲突。
本次未启动真实微信 DevTools/automator，没有产生待清理的浏览器或 DevTools 会话。

通过 `pnpm change` 为编译器的 Babel 依赖声明变更记录 patch 意图；包版本没有手工
递增，本次不执行 npm 发布。
