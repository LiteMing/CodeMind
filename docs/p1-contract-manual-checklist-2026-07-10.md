# P1 双契约人工验证清单（2026-07-10）

覆盖 `feat/p1-agent-contract` 的四个阶段：revision/If-Match、节点代码绑定与显式顺序、Git 语义格式与 CLI、Agent 命令契约与冲突恢复；同时抽查单二进制四种运行模式。

自动化验证基线：`CodeMind-1.14.1.exe` 契约验收 33 PASS、0 FAIL、4 个分组 SKIP；Go 全量测试通过；前端 237 通过、2 跳过；TypeScript、lint、build 和 VS Code 编译通过。本清单同时关注真实行为和使用体感：冲突恢复是否顺手、Agent 能否正确重读重试、Git 格式是否确实减少无关 diff。

## 准备

- 启动方式：浏览器开发模式运行 `npm run dev`，API 为 `http://127.0.0.1:34117`；或运行 `codemind serve`，默认 API 为 `http://127.0.0.1:7979`。
- 命令环境：以下示例按 Git Bash/curl 编写。先设置 `BASE=http://127.0.0.1:34117`（按实际端口修改）。
- 测试图：创建一张至少 10 个节点的小图，记录 `MAP_ID`。local/owner 模式可通过 `GET $BASE/api/maps` 查询。
- Token：C/D 组需要两枚绑定同一 `MAP_ID` 的 agent token，以及一枚 viewer token。配置了 owner API key 时，签发 token 的请求也要携带 `X-API-Key`。
- 判定：`[√]` 表示该项完整通过；`[△]` 表示自动化核心已通过、但仍有明确的人工观察点；`[ ]` 表示尚未验证；`[？]` 表示验证方法仍有疑问。失败时记录实际响应体和状态码。【记录】项没有预设结论，只记录当前行为。

### 自动验收脚本

在项目根目录运行：

```powershell
npm run test:p1-contract
```

脚本要求 PowerShell 7（`pwsh`）；默认 E6b 源码注入测试还需要 Go，未安装 Go 时该项记为 SKIP，不影响其余 EXE 契约验收。

脚本自动选择 `build/bin` 下最新的版本化 EXE，使用临时端口和临时数据目录，覆盖 B/C、D1/D2/D3/D5/D6、E1-E5、E6 覆盖/回滚，以及 F2/F3/F4 的协议和退出码。它不会连接或修改现有脑图，也不会自动改写本清单。

常用参数：

```powershell
# 指定待测 EXE
pwsh -File scripts/test-p1-contract.ps1 -Executable build/bin/CodeMind-1.14.1.exe

# 同时运行 Go、前端和 VS Code 回归套件
pwsh -File scripts/test-p1-contract.ps1 -IncludeRegression

# 主动保留临时 runtime/semantic/layout 现场（测试失败时会自动保留）
pwsh -File scripts/test-p1-contract.ps1 -KeepArtifacts
```

JSON 报告写入 `build/reports/`。自动脚本未覆盖：A 组 UI 体感、D4/D7、F1/F5、F2 的终端日志可见性、F3 的窗口体感、F4 的 help 文本可见性，以及 G 组视觉交互；其中已经人工验证的项目按下方清单勾选。

2026-07-13 本机结果：`33 PASS / 0 FAIL / 4 SKIP`（`CodeMind-1.14.1.exe`，包含 Go、前端、VS Code 回归套件）。证据报告：`build/reports/p1-contract-20260713-214019.json`。报告中的 SKIP 是分组结果行，不等于只剩 4 个清单子项。

---

## A. 乐观并发与冲突恢复（双浏览器窗口）

- [√] A1 制造冲突：窗口甲、乙打开同一张图；甲修改并等待保存成功；乙不刷新直接修改另一节点。乙应进入冲突态，不能静默覆盖甲。
- [√] A2 入口与停止重试：出现“重新加载服务端”和“用本地草稿覆盖”两个动作；floating 顶部面板和 fixed 工具栏均可访问。观察 1 分钟，autosave 不应反复发送失败请求。
- [√] A3 重新加载：点击“重新加载服务端”后出现放弃本地更改的确认；确认后加载甲的版本，dirty/冲突态清除，历史栈重置，可继续编辑。
- [√] A4 本地覆盖：重新制造冲突，点击“用本地草稿覆盖”；确认后服务端保存乙的草稿，冲突态清除。甲刷新后看到乙版本属于预期结果。
- [√] A5 二次冲突：乙确认覆盖后、实际 PUT 前让甲再保存一次。乙若再次收到 412，本地草稿必须保持原样，并可重新选择两个动作。
- [√] A6 轮询守卫：冲突态持续至少 10 秒，跨越多个 2 秒轮询周期；乙的本地草稿不能被服务端版本替换。
- [√] A7 切图竞态：让保存请求处于慢响应状态时切到另一张图并编辑；旧请求返回后，新图内容不能被替换，且新图仍会继续保存。

### A 组人工测试记录

1. 选择“重新加载服务端”后镜头会重置，操作上有些打断感。
2. 多人同时快速编辑时，即使修改的是不同节点，也会频繁产生客户端与服务端冲突，用户需要反复在本地草稿和服务端版本之间二选一。
3. “历史快照”侧栏显示的条目较多；不同客户端的手动快照似乎互不相同；列表会超出侧栏范围，且目前没有找到删除快照的入口。

### A 组发现的后续问题（初步归类）

1. **重载后镜头重置**：属确认的 UX 问题。当前重新加载会重新走文档打开流程并初始化视口；后续应在同图重载时保留当前中心点和缩放，仅在目标节点不可见时再调整镜头。
2. **不同节点也频繁发生整图冲突**：属当前同步模型边界。桌面端仍以整份 document revision 做 CAS 保存，所以两人修改不同节点也会冲突；节点级 REST 虽然能缩小写入面，但桌面客户端尚未使用 operation/rebase/changeset 合并。后续需要节点级操作同步或服务端 rebase，而不是继续增加二选一弹窗。
3. **快照列表与删除能力**：当前快照保存在每个浏览器/WebView 自己的 `localStorage`，所以不同客户端互不共享。每张图最多保留 14 条，并至少保护最近 4 条手动快照；当前没有单条删除/清空功能，列表也没有独立滚动和筛选。建议独立增加快照管理：删除、清空自动/AI 快照、按类型筛选、列表限高滚动和容量提示。

## B. Agent 命令信封（REST/curl）

先读取当前 revision：

```bash
curl -s -i "$BASE/api/maps/$MAP_ID" | grep -i etag
```

以下节点请求体应使用真实父节点，例如 `{"parentId":"root","title":"test node"}`。

基准写请求（把 `REV` 和 `KEY` 换成当前值）：

```bash
curl -s -i -X POST "$BASE/api/maps/$MAP_ID/nodes" \
  -H "Content-Type: application/json" \
  -H "If-Match: \"rev-$REV\"" \
  -H "X-CodeMind-Partition: development" \
  -H "Idempotency-Key: $KEY" \
  -d '{"parentId":"root","title":"test node"}'
```

`If-Match` 的 header 值必须包含字面双引号，即 `"rev-N"`；写成 `rev-N` 会得到 400。服务端启用鉴权时，基准请求还要增加 owner `X-API-Key` 或目标图的 Bearer token。

- [√] B1 缺 If-Match：只发送 JSON body，不带三个命令 header → **428 Precondition Required**。If-Match 的缺失检查应优先于 partition/key。
- [√] B2 陈旧 revision：携带陈旧 `If-Match`，同时带有效 `X-CodeMind-Partition: development` 和新 `Idempotency-Key` → **412**，JSON 含数值 `expectedRevision`、`actualRevision`，响应 ETag 为当前 revision。
- [√] B3 缺 partition：使用当前 If-Match 和新 key，但去掉 `X-CodeMind-Partition` → **400**，`code=partition_required`。
- [√] B4 缺 Idempotency-Key：使用当前 If-Match 和 development partition，但去掉 key → **400**，`code=invalid_idempotency_key`。
- [√] B5 stable 拒写：三个 header 齐全但 partition=stable → **403**，`code=stable_partition_read_only`。
- [√] B6 幂等重放：使用唯一 key（例如带当前时间的 `manual-replay-*`）把完全相同的请求连续发送两次 → 首次 2xx；第二次响应头含 `X-CodeMind-Idempotent-Replay: true`；revision 只增加一次，节点只创建一个。
- [√] B7 key 复用冲突：把 B6 的 key 用于不同 title/body → **409**，`code=idempotency_key_reused`。
- [√] B8 query 进入指纹：创建一个可删除节点；同一 key 先用 `?cascade=true` 删除，再改为 `?cascade=false` 重放 → **409**，不能错误重放第一次结果。
- [√] B9 失败不缓存：用某 key 发送不存在 parentId 的请求得到 400；修正 parentId 后复用该 key → 可以正常执行，说明失败响应未进入缓存。

自动证据：报告结果行 B1-B9 全部 PASS，均通过临时服务和真实 HTTP 请求验证。

## C. Token 与 actor 作用域

签发 token 的字段为 `accessLevel`，不是 `role`：

```bash
curl -s -X POST "$BASE/api/tokens" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $OWNER_API_KEY" \
  -d "{\"mapId\":\"$MAP_ID\",\"accessLevel\":\"editor\",\"actorKind\":\"agent\",\"displayName\":\"test-agent-a\"}"
```

本地未配置 API key 时可去掉 `X-API-Key`。保存返回的 `secret`，它只在创建时出现。

- [√] C1 agent token：返回体含 `actorKind: "agent"`、`accessLevel: "editor"` 和非空 secret。
- [√] C2 scoped 读写：在 B 组完整命令信封基础上增加 `Authorization: Bearer {secret}`，调用绑定 `MAP_ID` 的 `get_tree`/节点写接口 → 成功；访问其他 mapId → **403**。Bearer token 不能替代 If-Match、partition 或 idempotency key。
- [√] C3 scoped list 限制：使用 editor agent token 调用 `GET /api/maps` 或 MCP `list_maps` → **403** 是预期行为，不应误判为 token 失效。
- [√] C4 viewer 回归：签发 `accessLevel=viewer` token，写节点 → **403**。
- [√] C5 actor 进入幂等作用域：签发 agent A/B，绑定同一图；A 使用 key `actor-scope-1` 成功写入后，B 使用相同 key、当前 revision 和不同 body 也应成功，而不是 409。说明 key 按 actorId 隔离。
- [√] C6 身份不可自声明（必须用 REST 直测）：在合法节点请求 body 中加入 `author`、`actor`、`pending` 或 `actorKind` → 这些字段不应出现在保存后的文档，也不能改变 token actor。不要用 MCP 做此项，因为 MCP payload 白名单会先过滤这些字段。

自动证据：报告结果行 C1-C6 全部 PASS；C6 还重新加载持久化文档确认身份字段未落盘。

【边界】当前 actor 用于认证和幂等作用域，尚未持久化为文档 author，UI 也没有可见署名。人工验收不要期待 author/changeset 展示。

## D. MCP 端到端（真实 Agent）

配置 `codemind.exe mcp`，环境变量包括：

- `CODEMIND_API_URL=$BASE`
- `CODEMIND_ACCESS_TOKEN={C1 的 agent token}`

在 Agent 提示或项目配置中明确提供 `MAP_ID`。scoped token 无权使用 `list_maps` 发现全部脑图。

- [√] D1 工具 schema：五个写工具均要求 `expectedRevision`、`partition`、`idempotencyKey`。
- [△] D2 正常写入：让 Agent 对明确的 `MAP_ID` 先 `get_tree`，再在 development 创建节点 → 成功且画布可见。自动脚本已确认真实 MCP 写入成功；“画布可见”仍需人工观察。
- [√] D3 结构化冲突：Agent 读到 revision 后，人先保存一次，再让 Agent 用旧 revision 写 → tool result 为 `isError=true`，`content[0].text` 可解析为 JSON，含 `error.code=revision_conflict` 和 `error.actualRevision`。
- [ ] D4 Agent 自愈重试：MCP 适配器本身不会自动重试；观察外部 Agent 的工具调用轨迹。D3 后它应重新 `get_tree`、检查目标位置，并复用原 idempotency key 和新 revision 发起重试。协议最多允许 3 次重试，即初次失败后最多再出现 3 次写工具调用；超限应停下询问用户。
- [△] D5 stable 拒写：让 Agent 明确尝试 partition=stable → 收到 403 语义并停止，不换凭据绕过。自动脚本已确认 MCP 透传 stable 拒写；外部 Agent 是否停止仍需观察。
- [√] D6 MCP 重放：使用 MCP Inspector 或可查看原始参数的客户端，把同一写工具参数（包括相同 revision、partition、key 和 payload）连续调用两次 → 两次均返回首次成功结果，脑图 revision 只增加一次。
- [ ] D7 Agent key 礼仪【记录】：在可查看工具调用参数的宿主中，让 Agent“重试上一条完全相同的写入” → 应复用原 key；再要求执行一条新的逻辑写入 → 应使用新 key。记录实际参数，避免只凭自然语言答复判定。

## E. Git 语义格式与 format CLI

- [√] E1 确定性：对同一 runtime JSON 分别导出到 `/tmp/m1` 和 `/tmp/m2`，执行 `diff -r /tmp/m1 /tmp/m2` → 零差异。
- [√] E2 diff 友好：只修改一个节点标题，重新导出到 `/tmp/m3` → `semantic.json` 的差异只涉及该节点对象的 title 行；其他节点、key 顺序和 `layout.json` 不产生无关噪音。
- [√] E3 纯布局不污染语义：只移动节点、改变尺寸/折叠/关系路由或主题，重新导出 → `semantic.json` 字节不变，差异只在 `layout.json`。
- [√] E4 往返等价：按 `codemind format import --help` 将 m1 导回 runtime JSON，再次 export → semantic/layout 与 m1 零差异。
- [√] E5 非法输入拒绝：制造父子环、重复 ID、引用不存在节点或不连续 order → import 报错，不产出损坏 runtime 文档。
- [√] E6 覆盖回滚：目标输出已存在时不带 `--force` → 拒绝覆盖；模拟第二个文件提交失败 → semantic/layout 原文件均恢复，不留下半组新文件。

自动证据：E1-E5、E6a 全部通过真实 `CodeMind-1.14.1.exe`；E6b 通过当前源码的故障注入 Go 测试验证整组回滚。E6b 不单独声称对已打包 EXE 注入了文件提交故障。

## F. 单二进制四模式

- [√] F1 `codemind.exe` → GUI 正常启动。
- [△] F2 在终端运行 `codemind.exe serve` → 可看到监听日志，默认 7979 可访问。自动脚本已确认 serve 启动、端口归属和 health；终端日志可见性仍需人工观察。
- [△] F3 Claude Code 以 stdio 拉起 `codemind.exe mcp` → 工具可用，且没有额外 GUI/console 窗口干扰协议。自动脚本已确认 stdio 会话和退出；窗口体感仍需人工观察。
- [△] F4 `codemind.exe format --help` → 输出 format 用法；export/import 子命令帮助可用。自动脚本已确认 format help 命令成功退出；help 文本完整可见性仍需人工观察。
- [√] F5 GUI 与 serve 同时指向同一数据目录【记录】：记录是否存在跨进程并发冲突或明确限制；不得只观察“能启动”就判定安全。

## G. 历史回归抽查

- [ ] G1 AI 前置快照：触发一次 AI 改图 → Inspector 出现 AI 快照，Restore 可回滚。
- [ ] G2 手动快照配额：连续制造多次 AI 快照后，最近的手动快照仍保留。
- [√] G3 sibling order：新建三个兄弟节点 → 保存 → 重载 → 顺序不变。
- [ ] G4 bindings：通过 REST/MCP 写 file/symbol 绑定 → 保存、重载、Git export 后字段无损。
- [√] G5 UX：折叠动画原位渐隐、注释徽章可点且不误拖、小地图拖拽不跳动。
- [√] G6 多选剪切粘贴：关系线随粘贴保留，binding ID 会重建且不冲突。

---

## 结果记录

审查状态摘要：

- 完整通过：A1-A7、B1-B9、C1-C6、D1/D3/D6、E1-E6、F1/F5、G3/G5/G6。
- 部分通过：D2/D5、F2-F4；协议或进程行为已自动通过，剩余人工观察点已写在对应条目中。
- 尚未验证：D4/D7、G1/G2/G4。

| 日期       | 环境/版本                 | 通过                             | 失败 | 备注（含【记录】项）                                                                                                                   |
| ---------- | ------------------------- | -------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-13 | Windows / CodeMind 1.14.1 | 自动 33 个结果行；人工勾选见正文 | 0    | 自动报告 `p1-contract-20260713-214019.json`；4 个 SKIP 为 A、D4/D7、F-manual、G 四个分组行。D2/D5/F2-F4 标为部分通过，未夸大自动覆盖。 |
