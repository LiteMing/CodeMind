# Git 格式 Golden 换行修复总结

日期：2026-07-14 ｜ 分支：main

## 完成内容

- 在 `.gitattributes` 中将 `internal/mindmap/testdata/gitformat/*.json` 固定为 `eol=lf`。
- 重新检出四份格式契约 fixture，消除 Windows CRLF 与 canonical LF 的伪差异。
- 保留全字节 golden 比较，没有将测试降级为换行归一化后比较。

## 验证

- `git ls-files --eol internal/mindmap/testdata/gitformat/*.json`：工作区均为 LF。
- `go test ./...`：通过。
