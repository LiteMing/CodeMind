# P1 Phase B：节点代码绑定与显式顺序开发总结

日期：2026-07-10 ｜ 分支：feat/p1-node-code-order ｜ 版本：1.12.0

## 完成内容

- Go/TypeScript 节点契约新增 `order` 与 `bindings[]`；binding 支持 `file | directory | glob | symbol | asset`。
- binding ID 在整张脑图内唯一；服务端统一规范化 `/` 路径并拒绝绝对路径、盘符、UNC、控制字符和 `..`。
- `symbol` / `glob` 类型增加必填与互斥验证，bindings 可通过 PATCH 整组替换或传 `[]` 清空。
- 有父级节点使用从 1 开始、同一父级连续唯一的 sibling order；root 和 parentless floating 使用 0。
- 旧文档缺少 order 时按 `position.y -> position.x -> id` 稳定迁移；已有有效 order 不受坐标拖动影响。
- REST node create/update/delete、batch、import-fragment、node detail、full tree 和 compact 响应全部接入新契约。
- 节点 PATCH 支持通过 `parentId + order` 移动和插入；创建默认追加，删除后自动压紧。
- 非级联删除会在原位置提升直接子节点；parentless floating 的子节点提升后转为 parentless floating。
- MCP create/update/batch/import schema 和 payload 支持 order/bindings/parentId；VS Code 类型同步扩展。
- 桌面前端覆盖旧文档归一化、手动/AI/模板创建、拖拽重挂、切断层级、删除提升和复制粘贴。
- 复制节点时会重建 binding ID，避免违反全图唯一约束；树布局与 3D sibling 计算统一按 order。
- API、平台、README 和 VS Code 使用文档已更新。

## 验证结果

- `go test ./...`：通过。
- Go 新增模型、FileStore 迁移、REST CRUD/order/binding、fragment 和删除提升专项测试。
- `cd frontend && npm test`：16 个测试文件，227 通过、2 跳过。
- `cd frontend && npm run lint`：通过。
- `cd frontend && npm run build`：通过。
- `cd vscode-extension && npm run compile`：通过。
- verifier 最终审查：无阻断或中级问题，`git diff --check` 通过。
- 打包前端口 `34117`、`34118`、`7979` 均空闲。
- `npm run build:desktop`：通过，生成 `build/bin/CodeMind-1.12.0.exe`。
- Windows 资源校验：ProductVersion=`1.12.0`，FileVersion=`1.12.0.0`，大小 `12,362,240` 字节。

## 设计边界

- 本阶段只建立绑定字段、验证、迁移和接口契约，不扫描仓库、不执行 Git rename-follow。
- 没有增加 binding 编辑 UI；当前由 REST/MCP/未来稳定区生成器写入，桌面端负责无损保存和复制安全。
- `meta.version` 仍为 schema version 1，语义/布局双文件拆分留到 Phase C。
- order 是确定性语义顺序，不取代 position；坐标仍负责画布布局。

## 遗留风险

- VS Code 尚无自动化测试直接断言 `cascade=false` 查询参数；源码复核和 TypeScript compile 已通过，风险低。
- 非 Code Mind 客户端若直接构造完整 JSON，仍应先读取当前 revision，并遵守 binding ID 全图唯一与连续 order 约束。

## 后续

进入 Phase C：Git 语义格式。实现语义/布局转换器、稳定序列化、golden fixtures 与 Git 友好的确定性文件结构，为稳定区物化和云端 Git 分支工作流奠定格式基础。
