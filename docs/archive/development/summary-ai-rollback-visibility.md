# 开发总结：AI 可回滚 + AI 协作可见性补丁（E 组）

日期：2026-07-10 ｜ 版本：1.10.0 ｜ 计划：docs/archive/development/plan-ai-rollback-visibility.md ｜ 分支：feat/ai-rollback-visibility

## 完成内容（四项全交付）

### 1. AI 落库前置快照（红线修复）

- `SnapshotMode` 扩展 `'ai'`；`captureAISnapshot` 在**确认有实际变更之后、写入之前**强制落
  'ai' 快照（不受 autoSnapshots 偏好与 90s 节流约束）。
- 接线：notes 两分支 / relations（先去重再快照，避免全重复建议污染列表）/ suggest 的
  `captureHistory` 前；`persistExpandedDocument` 的 `saveMap` 前（该路径重载后撤销栈清零，
  快照是唯一回滚出口——红线主案）。
- generate/import 新建图落库后存 `AI 生成初稿` 快照（出身记录 + 一键回初稿）；快照点放在
  AI 调用侧而非 `persistGeneratedDocument` 内部——该函数同时被**模板建图**复用（app.ts:1250）。
- Inspector 快照列表：ai 模式渲染紫色 `AI` 徽标 + 模式文案 + 描边区分。

### 2. AI 完成后镜头跳转

- `centerViewportOnNode` public 化；`markAIChangedNodes` 在 render 后 `queueMicrotask`
  平移镜头到首个变更节点（与 `focusNodeFromGraph` 同手法）。

### 3. AI 变更高亮

- `aiChangedNodeIds` 状态驱动渲染 `node-ai-changed`（紫色描边+光晕）；8s 定时消退或画布
  pointerdown 立即清除（DOM 手术不触发全量 render）。
- 标记范围：notes=改动节点；notes-children/suggest=新建节点；relations=新关系两端；
  expand=新旧文档 diff（新增 + title/note/parentId/color/priority 变化，忽略纯布局位移）。

### 4. "AI 正在写"presence（[7.10 修订] 按 actor 通用设计）

- **最小 actor presence 模型**：`actorPresence: Map<actorId, {kind:'agent'|'human', label, focusNodeIds}>`，
  内置 AI 是 actor `'ai'`；P3 多人 = map 里多几行，渲染路径零重写。易逝红线：绝不进
  document/快照/git。
- 节点级：`node-presence-agent`（脉冲虚线描边 + AI 角标，按 kind 命名而非物种硬编码）；
  全局：画布底部居中 presence 角标（避开左下缩放控件与右下小地图），从 agent presence 派生
  （`ai.busy` 只管请求生命周期）。
- 命名回避 "pending"：这个词留给 P1-8 的持久待审变更（服务端按 token 盖章）。
- `prefers-reduced-motion` 全局规则自动把脉冲降为静态描边。

## 验证

- vitest 213 通过（12 文件）：新增 AI notes 全链路冒烟——deferred mock 断言 in-flight
  presence（节点类 + 角标可见）、'ai' 快照**先于写入**（快照内目标节点无注释）、完成后变更
  高亮 + 注释徽标 + presence 清除、画布交互清除高亮（途中揪出 AI 抽屉动画期 close 被
  panelAnimating 守卫吞掉的测试时序坑）。
- `npm run lint`、`npm run build`（tsc+vite）、`go test ./...` 全部通过；打包 1.10.0。

## 遗留与后续

- AI 抽屉开着时点"关闭"若落在滑入动画 300ms 内会被静默吞掉（panelAnimating 守卫，
  与 Inspector 同款既有行为）——真实用户手速下罕见，记录在案。
- presence 角标暂只显示单一 "AI 正在写…" 文案；多 actor 文案聚合（label 列表）随 P3 SSE。
- expand 的 diff 高亮依赖前端内存对比，带外（MCP/API）写入的变更可视化属 P1-8 changeset
  归组范畴（服务端按 token+时间窗归组），本补丁不覆盖。
