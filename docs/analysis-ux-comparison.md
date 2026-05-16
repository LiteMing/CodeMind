# Code Mind UX 短板分析 — 与 Project Graph 对比

## 总体评价

| 维度 | Code Mind | Project Graph | 差距 |
|------|-----------|---------------|------|
| 渲染流畅度 | DOM 渲染，中等 | Canvas 2D，极佳 | ⚠️ 大 |
| 动画/过渡 | 极少（仅 toast + API 新节点） | 丰富（节点创建/删除/移动/连线） | ⚠️ 大 |
| 视觉反馈 | 基础 hover/selected 状态 | 实时拖拽预览、吸附提示、特效 | ⚠️ 大 |
| 交互流畅感 | 功能完整但"硬" | 丝滑、有"弹性" | ⚠️ 大 |
| 视觉设计 | 现代毛玻璃风格，质感好 | 简洁实用，偏工具感 | ✅ CM 更好 |
| 信息层次 | 面板较多，层级清晰 | 极简，画布为主 | 各有优劣 |
| 上手门槛 | 需要学习快捷键 | 拖拽即用 | ⚠️ PG 更低 |

---

## 一、动画与过渡（最大短板）

### Code Mind 现状

当前只有 2 个 `@keyframes` 动画：
- `toastSlideIn` — API 更新 toast 滑入
- `nodeAppear` — API 创建的节点淡入缩放

其余所有交互都是**瞬间切换**，没有过渡：
- 节点创建：瞬间出现
- 节点删除：瞬间消失
- 面板打开/关闭：瞬间显示/隐藏
- 视图切换（home → map）：无过渡
- 折叠/展开：子节点瞬间消失/出现
- 拖拽结束：节点瞬间到位

### Project Graph 做法

- 节点创建有缩放+淡入动画
- 节点删除有收缩+淡出
- 连线绘制有"生长"动画
- 拖拽时有实时预览线和吸附提示
- 画布缩放有惯性滚动
- 分组框折叠/展开有平滑过渡

### 改进建议

```css
/* 1. 节点创建动画 */
@keyframes nodeCreate {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
.node-card.is-new { animation: nodeCreate 0.25s ease-out; }

/* 2. 节点删除动画 */
@keyframes nodeRemove {
  to { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
}
.node-card.is-removing { animation: nodeRemove 0.2s ease-in forwards; }

/* 3. 面板滑入 */
@keyframes slideInRight {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}
.settings-drawer, .ai-drawer { animation: slideInRight 0.22s ease-out; }

/* 4. 折叠/展开过渡 */
.node-card { transition: opacity 0.2s ease, transform 0.2s ease; }
```

---

## 二、拖拽体验

### Code Mind 现状

- 节点拖拽：直接移动 DOM 位置，无视觉辅助
- 无拖拽时的"幽灵"预览
- 无吸附网格线提示
- 无拖拽到目标节点时的"可放置"高亮
- 拖拽结束无"落地"动画

### Project Graph 做法

- 拖拽时节点有轻微阴影加深
- 有对齐辅助线（水平/垂直对齐提示）
- 拖拽到可连接目标时有高亮反馈
- 松手时有微弹效果

### 改进建议

1. **拖拽中阴影加深**：
```css
.node-card.is-dragging .node-shell {
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  transform: scale(1.02);
  opacity: 0.92;
}
```

2. **对齐辅助线**：拖拽时检测与其他节点的 x/y 对齐，显示虚线

3. **放置目标高亮**：拖拽节点靠近另一节点时，目标节点边框变色

---

## 三、画布交互

### Code Mind 现状

- 缩放：直接 scale 变化，无平滑过渡
- 平移：跟随鼠标，无惯性
- 无 minimap（小地图导航）
- 无"适应画布"动画（fit-to-view 是瞬间跳转）

### Project Graph 做法

- 缩放有平滑插值（lerp）
- 平移有惯性滑动
- 双击空白处可快速缩放到默认比例
- 有视口边界提示

### 改进建议

1. **缩放平滑过渡**：
```typescript
// 用 requestAnimationFrame 做缩放插值
private animateZoom(targetScale: number, centerX: number, centerY: number) {
  const start = this.viewport.scale
  const duration = 150
  const startTime = performance.now()
  const animate = (now: number) => {
    const t = Math.min((now - startTime) / duration, 1)
    const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
    this.viewport.scale = start + (targetScale - start) * eased
    this.renderWorkspace()
    if (t < 1) requestAnimationFrame(animate)
  }
  requestAnimationFrame(animate)
}
```

2. **Minimap**：右下角小地图显示全局视图和当前视口位置

3. **Fit-to-view 动画**：平滑过渡到包含所有节点的视口

---

## 四、节点编辑体验

### Code Mind 现状

- 双击进入编辑：textarea 替换节点，无过渡
- 编辑完成：瞬间切回显示模式
- 无实时预览（编辑时看不到最终渲染效果）
- 节点宽度变化无过渡

### Project Graph 做法

- 编辑时节点有"聚焦"放大效果
- 输入时节点大小实时自适应
- 有 Markdown 实时预览
- 编辑完成有平滑收缩

### 改进建议

1. **编辑态过渡**：进入编辑时节点轻微放大 + 边框高亮动画
2. **尺寸自适应动画**：节点宽高变化用 transition 平滑过渡
3. **退出编辑反馈**：完成编辑时有短暂的"确认"闪烁

---

## 五、连线交互

### Code Mind 现状

- 创建关系线：点击源节点 → 点击目标节点，中间无视觉引导
- 连线是静态的 SVG path
- 无连线创建动画
- 中间点拖拽无实时预览

### Project Graph 做法

- 拖拽创建连线：从节点边缘拖出，实时显示跟随鼠标的预览线
- 连线有"生长"动画
- 悬停连线时有高亮 + 粗细变化
- 连线标签有淡入效果

### Code Mind 已有但可优化

- connector dot 拖拽已实现（从节点右上角拖出）
- 但缺少：连线创建完成的动画、连线 hover 的平滑过渡

### 改进建议

```css
/* 连线 hover 过渡 */
.edge-relation {
  transition: stroke-width 0.15s ease, opacity 0.15s ease;
}
.edge-relation:hover {
  stroke-width: 4;
  opacity: 1;
}

/* 新连线创建动画 */
@keyframes edgeGrow {
  from { stroke-dashoffset: 100%; }
  to { stroke-dashoffset: 0; }
}
.edge-relation.is-new {
  animation: edgeGrow 0.3s ease-out;
}
```

---

## 六、空状态与引导

### Code Mind 现状

- 首次打开有语言选择（onboarding）
- 但进入编辑器后无引导
- 空画布无提示"如何开始"
- 快捷键需要查文档

### Project Graph 做法

- 有教程视频链接
- 空画布有操作提示
- 快捷键有图标标注
- 有 Welcome 界面

### 改进建议

1. **空画布引导**：中央显示半透明提示 "按 Tab 创建子节点 / 双击空白处创建浮动节点"
2. **快捷键提示层**：按住 `?` 或 `Ctrl+/` 显示快捷键覆盖层
3. **首次使用引导**：3-4 步的交互式教程（创建节点 → 编辑 → 连线 → AI）

---

## 七、响应式与微交互

### Code Mind 现状

- 按钮有 `transform: translateY(-1px)` hover 效果 ✓
- 有 `var(--ease): 180ms ease` 统一过渡时间 ✓
- 但大量交互缺少反馈：
  - 保存成功：仅状态栏文字变化
  - 删除节点：无确认动画
  - 复制/粘贴：无视觉反馈
  - AI 操作完成：仅文字提示

### Project Graph 做法

- 操作成功有短暂的"闪烁"或"脉冲"反馈
- 删除有"收缩消失"效果
- 复制有"幽灵节点"短暂显示
- 按键操作有即时视觉响应

### 改进建议

1. **保存反馈**：save indicator 脉冲动画
```css
@keyframes savePulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.7; }
}
.save-indicator.is-saving { animation: savePulse 0.4s ease; }
```

2. **操作反馈 toast**：轻量级底部 toast（"已复制" / "已删除 3 个节点"）

3. **按键视觉反馈**：按下快捷键时对应按钮短暂高亮

---

## 八、信息密度与布局

### Code Mind 现状

- Inspector 面板信息较多（节点详情、关系列表、快照、颜色选择器）
- 面板宽度固定 340px
- 设置面板是右侧抽屉
- AI 面板也是右侧抽屉
- 多个面板可能重叠

### Project Graph 做法

- 极简 UI，画布占据几乎全部空间
- 工具栏极窄，悬浮在边缘
- 属性编辑是内联的（选中节点直接编辑）
- 无常驻面板

### 改进建议

1. **Inspector 默认折叠**：只显示最关键信息（标题、优先级），展开查看详情
2. **上下文工具栏**：选中节点时在节点附近显示浮动工具条（颜色/优先级/删除）
3. **减少面板层级**：AI 功能集成到节点右键菜单或浮动工具条中

---

## 九、优先级改进路线图

### P0 — 立即可做（纯 CSS，无需改架构）

| 改进项 | 工作量 | 效果 |
|--------|--------|------|
| 面板打开/关闭动画 | 0.5h | 消除"闪现"感 |
| 节点创建/删除动画 | 1h | 操作有"生命力" |
| 拖拽中阴影加深 | 0.5h | 拖拽更有质感 |
| 连线 hover 过渡 | 0.5h | 交互更流畅 |
| 保存/操作反馈动画 | 1h | 操作有确认感 |

### P1 — 短期可做（需少量 JS）

| 改进项 | 工作量 | 效果 |
|--------|--------|------|
| 缩放平滑插值 | 2h | 画布操作丝滑 |
| 折叠/展开动画 | 3h | 结构变化可追踪 |
| 对齐辅助线 | 4h | 拖拽更精确 |
| 空画布引导提示 | 2h | 降低上手门槛 |
| 节点上下文浮动工具条 | 4h | 减少面板依赖 |

### P2 — 中期规划（需要较大改动）

| 改进项 | 工作量 | 效果 |
|--------|--------|------|
| Minimap 小地图 | 8h | 大图导航 |
| Fit-to-view 动画 | 3h | 视图切换流畅 |
| 惯性滚动/缩放 | 4h | 接近原生体验 |
| 快捷键覆盖层 | 3h | 可发现性 |
| 首次使用交互教程 | 6h | 新用户留存 |

---

## 十、总结

Code Mind 的 UX 短板主要集中在**动效缺失**和**交互反馈不足**，而非视觉设计。实际上 Code Mind 的视觉设计（毛玻璃面板、渐变背景、圆角卡片）比 Project Graph 更现代精致。

问题在于：**好看但不"活"**。

用户操作后缺少即时的视觉确认，导致体验感觉"硬"和"机械"。这是纯前端问题，不需要改架构，大部分改进只需要添加 CSS 动画和少量 JS 插值逻辑。

**最高 ROI 的改进**：给所有面板加 slide-in 动画 + 给节点增删加 fade 动画 + 给缩放加平滑插值。这三项改动可能只需要半天工作量，但能让整体体验提升一个档次。

---

*分析日期：2026-05-15*
