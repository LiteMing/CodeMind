# 2026-03-30 Git Ignore / Exclude 清理总结

## 检查结果

本轮未提交噪音主要来自 3 类：

- 本地 IDE 配置：`.idea/`
- 桌面打包产物：`build/bin/*.exe`
- 桌面运行时数据与校验产物：
  - `build/bin/data/`
  - `build/windows/icon-verify.png`

## 已调整

### 1. 仓库级 `.gitignore`

- 保留原有：
  - `node_modules/`
  - `data/maps/`
  - `code-mind/`
- 新增：
  - `build/bin/`
  - `build/windows/icon-verify.png`
  - `Thumbs.db`
  - `.DS_Store`

### 2. 本地 `.git/info/exclude`

- 新增：
  - `.idea/`
  - `*.iml`
  - `.vscode/`

## 验证结果

- `git status --short --branch` 现在只剩本轮真正需要提交的内容：
  - `.gitignore`
  - 本次 plan / summary 文档
- 原先的未跟踪噪音已进入 ignored 状态：
  - `.idea/`
  - `build/bin/CodeMind-1.2.0.exe`
  - `build/bin/CodeMind-20260328.exe`
  - `build/bin/data/`
  - `build/windows/icon-verify.png`

## 说明

- `build/bin/CodeMind-1.0.0.exe`、`build/bin/CodeMind-1.1.0.exe`、`build/windows/icon-from-ico.png` 等历史上已被 Git 跟踪的文件，本轮没有做 untrack；`.gitignore` 只会阻止未来新增噪音继续进入版本库。
- 如果后续要彻底清理这些已跟踪产物，需要单独做一次 `git rm --cached` 类型的提交。
