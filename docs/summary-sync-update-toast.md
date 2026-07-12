# 同步更新提示修复总结

日期：2026-07-13 ｜ 分支：feat/p1-agent-contract ｜ 版本：1.14.1

## 完成内容

- 将服务端轮询同步提示从“AI 已更新脑图”改为“脑图已从服务端更新”。
- 新增对应英文文案 `Map updated from the server`。
- 保留内置 AI 操作的 AI 专用文案，未改变同步、冲突或渲染逻辑。
- 增加专项测试，确保人工客户端、MCP 或其他服务端来源的更新不会再统一标成 AI。

## 原因

轮询接口当前只表达“服务端文档被 API 修改”，没有返回可靠的 actor 类型。原实现将所有该类变化直接显示成 AI，属于来源误分类，不是单纯中文本地化问题。

## 验证

- `npm test -- --run src/sync/api-sync.revision.test.ts`
- `npm run build`
- 前端全量 Vitest
- 桌面应用 1.14.1 打包
