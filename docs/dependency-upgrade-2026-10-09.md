# 依赖升级记录（2026-10-09）

本次核对 npm 已发布版本和宿主框架的兼容约束，升级可兼容的直接依赖，并刷新
锁文件中的间接依赖。公共 API、StyleX 单位语义和微信支持范围保持原有契约。

## 实际解析版本升级

| 范围                   | 依赖                    | 升级前  | 升级后 |
| ---------------------- | ----------------------- | ------- | ------ |
| 文档站                 | @cloudflare/nimbus-docs | 0.16.0  | 0.17.0 |
| 文档站                 | astro                   | 7.3.7   | 7.3.8  |
| 编译核心               | magic-string            | 0.30.21 | 1.4.3  |
| 原生、Wevu、文档工具链 | Vite 8                  | 8.3.3   | 8.3.4  |

下列声明的最低版本也与已解析的兼容版本对齐；它们在升级前的锁文件中已经是
目标版本，因此不计为本次实际解析版本变化。

| workspace                        | 依赖                    | 升级前声明 | 升级后声明 |
| -------------------------------- | ----------------------- | ---------- | ---------- |
| taro-react                       | @types/react            | ^18.3.18   | ^18.3.31   |
| taro-react                       | @types/react-dom        | ^18.3.5    | ^18.3.7    |
| taro-react、taro-vue3            | sass                    | ^1.97.3    | ^1.105.1   |
| taro-vue3、uni-vue3、wechat-wevu | vue-tsc                 | ^3.3.1     | ^3.3.12    |
| wechat-wevu                      | miniprogram-api-typings | ^5.0.0     | ^5.2.3     |

通过 `corepack pnpm update -r --include-workspace-root` 刷新兼容范围内的完整
依赖图。锁文件中 62 个包名的版本集合发生变化，其中包括平台二进制、移除旧版本
和新增 Nimbus 依赖。主要间接升级包括 Rollup 4.64.2 → 4.64.3、React ESLint
插件族 5.24.8 → 5.24.10、eslint-plugin-yml 3.8.1 → 3.9.0、
weapp-tailwindcss 5.5.12 → 5.6.0 和其 PostCSS 插件 3.3.11 → 3.4.0。

## 兼容边界与保留版本

- repoctl 5.9.0、受管模板 2.3.1、pnpm 12.10.1、StyleX runtime/plugin
  0.19.1 和 weapp-vite/Wevu 7.4.0 已是核对时的最新稳定版本。
- TypeScript 保持 6.0.3；最新 7.0.2 超出 repoctl 工具链声明的 TypeScript
  5/6 支持范围。`@arethetypeswrong/core` 的 TypeScript 5 兼容例外保留。
- StyleX 编译核心保持 Babel 7。Weapp Vite 的 Babel 8 依赖仍单独解析，
  不使用全局 major override 把两条编译链合并。
- Taro 4.3.0 的 Webpack runner 精确要求 Webpack 5.91.0，故不升级到
  5.111.1；其 Vite runner 保持 Vite 4.5.14，React 保持 18。
- Taro Vue 的 Babel JSX 插件保持 1.5.0：新版 2.x 改为 ESM-only，3.x
  要求 Babel 8，本轮保留该框架的同步 CJS Babel 配置。
- uni-app 保持 DCloud 对齐通道 `3.0.0-alpha-5030120260930001`、Vite
  5.2.8 和 Vue 3.4.21。`@dcloudio/types` 最新 3.4.32 虽已发布，但
  `@dcloudio/uni-app` 的 peer 精确要求 3.4.31；试升级后依据 peer 检查
  回退到 3.4.31，避免引入新的宿主不兼容。

受管的 Vite 8 override 经 repoctl 升级预览和精确计划应用改为
`vite@>=8 <9: 8.3.4`。保留微信专用 CI 和限定范围的安全 override；
没有应用默认预览中会破坏框架隔离的全局 Vite、esbuild 主版本替换。

## magic-string 与双格式编译器

magic-string 1.4.3 使用 ESM-only 包导出。源码单测通过后，真实 Taro Vue
Webpack 构建暴露了默认导入经打包器 CJS interop 包装后成为模块对象的问题，
报错为 `magic_string.default is not a constructor`。

编译核心改用官方 `MagicString` 和 `Bundle` 具名导出，从包导入边界消除歧义。
新增回归直接调用已构建的 CJS/ESM 公共入口，检查双脚本 SFC 转换结果、CSS、
sourcemap 一致，模板、style 和原始 source content 完整保留。
该路径在支持同步 require(ESM) 的项目 Node 基线上验证，不改变公开入口。
真实 Taro Vue Webpack 构建也重新通过。

通过 `corepack pnpm change` 为编译核心记录 patch 意图，没有手工递增版本。

## Nimbus 0.17 API 审查

使用官方迁移 CLI 审查后推进 `nimbus.json` baseline，并更新 `UPSTREAM.md`
及中英文贡献文档。文档集合使用 `docsCollection()`，符合新的页面集合规则。
本站没有 API 集合、API query version 或同名发现路由，也没有文档 workspace
根目录的 `skills/` 文件夹会被意外公开。

生产构建生成 `/.well-known/ard.json`、`/.well-known/ai-catalog.json` 和首页
发现 Link 响应头。`check:site` 校验 canonical host、实际目标文件及原有
`_headers` 安全和缓存规则的保留情况。原有 robots 策略及项目布局保持不变。

## 安全审计与 peer 残留

完整 workspace 审计前后均为 **72 条记录：4 critical、20 high、38 moderate、
10 low**。本次升级没有消除这些公告；`pnpm audit --json` 返回 1，
不能将通过构建和测试解释为审计零问题。报告中部分记录对应同一公告的不同版本
或包，数量不等同于独立漏洞数。

关键残留及路径包括：

| 依赖                                         | 路径或约束                                                               | 本轮处理                                 |
| -------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| minimist 0.0.8                               | miniprogram-automator → jimp → mkdirp；critical 公告 GHSA-xvch-5gv4-984h | 宿主仍使用旧范围，未强制跨范围替换       |
| swiper 11.1.15                               | Taro components；critical 公告 GHSA-hmx5-qpq5-p643                       | 修复需 12.1.2+，属于框架依赖跨主版本迁移 |
| decompress 4.2.1                             | Taro CLI → download-git-repo → download                                  | 两条 critical 及其他公告均无已发布修复版 |
| Vite 4/5、Webpack 5.91.0                     | Taro/uni-app 工具链兼容边界                                              | 需要单独验证宿主升级，未全局覆盖         |
| braces、git-clone、html-minifier、node-forge | 构建与工具依赖                                                           | 本次审计仍未提供已发布修复版本           |

仅兼容范围内更新不能保证修复旧框架的全部间接漏洞。需要另行评估宿主工具链
迁移或逐个限定范围替换，并验证对应功能；本轮没有盲目采用 `audit --fix`。

最终 peer 检查中，uni-app 的新增类型冲突已消除。仍保留已有上游不一致：
repoctl 内部部分 `@pnpm/*` 要求 logger 1001，却由工具链提供 1100；
devframe 1.1.0 的 optional peer 要求 agentic 1.1.0，解析为 1.2.3。
这两类也见于前次升级记录，本次相关工具检查与构建通过。

## 验证

本地环境为 Node 24.18.0、pnpm 12.10.1。验证日志和完整审计 JSON 保存在
忽略目录 `artifacts/dependency-upgrade-2026-10-09/`。

- frozen install、全仓 lint、build、typecheck、17 个单测通过。
- `test:deps` 验证三个限定安全 override、Babel 和框架版本隔离。
- `test:integration` 验证双格式 SFC、原生共享模块图、Vite 连续 watch 和
  Webpack filesystem cache。
- `test:examples` 检查七份微信产物，并运行原生和 Wevu 的 headless 交互。
- 文档 lint 和 `check:site` 验证 28 个中英文页面、Markdown、搜索和发现文件。
- `repo deps check` 通过；`repo doctor` 为 170 pass、76 warn、0 fail，
  警告包括项目定制资产与受管模板的差异。
- `repo check --full` 的 lint、typecheck、test、build 全部通过。全仓 lint
  仍有 7 条非阻塞警告。
- 最终 `pnpm outdated` 中直接依赖的 current 均等于 wanted，剩余最新版差异
  均属于上述框架和工具链兼容例外。

本机 PATH 中全局 pnpm 为 12.9.1，repoctl 嵌套调用会命中该旧入口；本地全量
验证采用临时目录中的 Corepack shim，让子进程同样使用声明的 12.10.1，
不更改全局安装或项目受管配置。CI 的 pnpm/action-setup 按 packageManager
安装版本，没有这项本机 PATH 差异。

本轮没有启动真实微信 DevTools/automator 或浏览器资源；没有重做真实 IDE 截图
验收。没有发布 npm 包或手动部署文档站。
