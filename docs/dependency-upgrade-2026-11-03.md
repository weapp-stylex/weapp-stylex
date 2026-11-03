# 2026-11-03 依赖升级记录

本次按官方已发布版本检查并升级工作区依赖，同时保留框架要求的版本边界。开发宿主 weapp-vite/Wevu 已升级到 `7.8.0`。最终冻结安装、类型检查、lint、单元测试、100 项脚本测试与 29 包真实 API 已通过；同一批 final2 tarball 的 Babel/auto 各 28 份构建、H5 交互、最低宿主、完整 integration、120 次隔离框架构建及两个最低 Node 版本消费者均已通过。微信开发者工具和远程 CI 仍待本轮最终验收，不能据此宣布整个升级已通过。

本文的审计数字来自本轮 `audit-before.json` / `audit-after.json` 快照。代码和锁文件尚在验收阶段，任何后续依赖变化都需要重新安装、审计和验证，并同步本文与逐项清单。

## 范围与逐项清单

[完整直接依赖清单](./dependency-upgrade-2026-11-03.json)逐项记录了 13 个 manifest 中的 132 条直接外部依赖声明，涉及 89 个不同包；13 条 `workspace:*` 内部依赖不计入。覆盖 `dependencies`、`devDependencies`、`optionalDependencies` 和 `peerDependencies`，每条包含升级前后范围、官方 dist-tag、最新版本、处理状态及原因。

清单同时保留生成时间、来源提交、manifest SHA-256、关键 engines/peers 和 TypeScript 导出边界，原始 registry 缓存记录各查询时间。它覆盖直接声明，不等同于完整传递依赖审计，也不包含 GitHub Actions 或 Node/pnpm 环境版本。本次刷新后共有 81 条声明变化，已包含 uni-app 新旧 peer 范围、weapp-vite/Wevu 7.8、原生类型依赖与文档工作区显式声明的 TypeScript ESLint parser；manifest 哈希对应生成时文件，最终验收状态仍单独记录。

版本来源只使用 npm 官方包与对应上游仓库的正式发布记录。DCloud 使用其官方 `vue3` dist-tag；该 tag 的版本含构建号，不能用默认 `latest` 的旧 Vue 通道替换。没有引入 fork、第三方补丁包或未发布提交。

## 主要变化

| 范围                     | 原版本                       | 本次版本               | 处理依据                                                   |
| ------------------------ | ---------------------------- | ---------------------- | ---------------------------------------------------------- |
| pnpm                     | 12.11.2                      | 12.16.1                | 固定 `packageManager`，统一安装入口                        |
| repoctl                  | 6.0.1                        | 6.3.2                  | 使用官方升级计划同步受管资产，保留已审查的宿主隔离配置     |
| Vitest / coverage        | 5.0.5                        | 5.1.0                  | 测试与 coverage 同步升级                                   |
| tsdown                   | 0.23.1                       | 0.23.4                 | 六个可发布包继续使用现有 ESM/CJS 边界                      |
| ESLint                   | 10.12.0                      | 10.14.0                | 保留原检查规则                                             |
| execa                    | 10.1.1                       | 10.2.1                 | 保留真实子进程验证                                         |
| `@mpcore/test`           | 1.0.0                        | 1.2.1                  | headless 验证工具升级                                      |
| miniprogram-automator    | 0.12.1                       | 0.13.0                 | 需要重新完成真实 IDE 验收                                  |
| Tailwind CSS             | 4.3.3                        | 4.3.4                  | 用于既有验证场景                                           |
| `@stylexswc/rs-compiler` | 0.19.1                       | 0.20.0                 | 可选原生后端，默认 Babel 保持不变                          |
| weapp-vite / Wevu        | 7.4.0                        | 7.8.0                  | 开发与示例配对升级，Linux 原故障位置验证通过；完整验收另列 |
| Taro                     | 4.3.0                        | 4.3.2                  | React/Vue 示例的 Taro 包整组同步                           |
| DCloud Vue 3 通道        | 3.0.0-alpha-5030120260930001 | 3.0.0-5030420261029002 | 匹配官方同一构建号的组件、编译器和运行时                   |
| Nimbus                   | 0.18.1                       | 0.19.2                 | 完成官方迁移检查与 18 项 API review                        |
| Astro                    | 7.3.8                        | 7.4.5                  | 符合 Nimbus 的 `>=7.2.6 <8` 范围                           |
| Wrangler                 | 4.151.0                      | 4.156.2                | 文档工具链升级，不代表已部署                               |
| Pagefind                 | 1.5.2                        | 1.6.0                  | 生产搜索交互重新验证                                       |

其他 Sass、vue-tsc、PostCSS、选择器解析器和工具依赖的逐项版本以 JSON 与 `pnpm-lock.yaml` 为准。

私有工作区与文档的 Node 范围升级为 `^22.23.4 || ^24.22.1 || >=26.12.1`，本地默认 Node 为 `26.13.0`，CI 配置为 `22.23.4`、`24.22.2`、`26.13.0`。可发布库仍保留 `^22.22.1 || >=24.11.0`，并配置这两个最低版本的隔离消费者检查。Node 26 不再附带 Corepack，安装入口明确使用官方 `corepack@0.36.0`。

## 保留的兼容边界

### StyleX、Babel 与 TypeScript

StyleX 官方 runtime/plugin 当前版本仍为 `0.19.1`。共享编译器继续使用兼容的 Babel 7 `7.29.7`，没有跟随全局最新 Babel 8。StyleX 与 Taro 的 peer 仍要求 Babel 7；weapp-vite 使用的 Babel 8 保持宿主隔离。

TypeScript 保留 `6.0.3`，没有直接追到 `7.0.2`。TypeScript 7 的根入口不再导出旧 Compiler API，相关 API 移到独立 `unstable/*` 模块，而现有验证代码还使用 `ts.transpileModule`。此外 repoctl 6.3.2 与 Astro check 0.9.12 的 peer 仍只声明 `^5 || ^6`。需要先完成 API 迁移并取得工具链支持，再升级主版本。

SWC 0.20.0 的发布包含原生 `processStylexRules` 能力；此前 0.19.2 修复了 TypeScript 泛型箭头函数解析。新增真实 `.ts` / `.mts` / `.cts` 回归用例，将运行结果、类名、规则与 CSS 同 Babel 对照。该升级不扩大 `auto` 的安全 AST 子集，主题、自定义 Babel 选项和原始 Vue SFC script 仍由 Babel 处理；上游 template-only binding removal 没有已验证修复，原保护继续保留。

上游依据：[SWC PR #1344](https://github.com/Dwlad90/stylex-swc-plugin/pull/1344)、[SWC 0.20.0](https://github.com/Dwlad90/stylex-swc-plugin/releases/tag/0.20.0)。

### Taro 4.3.2

Taro 示例升级到[官方 v4.3.2](https://github.com/NervJS/taro/releases/tag/v4.3.2)，适配包公开 peer 仍为 `>=4.3.0 <4.4.0`。宿主组继续按其官方要求对齐：

- Vite runner 要求 Vite 4，使用该主版本的 `4.5.14`。
- Webpack 5 runner 固定 Webpack `5.91.0`。
- React/React DOM 保留 `18.3.1` 及匹配的 18 类型。
- Vite React/Vue 插件分别保留其兼容主版本；Vue Babel JSX 保留 1.x，因为 3.x 要求 Babel 8。

这些边界通过依赖组和按版本范围约束表达，没有用全局 override 将各框架强行统一到 Vite 8、React 19 或 Babel 8。

### uni-app Vue 3

新通道仍精确要求 Vite `5.2.8` 与 Vue/compiler-sfc/shared/server-renderer `3.4.21`。`@dcloudio/types` 保留 `3.4.31`，原因是新 uni-app 声明了这个精确 peer，不能仅因 `3.4.32` 已发布就单独替换。

适配包 peer 同时支持旧通道 `3.0.0-alpha-5030120260930001` 和新通道 `3.0.0-5030420261029002`。隔离消费者脚本为两个通道分别选择匹配的 SFC parser 与 package extension，并检查 facade / 独立 adapter 入口，避免升级开发依赖时默默删除旧消费者支持。

新 `@dcloudio/uni-mp-vite` 的官方 tarball 仍在 `dist/plugins/independentMain.js` 使用未声明的 `estree-walker`。因此保留版本专属的 `2.0.2` package extension；该补全没有扩散到其他版本或框架。

### weapp-vite / Wevu 7.8.0

开发与示例已配对升级到官方 `7.8.0`，公开支持范围仍为 `>=7.4.0 <8`，没有随开发 pin 缩小兼容下界。历史 Linux CI 在 7.5.0 的测试 API 中出现 synthetic sidecar ID 被当作物理路径指纹处理，产生 `ENAMETOOLONG`，见[原始失败任务](https://github.com/weapp-stylex/weapp-stylex/actions/runs/38336664366/job/115098177364)。该历史失败不能作为排除所有后续版本的依据。

本轮先用 7.5.0 作为负对照检查简化 fixture，发现它和 7.8.0 都成功，因此没有把未重现问题的 fixture 当作修复证明。随后在真实 Linux x64 / Node 24.22.1 环境执行原完整 integration 的真实前序与 native build，7.8.0 已通过原故障位置。另行保留的 source-provider 报告实际观测到宿主产生 497 / 533 字节的 synthetic sidecar ID，源路径单个组件最多 46 字节；构建成功，并生成 app.js 与页面 JS/JSON/WXML。没有由测试插件伪造 ID，也没有修改宿主或降低断言。

Linux 完整 integration 已两次通过：等待器修复后为 664.56 秒，补齐原子写入后为 473.25 秒。前者属于安全补丁完成前的诊断快照，不代表最终依赖矩阵；后者验证了最终测试同步与输入写入边界。公开保存了[最终 Linux 报告](./validation/dependency-upgrade-2026-11-03/weapp-vite-7.8-linux-integration-atomic.json)与[完整原始日志](./validation/dependency-upgrade-2026-11-03/weapp-vite-7.8-linux-integration-atomic.log.txt)。这解除本仓库沿用旧宿主的阻塞；本地最终 Babel/auto 矩阵另列，IDE/CI 仍待验收。7.8 的发布记录还披露了 Web optimizer closure 和重复构建资源增长的现有 waiver，本轮没有宣称这些问题已解决。

公开保存的[Linux source-provider 报告](./validation/dependency-upgrade-2026-11-03/weapp-vite-7.8-linux-synthetic-success.json)记录了真实宿主 ID、合法源路径、构建输出及哈希。完整 integration 随后还暴露了本仓库 watcher 测试等待器的旧竞态：[事件诊断](./validation/dependency-upgrade-2026-11-03/watch-diagnostic-summary.json)显示，旧等待器在目标 entry 的 watchChange/transform 前，接受了上一轮 token 构建的 END。7.4 对照也在第 13 次复现同一断言，不能把它归因于 7.8 宿主。

等待器修复改为确认目标 watchChange、后续构建代次、匹配的原始输入 transform、BUNDLE_END 和 END；原 CSS 内容、资产删除、宿主样式保留与 session shutdown 清理断言全部保留，不轮询预期 CSS 来跳过同步边界。

修复等待器后，严格对照又定位了独立的写入竞态：`writeFile` 先截断被监听文件，异步构建可能在新内容写完前读取空字符串，从而报 `MISSING_EXPORT`。[原始输入事件摘要](./validation/dependency-upgrade-2026-11-03/watch-atomic-save-repro.json)保存了 7.4 第 8 次、7.8 第 13 次出现的空输入 SHA-256。测试现在先完整写入同目录暂存文件，再原子 rename 覆盖；写入失败时保留旧完整文件并清理本次暂存文件。官方 7.4 和 7.8 各 20 轮、共 40 轮严格 watcher 对照全部通过，见[对照报告](./validation/dependency-upgrade-2026-11-03/watch-diagnostic-atomic.json)。7.4 独立对照使用 Vite 8.3.1 / Rolldown 1.2.11，7.8 独立及工作区使用 8.3.5 / 1.2.16；它们不是相同的底层版本。两项修复均位于本仓库测试边界，没有补丁宿主或削弱产物断言。

原生示例现在直接声明 `miniprogram-api-typings: ^5.2.3`，并在 `tsconfig` 显式选择 `node` 与 `miniprogram-api-typings`。升级后的首轮类型检查暴露出原先依赖宿主隐式提供 App/Page/Component 全局类型的问题；修复将类型依赖归还给使用它的示例，而非重新扩大宿主的隐式类型暴露。最终冻结安装与 typecheck 已通过。

## 安全审计与约束修复

可提交的[审计前](./validation/dependency-upgrade-2026-11-03/audit-before.json)、[中间 76 项](./validation/dependency-upgrade-2026-11-03/audit-intermediate-76.json)与[最终审计](./validation/dependency-upgrade-2026-11-03/audit-after.json)均附原始字节 gzip 和 SHA-256，[证据索引](./validation/dependency-upgrade-2026-11-03/README.md)说明保存与校验方式。工作目录仍保留 `audit-after-compatible-patches.json` 原始响应。下表采用 pnpm audit 的 advisory 统计，不能理解成可利用漏洞实例数或生产运行时漏洞数。

| 等级     | 升级前 | 中间快照 | 最终冻结 |
| -------- | -----: | -------: | -------: |
| critical |      4 |        3 |        3 |
| high     |     40 |       12 |       10 |
| moderate |     66 |       46 |       37 |
| low      |     18 |       15 |        9 |
| 合计     |    128 |       76 |       59 |

快照中总依赖数为 3131 → 3097。按 `GHSA + 包名 + 已安装版本` 比较，受影响键为 154 → 76；同一 advisory 可以影响多个版本和多条路径，不能将 advisory 数量当成路径数量。

约束优先限制在现有兼容主版本内：PostCSS `8.5.32`、selector-parser 7.x `7.1.7`、node-forge `1.4.2`、source-map-js `1.2.2`、Zod 4.x `4.6.7`、Undici 6/7/8 分别为 `6.29.1` / `7.30.1` / `8.12.3`、body-parser 1.x `1.20.9`、path-to-regexp 0.1.x `0.1.13`、follow-redirects 1.x `1.16.2`、Joi 17.x `17.13.9`、Lodash/Lodash ES 4.x `4.18.1`、decode-uri-component 0.5.x `0.5.1`、ws 8.x `8.22.1`、glob 10.x `10.5.0`、mkdirp 0.5.x `0.5.6`。Vite 8.x 使用 `8.3.5`，未覆盖 Taro 的 Vite 4 与 DCloud 的 Vite 5。

最终复核继续处理了可以在现有主版本或补丁线内修复的项目，而非将未测试项目统一归为上游阻塞：

| 范围                | 最终版本                                     | 实际父包约束与验证                                                                                                                 |
| ------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| debug 4.x           | 4.4.3                                        | automator 0.13.0 精确声明 4.1.1；验证 namespace、enable/disable、过滤、格式化和子 namespace                                        |
| selector-parser 6.x | 6.1.5                                        | DCloud 精确 6.1.2、cssnano 为 ^6；验证转义类名、属性及伪类 AST 解析/改写，7.x 保持独立                                             |
| qs 6.x              | 6.16.1                                       | DCloud 的 Express 4.20.0 精确 6.11.0，新 body-parser/Express 使用 ~6.16.0；验证嵌套表单、重复项、原型污染及两个真实 Express 上下文 |
| fast-uri 3.x        | 3.1.9                                        | Ajv 8.20.0 要求 ^3.0.1；验证 URI 解析、相对引用与真实 Ajv 外部 schema 引用                                                         |
| ip-address 10.x     | 10.7.5                                       | socks 2.8.10 要求 ^10.1.1；验证 IPv4/IPv6 解析、压缩和子网                                                                         |
| seroval 1.6.x       | 1.6.11                                       | Solid 1.9.17 要求 ~1.6.8，plugins peer 为 ^1.0；验证循环引用、Map 与 Date 的真实序列化结果                                         |
| Babel core 7.x      | 7.29.7                                       | DCloud 和 plugin-legacy 仍解析到旧 7.25.2；限定 7.x 升级，验证转换、sourcemap 与 TypeScript 泛型解析，宿主 Babel 8 不受该约束影响  |
| Intlify 9.1.x       | core-base/resolver 9.1.11，其余配套包 9.1.10 | 官方并未为所有组件发布 9.1.11；验证命名参数、linked message、复数、解析器与 DCloud 旧 Vue I18n 的实际导入契约                      |

当前 audit 中，上述旧 node-forge、Undici、body-parser、Lodash、source-map-js、Zod、follow-redirects、Joi 等受影响版本已消失。glob 10.5.0 移除了原 10.2.6 的 finding，但仍和 13.0.6 受到新 advisory `GHSA-3g3m-2fjr-6pw4` 影响，当前修复版本为 `>=14.0.2`，跨出现有主版本；不能将这次升级写成 glob 审计清零。

`scripts/test-security-overrides.mjs` 沿已安装 dependencies、optionalDependencies 与 peers 的物理边验证 API；[最终 API 报告](./validation/dependency-upgrade-2026-11-03/security-override-apis.json)记录 31 份副本、29 个不同包、2 个 Express 上下文，`passed: true`。其中 Taro 的 Solid/Seroval 经 peer 提供，不能只遍历普通 dependencies。DCloud 旧 Vue I18n 的 16 个 shared、20 个 core-base 和 3 个 devtools 导出直接从实际 consumer 源码读取并验证。安装成功或版本号变大不足以证明 override 兼容；完整框架构建也仍是最终门禁。候选版本及父包要求见[兼容补丁评估](./validation/dependency-upgrade-2026-11-03/compatible-patch-evaluation.json)。

minimist 的 critical 通过父包升级解除。原链路为 `miniprogram-automator / DCloud → Jimp → mkdirp 0.5.1 → minimist 0.0.8`；本次只将官方 mkdirp 0.5.x 约束到 `0.5.6`，让父包采用其修正后的依赖声明。没有直接把 minimist 0.0.x 强制覆盖到 0.2.x：实际 5 组解析对照发现，`-m0750` 在 alias/string 选项下会从数字 `750` 变为字符串 `"0750"`，存在行为变化。

[minimist/mkdirp 评估](./validation/dependency-upgrade-2026-11-03/minimist-evaluation.json)保存了上述对照、2 组原型污染用例和 5 组 optimist 调用验证；还使用真实 Jimp 0.6.8 完成嵌套目录 PNG 写入与解码，验证 mkdirp 的 CLI 权限、同步和异步 API。当前 audit 已无 minimist finding。该父包修复同时移除了 1 项 critical 与 1 项 moderate，不靠跨子版本全局替换掩盖旧 API 差异。

### 新增与遗留风险分开记录

中间快照曾新增低危 `debug@4.1.1`、`GHSA-gxpj-cx7g-858c` 的 44 条路径，本轮已继续升级并消除该 finding。最终相对最初快照新增的受影响版本键仅为 `@intlify/core-base@9.1.11` 上 1 个 moderate 和 1 个 low；两个 advisory 原先已影响 9.1.9，没有新增 advisory，也没有新 high/critical 版本键。它们是升级后仍未解除的既有风险，不能因版本改变而忽略。

Intlify 的两个 high 已由 9.1.11 消除。剩余 moderate `GHSA-x8qp-wqqm-57ph` 要求 core-base `>=9.14.5`，但[官方 tarball 对照](./validation/dependency-upgrade-2026-11-03/intlify-exports.json)确认 9.14.5 删除了 DCloud 旧 Vue I18n 仍导入的 `handleFlatJson` 与 `getLocaleChain`；9.1.11 保留全部所需导出，报告保留两份官方 tarball 的 URL/integrity。剩余 low `GHSA-8rc2-428q-7ww3` 要求 `>=11.4.14`，跨主版本。继续修复需要迁移 DCloud 的实际消费者，不能把这些版本直接覆盖后宣称兼容。

phin、Webpack、esbuild、minimatch 等遗留 finding 的路径数量仍随框架图变化。这些路径变化保留在原始审计中；也不能把所有剩余项统一标成开发依赖。

### 当前剩余 critical / high 路径

以下是升级后快照中的实际链路；表中为代表路径，完整枚举见 audit JSON。缺少修复版本是审计返回值，不表示风险可以忽略；存在补丁但超出现有宿主约束的项目，需要独立兼容验证。

| 等级     | 包与版本 / advisory                                           | 代表路径                                                          | 继续处理的边界                                                                   |
| -------- | ------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| critical | swiper 11.1.15 / GHSA-hmx5-qpq5-p643                          | Taro → @tarojs/components → swiper                                | 修复版本 `>=12.1.2`；涉及 H5 应用运行时，不能仅归为构建工具                      |
| critical | decompress 4.2.1 / GHSA-mp2f-45pm-3cg9、GHSA-hrh2-vp3x-79xf   | Taro CLI → download-git-repo → download → decompress              | 审计未提供修复版本；属于模板下载/解压链                                          |
| high     | jpeg-js 0.3.7 / GHSA-xvf7-4v9q-58w6                           | DCloud / automator → jimp → @jimp/jpeg → jpeg-js                  | 修复版本 `>=0.4.4`，需验证旧 Jimp API                                            |
| high     | git-clone 0.1.0 / GHSA-8jmw-wjr8-2x66                         | Taro CLI → download-git-repo → git-clone                          | 审计未提供修复版本                                                               |
| high     | http-cache-semantics 3.8.1 / GHSA-rc47-6667-2j5j              | Taro CLI → download → got → cacheable-request                     | 修复版本 `>=4.1.1`，跨主版本                                                     |
| high     | html-minifier 4.0.0 / GHSA-pfq8-rq6v-vf5m                     | Taro vite-runner / webpack5-runner → html-minifier                | 审计未提供修复版本                                                               |
| high     | serialize-javascript 6.0.2 / GHSA-5c6j-r48x-rmvq              | Taro vite-runner → @rollup/plugin-terser；Webpack 的复制/压缩插件 | 修复版本 `>=7.0.3`，跨主版本                                                     |
| high     | Vite 4.5.14、5.2.8 / GHSA-c27g-q93r-2cwf、GHSA-587h-7wmj-h5pm | Taro runner → Vite；DCloud vite-plugin-uni → Vite                 | Windows editor 相关 advisory；分别要求 `>=5.4.9` / `>=6.4.4`，当前官方宿主不满足 |
| high     | webpack-dev-middleware 5.3.4 / GHSA-g84c-rxfj-3j2c            | Taro → webpack-dev-server → webpack-dev-middleware                | 修复版本 `>=7.4.5`，跨主版本                                                     |
| high     | @vue/server-renderer 3.4.21 / GHSA-g2v6-rqmx-r4w6             | DCloud uni-h5 / uni-cli-shared → @vue/server-renderer             | 修复版本 `>=3.5.42`；当前需要与 DCloud Vue/parser 3.4.21 配套                    |
| high     | decode-uri-component 0.2.2 / GHSA-qr28-fpjm-wq7f              | Taro CLI → download → got → normalize-url → query-string          | 修复版本 `>=0.5.1`；0.5.x 的约束没有越界覆盖旧 0.2.x                             |

这次没有将上表未验证的跨主版本替换塞入全局 overrides。依赖仍有已知问题，当前 PR 的结论应是“兼容升级与部分风险收敛”，不能写成“审计清零”。

## 文档工具链验证

Nimbus 的官方 `migrate --dry-run --json` 从 0.18.1 到 0.19.2 未报告源码迁移或错误，列出 18 项 review。初次退出 1 是 review 尚未确认的门禁；逐项核对后执行 `migrate --yes --json`，只更新 `nimbus.json`。

站点没有 changelog recipe、API collections、远程 MCP、partial build 或 OG route，不需要为了新版本引入这些功能。项目现有的中英文页面、导航、主题、Pagefind、Markdown/MDX 和 AI 导出保持原设计。具体 API review 见 [apps/docs/UPSTREAM.md](../apps/docs/UPSTREAM.md)。

本地[稳定版](./validation/dependency-upgrade-2026-11-03/docs-browser-stable.json)与[预览版](./validation/dependency-upgrade-2026-11-03/docs-browser-preview.json)生产产物的浏览器报告均为 Node 26.13.0、`headless: true`、`passed: true`、无错误。覆盖中英文生产搜索、键盘焦点、复制、主题持久化、语言路由、桌面/移动视口和无 JavaScript 内容。报告确认本任务创建的浏览器与服务均已关闭。这是本地生产构建证据，不是远程部署成功记录。

## 已取得的验证与未完成门禁

本节以现有日志为准。[最终准备检查](./validation/dependency-upgrade-2026-11-03/final-prepare-summary.json)、[原子写入修复后的复核与打包](./validation/dependency-upgrade-2026-11-03/final-repack-summary.json)和[最终 Babel/auto 矩阵](./validation/dependency-upgrade-2026-11-03/final-matrix-summary.json)均为 exit 0，前后锁文件哈希保持相同。矩阵、隔离框架消费者及最低 Node 消费者共用 final2 的六包 tarball，pack ID 为 `791d81f0a621e2ca1c6a27517377385ce4e7577f727d00141862d6e415e932a1`，各包原始 SHA-256 见[打包清单](./validation/dependency-upgrade-2026-11-03/library-packs-final2.json)。IDE 与远程 CI 仍需完成，不能用早期通过记录代替最终结果。

| 检查                                    | 本轮证据                                                                                                                                                                                                          | 状态                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| workspace 单元测试                      | Vitest 5.1.0：14 个文件、130 个测试通过；statement 83.68%、branch 74.42%、function 79.92%、line 83.52%                                                                                                            | 最终冻结配置已通过                              |
| lint                                    | 0 error、10 warning，主要为 execa 依赖建议                                                                                                                                                                        | 本地已通过，warning 保留                        |
| 最终冻结安装                            | 最终安全补丁后 `install --frozen-lockfile` exit 0                                                                                                                                                                 | 本地已通过                                      |
| workspace typecheck                     | 7.8、原生示例类型修复及安全补丁后重新通过；Wevu prepare warning 保留                                                                                                                                              | 最终冻结配置已通过                              |
| 依赖边界与安全 API                      | 最终 `test:deps` 和 repo deps check 通过；API 覆盖 31 副本 / 29 包、两个 Express 上下文及 DCloud 实际导入契约                                                                                                     | 最终冻结配置已通过                              |
| repo doctor                             | 150 pass、112 warn、0 fail                                                                                                                                                                                        | warning 包含静态工具不能证明覆盖后的锁/安装状态 |
| repo check --full                       | `final-repo-full.log` exit 0，最终冻结配置涵盖全部 28 份构建，锁文件保持相同                                                                                                                                      | 最终冻结配置已通过                              |
| 构建、IDE 就绪与资源归属脚本测试        | 16 suites、100 tests 全部通过，无跳过，覆盖 watcher 代次同步及原子写入失败时的完整源文件保护                                                                                                                      | 最终冻结配置已通过                              |
| docs deployment Node 测试               | 13 个测试通过                                                                                                                                                                                                     | 本地已通过                                      |
| Nimbus check / lint                     | 无 finding/error/warning；58 文件 lint clean                                                                                                                                                                      | 本地已通过                                      |
| 文档类型与单元测试                      | 50 文件诊断 0 error/warning/hint；4 文件、16 测试通过                                                                                                                                                             | 本地已通过                                      |
| docs API / site                         | 13 公共入口、24 声明条件、85 exports、双语 146 sections；58 页、294 anchors、142 自定义组件                                                                                                                       | 本地已通过                                      |
| docs production build                   | 60 routes、58 indexed pages；stable/preview 浏览器证据齐全                                                                                                                                                        | 本地已通过                                      |
| weapp-vite 7.8 Linux 宿主门禁           | 真实 synthetic sidecar 输入通过；最终测试修复后完整 Linux integration exit 0，另有 7.4/7.8 各 20 轮 watch 对照                                                                                                    | 已解除原升级阻塞                                |
| 四平台、七种宿主产物、Babel/auto 一致性 | 同批 final2 包的 Babel/auto 各 28 份构建、产物检查、H5 生产/开发交互、最低宿主与 integration 均通过                                                                                                               | 最终冻结配置已通过                              |
| 新旧 DCloud、facade/adapter 隔离消费者  | [120 次真实构建](./validation/dependency-upgrade-2026-11-03/framework-consumers-final2.json)，6 个命令均 exit 0，锁与 pack ID 一致                                                                                | 本地已通过                                      |
| Node 最低版本消费者                     | [22.22.1](./validation/dependency-upgrade-2026-11-03/floor-22.22.1.json) / [24.11.0](./validation/dependency-upgrade-2026-11-03/floor-24.11.0.json)：六包独立入口、ESM/CJS、types、Babel/auto/SWC 与无 addon 安装 | 本地已通过                                      |
| 真实微信开发者工具                      | 0.13.0 automator、真实 AppID、官方稳定 IDE、交互与资源清理                                                                                                                                                        | 待完成                                          |
| GitHub Actions / CD                     | 新 Node 矩阵和受管工作流                                                                                                                                                                                          | 尚未取得远程通过结论                            |

## 复现入口

使用 `.node-version` 指定的 Node 26.13.0，从仓库根目录执行。冻结安装是独立门禁，不能以 repo doctor 的静态判断代替。

后续维护先重新查询官方元数据并逐项核对 peers/engines，再修改 manifest；不要对所有包无条件执行主版本升级。repoctl 受管资产通过官方计划接口升级，计划必须以当前输入重新生成和审查，不应复用本轮旧计划：

```bash
corepack pnpm outdated --recursive
corepack pnpm exec repo upgrade --json > artifacts/repoctl-upgrade-plan.json
# 审查 add/modify/delete/skip/conflict 与宿主边界后再应用。
corepack pnpm exec repo upgrade --apply artifacts/repoctl-upgrade-plan.json
```

```bash
npm install --global corepack@0.36.0
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm exec repo deps check
corepack pnpm exec repo doctor
corepack pnpm exec repo check --full
corepack pnpm lint
corepack pnpm --filter './packages/*' build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:deps
corepack pnpm test:docs-deployment
corepack pnpm test:integration
WEAPP_STYLEX_BACKEND=auto corepack pnpm test:integration
```

四平台分别执行 `weapp`、`alipay`、`tt`、`h5`；每个平台的 Taro Vite/Webpack 构建按现有脚本串行执行：

```bash
WEAPP_STYLEX_TARGET=weapp corepack pnpm exec node scripts/build-examples.mjs weapp
WEAPP_STYLEX_TARGET=weapp corepack pnpm test:examples
WEAPP_STYLEX_TARGET=weapp WEAPP_STYLEX_BACKEND=auto corepack pnpm exec node scripts/build-examples.mjs weapp
WEAPP_STYLEX_TARGET=weapp WEAPP_STYLEX_BACKEND=auto corepack pnpm test:examples
corepack pnpm test:h5
WEAPP_STYLEX_BACKEND=auto corepack pnpm test:h5
corepack pnpm exec node scripts/test-consumer-hosts.mjs
WEAPP_STYLEX_CONSUMER_ENTRY=adapter corepack pnpm exec node scripts/test-consumer-hosts.mjs
WEAPP_STYLEX_UNI_HOST_VERSION=3.0.0-alpha-5030120260930001 corepack pnpm exec node scripts/test-consumer-hosts.mjs
WEAPP_STYLEX_UNI_HOST_VERSION=3.0.0-alpha-5030120260930001 WEAPP_STYLEX_CONSUMER_ENTRY=adapter corepack pnpm exec node scripts/test-consumer-hosts.mjs
```

文档生产与交互验证入口：

```bash
corepack pnpm --filter docs exec nimbus-docs migrate --dry-run --json
corepack pnpm --filter docs exec nimbus-docs check --json
corepack pnpm --filter docs typecheck
corepack pnpm --filter docs test
corepack pnpm --filter docs lint:docs
corepack pnpm docs:build
corepack pnpm --filter docs check:site
corepack pnpm exec node scripts/test-docs-browser.mjs
```

微信 IDE 验收须提供本机官方稳定版 CLI 路径与真实测试 AppID，并保持全局串行：

```bash
WEAPP_STYLEX_APPID='<real-appid>' \
WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH='<official-devtools-cli>' \
corepack pnpm test:ide
```

`corepack pnpm audit --json` 用于重新取得传递依赖审计快照；存在本节已披露的 advisory 时该命令会以非零状态退出，不能忽略或标为审计通过。锁文件、逐项 JSON、原始审计、运行环境及最终 CI 必须对应同一提交。本轮不执行 npm 发布，也不以本地文档预览代替受管部署记录。
