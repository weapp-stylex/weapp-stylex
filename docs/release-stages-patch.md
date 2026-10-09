# 发布阶段拆分与 repoctl 临时补丁

## 来源和适用版本

本项目先以 pnpm 精确版本补丁接入上游改进，等待正式稳定版包含该实现后移除。
本轮没有发布新的 npm 版本，也不会自动合并上游 PR。

- 问题记录：[icelib/repoctl#1057](https://github.com/icelib/repoctl/issues/1057)。
- 实现 PR：[icelib/repoctl#1058](https://github.com/icelib/repoctl/pull/1058)。
- 实现提交：`71e9a5e237b0f51cbfd28c2fad27fc2f45d769a5`，基于 `1fd6c0e0`。
- CLI 固定为 `repoctl@5.9.0`；引擎补丁仅适用于 `@icebreakers/monorepo@5.9.0`。
- 模板补丁仅适用于 `@icebreakers/monorepo-templates@2.3.1`。
- 补丁位于 `patches/`，由 `pnpm-workspace.yaml` 的 `patchedDependencies`
  注册；补丁内容和哈希由锁文件固定。

引擎补丁来自该提交构建的全部 `dist` 产物（包括公开类型声明），模板补丁来自
同步后的 `assets/.github/workflows/release.yml` 和 `assets/gitignore`。
安装后的 29 个引擎文件逐字节比对通过。通过 repoctl 的 upgrade 预览和精确计划
应用更新发布工作流、gitignore 和受管 baseline；微信专用 CI 未被默认模板覆盖。

## 警告原因与认证配置

[原发布运行](https://github.com/weapp-stylex/weapp-stylex/actions/runs/37913908235)
中 `repo release ci` 约耗时 6 分 7 秒，其中 registry 可见性等待约 4 分 21 秒，
缺少 `NODE_AUTH_TOKEN` 的配置替换警告出现 12 次。

`actions/setup-node` 的 `registry-url` 会生成引用 `${NODE_AUTH_TOKEN}` 的
认证配置。OIDC trusted publishing 没有静态 token，因此 npm/pnpm 读取该配置
时发出警告。发布与独立 OIDC audit 均移除这个选项，继续显式使用官方 registry、
`id-token: write` 和 provenance，不设置假 token，不屏蔽警告。

自定义 registry、已有认证配置、restricted 包或自定义 proxy/TLS 配置继续通过
npm CLI 查询，保留原认证和传输语义。官方 npm 的公开包在没有这些配置时使用
原生 HTTP；默认并发 4、单次请求超时 10 秒、总可见性预算 15 分钟。
这些值可通过 `commands.release.registry` 的 `concurrency`、
`requestTimeoutMs` 和 `visibilityTimeoutMs` 配置。

首次立即确认，前 30 秒每 2 秒、之后至 2 分钟每 5 秒、剩余时间每 10 秒检查。
只重查尚未确认的版本；版本已可见而 dist-tag 延迟时只重查 tag。
404 表示等待传播，401/403 明确失败，网络错误、429 和 5xx 有界重试并报告原因。
精确版本和目标 dist-tag 都确认后才收尾；已经接受的上传不会进入重传队列。

## Actions 的六个真实步骤

工作流保留 `release.yml` 文件名、同一 job 的 OIDC 身份、并发锁及 GitHub
App/token 优先级。现有完整命令仍等价于 `repo release ci --stage all`。

| 阶段     | 职责                                               |
| -------- | -------------------------------------------------- |
| plan     | 判断触发条件、操作和恢复源，输出后续步骤条件       |
| verify   | 执行质量检查与对应的前置 hooks                     |
| prepare  | 消费版本意图，准备版本、提交或稳定版 Release PR    |
| upload   | 仅上传尚无接受证据的版本，持久化部分成功进度       |
| confirm  | 只读确认精确版本与目标 dist-tag                    |
| finalize | 创建 tags、GitHub Releases，执行可恢复的后置 hooks |

普通无发布触发的提交仅执行 plan，其余步骤跳过。稳定版准备流程在创建 Release
PR 后停止；真正发布和预发布继续进入 upload、confirm、finalize。
每阶段输出耗时、完成数量及待确认包，并写入 Actions Summary。
无论成功或失败，工作流都尝试保存发布进度 artifact。

必须按顺序在同一 checkout、配置和 Actions run/attempt 中执行。阶段凭证保存在
Git 目录，绑定仓库、源提交、源码变更、候选版本、配置和当前运行，不能复制到新
runner 来跳过验证。`repoctl-ci-progress.json` 是诊断产物，不是验证授权。
旧 schema-1 checkpoint 仍可恢复接受证据和已完成 hooks；新运行须重新 plan/verify。
历史源码恢复在各阶段复用同一个隔离 checkout，成功收尾后清理。

## 实测与验证边界

2026-10-09 使用 Node 24.18.0、pnpm 12.10.1，只读查询已发布的六个精确版本
及 latest tag，一轮预热、三轮采样：

| 查询路径          | 三轮耗时（毫秒） | 中位数  |
| ----------------- | ---------------- | ------- |
| 串行 npm CLI      | 2251、4034、5050 | 4034 ms |
| 原生 HTTP，并发 4 | 1031、1440、2043 | 1440 ms |

查询耗时中位数减少约 64%。这是本机的查询路径比较，CLI 遵守本机 npm 配置；
不能据此宣称整个发布快 64%，也不能消除 npm 实际传播延迟。
[上游测量脚本](https://github.com/icelib/repoctl/blob/71e9a5e237b0f51cbfd28c2fad27fc2f45d769a5/scripts/benchmark-release-registry.mjs)
和[原始数据](https://github.com/icelib/repoctl/blob/71e9a5e237b0f51cbfd28c2fad27fc2f45d769a5/docs/release-registry-benchmark.json)
可复现这些只读测量，没有为测试制造版本。

上游 build、lint、typecheck、tsd、完整测试通过（2,104 个测试和 4 个开发场景），
最终阶段调整另通过 19 个定向回归。覆盖延迟、超时、认证失败、429/5xx、dist-tag
延迟、并发与统一预算、部分成功恢复、稳定版/预发布、陈旧凭证和 hook 顺序。
本项目 frozen install、lint、build、typecheck、test、test:deps、test:integration、
test:examples、repo deps check、repo doctor、repo check --full 和 change check
通过；构建包含七份微信产物。已有 7 条非阻塞 lint 警告仍保留。

推送提交 `4a35091` 后的[线上 Release 验证](https://github.com/weapp-stylex/weapp-stylex/actions/runs/37921477963)
成功：六个阶段分别显示，plan 判断无触发后正确跳过其余五步。保存的进度为
`action: skip`、`publish: false`、`done: [plan]`，plan 耗时 193 ms；
完整日志中缺失 token 的配置替换警告为 0。
[独立 OIDC audit](https://github.com/weapp-stylex/weapp-stylex/actions/runs/37921593571)
也成功，六个包均返回 HTTP 201，确认当前工作流身份可以交换发布认证，且同样没有
上述警告。这次验证没有上传包；不能把认证检查解释为新的正式发布验收。

## 重新生成与移除

如需重建补丁，检出上述上游提交，按上游指引安装、构建并同步模板；用对应精确
版本的 npm 原始产物作基线，将构建及模板产物写入 pnpm patch 的编辑目录。
引擎打包 chunk 名称会变化，最终必须生成 `git diff HEAD --no-renames --binary`
形式的新增/删除补丁：pnpm 12 不支持补丁中的 rename/copy 操作。
重新安装刷新锁文件，再冻结安装并比对全部构建文件，不手改编译后的逻辑。

正式稳定版包含 PR #1058 后：

1. 核对发布说明及对应模板版本，运行 `corepack pnpm patch-remove` 移除上述两个
   精确补丁并删除不再引用的补丁文件。
2. 将 repoctl 升级到包含改进的稳定版，通过 pnpm 重新生成锁文件。
3. 运行 `corepack pnpm exec repo upgrade --dry-run --json` 审查受管差异，再按
   upgrade 计划/应用流程同步配置，保留微信 CI 和项目定制。
4. 冻结安装并重跑上述完整校验，确认发布六阶段、OIDC 和进度保存仍然有效。

不要在只有部分改进的版本中提前移除补丁；不要把临时补丁扩展到未经验证的版本。
