# 开发计划：AI 可回滚 + AI 协作可见性补丁（E 组）

日期：2026-07-09 ｜ 分支：feat/ai-rollback-visibility ｜ 依据：审查报告-开发计划7.9.txt 第 111/123 行、复查清单 E3 实测意见

## [7.10 修订] presence 按 actor 通用设计（总计划 §2 actor 一等模型）

原方案的 `aiPendingNodeIds: Set<string>` 把"谁"写死在了字段名里——正是总计划 §2 警告的
"把 AI 正在写做成画布硬编码特殊状态，多人 presence 时须重写"。按 7.10 修订调整：

- **最小 presence 模型**：`actorPresence: Map<actorId, { kind: 'agent'|'human', label, focusNodeIds }>`。
  今天唯一的 actor 是内置 AI（`'ai'`，kind `'agent'`）；P3 多人接入 = map 里多几行，机制零重写。
- **易逝红线**：presence 只活在这张 map 里，绝不进 document、快照、git（已由实现保证）。
- **UI 先只做 AI 案例**：节点类名按 kind 输出（`node-presence-agent`），画布角标从 agent presence
  派生（`state.ai.busy` 只管请求生命周期/按钮禁用，显示层与它分离）。
- **命名回避 "pending"**：presence 是"正在写"（易逝），pending 是"待审变更"（持久、进数据模型、
  P1-8 契约随服务端盖章落地）——本补丁不引入任何持久 pending 字段，把这个词留给评审门。
- 快照 `mode: 'ai'` 是触发方式分类（回滚工件 UI 分组），非 author 模型；actor 身份体系（token）
  P1-8 落地后再给快照加可选 `author` 字段，纯增量。

## 背景（红线）

7.9 审计确认：AI 落库（`persistGeneratedDocument`/`persistExpandedDocument`）绕过常规保存路径，
不触发自动快照，直接违背总计划第 2 节"AI 对代码/工程的每次自动操作必须可评审、可回滚"。
`expandAIMap` 落库后经 `openLoadedDocument` 整体重载，历史栈被重置——Ctrl+Z 也救不回来。
in-place 路径（notes/relations/suggest）有 captureHistory 但无快照，回滚只能连按 Ctrl+Z。

## 范围（四项）

### 1. AI 落库前置快照（红线修复）

- `snapshots.ts`：`SnapshotMode` 扩展为 `'manual' | 'auto' | 'ai'`；`readSnapshots` 校验放行 `'ai'`。
  （旧版本 exe 读到 ai 快照会丢弃——测试包线可接受，不做迁移。）
- `ai/actions.ts` 新增 `captureAISnapshot(app, action)`：`saveLocalSnapshot(mode:'ai')`，
  命名 `AI {{action}}前 · {{title}}`（i18n）。**不受** `interaction.autoSnapshots` 偏好与
  auto 快照 90s 节流约束——红线是强制的。
- 接线点（都在确认"有实际变更"之后、写入之前，避免空跑污染快照列表）：
  - `applyAINodeNotesForTargets` 两个分支的 `captureHistory` 前
  - `applyAIRelationsForFocus` 的 `captureHistory` 前
  - `applyAISuggestNodes` 的 `captureHistory` 前
  - `persistExpandedDocument` 的 `api.saveMap` 前（对旧文档快照——这是红线主案发现场）
  - `persistGeneratedDocument`/`importFileWithAI`（新建图，无"前"状态）：落库后对新图存
    `AI 生成初稿 · {{title}}`（mode:'ai'）——记录 AI 出身，支持一键回到初稿
- `inspector.ts` 快照列表：ai 模式渲染紫色 `AI` 徽标 + 模式文案，与手动/自动可区分。

### 2. AI 完成后镜头跳转

- `centerViewportOnNode` 由 private 改 public（原语已存在，接线活）。
- 变更落地 render 后 `queueMicrotask` 平移镜头到首个变更节点（同 `focusNodeFromGraph` 手法）。

### 3. AI 变更高亮

- 复用 `creatingNodeIds` 同款状态驱动机制：`app.aiChangedNodeIds: Set<string>`，
  `renderNodes` 输出 `node-ai-changed` 类（紫色描边+光晕，区别于琥珀色注释徽标）。
- 消退：8s 定时（删 set + 摘 DOM 类，不触发全量 render），或用户在画布上 pointerdown 时立即清除。
- 标记范围：notes=改动节点；notes-children/suggest=新建节点；relations=新关系两端节点；
  expand=重载后与旧文档 diff（新增 id + title/note/parentId/color/priority 变化的 id）。
  generate/import 整图皆 AI，不标（快照已记出身）。

### 4. ai-pending 节点级状态（非流式）

- `app.aiPendingNodeIds: Set<string>`：AI 请求期间目标节点加 `node-ai-pending` 类
  （脉冲虚线描边 + 角标 AI 点）。notes=目标节点；suggest=锚点节点；expand=根节点；
  relations 聚焦模式=焦点节点；generate/import=无节点目标。
- 画布角落全局角标：shell 常驻元素 `[data-ai-pending-indicator]`（workspace-panel 右上），
  `render()` 里按 `state.ai.busy` 同步显隐 + 文案"AI 正在写…"。真流式 presence 依赖 SSE，随 P3。
- 请求结束（含失败）finally 清 pending 并 render。
- `prefers-reduced-motion` 降级：脉冲动画禁用，保留静态描边。

## 任务拆分

| 子任务 | 文件 |
|---|---|
| 快照模式扩展 + AI 快照落点 | snapshots.ts、ai/actions.ts、i18n.ts |
| 快照列表区分 AI | render/inspector.ts、style.css |
| pending/changed 状态字段与渲染 | app.ts、render/canvas.ts、animations.css、style.css |
| 镜头跳转接线 | app.ts（public 化）、ai/actions.ts |
| 画布角标 | app.ts（shell 模板 + refs + 同步）、i18n.ts、style.css |
| 高亮清除交互 | interaction/pointer.ts |
| 回归测试 | app.smoke.test.ts（AI notes 全链路：前置快照/高亮/pending 清除）、document.roundtrip.test.ts 不涉及 |

## 验证

- vitest：新增 AI notes 端到端冒烟（mock completeNodeNotes）——断言 localStorage 出现 mode:'ai'
  前置快照、目标节点 in-flight 时带 `node-ai-pending`、完成后带 `node-ai-changed`、finally 清 pending。
- `npm run build`、`npm run lint`、`go test ./...`。
- 打包 1.10.0 测试包（功能位 +1）。
