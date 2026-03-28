# 2026-03-28 父节点拖拽联动子节点设置开发总结

## 本轮完成

- 新增本地交互偏好 `interaction.dragSubtreeWithParent`
- 默认值为开启
- 在设置面板中新增对应开关项
- 拖拽节点时，若该设置开启，会把被拖拽父节点的整棵后代子树一起加入拖拽集合
- 处理了多选和父子重复选择，避免同一节点被重复位移

## 行为说明

- 开启时：
  - 拖拽一个有子节点的父节点，后代节点会一起移动
- 关闭时：
  - 仅移动当前直接拖拽的节点，或当前显式选中的节点集合
- 根节点仍然不可拖拽

## 修改文件

- `frontend/src/types.ts`
- `frontend/src/preferences.ts`
- `frontend/src/app.ts`
- `frontend/src/i18n.ts`
- `docs/dev-plan-2026-03-28-drag-subtree-setting.md`

## 验证结果

已执行并通过：

1. `frontend`：`npm run build`
2. 仓库根目录：`npm run build`
3. 仓库根目录：`go test ./...`

## 备注

- 未触碰用户已有未提交文件：`AGENTS.md`、`data/default-map.json`、`docs/open-issues.md` 等。
