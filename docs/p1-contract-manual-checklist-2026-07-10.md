# P1 双契约人工验证清单（2026-07-10）

覆盖 `feat/p1-agent-contract` 的四个阶段：revision/If-Match、节点代码绑定与显式顺序、Git 语义格式与 CLI、Agent 命令契约与冲突恢复；同时抽查单二进制四种运行模式。

自动化验证基线：Go 全量测试通过；前端 236 通过、2 跳过；TypeScript、lint、build 和 VS Code 编译通过。本清单关注真实行为和使用体感：冲突恢复是否顺手、Agent 能否正确重读重试、Git 格式是否确实减少无关 diff。

## 准备

- 启动方式：浏览器开发模式运行 `npm run dev`，API 为 `http://127.0.0.1:34117`；或运行 `codemind serve`，默认 API 为 `http://127.0.0.1:7979`。
- 命令环境：以下示例按 Git Bash/curl 编写。先设置 `BASE=http://127.0.0.1:34117`（按实际端口修改）。
- 测试图：创建一张至少 10 个节点的小图，记录 `MAP_ID`。local/owner 模式可通过 `GET $BASE/api/maps` 查询。
- Token：C/D 组需要两枚绑定同一 `MAP_ID` 的 agent token，以及一枚 viewer token。配置了 owner API key 时，签发 token 的请求也要携带 `X-API-Key`。
- 判定：勾选表示通过；失败时记录实际响应体和状态码。【记录】项没有预设结论，只记录当前行为。

---

## A. 乐观并发与冲突恢复（双浏览器窗口）

- [ ] A1 制造冲突：窗口甲、乙打开同一张图；甲修改并等待保存成功；乙不刷新直接修改另一节点。乙应进入冲突态，不能静默覆盖甲。
- [ ] A2 入口与停止重试：出现“重新加载服务端”和“用本地草稿覆盖”两个动作；floating 顶部面板和 fixed 工具栏均可访问。观察 1 分钟，autosave 不应反复发送失败请求。
- [ ] A3 重新加载：点击“重新加载服务端”后出现放弃本地更改的确认；确认后加载甲的版本，dirty/冲突态清除，历史栈重置，可继续编辑。
- [ ] A4 本地覆盖：重新制造冲突，点击“用本地草稿覆盖”；确认后服务端保存乙的草稿，冲突态清除。甲刷新后看到乙版本属于预期结果。
- [ ] A5 二次冲突：乙确认覆盖后、实际 PUT 前让甲再保存一次。乙若再次收到 412，本地草稿必须保持原样，并可重新选择两个动作。
- [ ] A6 轮询守卫：冲突态持续至少 10 秒，跨越多个 2 秒轮询周期；乙的本地草稿不能被服务端版本替换。
- [ ] A7 切图竞态：让保存请求处于慢响应状态时切到另一张图并编辑；旧请求返回后，新图内容不能被替换，且新图仍会继续保存。

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

- [ ] B1 缺 If-Match：只发送 JSON body，不带三个命令 header → **428 Precondition Required**。If-Match 的缺失检查应优先于 partition/key。
- [ ] B2 陈旧 revision：携带陈旧 `If-Match`，同时带有效 `X-CodeMind-Partition: development` 和新 `Idempotency-Key` → **412**，JSON 含数值 `expectedRevision`、`actualRevision`，响应 ETag 为当前 revision。
- [ ] B3 缺 partition：使用当前 If-Match 和新 key，但去掉 `X-CodeMind-Partition` → **400**，`code=partition_required`。
- [ ] B4 缺 Idempotency-Key：使用当前 If-Match 和 development partition，但去掉 key → **400**，`code=invalid_idempotency_key`。
- [ ] B5 stable 拒写：三个 header 齐全但 partition=stable → **403**，`code=stable_partition_read_only`。
- [ ] B6 幂等重放：使用唯一 key（例如带当前时间的 `manual-replay-*`）把完全相同的请求连续发送两次 → 首次 2xx；第二次响应头含 `X-CodeMind-Idempotent-Replay: true`；revision 只增加一次，节点只创建一个。
- [ ] B7 key 复用冲突：把 B6 的 key 用于不同 title/body → **409**，`code=idempotency_key_reused`。
- [ ] B8 query 进入指纹：创建一个可删除节点；同一 key 先用 `?cascade=true` 删除，再改为 `?cascade=false` 重放 → **409**，不能错误重放第一次结果。
- [ ] B9 失败不缓存：用某 key 发送不存在 parentId 的请求得到 400；修正 parentId 后复用该 key → 可以正常执行，说明失败响应未进入缓存。

## C. Token 与 actor 作用域

签发 token 的字段为 `accessLevel`，不是 `role`：

```bash
curl -s -X POST "$BASE/api/tokens" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $OWNER_API_KEY" \
  -d "{\"mapId\":\"$MAP_ID\",\"accessLevel\":\"editor\",\"actorKind\":\"agent\",\"displayName\":\"test-agent-a\"}"
```

本地未配置 API key 时可去掉 `X-API-Key`。保存返回的 `secret`，它只在创建时出现。

- [ ] C1 agent token：返回体含 `actorKind: "agent"`、`accessLevel: "editor"` 和非空 secret。
- [ ] C2 scoped 读写：在 B 组完整命令信封基础上增加 `Authorization: Bearer {secret}`，调用绑定 `MAP_ID` 的 `get_tree`/节点写接口 → 成功；访问其他 mapId → **403**。Bearer token 不能替代 If-Match、partition 或 idempotency key。
- [ ] C3 scoped list 限制：使用 editor agent token 调用 `GET /api/maps` 或 MCP `list_maps` → **403** 是预期行为，不应误判为 token 失效。
- [ ] C4 viewer 回归：签发 `accessLevel=viewer` token，写节点 → **403**。
- [ ] C5 actor 进入幂等作用域：签发 agent A/B，绑定同一图；A 使用 key `actor-scope-1` 成功写入后，B 使用相同 key、当前 revision 和不同 body 也应成功，而不是 409。说明 key 按 actorId 隔离。
- [ ] C6 身份不可自声明（必须用 REST 直测）：在合法节点请求 body 中加入 `author`、`actor`、`pending` 或 `actorKind` → 这些字段不应出现在保存后的文档，也不能改变 token actor。不要用 MCP 做此项，因为 MCP payload 白名单会先过滤这些字段。

【边界】当前 actor 用于认证和幂等作用域，尚未持久化为文档 author，UI 也没有可见署名。人工验收不要期待 author/changeset 展示。

## D. MCP 端到端（真实 Agent）

配置 `codemind.exe mcp`，环境变量包括：

- `CODEMIND_API_URL=$BASE`
- `CODEMIND_ACCESS_TOKEN={C1 的 agent token}`

在 Agent 提示或项目配置中明确提供 `MAP_ID`。scoped token 无权使用 `list_maps` 发现全部脑图。

- [ ] D1 工具 schema：五个写工具均要求 `expectedRevision`、`partition`、`idempotencyKey`。
- [ ] D2 正常写入：让 Agent 对明确的 `MAP_ID` 先 `get_tree`，再在 development 创建节点 → 成功且画布可见。
- [ ] D3 结构化冲突：Agent 读到 revision 后，人先保存一次，再让 Agent 用旧 revision 写 → tool result 为 `isError=true`，`content[0].text` 可解析为 JSON，含 `error.code=revision_conflict` 和 `error.actualRevision`。
- [ ] D4 Agent 自愈重试：MCP 适配器本身不会自动重试；观察外部 Agent 的工具调用轨迹。D3 后它应重新 `get_tree`、检查目标位置，并复用原 idempotency key 和新 revision 发起重试。协议最多允许 3 次重试，即初次失败后最多再出现 3 次写工具调用；超限应停下询问用户。
- [ ] D5 stable 拒写：让 Agent 明确尝试 partition=stable → 收到 403 语义并停止，不换凭据绕过。
- [ ] D6 MCP 重放：使用 MCP Inspector 或可查看原始参数的客户端，把同一写工具参数（包括相同 revision、partition、key 和 payload）连续调用两次 → 两次均返回首次成功结果，脑图 revision 只增加一次。
- [ ] D7 Agent key 礼仪【记录】：在可查看工具调用参数的宿主中，让 Agent“重试上一条完全相同的写入” → 应复用原 key；再要求执行一条新的逻辑写入 → 应使用新 key。记录实际参数，避免只凭自然语言答复判定。

## E. Git 语义格式与 format CLI

- [ ] E1 确定性：对同一 runtime JSON 分别导出到 `/tmp/m1` 和 `/tmp/m2`，执行 `diff -r /tmp/m1 /tmp/m2` → 零差异。
- [ ] E2 diff 友好：只修改一个节点标题，重新导出到 `/tmp/m3` → `semantic.json` 的差异只涉及该节点对象的 title 行；其他节点、key 顺序和 `layout.json` 不产生无关噪音。
- [ ] E3 纯布局不污染语义：只移动节点、改变尺寸/折叠/关系路由或主题，重新导出 → `semantic.json` 字节不变，差异只在 `layout.json`。
- [ ] E4 往返等价：按 `codemind format import --help` 将 m1 导回 runtime JSON，再次 export → semantic/layout 与 m1 零差异。
- [ ] E5 非法输入拒绝：制造父子环、重复 ID、引用不存在节点或不连续 order → import 报错，不产出损坏 runtime 文档。
- [ ] E6 覆盖回滚：目标输出已存在时不带 `--force` → 拒绝覆盖；模拟第二个文件提交失败 → semantic/layout 原文件均恢复，不留下半组新文件。

## F. 单二进制四模式

- [ ] F1 `codemind.exe` → GUI 正常启动。
- [ ] F2 在终端运行 `codemind.exe serve` → 可看到监听日志，默认 7979 可访问。
- [ ] F3 Claude Code 以 stdio 拉起 `codemind.exe mcp` → 工具可用，且没有额外 GUI/console 窗口干扰协议。
- [ ] F4 `codemind.exe format --help` → 输出 format 用法；export/import 子命令帮助可用。
- [ ] F5 GUI 与 serve 同时指向同一数据目录【记录】：记录是否存在跨进程并发冲突或明确限制；不得只观察“能启动”就判定安全。

## G. 历史回归抽查

- [ ] G1 AI 前置快照：触发一次 AI 改图 → Inspector 出现 AI 快照，Restore 可回滚。
- [ ] G2 手动快照配额：连续制造多次 AI 快照后，最近的手动快照仍保留。
- [ ] G3 sibling order：新建三个兄弟节点 → 保存 → 重载 → 顺序不变。
- [ ] G4 bindings：通过 REST/MCP 写 file/symbol 绑定 → 保存、重载、Git export 后字段无损。
- [ ] G5 UX：折叠动画原位渐隐、注释徽章可点且不误拖、小地图拖拽不跳动。
- [ ] G6 多选剪切粘贴：关系线随粘贴保留，binding ID 会重建且不冲突。

---

## 结果记录

| 日期 | 环境/版本 | 通过 | 失败 | 备注（含【记录】项） |
| ---- | --------- | ---- | ---- | -------------------- |
|      |           |      |      |                      |
