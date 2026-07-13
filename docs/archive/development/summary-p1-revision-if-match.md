# P1 Phase A：Revision 与 If-Match 开发总结

日期：2026-07-10 ｜ 分支：feat/p1-map-agent-contract ｜ 版本：1.11.0

## 完成内容

- 文档元数据新增单调递增的 `revision`，与 schema `version` 分离；旧文件缺失 revision 时按 `1` 兼容读取。
- FileStore 新增原子 `SaveIfRevision` / `DeleteIfRevision`，revision 比较与写盘位于同一临界区。
- 相同 expected revision 的并发保存最多一个成功，失败方得到包含 expected/actual 的 conflict error。
- 所有已有脑图写接口强制 `If-Match`：整图保存、重命名、删除、节点增删改、batch、import-fragment。
- 缺少 If-Match 返回 428，非法 ETag 返回 400，陈旧 revision 返回 412，并附当前 ETag。
- map、nodes、node detail、tree、version、poll 等读取响应输出 ETag；列表/tree/node detail JSON 暴露 revision。
- 桌面前端保存、重命名、删除和 AI 整图落库自动携带 revision；冲突时保留本地 dirty 文档并提示服务端 revision。
- MCP 五个写工具新增必填 `expectedRevision`，成功结果统一返回 `{revision, result}`。
- VS Code 插件增加 revision 缓存、`/version` 回退读取、If-Match 写入和 412 刷新提示。
- CORS 放行 `If-Match` 并暴露 `ETag`，API 与 MCP 使用文档同步更新。

## 验证结果

- `go test ./...`：通过。
- `cd frontend && npm test`：15 个测试文件，220 通过、2 跳过。
- `cd frontend && npm run lint`：通过。
- `cd frontend && npm run build`：通过。
- `cd vscode-extension && npm run compile`：通过。
- 临时独立数据目录 HTTP 集成：create=`201/rev-1`，save=`200/rev-2`，stale save=`412/rev-2`。
- `npm run build:desktop`：通过，生成 `build/bin/CodeMind-1.11.0.exe`，Windows 资源与 ProductVersion 校验通过。

## 设计边界

- `meta.version` 仍为 schema version 1；本阶段没有开始语义/布局格式拆分。
- revision 是中心 FileStore 的持久版本，不替代未来 CRDT/OpLog；它先承担异步协作和软锁前的冲突门。
- 冲突不会自动合并。桌面端保留本地草稿，Agent/VS Code 必须重新读取后再决定重试内容。
- 新建脑图不要求 If-Match；删除整张脑图返回的是删除前匹配到的最后 revision。

## 后续

进入 Phase B：节点代码绑定与显式 sibling order，为 Git 语义格式和稳定区程序化物化提供字段基础。
