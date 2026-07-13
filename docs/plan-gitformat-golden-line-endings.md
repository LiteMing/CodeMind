# Git 格式 Golden 换行修复计划

日期：2026-07-14 ｜ 分支：main

## 目标

- 固定 Git 格式 byte-golden JSON 在 Windows checkout 后仍使用 LF。
- 保持 canonical exporter 的字节契约，不在测试中弱化换行比较。

## 验收

- `git ls-files --eol` 显示 golden/testdata 工作区为 LF。
- `go test ./...` 全部通过。
