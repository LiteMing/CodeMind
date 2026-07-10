# 手动快照保留策略修复计划

日期：2026-07-10 ｜ 分支：feat/ai-rollback-visibility ｜ 版本：1.10.1

## 目标

- 修复高频 AI 快照按纯最近性淘汰时可能挤掉全部手动快照的问题。
- 保持每图最多 14 条快照的现有存储上限，避免扩大 localStorage 压力。
- 明确 AI 快照写入失败时阻止 AI 继续落库的 fail-closed 设计意图。

## 技术方案

- 在快照裁剪逻辑中保护最近 4 条 `manual` 快照。
- 剩余名额继续由所有模式按创建时间共享，不为未使用的手动名额预留空位。
- 读取旧数据和保存新数据统一走同一裁剪函数，保证历史数据升级后的行为一致。
- 新增独立快照测试，覆盖高频 AI 写入、无手动快照和手动快照超过保护数三种情况。

## 验证

- `cd frontend && npm test`
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `go test ./...`
- `npm run build:desktop`
