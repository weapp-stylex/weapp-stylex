# 文档站部署

repoctl `6.0.1` 将站点登记为 `commands.docs.sites.stylex`，覆盖六个公开包。两个渠道使用相同的 Nimbus/Astro 静态站和双语内容，部署到独立 Cloudflare Worker。

| 渠道      | 来源与触发                                         | 地址                                | Worker                      |
| --------- | -------------------------------------------------- | ----------------------------------- | --------------------------- |
| `preview` | 最新 `main` 提交；main push 自动部署               | <https://preview.stylex.weapp.dev/> | `weapp-stylex-docs-preview` |
| `stable`  | 完整稳定 npm 发布记录；release finalize 后自动部署 | <https://stylex.weapp.dev/>         | `weapp-stylex-docs`         |

正式站内容绑定已发布包对应的源码；nightly 不触发正式站。预览站显示未发布提示，使用 HTML noindex、robots 和响应头限制搜索引擎索引，保留 Pagefind 搜索。两个渠道的 canonical、hreflang、sitemap、Markdown 和 AI 入口分别使用自己的 origin。

根地址由客户端选择语言：手动保存的选择优先，其次按系统时区推断地区，中国时区进入 `/zh/`，其他有效时区进入 `/en/`；时区不可用时回退到浏览器首选语言。英文首页位于 `/en/`，其他英文指南沿用根目录路由。无 JavaScript 时保留两个语言入口，具体文章地址不自动改写。

## 工作流与首次接入

- `.github/workflows/repoctl-docs.yml` 监听 `main` push，并提供手动选择 site、channel、release、source-sha 和 commits 的入口。
- `.github/workflows/repoctl-docs-deploy.yml` 是受管部署执行器，使用环境和并发组 `docs-stylex-preview` / `docs-stylex-stable`。同一站点渠道串行执行，不取消正在运行的部署。
- `.github/workflows/release.yml` 的 finalize 阶段产生完整稳定发布记录后，调用执行器部署 `stable`。
- `.github/workflows/docs.yml` 的 `Documentation checks` 保留项目专用静态检查及浏览器验证。部署自身的 `docs:build` 也必须验证冻结源码，不能仅凭另一个 workflow 通过就上传。

首次迁移时保留已在线的正式 Worker 版本，先启用预览。稳定站的首个受管基线等待下一次合格的完整稳定发布；旧发布检查点不等于新的 completion record。不要伪造发布记录、将任意 main SHA 指定为稳定源码，或为启用网站而临时发布 npm。

完成记录和部署进度由 repoctl 保存在 `repoctl-release-state` 分支。稳定站部署必须在受管 Actions 环境和正确并发组中执行；本地可以 plan，不能直接 deploy stable。

## Cloudflare 与 GitHub 配置

在 GitHub 创建 `docs-stylex-preview`、`docs-stylex-stable` environments，均采用自动部署，不设置人工审核门禁。为工作流配置：

| 名称                    | 类型               | 内容                                                      |
| ----------------------- | ------------------ | --------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Environment secret | 可管理目标 Worker 的专用 API token                        |
| `CLOUDFLARE_ACCOUNT_ID` | Secret 或 variable | `apps/docs/wrangler.jsonc` 中已有的 Cloudflare account ID |

Token 需要目标账户的 Worker 上传与部署权限、版本和 deployment 读取权限，以及目标 zone 的 custom domain 管理权限。复用现有账户和 zone，仅管理本项目两个 Worker。不要将本地 Wrangler 的短期 OAuth token 复制到 GitHub，或将凭据写入仓库、日志与命令参数。

`apps/docs/wrangler.jsonc` 是部署配置来源，静态产物为 `apps/docs/dist`。正式目标保留 `weapp-stylex-docs`，预览通过 `preview` environment 使用独立 Worker 与 `preview.stylex.weapp.dev` custom domain。两者继续禁用 `workers.dev` 和版本 preview URL；常驻预览站使用自己的 custom domain。Wrangler 管理对应 DNS/TLS。

保持纯 Static Assets，不增加 Worker 脚本、按请求运行的语言检测、IP 查询或定位权限。HTML 使用末尾斜线，未知路径返回真实 404；`_redirects` 保留旧 `/index.mdx` 到 `/en/index.mdx` 的跳转，`_headers` 保留安全及哈希资源缓存策略。

## 本地验证

开发工具链要求 Node.js `^22.23.4 || ^24.22.1 || >=26.12.1`，CI 使用 22.23.4 和 24.22.1。pnpm 固定为 12.11.2，公开包的消费者下限不变。

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm docs:build
REPO_DOCS_CHANNEL=preview REPO_DOCS_URL=https://preview.stylex.weapp.dev corepack pnpm docs:build
```

`docs:build` 构建六包声明并执行文档 lint、类型检查、构建、API/站点检查、单测与 headless 浏览器验收，同时准备所需 Chromium。本地两个命令只构建和验证，不上传。无部署环境变量时使用正式站 origin；预览变量应同时传给构建与检查，避免用正式 origin 校验预览产物。

浏览器验证覆盖双语搜索、键盘与焦点、复制、主题持久化、语言切换、移动导航及无 JavaScript 内容，并关闭自己创建的浏览器和服务。既有框架/IDE 验收仍按各自的日期与范围记录。

## 计划、部署与重试

预览必须使用当前最新 `origin/main` 的完整 SHA。repoctl 在构建后再次核对 main，阻止较旧预览覆盖较新提交：

```sh
corepack pnpm exec repo docs plan stylex --channel preview --source-sha <full-main-sha> --json
```

正式计划使用完整稳定发布记录 ID，不能使用任意源码 SHA：

```sh
corepack pnpm exec repo docs plan stylex --channel stable --release <completion-id> --json
```

正常发布自动部署。需要重新执行失败的正式部署时，通过受管入口传同一个记录：

```sh
gh workflow run repoctl-docs.yml --repo weapp-stylex/weapp-stylex --ref main \
  -f site=stylex -f channel=stable -f release=<completion-id>
```

`docs:deploy:preview` 与 `docs:deploy:stable` 是内部 provider 适配器。repoctl 注入源码、渠道、URL、发布记录、deployment ID 和 `REPO_DOCS_RESULT_FILE`；适配器确认构建身份与目标一致，再检查 Cloudflare 当前唯一 100% 生效版本。只有部署确认后，才写入 `{ versionId, url }` 供 repoctl 推进状态。同一 deployment ID 已生效时可恢复结果，不重复上传。

失败后保留日志、deployment ID 和版本证据，修正原因后重试同一记录。不要重新发布 npm、修改 repoctl 状态分支、删除 pending 记录，或用直接 `wrangler deploy` 覆盖正式站。重试仍需验证 Cloudflare 实际生效版本，不能把上传成功等同于已完成发布。

## 稳定文档修正

`patchPaths` 只允许已经合入 main 的中英文内容和静态图片修正。通过受管手动入口的 `commits` 选择单父提交；每个提交必须通过 repoctl 的路径及内容检查。导航、组件、构建与部署配置、scripts、包源码和 lockfile 变更等待正常稳定发布，不通过文档修正入口绕过发布边界。

`releaseInputs` 覆盖每个公开包的发布源码、manifest、构建配置和共享 `tsconfig.base.json`，排除测试、fixtures、README 与 CHANGELOG。修改这些输入后，稳定站必须取得相应的新发布证据。完整快照仍使用冻结 lockfile 安装依赖。

## 验收与恢复记录

对两个渠道分别检查以下入口，以及目标域名、索引策略、真实 404 和交互行为：

```text
/
/zh/
/en/
/get-started/
/zh/get-started/
/llms.txt
/zh/llms.txt
/llms-full.txt
/styles/index.md
/zh/styles/index.mdx
/sitemap-index.xml
/robots.txt
```

配置接入、构建成功和站点上线是不同状态。记录各次实际 workflow、源码 SHA、release/deployment ID、Cloudflare version ID、URL 和线上验收结果；凭据未就绪或首次稳定基线未建立时，明确标为待上线。

预览失败可由当前 main 的部署重试恢复。稳定站保留上一次成功部署，使用相同 completion ID 恢复未完成部署，或通过合格的后续稳定发布更新。紧急 Cloudflare 版本回退属于单独的运维操作，需要同时核对真实生效版本与 repoctl 记录，不能把旧的直接 rollback/build/deploy 方式当作日常发布入口。不要删除整个 zone 或改动其他项目的 DNS/Worker。

以下为历史迁移和验收记录，不代表当前双渠道流程已上线或当前版本已通过验收。

## 2026-10-10 repoctl 正式版收敛

上游 [PR #1056](https://github.com/icelib/repoctl/pull/1056) 的
[正式发布运行](https://github.com/icelib/repoctl/actions/runs/37969332933) 已成功。
本项目升级到 `repoctl@5.10.0` 与模板 `2.3.2`，移除两个临时补丁。受管同步采用
`repo upgrade --dry-run --json --no-overwrite` 计划及 `--apply <plan.json>`，保留微信
专用 CI、gitignore 定制、intentional dependency groups 和框架版本隔离；历史 root
asset baseline 继续记录原来源版本。

本轮验证命令与 CI/CD 入口见[发布维护记录](./release-stages-patch.md)。Cloudflare
生产版本及浏览器验收仍以各次真实部署记录为准。

## 创建与升级记录（2026-10-09）

2026-10-09 查询时，npm 的最新 repoctl 为 **5.9.0**，从 5.8.1 升级。模板依赖仍为 **2.3.1**。执行 `repo upgrade --dry-run --json` 审查差异后，使用 `--no-overwrite` 的计划应用，结果为 unchanged。保留微信专用 CI，以及 Taro Vite 4、uni-app Vite 5、weapp-vite Vite 8 的版本隔离；未采用模板新增的全局 major override。

通过 `corepack pnpm exec repo new docs --template nimbus` 创建 `apps/docs`，保留模板实例与基线。使用默认 Nimbus 0.16.0 / Astro 7.3.7，不替换成 VitePress。

## 2026-10-09 交付记录

- repoctl：5.9.0，模板：2.3.1，Wrangler：4.149.0。
- 最终 Worker version：`dc94754d-8ef2-4be6-8953-16c3fa3d87ff`。
- Cloudflare 与 Google 公共 DNS 均解析成功；HTTPS 真实浏览器加载成功。
- 14 组中英文页面、对应语言切换、两种语言搜索、Markdown/AI 入口、404、移动菜单、无横向溢出和深色模式均通过。线上浏览器未报告页面错误。
- 首次文档 CI 暴露干净 checkout 缺少 `.nimbus/lint.json` / 路由清单的问题。文档 lint 入口已自动先 build 再执行 Nimbus lint，同时验证无缓存运行；不将本地已生成文件当作 CI 前提。
- frozen install、根 lint/build/typecheck/test、test:deps、test:integration、test:examples、repo deps check、repo doctor、repo check --full 均返回 0；文档 lint、类型检查、check:site 和部署 dry-run 通过。
- repo doctor 仍提示 override 声明等证据限制，未将 warn 描述为通过证明。pnpm audit 返回 1：全仓 4 critical / 20 high / 38 moderate / 10 low，残留包含受兼容版本约束的框架工具链，审计不视为通过。本次没有扩大到框架依赖全面升级。文档依赖路径也包含 Vite 的可选 Stylus → glob CLI 告警，审计详情保留在日志中。
- 新增 Nimbus 改变了私有 hoist 的 estree-walker 版本，暴露 DCloud `uni-mp-vite` 对 CJS walker 的未声明依赖。通过审查并应用 repo upgrade JSON，给该精确 DCloud 版本补充 `estree-walker: 2.0.2` packageExtension，并加入真实 CJS walk 兼容检查，七份示例产物已重新验证。
- 线上截图：`artifacts/docs-desktop.png`、`artifacts/docs-mobile.png`、`artifacts/docs-dark.png`。浏览器日志：`artifacts/docs-online-qa.log`；完整命令结果：`artifacts/docs-validation.json`；审计：`artifacts/docs-audit.json`；部署：`artifacts/docs-deploy-final.log`。
- 浏览器 QA 使用 headless Chrome，每次以 try/finally 关闭 context/browser。复用原有项目预览标签展示中文线上首页；本地文档 preview 与已被线上页面替换的 logo preview 服务在交付时关闭。保留一个线上交付页。

## 默认中文入口修复（2026-10-09）

以下是上一版无条件中文跳转的历史记录，已由后续的地区自动选择实现替代。

- 根因：英文首页原先由根内容条目发布到 `/`，没有语言跳转规则；中文只在 `/zh/` 提供。静态部署不会依据浏览器语言自动切换。
- 根地址现在返回 `302 Location: /zh/`。Astro 的 redirect 覆盖开发及静态 preview，Cloudflare `public/_redirects` 在资源层提供无需 JavaScript 的 HTTP 跳转。
- 英文首页通过原内容的 `slug: en` 发布到 `/en/`。更新首页语言切换、品牌导航、404 返回入口、项目及组织 README 链接；其他英文指南保持原有路由。旧 `/index.mdx` 返回 301 到 `/en/index.mdx`。
- 原生产版本：`42d7e0f8-3c2d-437a-b3b1-8e2eb8b9aead`；新生产版本：`6a458a77-d506-49d5-a35f-8810b7f29e5c`。部署日志：`artifacts/docs-language-deploy.log`。
- frozen install、文档 lint/typecheck、32 页站点检查、仓库 `repo check --full`、发布意图检查及部署 dry-run 均通过。Doctor 为 175 pass / 83 warn / 0 fail，保留模板定制与 override 一致性证据等提示。
- 本地和线上各通过 37 项 HTTP 与真实浏览器检查：根地址及带查询参数的入口、默认中文、英文首页、正文对应语言切换、双语搜索、canonical、Markdown、AI 发现入口、sitemap、robots 和真实 404。浏览器未报告页面错误。回归检查已加入 `check:site`。
- 日志：`artifacts/docs-language-local-qa.log`、`artifacts/docs-language-online-qa.log`；截图：`artifacts/docs-language-local-zh.png`、`artifacts/docs-language-online-zh.png`；结构化记录：`artifacts/docs-language-validation.json`。两次验收脚本路径/执行环境错误保留为独立日志，没有将错误当作通过。
- 复用一个本任务创建的 headless Chrome 会话 `sxlang1009`，确认 `headed: false`。验收结束已关闭并核对无剩余会话；本任务 Wrangler 本地服务的 18969/18970 端口均已释放，没有操作用户的浏览器或其他任务资源。

## 客户端地区语言选择（2026-10-09）

- 用户要求中国地区进入中文、其他地区进入英文，并明确采用纯客户端判断。撤销 Astro 与 `_redirects` 的无条件中文跳转，根地址发布静态语言选择页。配置没有 Worker `main`、binding 或 `run_worker_first`，不增加按请求运行的语言检测。
- 使用设备 IANA 时区推断地区：中国时区进入中文，其他有效时区进入英文；无时区信息时按浏览器首选语言回退。设备设置可能与真实所在地不同，不把时区检测宣传为 IP 定位。
- 手动语言选择优先并保存到 localStorage；自动检测不写入持久偏好，以便设备时区变化后重新判断。禁用存储时仍可自动选择和手动切换。直接文章路径不改写，根入口使用 `location.replace` 保留 query/hash，避免后退时循环进入选择页；无 JavaScript 时保留两种语言链接。
- 新生产版本：`0bab9fe8-040a-4901-9391-cc0e0363b1f7`；此前版本：`6a458a77-d506-49d5-a35f-8810b7f29e5c`。线上根地址实测为 HTTP 200，继续使用 Static Assets 缓存和安全响应头。
- 新增 4 组语言策略回归测试，文档 CI 显式执行。文档 lint/build/typecheck、32 页站点检查、仓库 `repo check --full`、`pnpm change check` 和部署 dry-run 均通过；Doctor 仍为 175 pass / 83 warn / 0 fail，不将既有提示当作零问题。
- 本地与线上各通过 69 项 HTTP/真实浏览器检查，包含中外时区与浏览器语言不一致、上海/乌鲁木齐、同为 UTC+8 的新加坡、UTC、手动选择优先、无效存储、storage/Intl 不可用、浏览器语言回退、无 JavaScript、query/hash、旧 MDX 入口、正文切换、后退、双语搜索、Markdown/AI、404。浏览器无页面错误。
- 证据：`artifacts/docs-client-region-online-qa.json`、`artifacts/docs-client-region-online-qa.log`、`artifacts/docs-client-region-validation.json`、`artifacts/docs-client-region-deploy.log`；截图：`artifacts/docs-client-region-local-zh.png`、`artifacts/docs-client-region-online-zh.png`。
- 本任务的 `sxgeo1009` Chrome 会话为 headless、in-memory，所有临时地区测试 context 均通过 `finally` 关闭；会话已关闭，`playwright-cli list` 确认无浏览器。本地 Wrangler 18971 端口已释放，未操作用户原有浏览器或保留临时页面。

## 文档体系与站点界面（2026-10-10）

- 文档增加到 29 对、58 个双语页面，保留原有 URL。五组共享导航同时驱动侧栏、面包屑和前后页；新增 API 总览、Runtime、类型、适配器、Compiler、六类场景教程及排障页。
- API 覆盖检查读取构建后的公开声明：13 个入口、24 个声明条件、64 个公开符号和 54 个对象/会话成员，要求两种语言都有对应章节。官方不稳定、遗留和微信未验证能力各自标注，不把内部导出当作公共 API。
- 首页和文章布局由项目维护，采用浅色底、绿色强调及静态 Phosphor SVG。主题支持浅色、深色和系统；搜索使用生产 Pagefind 索引，提供键盘快捷键、摘要、空结果及失败重试。Tabs、步骤、提示和 API 表同步进入 Markdown 与 AI 全文导出。
- 本地 Node 24.18.0、Corepack pnpm 12.10.1 下，frozen install、文档 lint/build/typecheck/test/check:site 与仓库 lint/build/typecheck/test/test:deps 通过；Babel/auto integration、七产物构建及 examples/headless 验证通过，auto WXSS 与 Babel 完全一致。repo deps check、doctor、check --full 和 pnpm change check 通过，没有包发布意图。Node 22.22.1 与 24.18.0 的远端矩阵由提交后 CI 确认。
- 单个 headless、in-memory 浏览器会话验证桌面和手机、浅色/深色/系统、复制、Tabs 键盘操作、搜索/空结果/失败重试、Escape 与焦点恢复、语言切换，以及 JavaScript 和存储不可用时的导航阅读。全部文档分别检查桌面与手机宽度，无页面横向溢出；API 稳定锚点保留顶栏偏移。
- 浏览器验收面向文档站点。七份微信产物和原生/Wevu headless 检查不等同于七框架全部微信开发者工具真实交互验收；历史 IDE 报告的 partial/pending 状态继续保留。
