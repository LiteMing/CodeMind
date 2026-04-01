# 2026-04-01 父子水平间距配置计划

## 目标

- 修复自动生成节点与自动整理布局后，父子连线水平距离偏长的问题。
- 在保持“避开宽度延展父节点”的前提下，缩短默认父子水平间距。
- 将父子水平间距暴露为设置项，便于后续按偏好调整。

## 任务拆分

1. 布局参数抽象
   - 将 `document.ts` 中固定的水平间距常量改为参数化配置
   - 让自动创建和自动整理共用同一参数
2. 设置接入
   - 为 `appearance` 增加父子水平间距字段
   - 在设置面板新增可编辑项与中英文文案
3. 行为联动
   - 设置修改后即时重新整理层级布局
   - AI 生成子节点/同级节点时沿用当前配置
4. 交付验证
   - 构建前端
   - 运行 Go 测试
   - 升级版本并重新打包桌面端

## 技术方案

- `frontend/src/document.ts`
  - 为 `nextChildPosition(...)`、`nextSiblingPosition(...)`、`autoLayoutHierarchy(...)` 增加 `childGapX` 参数
  - `resolveRelativeChildColumnEdge(...)` 改为基于该配置计算子节点列边缘
- `frontend/src/types.ts`
  - 在 `AppearanceSettings` 中增加 `childGapX`
- `frontend/src/preferences.ts`
  - 默认值下调到较短距离，并增加归一化函数
- `frontend/src/app.ts`
  - 所有自动创建/自动整理入口传入 `appearance.childGapX`
  - 设置变化时即时触发重排
