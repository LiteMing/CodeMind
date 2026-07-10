# P1 Phase C：Git 语义格式开发总结

日期：2026-07-10 ｜ 分支：feat/p1-git-semantic-format ｜ 版本：1.13.0

## 完成内容

- 新增 `ProjectMapSemanticDocument` 与 `ProjectMapLayoutDocument`，现有 runtime JSON 和 FileStore 主存储保持不变。
- semantic 保存节点层级/order/内容/bindings、关系语义和区域标签；不包含 theme、布局、routing、时间戳或 revision。
- layout companion 保存 theme、节点布局/折叠、关系 routing、区域几何、实体时间戳和 runtime meta。
- split 会深拷贝并验证 runtime，不修改调用方 document；旧文件缺失 runtime metadata、order 或 theme 时在副本内兼容迁移。
- semantic key 由专用 struct 固定，nodes root 优先后按 ID，relations/regions 按 ID，bindings/branches 按稳定 ID 排序。
- JSON 统一 2 空格缩进、UTF-8、LF、末尾单换行、空集合 `[]`，并关闭 HTML escaping。
- strict merge 要求 semantic/layout 的 mapId 和 node/relation/region ID 集合完全一致，用于完整回滚。
- reconcile merge 按 semantic ID 过滤 stale layout orphan，保留仍有效布局，为新增实体生成确定性默认布局。
- semantic-only import 自动使用 reconcile；semantic 缺失、重复或不连续 order 会被严格拒绝。
- 新增 `codemind format export/import`，默认拒绝覆盖，禁止输入输出同路径，支持 `--force` 与 `--reconcile`。
- 双文件覆盖前会备份全部旧输出；任一提交失败会删除部分新文件并恢复全部备份，避免新 semantic 搭配旧 layout。
- 原 runtime 输入、semantic 输入和 layout 输入始终只读，不执行原地迁移。
- README、API Guide 和平台使用文档已补充格式契约、Git 建议和 CLI 工作流。

## Golden 与测试

- 新增完整 runtime、legacy runtime、semantic golden 和 layout golden fixtures。
- 覆盖字节级 golden、数组 shuffle、bindings/branches 排序、LF/末尾换行和 HTML escaping。
- 覆盖仅改变 theme/坐标/尺寸/折叠/routing/时间戳/revision 时 semantic bytes 完全不变。
- 覆盖语义字段变化、strict 双投影往返、semantic-only 默认布局、reconcile 新增/删除实体。
- 覆盖 unsupported format/schema、mapId mismatch、duplicate ID、strict ID 集合不一致和 semantic order 错误。
- CLI 覆盖参数校验、严格往返、无 layout reconcile、默认拒绝覆盖、force、路径冲突和输入不变。
- CLI 覆盖 stale invalid orphan reconcile，以及第二个输出提交失败后的整组回滚。

## 验证结果

- `go test ./...`：通过。
- `go vet ./...`：通过。
- ProjectMap/CLI 定向套件重复运行通过；关键修复用例重复 50 次通过。
- `cd frontend && npm test`：16 个测试文件，227 通过、2 跳过。
- `cd frontend && npm run lint`：通过。
- `cd frontend && npm run build`：通过。
- `cd vscode-extension && npm run compile`：通过。
- verifier 复验：无阻断或中级问题，`git diff --check` 通过。
- Windows 真实锁文件测试：layout 被独占时 export 失败，但 semantic/layout 均未改变，backup/temp 残留为 0。
- 打包前端口 `34117`、`34118`、`7979` 均空闲。
- `npm run build:desktop`：通过，生成 `build/bin/CodeMind-1.13.0.exe`。
- Windows 资源：ProductVersion=`1.13.0`，FileVersion=`1.13.0.0`，大小 `12,680,192` 字节。
- 打包 EXE CLI 冒烟：export/import exit=0，恢复 mapId=`project-map`、revision=`7`。

## 设计边界

- `semantic.json` 建议提交 Git；`layout.json` 是本地布局与运行状态 companion，建议加入 `.gitignore`。
- 本阶段不把双文件放入 `data/maps`；FileStore 当前会把目录内 `.json` 当作 runtime 文档读取。
- 本阶段不提供 REST/MCP 格式端点或桌面导出 UI，也不扫描仓库、不自动提交 Git。
- 不实现三方 merge、CRDT、rename-follow、稳定区文件树、Git status/diff 高亮或云端部署。
- Go race 未执行：当前环境 `CGO_ENABLED=0`，不支持 `-race`；其余全量与重复测试通过。

## 后续

进入 Phase D：Agent 契约骨架。定义 actor、partition、idempotency key、expected revision 和 changeset metadata，并将 HTTP/MCP 写入收敛到同一服务层命令，为开发区 Agent 提交与稳定区评审门奠定契约基础。
