# 2026-03-30 AI 导入、子节点建议与布局稳定性 — 完成总结

## 已完成

### 1. 删除后的布局回收 (fix1)
- 在 `deleteSelectedNode()` 方法中，删除节点后加入了 `autoLayoutHierarchy()` 调用。
- 删除新增节点后，剩余分支会自动回收并重排到最优布局。

### 2. AI 批量子节点后重排
- 在 `applyAINodeNotes('children')` 模式下，创建完子节点后调用 `autoLayoutHierarchy()`。
- AI 子节点不再堆积在原位。

### 3. AI 生成稳定性
- **大幅加强系统提示词**：在 `generateAIDocument()` 系统提示中增加了 CRITICAL FORMAT RULES 段落：
  - 强制 4 个顶层 key：`title`, `summary`, `nodes`, `relations`
  - 禁止发明替代结构（root/children/crossLinks 等）
  - 禁止 markdown fences 包裹
  - 强制 root 节点在 nodes 数组首位
  - 强制每个 non-root 节点含全部 6 字段
  - 限定 kind 和 priority 合法值
- 同样的 FORMAT RULES 也用在了 AI Import 提示词中。

### 4. AI 导入
- **后端**：新增 `/api/ai/import` 端点 + `importDocumentWithAI()` 函数。
  - 接收文件名、格式、内容和用户指令。
  - 截取前 12000 字符防止 token 溢出。
  - 生成后走 `normalizeGeneratedGraphPayload` + `generatedGraphToDocument` 统一流程。
- **前端**：
  - `importFile()` 支持 `mode: 'auto' | 'ai'` —— `.md/.markdown/.txt` 走规则导入，其他格式自动走 AI 导入。
  - AI 工作台新增 **AI Import** 卡片（带指令输入 + 文件选择按钮 + debug raw editor）。
  - 导入文件接受列表从 `.md,.txt` 扩展到 `.json,.csv,.html,.xml,.yaml,.yml,.toml,.ini,.cfg,.log,.rst,.mmd,.mermaid,.opml` 等。
  - 新增 `ai-import-file` 命令。

### 5. AI 子节点建议（类 Continue 插件补全）
- **后端**：新增 `/api/ai/suggest-children` 端点 + `suggestAIChildren()` 函数。
  - 给定目标节点 ID，返回 3-6 个 {title, note} 建议。
  - 提示词包含全文档上下文和已有子节点去重。
- **前端**：
  - AI 工作台新增 **Suggest Child Nodes** 卡片。
  - `ai-suggest-children` 命令：选中节点 → 调用建议 API → 创建子节点 → 自动重排。
  - 创建后自动 `autoLayoutHierarchy()` 保证布局。
- 双语 i18n 已全部补齐。

## 技术决策
- AI Import 复用 `generatedGraphToDocument` 统一图转换管线，确保导入后的文档结构与 AI 生成的一致。
- Suggest Children 不走 generate graph 全流程，而是用更轻量的 schema（只返回 title+note 列表），响应更快。
- 文件格式路由逻辑放在前端 `importFile` 的 auto 模式中，后端仅提供两套独立端点。

## 遗留
- AI 建议子节点目前需要手动触发（打开 AI 工作台点按钮），尚未实现选中节点时自动在旁边弹出下拉候选的"补全弹窗"体验——需要后续 UI 迭代。
- AI Import 对超大文件（>12000 字符）做了截断，极大文件可能丢失尾部内容。
