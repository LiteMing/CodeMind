# 2026-03-29 快照命名功能总结

## 完成内容

1. 本地快照现在区分快照名称和脑图标题，旧快照数据会自动兼容补全。
2. 右侧快照面板新增命名输入框，手动保存时可以直接输入快照名称。
3. 自动快照也统一写入标准名称，快照列表展示更稳定。
4. 切换脑图、返回主页、恢复快照后，命名输入框会自动清空，避免串值。

## 涉及文件

- `frontend/src/app.ts`
- `frontend/src/snapshots.ts`
- `frontend/src/style.css`
- `frontend/src/i18n.ts`

## 验证

1. `cd frontend && npm run build`
2. `go test ./...`
3. `npm run build:desktop`
4. 新桌面包：`build/bin/CodeMind-1.0.0.exe`

