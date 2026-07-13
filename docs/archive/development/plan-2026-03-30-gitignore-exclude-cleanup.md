# 2026-03-30 Git Ignore / Exclude 清理计划

## 目标

- 检查当前未提交文件，识别哪些属于构建产物、运行时数据和本地 IDE 配置。
- 优化仓库级 `.gitignore`，减少所有开发者都会遇到的构建噪音。
- 优化本地 `.git/info/exclude`，屏蔽仅与当前机器相关的编辑器配置。
- 保持已被版本管理的历史文件不被误删或误回退。

## 当前未提交内容

- `.idea/`
- `build/bin/CodeMind-1.2.0.exe`
- `build/bin/CodeMind-20260328.exe`
- `build/bin/data/`
- `build/windows/icon-verify.png`

## 处理策略

### 仓库级 `.gitignore`

- 保留 `node_modules/`、`data/maps/` 等已有规则。
- 增加桌面构建输出忽略：
  - `build/bin/`
  - `build/windows/icon-verify.png`
- 保留现有 `code-mind/` 规则，避免嵌套仓库干扰。

### 本地 `.git/info/exclude`

- 增加 JetBrains 本地配置忽略：
  - `.idea/`
  - `*.iml`
- 如有必要，一并补充 `.vscode/` 这类典型本地工作区文件。

## 验证

- 调整后执行 `git status --short --branch`
- 目标：当前这批无意义未跟踪文件不再出现
- 不处理已被 Git 跟踪的历史构建产物；若后续要彻底清理，需要单独做一次 untrack 提交
