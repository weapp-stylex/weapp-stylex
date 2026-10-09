# npm 发布

六个公开包（`weapp-stylex` 聚合包及五个 `@weapp-stylex/*` 拆分包）由 `weapp-stylex/weapp-stylex` 的 `.github/workflows/release.yml` 发布。npm trusted publisher 绑定该仓库及工作流文件名；新包按下述首次注册流程接入，不使用持久 npm token。

## 版本与发布流程

在修改公开包后，用中文摘要记录变更意图：

```bash
corepack pnpm change @weapp-stylex/core --bump patch --summary '描述用户可见的改动。'
corepack pnpm exec repo release plan --json
```

提交并推送后，repoctl 的受管工作流生成 Release PR，使用 pnpm 原生版本管理消费意图、更新版本、依赖和 changelog。审查并合并 Release PR 后，工作流完成质量检查、公开发布、provenance 及 GitHub Release。不要手动修改版本或跳过尚未消费的意图发布。

手动触发与认证检查：

```bash
gh workflow run release.yml --repo weapp-stylex/weapp-stylex --ref main -f mode=prepare
gh workflow run release.yml --repo weapp-stylex/weapp-stylex --ref main -f mode=oidc-audit
```

`oidc-audit` 检查每个包能否通过 GitHub OIDC 换取 npm 发布认证；成功不代表包已发布。新 trusted publisher 还需在 npm 要求的两天内完成首次成功的 OIDC 发布。

## 新包注册

`npm trust` 要求包已存在、当前账号有写入权限且开启 2FA。新包先通过已登录账号发布实际构建并验证过的产物，然后配置：

```bash
npm trust github @weapp-stylex/core \
  --repo weapp-stylex/weapp-stylex \
  --file release.yml \
  --allow-publish --yes \
  --registry=https://registry.npmjs.org
npm trust list @weapp-stylex/core --json
```

对其他包使用各自的名称。批量配置按 npm 官方建议串行执行并间隔两秒。npm 可能要求网页二次验证；CLI 登录不能替代这一步。

首次上传后 registry 可能需要几分钟处理。确认目标版本的可见状态再恢复发布，避免重复上传已成功的版本。发布工作流保存进度 artifact；单包恢复使用 repoctl 受管工作流的 `publish-unpublished` 模式及精确包名、版本。

## 聚合包发布验收

首次注册后，用 `pnpm change` 记录正式版本意图，再通过 Release PR 验证首次 OIDC 上传。pnpm 原生流程会将新包当前版本作为注册版本；正式版本仍由变更意图和 Release PR 生成，不手改 manifest。

确认聚合包及其依赖都已在 registry 可见后，在干净临时项目中验证实际发布产物：

```bash
WEAPP_STYLEX_TEST_REGISTRY_VERSION=0.1.0 corepack pnpm exec node scripts/test-package.mjs
```

将版本替换为本次实际发布版本。该脚本检查宿主可选 peer、runtime 隔离、ESM/CJS 子路径、官方 StyleX 编译结果和独立消费者类型声明，结束后清理临时目录。不设置版本时检查本地六个 tarball，供集成测试使用。

仓库需允许 Actions 创建 Release PR。工作流使用 GitHub hosted runner、`id-token: write`、支持 trusted publishing 的 npm CLI 及公开 `publishConfig.access`。受管配置通过 repoctl 维护。

## 发布阶段与上游收敛

Actions 将发布拆成 plan、verify、prepare、upload、confirm、finalize 六个步骤，
无触发的提交在 plan 后跳过。OIDC 工作流不设置 setup-node 的 `registry-url`，
避免生成缺少 `NODE_AUTH_TOKEN` 的静态认证占位符。

2026-10-09 曾通过精确版本 pnpm 补丁接入 repoctl 上游改进；2026-10-10 已升级到
正式 `repoctl@5.10.0` 与模板 `2.3.2` 并移除两个补丁。
上游 [PR #1056](https://github.com/icelib/repoctl/pull/1056) 的
[发布运行](https://github.com/icelib/repoctl/actions/runs/37969332933) 已成功。
来源、registry 查询策略、阶段恢复规则、历史证据与本轮验证入口见
[维护记录](./release-stages-patch.md)。
