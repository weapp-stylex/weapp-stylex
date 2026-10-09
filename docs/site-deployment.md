# 文档站部署

核心域名：<https://stylex.weapp.dev/>，英文位于 `/`，中文位于 `/zh/`。所有 canonical、hreflang、sitemap 和 Markdown/AI 入口都使用该域名。

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
corepack pnpm --filter docs exec wrangler whoami
corepack pnpm --filter docs exec wrangler deploy --dry-run
corepack pnpm --filter docs exec wrangler deploy
```

构建后的搜索使用 Pagefind。浏览器验收检查中英页面、对应语言切换、搜索结果、移动导航、代码滚动与深色模式；先在生产 preview 检查，再验证线上产物。

## Cloudflare 配置

- Worker：`weapp-stylex-docs`，纯 Static Assets，无自定义 Worker 脚本。
- 配置：`apps/docs/wrangler.jsonc`；产物：`apps/docs/dist`。
- custom domain：`stylex.weapp.dev`，由 Wrangler 管理 DNS 与 TLS。
- 禁用 workers.dev 和 preview URL，主域名作为唯一公开站点入口。
- HTML 使用末尾斜线；未知页面返回真实 404，不返回 SPA 首页。
- `_headers` 为哈希静态资源提供长期缓存，并配置基本响应头。
- 所有凭据留在本地 Wrangler 登录配置或 CI secret，代码不包含令牌。

`.github/workflows/docs.yml` 自动验证站点。常规根 CI 的 build/typecheck 也覆盖此 workspace。当前部署使用本地 Wrangler 认证；没有将短期 OAuth token 复制进 GitHub Actions。需要持续自动部署时，配置最小权限的 Cloudflare API token 与明确的部署环境后接入。

## 验收入口

```text
/
/zh/
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
