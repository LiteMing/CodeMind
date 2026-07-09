# UX 缺陷根因诊断与修复工单（2026-07-09）

来源：`docs/ux-manual-checklist-2026-07-09.md` 人工检验失败项 + 同日静态审计与三路代码级根因定位。
用途：供开发/测试 agent 辅助诊断与修复。每条含【症状 / 根因 / 证据锚点 / 修复方向 / 验证方法 / 规模】。

## Agent 须知（动手前必读）

1. **行号不可信**：`frontend/src/app.ts` 正在被并发拆分重构（渲染层已抽出 `render/shell.ts`、`render/canvas.ts`、`render/toolbar.ts`，另有 `overlay.ts`、`api-sync.ts`）。定位一律用 **文件 + 函数名/选择器名 grep**；只有稳定文件（`animations.css`、`style.css`、`ux-engine.ts`、`document.ts`、`types.ts`、`node-sizing.ts`）的行号可参考。
2. **修复落位**：改动写进拆分后的新模块；不要往 app.ts 回填已迁出的逻辑。
3. **回归护栏**：每次修复后运行 `cd frontend && npx vitest --run`（基线：8 文件 193 用例全绿）。纯函数类修复（UX-04 小地图映射、UX-07 stagger）必须补单测。
4. **验证**：每条末尾"验证"指向人工检验清单条目，修复后按其步骤复测。
5. 关联文档：`审查报告-开发计划7.9.txt`（仓库根，总计划）、`docs/ux-manual-checklist-2026-07-09.md`（复测步骤与原始实测记录）。

## 共性机制（多条缺陷的公共根因，先理解再动手）

- **M1 动画 transform 覆盖定位 transform**：`.node-card` 靠自身 `transform: translate(-50%,-50%)` 居中（`style.css:1766`；内联 left/top 是中心坐标，生成处 `render/canvas.ts` articleStyle）。而 `node-create`/`node-delete`/`node-collapse`/`node-expand` 四个 keyframes 只写裸 `scale()`（`animations.css:125/137/416/428`）。动画接管 transform 期间居中位移丢失 → 节点回落到左上角锚点 = 右下漂移半宽半高。注意特例：`.node-card.is-editing-auto-width` 基础 transform 是 `translate(0,-50%)`（`style.css:1772`）。涉及 UX-01/02。
- **M2 全量重建渲染**：`renderWorkspace` 每次对 edge/region/node 三层 `innerHTML` 全量重写（`render/shell.ts:67-69`；`renderNodes` 在 `render/canvas.ts`），无 diff、无 rAF 合帧、无视口裁剪。任何"render 后事后 `classList.add` 的动画类"都会被下一次 render 抹掉；也是大图性能问题的核心。涉及 UX-01/08。

---

## 缺陷清单

### UX-01 手动创建节点无出现动画（清单 A2）【小修，依赖 UX-02 先修】
- **修复 commit：a09a142**
- 症状：Tab/Enter 建节点无 scale+fade 动画；连续建 10 个全无动画。
- 根因：`.node-creating` 不在 `renderNodes` 输出的 class 里，只由 `applyNodeCreateAnimation` 在 `render()` 之后 rAF 补加。连续创建时下一次全量 render（M2）把未播完的元素连类销毁；单次创建时类晚一帧 + 新节点直接进入聚焦编辑态满帧闪现，动画不可见。
- 锚点：app.ts `applyNodeCreateAnimation` / `createChildNode` / `createSiblingNode`；`render/canvas.ts` renderNodes 的 class 拼接处；`animations.css:125`。
- 修复：把"刚创建节点 id 集合"放进渲染状态，`renderNodes` 直接输出 `node-creating` 类；`animationend`（或超时兜底）后从状态移除。不要依赖 render 后补类。
- 验证：清单 A2（含连续快速创建场景）。

### UX-02 删除/折叠渐隐位置右下漂移（清单 A3/A4）【小修】
- **修复 commit：a09a142**
- 症状：删除与折叠时节点渐隐动画发生在向右下偏移后的位置。
- 根因：M1。
- 锚点：`animations.css:125/137/416/428`；`style.css:1766/1772`。
- 修复：方案 B（推荐）——scale/fade 动画改施加在内层 `.node-shell`（不承担定位），外层 transform 不动，天然规避 auto-width 编辑态差异；方案 A——keyframes 补 translate 分量，但需为 `is-editing-auto-width` 单独处理。
- 验证：清单 A3/A4（渐隐必须发生在节点原位）。

### UX-03 删除节点时连线瞬间消失（清单 A3）【小修】
- **修复 commit：a09a142**
- 症状：节点有渐隐，相关连线无任何淡出直接消失。
- 根因：删除路径只给节点加 `.node-deleting`，未比照折叠路径给受影响 edge 加淡出类（折叠路径有 `edge.classList.add('edge-collapsing')`，CSS 在 `animations.css:460`）。
- 锚点：app.ts `deleteSelectedNode` / `performDeletion`；对照折叠命令分支。
- 修复：删除动画阶段，对 source/target 落在删除集合内的 hierarchy/relation 边加 `.edge-collapsing`（或新增 `.edge-deleting`），与节点 stagger 同步，`animationend` 后再 `performDeletion`。
- 验证：清单 A3。

### UX-04 小地图拖拽抖动 + 点空白飞到极远（清单 B6）【小修+单测】
- **修复 commit：a09a142**
- 症状：拖视口框时镜头异常快速跳变；点击外围空白镜头飞到极远区域且难折返。
- 根因：①`computeWorldBounds` 把**当前视口矩形并入世界包围盒**（`ux-engine.ts:941-955`），且 `minimapToWorld` 每次 mousemove 重算包围盒（非 mousedown 快照）→ 拖动视口→包围盒变→比例尺变→同点映射漂移→再动视口，正反馈循环；②映射结果**无 clamp**（`ux-engine.ts:902-924`），包围盒被撑大后比例尺极小，点远角映射出 ~10^4 级世界坐标，飞远后包围盒更大，自我放大。
- 锚点：`ux-engine.ts` `computeWorldBounds` / `minimapToWorld` / `drawFrame`；app.ts `bindMinimapNavigation` / `panToMinimapPosition`。
- 修复：①bounds 只按节点计算（视口矩形改为绘制期裁剪显示，不进 bounds）；②`minimapToWorld` 结果 clamp 到节点包围盒（留边距）；③mousedown 快照 bounds/scale 供整次拖拽复用。补映射纯函数单测（含外围点击 clamp 用例）。
- 验证：清单 B6。

### UX-05 空画布引导：dismiss 失效 + 遮挡 + 文案不准（清单 C1）【小修】
- **修复 commit：a09a142**
- 症状：删光子节点后引导重现；提示遮挡中央根节点；文案未说明需先选中节点。
- 根因：①`createChildNode` 中**先 `render()` 后 `dismissCanvasGuide()`**——render 时已有子节点把 `canvasGuideVisible` 置 false，`dismissCanvasGuide` 开头 `if (!visible) return` 短路，`canvasGuideDismissed` 永不写入（`overlay.ts` 的 `updateCanvasGuide` 本身检查 dismissed 是对的）；②`.canvas-guide` 与根节点都绝对居中（`animations.css:483`）；③文案 `guide.canvasHint`（i18n 中英两处），而 Tab 处理有 `if (!selectedNode) return` 前置。
- 锚点：`overlay.ts` `updateCanvasGuide` / `renderCanvasGuide`；app.ts `dismissCanvasGuide` / `createChildNode`；`i18n.ts` guide.canvasHint。
- 修复：dismiss 移到 render 之前（或去掉 early-return 无条件置 dismissed）；引导位置改画布中央偏下/偏上避开根节点；文案改"选中节点后按 Tab 创建子节点"（中英同步改）。
- 验证：清单 C1（含"删光子节点不重现"）。

### UX-06 上下文工具条：按钮无效 + 偏右 + 越界（清单 C5 及截图"小黑条"，同一组件）【小修】
- **修复 commit：a09a142**
- 症状：选中节点浮现的四钮工具条（颜色/优先级/删除/AI）点击无任何效果；出现在节点右侧而非上方；易越出屏幕。
- 根因：①全局 `handleClick` 开头 `if (!(target instanceof HTMLElement)) return`——这四个按钮是全应用唯一用内联 SVG 图标的按钮，点在 SVG 上 `event.target` 是 SVGElement 被直接吞掉，`data-command` 分发不执行（命令本身有效）；叠加 `handlePointerDown` 对工具条无豁免（`canvasLeftDragAction='pan-canvas'` 时 `suppressClickOnce` 还会吞 click）。②入场动画 `context-toolbar-enter` 只动画 `translateY` 且 forwards 填充，覆盖内联 `translateX(-50%)` 水平居中 → 工具条左缘落在节点中心，视觉偏右。③定位无视口 clamp。
- 锚点：app.ts `handleClick` / `handlePointerDown` / `createContextToolbar` / `updateContextToolbar`；`animations.css:190-201`（keyframes）与 212-257（样式）。
- 修复：①`handleClick` 改用 `(event.target as Element).closest('[data-command]')` 不限 HTMLElement；同时给 `.context-toolbar svg` 加 `pointer-events:none` 双保险；`handlePointerDown` 对 `closest('.context-toolbar')` 早退。②keyframes 改 `translate(-50%, 6px) → translate(-50%, 0)` 保留水平居中。③定位结果按视口宽高 clamp。
- 验证：清单 C5 + 截图场景（浮动节点选中后四钮全部生效、位置在节点正上方、贴边不出屏）。

### UX-07 折叠 stagger 无总时长上限（清单 F3）【小修+单测】
- **修复 commit：a09a142**
- 症状：50+ 子节点折叠动画拖到 ~2.3s（(n−1)×40ms + 350ms，线性无界）。
- 根因：`computeStaggerDelays` 固定 baseDelay 逐个递增、无 cap（`ux-engine.ts:487-493`）；折叠调用 baseDelay=40，提交等待 `maxDelay+350`。
- 锚点：`ux-engine.ts` `computeStaggerDelays`；app.ts 折叠分支的 baseDelay 与 setTimeout 计算。
- 修复：`baseDelay = Math.min(40, MAX_WINDOW / Math.max(n-1, 1))`，MAX_WINDOW≈400ms；同步修调用处等待时长。补单测（n=5/50/200 时总窗口 ≤ MAX_WINDOW+350ms）。
- 验证：清单 F3。

### UX-08 大图性能：按住 Tab 冻结 + 缩小视图掉帧（清单 F1/F5）【结构】
- **修复 commit：5e29955（短期项；rAF 合帧/视口虚拟化留 P4）**
- 症状：300 节点 40% 缩放 15-20fps（240% 时 60fps）；快速连建节点卡顿冻结。
- 根因：每次 keydown（**无 `event.repeat` 守卫**）同步全链：`captureHistory` 全文档 `JSON.parse(JSON.stringify)` 深拷贝（`utils.ts` cloneDocument）→ **全图** `autoLayoutHierarchy`（`document.ts:475`）→ M2 三层 innerHTML 全量重建 → `updateMinimap` 全节点重绘 → `scheduleAutosave`；无 rAF 合帧。缩放不对称的根因是每节点 28px 模糊 `box-shadow`（`--shadow-card`，`style.css:12/1784`；**不是** backdrop-filter，那只在面板/浮层上）——浏览器只 paint 视口内元素，缩小=全部同屏 paint。
- 修复（分层）：短期＝keydown 加 `event.repeat` 节流 + render 以 rAF 合帧（一帧至多一次）+ 降低节点阴影成本（小阴影/描边，或按缩放级别降级）；中期＝nodeLayer 增量 diff 或视口虚拟化（对应总计划 P4"大图性能"项）+ 历史快照改结构共享/延迟拷贝。与进行中的渲染层拆分协同，勿在旧结构上做。
- 验证：清单 F1/F3/F5 复测（帧率与按住 Tab 不冻结）。

### UX-09 多选剪切粘贴丢关系线（清单 H2）【小修+单测】
- **修复 commit：a09a142**
- 症状：Ctrl+X → Ctrl+V 后父子层级线正常，节点间 relation 线消失。
- 根因：**复制那一步就丢了**——剪贴板类型 `CopiedSubtree` 只有 `{rootId, nodes}`、无 relations 字段（`app-types.ts`）；`copySelectedSubtree` 不采集文档级 `relations`（relation 存于 `MindMapDocument.relations`，`types.ts:96`，端点为 `sourceId/targetId` + 可选 `branches[].targetId`）；剪切随后级联删除相关 relation；粘贴只经 idMap 重映射 `parentId`，不重建 relation。
- 锚点：app.ts `copySelectedSubtree` / 剪切分支 / 粘贴分支（idMap 处）；`app-types.ts` CopiedSubtree；`types.ts` RelationEdge。
- 修复：`CopiedSubtree` 增 `relations` 字段；复制时收集两端（含 branches 目标）均在选中子树 id 集内的 relations；粘贴时经 idMap 重映射端点后重建（端点缺失则丢弃该条）。补往返单测（复制→粘贴后 relation 保留且端点为新 id）。
- 验证：清单 H2。

### UX-10 布局不响应节点高度变化（新问题 1）【结构】
- **修复 commit：5e29955**
- 症状：自动整理不考虑节点高度；文本编辑使节点变大/变小并确认后，周围不重排，出现重叠或异常间距。
- 根因：`autoLayoutHierarchy` 垂直排布用固定 `NODE_GAP_Y=96 × branchWeight(叶子数)`（`document.ts:6/528-569`），**全程不读 `node.height`**（`node-sizing.ts` 的高度只用于画布 bounds）；`commitNodeEditor`/`commitNodeNote` 不触发任何布局；已有局部整理能力 `tidySubtree`（`document.ts:458`）无人调用。
- 修复：①垂直布局改按兄弟实际高度（`node.height` 或 estimateNodeHeight）累加 + 间距，替代固定 GAP×权重；②编辑提交/尺寸变化路径对受影响父节点调 `tidySubtree` 做局部邻域整理（不要全图重排，避免视觉抖动与破坏手动布局）。
- 验证：新问题 1 场景（编辑多行长文本确认后，兄弟节点间距正确、无重叠）。

---

## 非缺陷项（记录在案，不按 bug 修）

- **D2 保存点"闪一次"**：非 bug。dirty 仅存在于 700ms autosave 防抖窗口（`api-sync.ts` `scheduleAutosave`→保存成功即清），圆点样式本身是 dirty 期间常显。要 IDE 式体验需引入"未保存/保存中/已保存"三态指示，属交互改进（归 P4）。
- **新问题 3 顶栏自定义**：功能请求。现状 `render/toolbar.ts` 分组硬编码——file/node/ai/view 四组可折叠，主信息组与快捷组不可折叠（顺带统一折叠能力）；按钮显隐与排序配置化归 P4 待办。
- **C3/C4/D1**（快捷键层入口不可发现、快捷键文档漂移、toast 薄且硬编码中文）：已列入总计划 P4"可发现性残留"。
- **E 组 AI 可见性**：已列入总计划"AI 可回滚补丁 + AI 协作可见性"。实测补充需求一并实现：ai-pending 状态高亮、AI 生成内容自动区域框选/染色标记、快照能区分 AI 刚生成的部分。

## 建议修复批次

- **批次 1（纯小修，互不依赖可并行；唯 UX-01 依赖 UX-02 先修，否则出现动画自带位移）**：UX-02 → UX-01、UX-03、UX-05、UX-06、UX-07、UX-04、UX-09。
- **批次 2（结构级，与 P1 渲染拆分 / P4 视口虚拟化协同排期）**：UX-08、UX-10。
- 每批完成：`cd frontend && npx vitest --run` 全绿 + 按清单对应条目复测 + 在本文件对应条目标注修复 commit。
