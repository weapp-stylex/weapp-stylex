# 共享模块与多框架验收（2026-10-08）

本轮新增 `@weapp-stylex/compiler`、`@weapp-stylex/taro`、`@weapp-stylex/uni-app`，保留原生 `stylexCompiler()`，新增原生/Wevu 共享 session 工厂 `createStylex()`。包与示例通过 repoctl 的 tsdown 模板创建，保留模板基线以供后续升级比较。

## 版本与隔离

本地 Node 24.18.0、Corepack pnpm 12.10.1，TypeScript 6.0.3，官方 StyleX runtime/plugin 0.19.1。CI 同时配置 Node 22.22.1、24.18.0。

| 技术路线       | 框架版本                                                | Builder        | 已构建目录                             |
| -------------- | ------------------------------------------------------- | -------------- | -------------------------------------- |
| 原生微信       | weapp-vite 7.4.0                                        | Vite 8.3.3     | examples/wechat-native/dist            |
| Wevu SFC / JSX | wevu 7.4.0、weapp-vite 7.4.0                            | Vite 8.3.3     | examples/wechat-wevu/dist              |
| Taro React     | Taro 4.3.0、React 18.3.1                                | Webpack 5.91.0 | examples/taro-react/dist/weapp-webpack |
| Taro React     | 同上                                                    | Vite 4.5.14    | examples/taro-react/dist/weapp-vite    |
| Taro Vue 3     | Taro 4.3.0、Vue 3.5.43                                  | Webpack 5.91.0 | examples/taro-vue3/dist/weapp-webpack  |
| Taro Vue 3     | 同上                                                    | Vite 4.5.14    | examples/taro-vue3/dist/weapp-vite     |
| uni-app Vue 3  | 官方 vue3 通道 3.0.0-alpha-5030120260930001、Vue 3.4.21 | Vite 5.2.8     | examples/uni-vue3/dist/build/mp-weixin |

StyleX 使用 Babel 7（声明 ^7.29.7），weapp-vite 保留自身 Babel 8。DCloud 包全部使用同一通道版本，`@dcloudio/types` 对齐该通道的 peer 3.4.31。Taro 显式安装 Babel preset 的可选 React/Vue JSX peer、对应 Vite framework plugin 和 Less 4，避免 pnpm 的严格依赖布局掩盖缺失依赖。

原先全局 Vite override 已改为只作用于 Vite 8 的限定范围。esbuild、nanoid、js-yaml、uuid、postcss-selector-parser 的旧全局跨主版本覆盖也改为限定范围。repoctl 的 intentional dependency groups 分开管理 Taro 的 Vite 4 与 uni-app 的 Vite 5 / Vue 3.4。保留已验证的 simple-git、tinypool、KaTeX 局部修复，不将 Babel 8 或 Vite 8 强加给其他工具链。

uni-app 的构建会重定向 Vue compiler 解析；适配器从 DCloud 插件所在的依赖上下文解析 SFC parser，避免 core compiler 3.5 与 DCloud shared 3.4 的 `genCacheKey` API 不一致。

## 自动验收

| 入口                      | 验证内容                                              | 状态                                           |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| install --frozen-lockfile | 全部 workspace 与锁文件一致                           | 通过                                           |
| lint                      | 真正的 ESLint 全仓检查                                | 通过，保留非阻塞工具建议                       |
| build                     | 五个公开包、七份微信产物                              | 通过                                           |
| typecheck                 | 工具、全部源码、编译器测试、五个示例                  | 通过                                           |
| test                      | 共享编译核心和原生适配器 17 个单测                    | 通过                                           |
| test:deps                 | Babel 7/8 隔离、simple-git、格式化、Markdown 数学解析 | 通过                                           |
| test:integration          | 原生模块图、Vite watch、Webpack filesystem cache      | 通过                                           |
| test:examples             | 七份产物、原生/Wevu 逻辑树与交互                      | 通过                                           |
| repo deps check           | 有意分组的版本声明                                    | 通过                                           |
| repo doctor               | 模板基线、workspace、工具版本及配置                   | 无阻塞失败；模板定制和 override 证据限制有提示 |
| repo check --full         | lint、typecheck、test、build                          | 通过                                           |
| audit --json              | 有效审计报告，见下一节                                | 有残留，退出码 1                               |
| test:ide                  | 官方稳定版预检、真实串行 suite                        | 缺真实 AppID，pending，退出码 2                |

单测包含具名/默认共享导出、barrel、官方 runtime 条件合并与属性覆盖、动态 style、别名主题哈希一致、SFC 双脚本和 sourcemap、虚拟脚本重复转换防护、metadata 替换/删除/图裁剪、CSS 去重、px/rpx、WXSS companion、重复输出、watch 中新出现的用户样式与同名冲突，以及无 StyleX 的初始构建不变。

真实原生模块图使用 src 外部的 workspace 源码包（symlink + package exports）、路径别名、barrel 和两个消费者。只移除一个消费者时样式保留，两个消费者都移除导入后样式消失。重复调用生产 build API 时，测试通过宿主公开 `invalidateFileCache` 通知组件源码变化；宿主生产编译器在同一个 Node 进程保存文件读取缓存，正常 host watcher 会调用该 invalidation。

官方 Babel 插件可能内联 token 引用并移除 token 的 JS 导入。共享编译核心直接收集这些 token 文件的默认 CSS 和传递依赖，并随消费者 metadata 一起保存，保证原生宿主未加载 token 模块或 Webpack 命中磁盘缓存时默认变量仍存在。真实原生、Vite watch、Webpack cache 测试均覆盖默认值更新；七份产物使用 CSS 解析检查 `page` 默认变量，兼容宿主的选择器排序和颜色压缩。

Vite watcher 连续验证 importer-only 修改、共享定义 red→blue、token 默认值 orange→purple、移除导入，确认没有旧规则或过期生成文件。Webpack 关闭 compiler 再创建新实例，验证 shared 模块从磁盘缓存恢复且 `buildInfo` 的 StyleX metadata 仍存在，然后验证编辑与清理。所有 watcher/compiler 和临时目录在 finally 中关闭或删除。

七份产物都检查共享 class、16px 和 12rpx、主题变量、无 Layers/:root/polyfill、同目录 import、页面及普通分包入口。原生、Wevu 通过 `@mpcore/test` 验证组件、条件 class、主题切换、动态 120px 和分包；Wevu 同时验证 JSX 组件。Taro 与 uni-app 的真实运行时验收仍按下节标记，不把构建检查替代为 IDE 成功。

本机另有 pnpm 12.9.1 在 PATH 中遮蔽 Corepack shim。验证通过 Corepack 执行，并在 repo check/提交 hooks 前将当前 Node 的 Corepack shim 目录置于 PATH 前端，保留严格版本校验。没有修改全局 pnpm 或关闭版本门禁。

## 审计边界

新增 Taro/uni-app 开发工具链后，旧的依赖升级记录中“仅 1 high”属于此前原生项目的历史结果，不能代表现在的完整依赖图。完整本轮报告保存在本地 `artifacts/audit.json`。

当前审计为 **72 项：4 critical、20 high、38 moderate、10 low**。这些是扫描完整 workspace 开发工具链所得的公告条目，不代表 72 个独立运行时漏洞。

- 固定的 Vite 4.5.14 / 5.2.8、Webpack 5.91.0 和 Vue 3.4.21 来自本轮框架兼容基线，因此相应 Vite、Webpack、Vue server-renderer 公告保留。需要单独的宿主框架升级工作验证，不能全局换到新主版本。
- critical 涉及旧的 `minimist`、`swiper`、`decompress`；其他旧构建链包含 got、jpeg-js、git-clone、html-minifier、Webpack dev server/middleware、ws、intlify 等。`decompress`、git-clone、html-minifier、node-forge、braces 的报告没有已发布修复版本。
- 已有 simple-git、argv-parser、tinypool、KaTeX 修复继续生效，并由 test:deps 验证。并未宣称完整审计为零。
- repoctl 上游 @pnpm/logger 1001/1100 和 devframe 的 agentic peer 版本提示仍保留；新增示例自身的 Less/DCloud 类型 peer 已对齐。

## 真实微信开发者工具

预检时间：2026-10-08T10:18:13.036Z。官方来源：[开发者工具下载页](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，及该页加载的 [官方版本配置](https://devtools.wxqcloud.qq.com.cn/WechatWebDev/nightly/versions/config.json)。

| 记录                            | 本次结果                                               |
| ------------------------------- | ------------------------------------------------------ |
| 官方稳定版                      | 2.02.2608080，官方配置日期 2026-09-30                  |
| 选定安装                        | /Applications/wechatwebdevtools.app/Contents/MacOS/cli |
| 实际安装版本                    | 2.02.2608080，与官方稳定版一致                         |
| AppID                           | WEAPP_STYLEX_APPID 未配置，未使用 tourist mode 验收    |
| 实际连接 IDE / 基础库           | 未连接，待真实 AppID 后记录                            |
| 截图 / runtime 日志             | 未产生；suite 完成时写入 artifacts/ide/run-*           |
| 预检记录                        | artifacts/ide/report.json、official-versions.json      |
| 本任务创建 DevTools / automator | 0 / 0；没有待清理资源                                  |

`test:ide` 已实现全局串行 suite 与锁、每份产物独立副本、真实 AppID 与条件页同步、单次 automator 启动、reLaunch 切页、组件/条件/主题/动态值/分包断言、断言后的截图、console/exception 日志、基础库与账户信息记录，以及专属项目连接关闭后的端点核对。缺环境预检返回 2；失败返回 1；只有七份全部真实通过才返回 0。

```bash
WEAPP_STYLEX_APPID=wx... \
WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH=/Applications/wechatwebdevtools.app/Contents/MacOS/cli \
corepack pnpm test:ide
```

再次运行时重新查询官方 stable，而不是把本次版本永久当作最新版。macOS 长时间验收可通过 caffeinate 包裹命令。首次登录、服务端口未开或版本不符不会静默改用旧版本。

## 交付

通过 `corepack pnpm change` 为共享编译器和三个适配包记录 minor 意图，版本仍由正式发布流程决定。本轮不发布 npm。独立分包、非微信平台、Vue 2、uni-app x、WXML sx 属性和 stateful HMR 均未加入稳定兼容承诺。
