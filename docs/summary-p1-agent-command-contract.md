# P1 Phase D：Agent 命令契约开发总结

日期：2026-07-10 ｜ 分支：feat/p1-agent-contract ｜ 版本：1.14.0

## 完成内容

- 新增 `ActorKind`、`ActorRef`、`Partition`、`CommandEnvelope` 与 `ChangeSetMetadata` 类型骨架。
- token 增加 `actorKind`，新 token 可签发 human/agent；旧 token 自动迁移为 human，Validate 改为返回副本。
- Bearer token 的 token ID、actorKind、displayName 由认证中间件派生为 actor；本地/API key 固定为 `local-owner/human`。
- 节点 create/update/delete、batch、import-fragment 统一要求 `If-Match`、`X-CodeMind-Partition`、`Idempotency-Key`。
- partition 固定为 requirements/development/stable；stable 当前拒绝写入，现有访问级别权限继续生效。
- 幂等范围为 actorId + mapId + key，指纹包含 operation、target/query、partition、expected revision 和规范化 JSON payload。
- 相同 key/指纹重放首次成功响应且不重复增加 revision；不同指纹返回 409 `idempotency_key_reused`。
- 并发相同命令单飞执行，失败不缓存；成功记录采用 256 条、15 分钟 TTL 的严格有界进程内缓存。
- MCP 五个写工具新增必填 partition/idempotencyKey，转发统一 header，并支持 `CODEMIND_ACCESS_TOKEN` Bearer actor 凭据。
- MCP 412 继续使用 `isError=true` tool result，`content[0].text` 改为稳定 JSON `revision_conflict` 结构。
- VS Code 节点写入同步发送 development partition 和唯一 idempotency key，避免新服务端契约破坏插件。

## 前端冲突恢复

- 412 后锁存独立 revisionConflict，精确保留当前文档和 dirty 状态；后续 autosave 不再循环请求。
- floating/fixed 两种 chrome 都提供“重新加载服务端”和“用本地草稿覆盖”入口。
- reload 经确认后清理遗留 timer、替换服务端最新文档、清 dirty/conflict 并重置历史。
- overwrite 先 GET 最新 revision，再以本地草稿做 CAS 保存；二次 412 仍保留原草稿。
- polling 在 dirty、冲突、保存中或冲突处理中不重载，避免静默覆盖本地内容。
- 保存采用单飞和 document session/local change epoch；请求期间继续编辑、切图或旧响应晚到都不会丢失新内容。
- 保存成功后的 map list 刷新或本地自动快照失败不再把已提交写入误判为保存失败并重复增加 revision。

## 测试与验证

- Go 契约测试覆盖 header 矩阵、stable 拒写、顺序重放、canonical payload、query 指纹、key 复用、并发单飞、失败不缓存和缓存上限。
- token 测试覆盖 agent 签发、旧 token human 迁移、非法 actorKind 和认证上下文派生。
- MCP 测试覆盖 schema 必填项、三个命令 header、Bearer 优先级和可反序列化的 412 JSON。
- 前端专项测试覆盖草稿保留、停止重复保存、reload、overwrite、二次 412、polling 守卫、慢保存继续编辑和跨图旧响应。
- UI 冒烟测试覆盖 floating/fixed 两种布局下的冲突恢复动作。
- `go test ./...`：通过。
- `go vet ./...`：通过。
- `cd frontend && npm test -- --run`：16 个测试文件，236 通过、2 跳过。
- `cd frontend && npm run lint`：通过。
- `cd frontend && npm run build`：通过。
- `cd vscode-extension && npm run compile`：通过。
- 打包前 `34117`、`34118`、`7979` 均确认空闲。
- `npm run build:desktop`：通过，生成 `build/bin/CodeMind-1.14.0.exe`。
- Windows 资源：ProductVersion 1.14.0，FileVersion 1.14.0.0，大小 12,727,296 字节。
- 最终 EXE 真实 HTTP 冒烟：首次/重放均为 201，重放 header=true，最终 revision=2、nodeCount=2。

## 设计边界

- 当前 partition 是命令声明，不是实体级归属；节点/关系/区域尚未持久化“属于哪个分区”。
- stable 仍是只读声明边界，尚未实现 Git commit 物化、稳定区文件树或评审门。
- `ChangeSetMetadata` 只定型，不持久化 pending/changeset，不实现 accept/reject 或聚合时间窗。
- 幂等记录是进程内缓存，服务重启或条目过期后不保证继续重放；未来跨实例部署需持久 command ledger。
- collab WebSocket 仍只承载 presence/通知，不是权威持久写入口。

## 跟进项

- Go 对外部畸形 sibling order 的自愈策略与前端对齐，独立评估严格 Git 格式边界。
- 清理或 deprecated 非条件 `Save/Rename/Delete`，审查只读 GET 的落盘迁移和 lastOpenedAt 行为。
- stable 文件系统物化前必须在百分号解码前拦截 `%2e%2e` 等路径穿越形式。
- Git 格式使用 `DisallowUnknownFields`；annotation、viewport 等新字段必须提升 schemaVersion。
- 下一阶段从 main 开启 `feat/git-stable-zone`：实现 repo/commit 派生、稳定区只读物化、Git 状态与评审入口。
