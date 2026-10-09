# 编译提速验收 · 2026-10-09

本轮新增安全 SWC 后端、默认 Babel 解析与缓存优化、框架诊断，以及双模式产物检查。默认仍为 Babel。本轮只提交源码和 release intent，不发布 npm。

## 实现与兼容决策

- 公共 `backend` 选项贯穿 compiler、三个框架适配器和聚合子路径。可选原生依赖固定为 `@stylexswc/rs-compiler@0.19.0`，首次符合能力检查时加载；默认 Babel/runtime 不加载原生模块。
- AST 能力检查覆盖常规静态、简单局部动态、合并、shorthand/null、keyframes/firstThatWorks。官方 Babel 保留主题/常量、编译期导入、特殊 runtime 子路径、自定义配置和未验证求值。
- 真实 Taro Vue Vite 构建暴露 SWC 删除模板专用绑定与组件导入的问题。首版保护原始 SFC 脚本，auto 使用 Babel，强制 swc 明确报错；独立 TS/JS 样式文件仍可加速。没有重写导入或替换主题哈希算法。
- Babel 复用一次性 AST；只预解析编译期导入；token 读取、编译结果和并发请求共享。配置/manifest/源码变化、删除、移除导入及已被宿主移除 JS 引用的 token metadata 均有失效与代次保护。
- Webpack 指纹追加到宿主 cache version/buildDependencies，支持磁盘恢复、后端和配置切换。自定义 Babel 选项停用转换与 loader 缓存，避免回调读取外部状态导致缓存错误。

## 可复现转换测量

环境：Apple M4 Max、macOS arm64、Node 24.18.0、pnpm 12.10.1、Babel 7.29.7、StyleX Babel/runtime 0.19.1、SWC 0.19.0。

命令：`corepack pnpm exec node scripts/benchmark.mjs --full`。各转换先预热 5 轮，再采样 7 轮，使用 sourcemap。每轮重复次数分别为 15/5/2。原始逐轮数据见 [JSON](benchmarks/compiler-2026-10-09.json)。

所有数字为毫秒中位数：

| 样式数 | 单独解析 | 原双解析转换器对照 | 新 Babel 冷 session | auto 冷 session | 缓存命中 |
| ------ | -------- | ------------------ | ------------------- | --------------- | -------- |
| 10     | 0.063    | 1.666              | 2.422               | 0.974           | 0.045    |
| 100    | 0.270    | 12.812             | 14.436              | 6.263           | 0.068    |
| 1000   | 3.677    | 121.328            | 122.441             | 64.184          | 0.383    |

旧转换器对照使用原来 parseSync + transformSync 结构，但不包含新 session 的哈希、依赖签名和生命周期管理开销，因此它不是完整构建基线。新 Babel 的冷路径仍有这些开销，并未在所有规模上变快。缓存命中不再解析或编译；1000 个样式的 auto 转换相对新 Babel 冷路径约 1.91 倍快，已包含 AST 安全检查，不能当作宿主完整构建倍数。

## Watch 转换与完整构建

64 个并发消费者的首次转换批次为 43.78ms：65 次解析/编译，token 只读取一次。七轮未变化重建转换批次中位数 2.93ms，零解析、零编译、零 token 读取，每轮命中 64 个缓存。修改 token 后批次为 36.18ms，再读取一次 token 并重编译受影响消费者。这是共享核心的 watch 转换耗时，未包含整个 Vite/微信宿主重建。

根构建包含文档、所有包和七份微信产物；每种后端独立预热一次，再串行测量三次：

| 模式  | 三次耗时（秒）    | 中位数（秒） |
| ----- | ----------------- | ------------ |
| Babel | 9.69, 9.53, 10.36 | 9.69         |
| auto  | 9.25, 9.63, 9.50  | 9.50         |

约 1.9% 的差异处于小示例测量波动范围，不能证明整体构建有显著提速。一次早期采样中 auto 还更慢；原生模块启动和大量保留 Babel 的主题/SFC 工作会影响结果。默认保持 Babel，适合有大量常规 TS/JS 样式的项目自行测量后启用 auto。CI 用调用次数保证缓存收益，不设置易波动的耗时门槛。

## 验证与边界

- frozen install、lint、build、typecheck、57 个单测、test:deps、默认/auto integration、默认/auto examples、repo deps check/doctor/check --full 和中英文 docs lint/typecheck/check:site。
- 七份 auto WXSS 与 Babel 逐文件目录及完整 CSS 对照一致。原生与 Wevu headless 覆盖共享 class、条件切换、主题、动态值、隔离组件和普通分包。
- 单测核对官方规则/class/RTL/优先级及 runtime 合并，检查语法错误映射、双脚本与具体 sourcemap 位置、共享/并发缓存、连续修改/删除/配置变更和旧任务保护。
- 隔离打包安装验证 ESM/CJS、runtime/default Babel 不加载原生依赖。实际移除可选 npm 包后，Babel 和 auto 正常运行，强制 swc 明确报错。
- 本地验证 Node 24.18.0；CI 保留 22.22.1 与 24.18.0 并运行双模式和原生可用/缺失路径。此机器独立 pnpm 12.9.1 在 PATH 中遮住 Corepack shim，repo check --full 验证时在该命令的 PATH 前置 Node 24.18.0 的 bin，仍使用声明的 pnpm 12.10.1；没有降低版本检查。
- 审计仍为 72 条：4 critical、20 high、38 moderate、10 low，与此前完整工具链基线一致。新增 SWC 未引入新的公告；已有限定 override 兼容验证通过。残留范围见 [依赖升级记录](dependency-upgrade-2026-10-09.md)。不宣称审计为零。

后续已使用 weapp-tailwindcss 的 AppID `wx6ffee4673b257014` 和 weapp-vite 选定 CLI 验收：实际工具 Stable `2.02.2608080`、基础库 `3.17.4`。七种产物的运行断言分别通过，**单轮完整 suite 仍待验收**，最近重跑因原生模拟器启动失败而退出。真实验收另发现并修复 Taro Vue / Webpack 的内联 SFC 漏编译，增加真实 Vue-loader 的 setup 执行与磁盘缓存回归；Babel/auto 集成、七份产物和 headless 重新通过。截图、日志、原始失败与资源清理范围见 [IDE 验收记录](ide-validation-2026-10-09.md)。本文完整构建耗时采于该 SFC 修复前，保留为历史观测，不能作为修复后整体构建的性能承诺；单文件和共享核心转换数据的边界不变。
