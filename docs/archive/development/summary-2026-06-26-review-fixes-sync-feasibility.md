# 2026-06-26 审查修复与同步/白板可行性总结

## 完成内容

- 新建分支：`fix/review-security-sync-foundations`。
- 收紧本地 API 安全边界：
  - CORS 从 `*` 改为只允许本地 loopback / Wails Origin。
  - `/api/settings` 在已有 API key 时只允许可信本地前端或有效 owner key 访问。
  - REST 分享 token 增加 map 范围校验，非 owner token 不能跨 map，也不能列出全部 maps。
  - `cmd/server` 启用 token store，与桌面端共用 token auth 能力。
- 修复数据一致性：
  - 普通删除和 batch 删除节点时会裁剪悬空 relation 和 branch target。
  - 轮询、版本、树读取改用只读加载，避免周期性刷新 `LastOpenedAt` 写盘。
- 修复 Roaming 缓存问题：
  - Windows 桌面端显式设置 `WebviewUserDataPath` 到 `%LOCALAPPDATA%\CodeMind\WebView2`。
  - 业务数据仍保留在 `%APPDATA%\CodeMind\data`，不和 WebView2 缓存混放。
- 降低前端 HTML 属性注入风险：
  - 持久化 ID 写入 `data-*` / `data-command` 前做属性转义。
  - 文档模型新增 ID 安全字符校验。
- 修复根目录 `prepare` 脚本缺少 `husky` 依赖的问题。

## 验证结果

- `go test ./...` 通过。
- `cd frontend && npm test` 通过。
- `cd vscode-extension && npm run compile` 通过。
- `npm run prepare --if-present` 通过。
- `npm run build` 通过。

## 遗留问题

- `npm install` 提示当前依赖树仍有 2 个 critical audit 项，需要单独审计依赖升级风险。
- 旧的 Roaming WebView2 缓存目录不会被程序自动删除；确认 `%APPDATA%\CodeMind\data` 下业务数据存在后，可在应用关闭时手动清理旧缓存目录。

## VPS 多设备同步可行性

可行。1GB 内存日本 VPS 足够承载轻量同步服务，前提是不在服务器上跑 AI、浏览器渲染或图片处理。推荐形态：

- Go API + SQLite/BoltDB + Caddy/Nginx TLS，常驻内存通常可控在 100-250MB 级别。
- MVP 先做“中心化文档同步”：map/whiteboard 文件上传、下载、版本号、乐观锁冲突提示。
- 第二阶段再做操作日志：节点增删改、白板 stroke append/delete，用 revision 合并。
- 需要 HTTPS、设备 token、每日备份、导出恢复、请求限流。

不建议第一版直接做 CRDT。脑图编辑可以先用文档版本和冲突提示；白板 stroke 可天然 append-only，后续更适合做增量同步。

## 白板模式可行性

可行，建议做独立文件，不依附脑图：

- 数据目录与脑图并列，例如 `maps/*.json` 和 `boards/*.json`。
- 白板文件保存 vector strokes，而不是保存大 bitmap。
- 最小功能：笔、颜色、粗细、橡皮擦、撤销/重做、缩放/平移。
- 技术方案：自研 Canvas pointer-events + `perfect-freehand` 平滑笔迹；不建议第一版引入完整 tldraw/Excalidraw 级别框架。
- 数据模型：`BoardDocument { id, title, strokes, meta }`，stroke 包含 `id/color/width/points/createdAt`。

白板和脑图保持并列，可以降低耦合；后续若需要关联，再用“引用关系”而不是把白板嵌进脑图文档。

