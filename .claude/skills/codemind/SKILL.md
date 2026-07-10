---
name: codemind
description: 操作 CodeMind 项目脑图（人机协作控制平面）。当用户要求把任务、进度或决策记录到脑图，或当前工作需要通过 CodeMind MCP/REST 结构化落图时使用。涵盖在线检测、目标图确认、带乐观并发的写入循环、幂等重试、冲突处理和必须请求用户确认的操作。
---

# CodeMind 脑图操作协议

CodeMind 脑图用于承载项目任务、关键决策和进度。Agent 的写命令统一声明 `development` 分区，供人类在图上查看和评审。

当前 Phase D 只实现了命令级 partition、服务端 actor 派生和幂等重放；节点尚未持久化实体级分区，author/changeset/pending 也尚未写入脑图。不要把目标架构描述成已经交付的功能。规范源见 `docs/agent-protocol.md`。

## 第 0 步：确认服务和目标 mapId

1. 若用户或项目配置已经给出 mapId，优先调用 `get_tree(mapId)`；成功即表示 MCP、鉴权和目标图均可用。
2. 若尚不知道 mapId：
   - 本地无鉴权或 owner 凭据可以调用 `list_maps` 选择目标图；
   - scoped Bearer token 只能访问签发时绑定的脑图，调用 `list_maps` 返回 403 是预期行为。此时应请用户提供 mapId，或从 token 签发结果/项目配置中读取，不能换用其他凭据绕过。
3. MCP 不可用时可探测 REST health：`${CODEMIND_API_URL}/api/health`。默认桌面地址为 `http://127.0.0.1:34117`，`codemind serve` 默认为 `http://127.0.0.1:7979`。
4. 服务离线时只提示一次，请用户启动桌面应用或 `codemind serve`；等待用户确认后再继续，不循环重试刷屏。
5. 对已知 mapId 调用 `get_tree` 仍返回 401/403 时，提示用户检查该图签发的 `actorKind=agent` token，并将其配置到 `CODEMIND_ACCESS_TOKEN`。

## 第 1 步：确认目标脑图

1. 用户明确给出 mapId 或唯一图名时，首次写入前复述：`将写入脑图《X》（mapId），确认？`
2. owner/local 模式下可用 `list_maps` 列出候选；未指名或同名时让用户选择。
3. scoped agent token 下无法列出全部脑图。缺少 mapId 时直接询问，不把预期的 scope 403 误判为 token 失效。
4. 会话内记住已确认的 mapId；中途切换目标图必须重新确认。

## 第 2 步：执行写入循环

每次逻辑写入都按以下顺序执行：

1. **先读后写**：调用 `get_tree` 理解当前结构，并记录返回的 revision。
2. **构造写入信封**：五个写工具 `create_node`、`update_node`、`delete_node`、`batch_operations`、`import_fragment` 均必填：
   - `expectedRevision`：来自最近一次读取；
   - `partition`：固定使用 `development`。requirements 按本协议保留给人类意图，Agent 不写；stable 由服务端强制只读并返回 403；
   - `idempotencyKey`：同一逻辑写入的首次请求和重试必须复用同一个 key。推荐格式 `<任务slug>-<操作序号>`，例如 `fix-minimap-3`。不要在重试时重新生成随机 key。
3. **处理 412**：MCP tool result 的 `content[0].text` 是 JSON 字符串，结构为 `{"error":{"code":"revision_conflict",...,"actualRevision":N}}`。重新 `get_tree`，检查目标位置是否已被修改，再用新 revision 和原 idempotency key 重试。最多自动重试 3 次。
4. **处理 409**：`idempotency_key_reused` 表示同一个 key 被用于不同指纹。先确认原请求是否已成功；只有当前动作确实是新的逻辑写入时才换新 key。
5. **处理 403**：停止并解释是权限或 stable 分区限制，不换路径或凭据绕过。

幂等记录当前是进程内缓存，服务重启或条目过期后不保证继续重放。网络结果不明时仍应先重读脑图，确认是否已经落图，再决定是否重试。

## 写什么、怎么组织

- **任务开始**：为本次任务创建一个任务节点，title 写任务名，note 写目标和背景。本次会话新增的记录尽量挂在该子树下，作为未来 changeset 归组的候选边界。
- **过程中**：关键决策、风险和方案取舍各用一个子节点，note 说明原因。
- **任务完成**：更新任务节点 note，写入结果摘要、涉及的文件路径，并明确写上“待人工评审”。当前没有正式 pending/status 字段，不要声称已进入服务端评审流。
- 一个节点只表达一件事；title 简短，细节放 note。不要把完整 diff 或聊天记录倾倒进脑图。
- 不修改、删除或重排他人创建的节点和布局；不写入 token、密钥等敏感信息。
- 当前 actor 只用于服务端认证和幂等作用域，脑图中尚无可见 author 字段。不要向用户声称写入已经带有持久作者署名。

## 必须二次确认的操作

1. 首次选定或中途切换目标脑图。
2. 删除任何非本会话创建的节点。即使任务隐含删除，也要列出目标节点后确认。
3. `batch_operations` 单次影响超过 10 个节点，或使用 `import_fragment` 批量导入。执行前说明新增、修改、删除数量和挂载位置。
4. 用户要求 Agent 写 requirements/stable 时，说明协议边界并询问是否改写到 development，交由人类后续整理或晋级。
5. 连续 3 次自愈仍发生 revision 冲突后的任何进一步写入。

## 示例节拍

> 用户：`修一下小地图拖拽抖动，并把过程记到脑图。`
>
> 1. 已知 mapId 时调用 `get_tree`；未知且是 scoped token 时向用户询问 mapId。
> 2. 复述目标图并确认。
> 3. `get_tree` 得到 rev-41，使用 key `fix-minimap-1` 创建任务节点。
> 4. 修代码；发现根因后使用新 key `fix-minimap-2` 创建“根因”子节点。
> 5. 使用新 key `fix-minimap-3` 更新任务 note，写入结果、文件列表和“待人工评审”。
> 6. 若收到 412，重读后复用发生冲突的原 key 重试；收尾告知用户已完成记录，等待人工评审。
