# 文档站部署

核心域名：<https://stylex.weapp.dev/>，根地址由客户端自动选择语言：手动保存的选择优先，其次按系统时区推断地区（中国时区进入 `/zh/`，其他有效时区进入 `/en/`），时区不可用时回退到浏览器首选语言。英文首页位于 `/en/`，其他英文指南沿用根目录路由。所有 canonical、hreflang、sitemap 和 Markdown/AI 入口都使用该域名。

## 创建与升级记录

2026-10-09 查询 npm 的最新 repoctl 为 **5.9.0**，从 5.8.1 升级。模板依赖仍为 **2.3.1**。执行 `repo upgrade --dry-run --json` 审查差异后，使用 `--no-overwrite` 的计划应用，结果为 unchanged。保留微信专用 CI，以及 Taro Vite 4、uni-app Vite 5、weapp-vite Vite 8 的版本隔离；未采用模板新增的全局 major override。

通过 `corepack pnpm exec repo new docs --template nimbus` 创建 `apps/docs`，保留模板实例与基线。使用默认 Nimbus 0.16.0 / Astro 7.3.7，不替换成 VitePress。

## 本地验证与部署

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter docs lint
corepack pnpm --filter docs typecheck
corepack pnpm --filter docs build
corepack pnpm --filter docs check:site
corepack pnpm --filter docs test
corepack pnpm --filter docs exec wrangler whoami
corepack pnpm --filter docs exec wrangler deploy --dry-run
corepack pnpm --filter docs exec wrangler deploy
```

构建后的搜索使用 Pagefind。浏览器验收检查中英页面、对应语言切换、搜索结果、移动导航、代码滚动与深色模式；先在生产 preview 检查，再验证线上产物。

## Cloudflare 配置

- Cloudflare 部署名：`weapp-stylex-docs`，纯 Static Assets，无自定义 Worker 脚本。
- 配置：`apps/docs/wrangler.jsonc`；产物：`apps/docs/dist`。
- custom domain：`stylex.weapp.dev`，由 Wrangler 管理 DNS 与 TLS。
- 禁用 workers.dev 和 preview URL，主域名作为唯一公开站点入口。
- HTML 使用末尾斜线；未知页面返回真实 404，不返回 SPA 首页。
- 根地址发布统一的语言选择 HTML，客户端读取 `Intl.DateTimeFormat().resolvedOptions().timeZone` 推断地区，通过 `location.replace` 跳转并保留 query/hash。中国时区含 `Asia/Shanghai`、`Asia/Urumqi` 及 IANA 历史别名；其他有效时区（包括 UTC）选择英文，单纯 UTC 偏移不能推断地区。
- 保持纯静态部署，不增加 Worker 运行调用，不查询 IP 服务、不请求定位权限。HTML 相同，语言选择只在客户端执行，静态缓存不会串用户地区。
- 设备时区只反映系统设置，不保证真实所在地；时区不可用时使用浏览器首选语言。开发、静态 preview 与生产使用同一逻辑。手动切换保存到 localStorage；storage 禁用不影响切换和自动选择。无 JavaScript 时提供两种手动入口。直接访问具体语言页或文章不会自动改写。
- 英文首页使用 `slug: en`，导航与语言切换明确指向 `/en/`；`public/_redirects` 仅保留旧 `/index.mdx` 到 `/en/index.mdx` 的兼容跳转。
- `_headers` 为哈希静态资源提供长期缓存，并配置基本响应头。
- 所有凭据留在本地 Wrangler 登录配置或 CI secret，代码不包含令牌。

`.github/workflows/docs.yml` 自动验证站点。常规根 CI 的 build/typecheck 也覆盖此 workspace。当前部署使用本地 Wrangler 认证；没有将短期 OAuth token 复制进 GitHub Actions。需要持续自动部署时，配置最小权限的 Cloudflare API token 与明确的部署环境后接入。

## 验收入口

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

`check:site` 检查双语页面数量、语言属性、canonical、alternate、内部链接和锚点、Markdown 以及搜索/AI 文件。新增文档时同步两种语言。

## 回滚

```sh
corepack pnpm --filter docs exec wrangler deployments list
corepack pnpm --filter docs exec wrangler rollback <previous-version-id>
```

首个部署没有可回滚的旧版本；从 Git 恢复之前的文档提交后重新 build/deploy。不要删除整个 zone 或改动其他项目的 DNS/Worker。真实发布版本、线上验收与日志记录见本文件后续的交付记录。

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
