# 2026-06-26 审查修复与同步/白板可行性计划

## 目标

- 新建独立修复分支，处理本轮代码审查发现的安全、数据一致性、安装脚本和缓存目录问题。
- 针对 1GB 日本 VPS 多设备同步、轻量白板模式给出可行性意见，不在本轮直接实现大功能。

## 子任务拆分

- 后端安全：收紧 `/api/settings` 认证、限制分享 token 的 map 访问范围、收敛 CORS。
- 后端数据一致性：删除节点时同步清理无效关系线和分支目标。
- 持久化与缓存：避免轮询接口刷新 `LastOpenedAt` 并写盘；固定 Windows WebView2 缓存目录到 LocalAppData，减少 Roaming 重复缓存。
- 前端安全：转义持久化 ID 写入的 `data-*` 属性，降低异常 ID 造成的 HTML 注入风险。
- 工程脚本：修复根目录 `prepare` 脚本缺少 `husky` 依赖的问题。
- 验证：运行 Go 测试、前端测试/构建、VS Code 扩展编译。

## 技术方案

- 认证中间件增加 owner API key 校验复用函数；`/api/settings` 在 key 已配置时必须提供有效 key，未配置时允许初始化。
- REST token 请求解析 `/api/maps/{mapId}`，非 owner token 只能访问自身 `MapID`，并禁止枚举全量 map 列表。
- 删除节点和 batch 删除提交前统一裁剪引用不存在节点的 relation 及 branch。
- `FileStore` 增加只读加载方法，轮询和版本接口使用只读加载，避免周期性写回。
- Windows 桌面端设置 `WebviewUserDataPath` 到 `%LOCALAPPDATA%\CodeMind\WebView2`，业务数据继续保存在 `%APPDATA%\CodeMind\data`。
- 前端模板中持久化 ID 使用 `escapeAttribute`，后端文档 ID 增加安全字符校验，阻止带引号/尖括号/斜杠等危险 ID 入库。
- 根 `package.json` 增加 `husky` devDependency 并更新 lockfile。

## 可行性研究范围

- VPS 同步只评估架构、资源预算、协议选择和最小可行版本。
- 白板模式只评估数据模型、交互边界、开源参考方向和与脑图文件并列存储的可行性。

