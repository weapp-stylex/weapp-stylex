# weapp-stylex

## 0.2.0

### Minor Changes

- Add opt-in safe SWC compilation, reuse Babel ASTs and session caches, coalesce token work, protect watch generations and Webpack cache identities, and report framework diagnostics.

### Patch Changes

- 修正文档语言入口：根地址在客户端按系统时区推断地区并选择中英文，尊重手动语言选择；英文首页使用明确的 /en/ 链接，避免语言切换回到自动入口。

- 完善六个公开包的官网、用途描述、中英文搜索关键词与赞助入口，移除模板元数据，方便在 npm、GitHub 与 AI 工具中识别项目和查找框架接入文档。

- Updated dependencies:
  - @weapp-stylex/compiler@0.2.0
  - @weapp-stylex/core@0.1.2
  - @weapp-stylex/taro@0.2.0
  - @weapp-stylex/uni-app@0.2.0
  - @weapp-stylex/weapp-vite@0.3.0

## 0.1.0

### Minor Changes

- 正式发布 weapp-stylex 聚合入口，补充官方文档首页，并提供 registry 独立安装验收入口；通过 GitHub OIDC 验证自动发布。

## 0.0.0

### Minor Changes

- 新增 weapp-stylex 聚合包，提供官方 StyleX runtime 与原生、Wevu、Taro、uni-app 的独立子路径，包含 ESM/CJS 和类型声明。

### Patch Changes

- Updated dependencies:
  - @weapp-stylex/compiler@0.1.1
  - @weapp-stylex/taro@0.1.1
  - @weapp-stylex/uni-app@0.1.1
  - @weapp-stylex/weapp-vite@0.2.1
