# 全场景验收 · 2026-10-16

本轮两套微信 IDE suite 已完成：同一份 r4 源码在 Babel、auto 后端各完成完整七产物验收，所有自有资源已关闭。Goal 仍等待对应提交的远端 CI；在提交和推送前不将本轮标记为最终完成。历史 IDE 成功和局部测试不能替代本轮验收。

r2 的非 IDE 验证已完成：根目录 102 项测试、91 项脚本测试、文档 12 项测试及浏览器交互；根目录全部规定检查、最低 Node 与宿主检查通过。facade / 独立适配器合计 112 次外部真实宿主构建通过。Babel、auto 各 28 份正式工作区产物通过，全部 28 组 CSS 一致；每后端 H5 七条生产和七条开发链路完整通过，各 14 张有效 PNG、9 项自有资源全部关闭。完整构建基准也已通过。这些记录保留原源码摘要 `dfa4d83b6de9a7fa9512d33011c4b089227b81d2274ab472832f8b049ed97486` 和 r2 包批次身份。

当前 r4 源码摘要为 `d2ac864a7017921afeb1ab11442d05d9bbfc240636dd6bbec131313a68a7ecc1`。r2→r3 的 IDE 圆角和启动修复之后，r3→r4 仅修改 Wevu JSX fixture、headless 尾端断言和 IDE 错误消息；六库已重新构建打包，完整 dist、归档内容和 tarball 字节均与 r3 一致，证明见 `artifacts/goal-final-packs-r3-r4-comparison.json`。r4 已通过 root lint、typecheck、102 项根测试、依赖边界检查、92 项脚本测试、repo doctor；默认 `repo check` 也通过（空暂存集），`repo check --full` 仅按约束完成 dry-run 预览，未重复执行 build。r4 facade 与独立 adapter 各完成 Babel/auto 56 次外部真实宿主构建；两者 Wevu headless 结果均已保存并通过。Node 22.22.1 与 24.11.0 的 r4 隔离消费者现已通过，并绑定同一 r4 六包证明；此前 r3 的完整 Node 检查和 r2 的其他结果继续保留原运行身份。

## 场景与验收层次

| 场景                       | 构建与交互覆盖                                                  | 安装覆盖                       |
| -------------------------- | --------------------------------------------------------------- | ------------------------------ |
| 原生 Page / Component      | 四平台产物；页面数据绑定、组件 props 更新、主题继承、分包与重入 | facade、独立 weapp-vite 适配器 |
| Wevu SFC / JSX             | 四平台产物；显式 class/style、SFC 与 JSX 组件、独立主题与继承   | facade、独立 weapp-vite 适配器 |
| Taro React / Webpack、Vite | 两构建器分别输出；四平台产物、页面与组件交互                    | facade、独立 Taro 适配器       |
| Taro Vue 3 / Webpack、Vite | 两构建器分别输出；原始 SFC、组件 props、主题与分包              | facade、独立 Taro 适配器       |
| uni-app Vue 3              | DCloud 匹配的 Vue/SFC/Vite；四平台产物、组件与主题              | facade、独立 uni-app 适配器    |

每后端有 28 份构建产物；微信与 H5 各有七条链路。微信 IDE 使用仓库外 facade 消费者的候选包构建产物。H5 浏览器验证工作区的生产和开发链路；仓库外 H5 消费者另行完成真实构建，不将它表述为浏览器交互验收。

编译器行为测试覆盖动态零值、空值移除、独立字段、组合与重置、自定义导入源、命名别名、跨文件常量和 token 缓存失效。既有集成层覆盖共享导出、barrel、宿主别名、watch、缓存、SFC sourcemap、样式文件所有权和无 StyleX 的初始构建。

浏览器与 IDE 检查实际背景色和文字颜色、16px padding、8px 内联间距、12rpx 小程序间距及 H5 宿主换算。IDE 另外逐角检查组件的 12px 圆角；H5 未将圆角纳入当前断言。条件状态、明暗主题、80→120→80 宽度分别往返三轮，随后检查普通分包、返回首页和页面重入。先检查应用结构，再截图；协议错误、运行错误和自有资源清理失败均不能通过。

## 构建与证据关联

`scripts/library-packs.mjs` 在构建前记录源码、源锁与安装锁、实际依赖版本，清理六库生成目录，完成真实构建和打包后逐文件核对归档。`library-packs.json` 绑定源码、完整 dist 集合、六份候选 tarball 和同一构建批次。旧包、混批、空构建和构建后修改均被拒绝；最低 Node 消费者复用生产工具链生成的同一批包。

当前候选清单为 `artifacts/goal-final-packs-20261016-r4/library-packs.json`，证明 ID 为 `cfa6e3e18cd818a0cf69dad4c1b3a2e7f539c030589827a9e66fb273b1ce18d0`，构建批次为 `9c876159-604d-460f-a9af-8c227cbdddad`。r4 facade 清单为 `artifacts/consumer-hosts-tHijna/manifest.json`，独立 adapter 清单为 `artifacts/consumer-hosts-nTgwhM/manifest.json`；两份均为 Babel / auto 各 28 份产物、总计 56 份，并提供当前 IDE 输入。r3 清单、运行 ID 和六包字节比较仍作为历史证据保留；不能替代 r4 完整 suite 结束时的再次核验。

`scripts/build-provenance.mjs` 记录后端、外部消费者源码与安装锁、框架版本和完整产物摘要。IDE 启动前验证完整七产物，复制前后再次核对全部文件，修改隔离副本的 AppID 后才启动。suite 完成前再次核验同一源码和包批次。跨 checkout 原子互斥保证 IDE 串行，每份只启动一个 automator。

H5 报告记录源码与产物身份，生产验收后再次核对完整产物，再运行开发服务器与源码更新测试；恢复源码后核对输入身份。过滤场景或跳过开发链路的运行标记为 `partial`。报告使用独立运行目录保留失败记录。

r4 平台矩阵 `artifacts/goal-final-r4-matrix-status.json` 的 Babel / auto 六步全部通过：每后端 28 份产物、示例 headless、H5 full 均成功，日志中的 28 组 CSS 与 Babel 完全一致。Babel H5 报告为 `artifacts/h5/babel/run-1792121090991/report.json`，auto H5 报告为 `artifacts/h5/auto/run-1792121263081/report.json`；两者各覆盖七个生产和七个开发应用、14 张 PNG，9 项自有资源全部关闭。

当前 IDE 验收报告为 Babel `artifacts/ide/run-1792121348602/report.json` 和 auto `artifacts/ide/report.json`。两者均为 `status=passed`、`scope=full`，各含七个产物、21 张 PNG、7 个自有资源；端口、automator endpoint、原生窗口和 webContents 均已关闭，suite lock 已释放，最终输入核验绑定同一 r4 源码与包证明。Babel 的 `Tool.getInfo` 为 Stable 2.02.2608080 / SDK 3.17.4，auto 为 Stable 2.02.2608080 / SDK 3.17.5；这是本次运行环境的实际差异，两个 SDK 均完成同一场景断言。

## 已发现的问题与修复

- 隔离消费者生成声明时触发 TS2883：为适配器返回值提供公共类型身份，重导出声明需要的共享类型，包括 Taro/uni-app 的 `StylexTarget`。通过真实 `.mts` / `.cts` 声明输出检查整体返回值、解构和数组展开。
- uni-app 保留符号链接时，单 facade 安装无法解析运行时的传递依赖：只对 facade→core、core→官方运行时两条转发边使用物理 importer 委托宿主解析；保留 DCloud 的全局解析策略。
- Taro Vue 的外部 Vite 构建缺少 JSX peer：示例显式声明兼容 Vite 4 的 `@vitejs/plugin-vue-jsx`。
- 候选包证明最初拒绝未声明 `private` 的合法发布包；实际六包准备阶段保留了该失败证据，修复后重新生成候选批次。
- 一次并行验证中，包准备清理了另一构建正在读取的共享 dist。保留 `artifacts/goal-final-build.log`，改为串行重跑；该失败不计为通过。
- 首次真实 IDE 在原生组件圆角断言处失败：`artifacts/ide/run-1792119429763/report.json` 记录 `border-radius=null`。隔离真实诊断 `artifacts/goal-ide-radius-probe.json` 确认正确 class 与 WXSS 均已生效，四角计算值全部为 12px，属于当前 Stable/SDK 的缩写读取差异。改为检查四个长属性；回归同时模拟缩写为 null 的通过路径和单角归零的失败路径，已包含于 92 项脚本测试。
- 重新打开历史项目的诊断未再出现 open 后原生 ready 事件，失败记录为 `artifacts/goal-ide-radius-preopen-failure.json`。`open` 只证明编辑器已打开，因此启动流程不再提前要求模拟器 ready；仍在 `auto` 前记录 checkpoint，等待 `auto` 后新的自有原生 ready 事件，再连接 SDK，并验证应用页面栈与根结构。
- r3 Babel 运行 `artifacts/ide/run-1792120256803/report.json` 的原生场景已完成全部交互；随后 Wevu 初始 class 属性返回 null 而失败。该运行不是完整 suite 通过；两份自有项目、端口和原生窗口已关闭，互斥锁已释放。
- r3 Wevu 失败的根因是 JSX 模板使用的 `attrs` 在模块级声明，Wevu 只把 `setup()` 局部发布到 WXML；同时 headless 断言在带尾部分隔符的项目路径上漏掉 JSX 检查，未覆盖组件自己的主题保持。r4 将 `stylex.attrs(lightTheme, styles.card)` 移入 `setup()`，显式绑定 `class` / `style` 并增加 `data-testid`；headless 现在检查初始 JSX class、父主题切换后的 own light theme 和分包尾端。红色复现为 `artifacts/goal-wevu-jsx-regression-red.log`，Babel / auto 绿色回归为 `artifacts/goal-wevu-jsx-regression-green-babel.log` 与 `artifacts/goal-wevu-jsx-regression-green-auto.log`，外部 adapter 绿色结果为 `artifacts/goal-ide-final-r4-adapter-headless.json`，facade/adapter 汇总为 `artifacts/goal-final-r4-consumer-gate.json`。
- r4 已在两份技术文档中说明该 Wevu 约束：JSX/TSX 的模板绑定必须在 `setup()` 内声明，模块级 styles/tokens/themes 仍可导入，且应显式绑定 `class` 与 `style`。文档 API、site、lint、typecheck、build、12 项测试及生产浏览器交互均通过；汇总见 `artifacts/goal-final-r4-docs-checks.json`。

发布包变更由 Changesets 记录，不手动增加版本，不发布 npm。

## 当前环境边界

实际安装及本轮核对的官方 Stable 均为 2.02.2608080，显式 CLI 为 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`；授权 AppID 沿用 `wx6ffee4673b257014`。macOS 已解锁，CLI 已确认 `login=true`，服务端口为 20343，日志为 `artifacts/goal-ide-final-islogin.log`。Babel 运行的 `Tool.getInfo` 与系统信息报告 SDK 3.17.4，auto 运行报告 SDK 3.17.5；两者均通过完整 suite。此前锁屏与服务端口关闭的预检作为历史记录保留，已不再是当前阻塞。

支付宝、抖音覆盖构建与集成回归，其真实 IDE 验收仍待完成。真机、独立分包、Vue 2、uni-app x 和 stateful HMR 不在本次完成门槛内。

本轮机器可读结果与日志位于 `artifacts/goal-final-*`，完整 IDE 运行证据位于 `artifacts/ide/run-*`。两轮完整 IDE 和其他规定回归均已通过；当前仍未提交或推送本轮代码，因此对应远端 CI 尚未验收。

结构化汇总见 [本轮验证记录](validation/full-scenario-2026-10-16.json)。候选包审计与依赖升级后的基线一致：75 项 advisory（4 critical、21 high、40 moderate、10 low），没有新增 advisory ID；仍由固定的 Taro、uni-app 和 automator 宿主链路传递。未执行 audit fix，未添加安全 overrides。兼容 outdated 查询只返回 Sass 1.105.2，其当前与 wanted 均为 1.105.1；本轮保留已验证的锁文件。

审计路径差异另存 `artifacts/goal-final-audit-delta.json`：新增的 Vue JSX peer 边会显示已直接声明、固定在 Taro 兼容组合中的 Vite 4 风险路径，不代表解决了该宿主的历史风险，也没有引入新的 Vite 版本。
