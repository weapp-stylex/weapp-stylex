# 2026-11-03 依赖升级验证证据

这里提交本轮依赖审查、最终本地矩阵、消费者与 Linux 诊断的 30 份白名单证据，不包含测试 AppID、认证状态、完整 node_modules 或源码树。IDE 截图和远程 CI 结果由对应验收记录补充；本目录中的单个通过报告不能替代这些门禁。

| 文件                                                                                                                                                                       | 用途                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [audit-before.json](./audit-before.json)                                                                                                                                   | 升级前 pnpm audit 原始数据：128 个 advisory                                                     |
| [audit-intermediate-76.json](./audit-intermediate-76.json)                                                                                                                 | 中间阶段快照，保留追加兼容补丁前的 76 项结果                                                    |
| [audit-after.json](./audit-after.json)                                                                                                                                     | 最终冻结依赖审计：3 critical、10 high、37 moderate、9 low，共 59 项                             |
| [compatible-patch-evaluation.json](./compatible-patch-evaluation.json)                                                                                                     | 补丁选择前的官方包版本、engines、依赖及实际父包声明，含查询时间                                 |
| [intlify-exports.json](./intlify-exports.json)                                                                                                                             | 官方 core-base 9.1.11 / 9.14.5 tarball 与 DCloud 旧 Vue I18n 实际导出需求对照                   |
| [security-override-apis.json](./security-override-apis.json)                                                                                                               | 最终 31 份真实安装副本、29 包、2 个 Express 上下文及 DCloud 导入契约的 API 验证                 |
| [minimist-evaluation.json](./minimist-evaluation.json)                                                                                                                     | minimist 参数语义对照，以及 mkdirp 父包补丁的 CLI、权限、同步/异步和真实 Jimp 验证              |
| [watch-diagnostic-summary.json](./watch-diagnostic-summary.json)                                                                                                           | Linux watcher 等待器接受前一轮 END 的事件序列、7.4 对照与修复边界                               |
| [weapp-vite-7.8-linux-synthetic-success.json](./weapp-vite-7.8-linux-synthetic-success.json)                                                                               | 官方宿主实际生成长 synthetic sidecar ID 后成功构建的 Linux 报告                                 |
| [watch-atomic-save-repro.json](./watch-atomic-save-repro.json)                                                                                                             | 两个官方宿主都读取到 writeFile 截断空输入的原始事件、空内容 SHA-256 与各自底层版本              |
| [watch-diagnostic-atomic.json](./watch-diagnostic-atomic.json)                                                                                                             | 原子写入后 7.4 / 7.8 各 20 轮严格 watch 对照通过；两组底层 Vite/Rolldown 版本不同               |
| [weapp-vite-7.8-linux-integration.json](./weapp-vite-7.8-linux-integration.json)、[原始日志](./weapp-vite-7.8-linux-integration.log.txt)                                   | 664.56 秒完整 Linux integration，属于安全补丁完成前的等待器诊断快照                             |
| [weapp-vite-7.8-linux-integration-atomic.json](./weapp-vite-7.8-linux-integration-atomic.json)、[原始日志](./weapp-vite-7.8-linux-integration-atomic.log.txt)              | 原子写入修复后最终测试输入的完整 Linux integration，473.25 秒，exit 0                           |
| [final-prepare-summary.json](./final-prepare-summary.json)                                                                                                                 | 最终冻结安装、库构建、类型、lint、单元、依赖、doctor、repo check 和打包的逐步结果               |
| [final-repack-summary.json](./final-repack-summary.json)                                                                                                                   | 原子写入修复后再次冻结安装、lint、100 项脚本测试和同批六包 tarball                              |
| [final-matrix-summary.json](./final-matrix-summary.json)                                                                                                                   | Babel / auto 各 28 构建与产物、H5、最低宿主、完整 integration；10 个命令 exit 0、锁未变         |
| [library-packs-final2.json](./library-packs-final2.json)                                                                                                                   | 最终共同使用的六包 tarball、SHA-256、pack ID、run ID 与打包时源文件清单                         |
| [framework-consumers-final2.json](./framework-consumers-final2.json)                                                                                                       | facade / adapter、新旧 DCloud 的 120 次真实构建汇总，同 pack ID、锁哈希与六个原始 manifest 来源 |
| [facade 全矩阵](./framework-consumer-facade-all.json.gz)、[旧通道微信](./framework-consumer-facade-weapp.json.gz)、[旧通道 H5](./framework-consumer-facade-h5.json.gz)     | 三份 facade 原始 manifest，仅保留完整 gzip，56 + 2 + 2 次真实构建                               |
| [adapter 全矩阵](./framework-consumer-adapter-all.json.gz)、[旧通道微信](./framework-consumer-adapter-weapp.json.gz)、[旧通道 H5](./framework-consumer-adapter-h5.json.gz) | 三份 adapter 原始 manifest，仅保留完整 gzip，56 + 2 + 2 次真实构建                              |
| [floor-22.22.1.json](./floor-22.22.1.json)、[floor-24.11.0.json](./floor-24.11.0.json)                                                                                     | 可发布库两个最低 Node 版本的六包独立入口、ESM/CJS、types、Babel/auto/SWC 与无 addon 消费者      |
| [docs-browser-stable.json](./docs-browser-stable.json)、[docs-browser-preview.json](./docs-browser-preview.json)                                                           | 稳定/预览生产文档的后台浏览器交互验证与本任务资源关闭状态                                       |
| [manifest.json](./manifest.json)                                                                                                                                           | 每份证据的原始字节数、SHA-256、gzip 归档校验与可读 JSON 校验                                    |

可读 `.json` 允许仓库 formatter 调整缩进和键顺序；每个同名 `.gz` 都保存采集时的完整原始字节，未经过 JSON parse/stringify。`manifest.json` 分别记录原始数据、归档文件和可读文件的校验值。可读 JSON 已验证与原始字节解析出的数据相同，原始日志则按字节相同校验。六份完整消费者 manifest 仅存 gzip，避免提交重复可读副本；它们的原始字节数、SHA-256 和归档校验值同样列在 manifest 中。

本地最终矩阵、120 次框架消费者与两个最低 Node 消费者使用同一个 final2 pack ID。Linux 记录用于确认官方宿主、真实 synthetic ID 和本仓库测试修复，较早的 664.56 秒记录不能当成最终安全补丁矩阵。报告中的绝对路径是采集环境来源标识；提交目录内的 gzip 才是可独立复核的原始证据，完整后续 CI 日志另由 Actions artifact 保存。

例如验证原始审计响应：

```bash
gzip -dc docs/validation/dependency-upgrade-2026-11-03/audit-after.json.gz | shasum -a 256
```

结果应等于 manifest 中该文件的 `originalSha256`。归档采用 gzip level 9；它只用于证据字节保存，与小程序产物体积比较无关。

本轮审计并未清零。剩余风险、宿主版本约束与明确的 API 不兼容边界见[升级报告](../../dependency-upgrade-2026-11-03.md)。
