# CodeMind Agent 使用协议（规范源）

本文件规定外置 AI（Claude Code、OpenCode 及其他 MCP/REST 客户端）操作 CodeMind 脑图时必须遵守的行为边界。

宿主侧文件是本协议的可执行副本：

- Claude Code：`.claude/skills/codemind/SKILL.md`
- OpenCode：可将 Skill 正文纳入目标项目的 `AGENTS.md`
- 通用 REST：连接和字段细节见 `build/API-GUIDE.md`

机制层文档见 `docs/platform-usage.md` 与 `build/API-GUIDE.md`。若宿主 Skill、示例或其他说明与本文件冲突，以本文件为准；Skill 必须同步修订。

## 核心规则

1. **目标图必须确认**：首次写入和中途切图前，Agent 必须向用户复述 mapId/图名并获得确认。
2. **只写 development**：Agent 的写命令统一声明 `partition=development`。requirements 按协议保留给人类意图，stable 禁止 Agent 写入。
3. **先读后写**：每次逻辑写入前读取目标图 revision，写入携带 expectedRevision 和稳定的 idempotency key。
4. **冲突先重读**：412 后重新读取并检查目标位置，最多自动重试 3 次；不得寻找无条件覆盖接口。
5. **破坏性动作问人**：删除非本会话节点、大批量改动、导入片段和冲突超限必须二次确认。
6. **敏感信息不落图**：token、API key、密钥、个人隐私和未脱敏日志不得写入节点。
7. **不伪造评审状态**：任务完成只在 note 中标记“待人工评审”，不得声明服务端已 pending、accepted 或完成评审。

## 当前能力边界（Phase D / 1.15.0）

| 能力        | 当前实现                                                                                 | 不得声称                                                  |
| ----------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| actor       | 服务端从 Bearer token 派生 actor ID/kind/label；local/API key 映射为 `local-owner/human` | author 已写入文档或 UI 可见署名                           |
| partition   | 命令信封校验枚举；stable 写入强制 403                                                    | 节点已经持久化实体级分区；requirements 已由服务端强制只读 |
| idempotency | actorId + mapId + key 作用域；成功响应进程内有界 TTL 重放                                | 重启后仍保留重放历史；跨实例已有持久 command ledger       |
| changeset   | `ChangeSetMetadata` 类型已定型                                                           | pending/changeset 已持久化；已有 accept/reject 评审门     |
| 工作区物化  | VS Code 可绑定 mapId，并生成 canonical semantic/layout 与人工里程碑快照                  | 文件修改会自动回写脑图；已实现完整 Git stable 派生层      |
| 稳定区      | stable 命令声明只读                                                                      | Git stable 已自动物化或自动回写脑图                       |
| map 发现    | owner/local 可 `list_maps`；scoped token 只能访问绑定 mapId                              | scoped agent token 能列出全部脑图                         |

这些限制是协议的一部分。Agent 遇到尚未实现的能力时，应向用户说明边界，而不是用现有字段模拟权威状态。

## 目标架构

- 脑图作为人机控制平面：Agent 记录任务、决策和进度，人类负责最终评审。
- development 承载 Agent 尝试；requirements 承载人类意图；stable 将由 Git/repo 状态派生。
- 一次任务的节点子树可作为未来 changeset 聚合、整组接受和回滚的候选边界。

以上是后续阶段的方向，不代表 Phase D 已经交付实体分区、changeset 或稳定区物化。

## 可执行细则

在线检测、scoped token 选图、写入循环、幂等 key、冲突礼仪和确认清单见 `.claude/skills/codemind/SKILL.md`。Skill 是执行说明，不得扩大本协议授权。

## 维护记录

- 狗粮验证中发现 Agent 卡点或误解时，同时修订本文件、Skill 和人工验证清单。
- 2026-07-10：初版，配套 P1 双契约。
- 2026-07-10：补充 scoped token 无法 `list_maps`、actor/partition/changeset 当前边界及准确冲突流程。
- 2026-07-13：补充 `.codemind/project.json` 发现、canonical 工作区物化与文件不可直接回写的边界。
