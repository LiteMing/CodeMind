# 全局开发配置

## 最重要
- Always reply in Chinese. 
- 除非用户明确要求英文，否则所有回复使用简体中文。
- 代码标识符、命令、日志、报错信息保持原始语言；其余解释用中文。
- 如果不小心用英文作答，立即用中文重写同一答案（不要只追加一句中文）

## 核心原则
- **维持质量与一致性** — 彻底执行自动检查
- **事实确认** — 自行确认信息来源，不将猜测作为事实陈述
- **优先现有文件** — 优先编辑现有文件而非创建新文件
- **任务性质确认** — 确认任务是否需要改动代码，如果是计划或技术文档不要动源代码

---

## 通用交互规范

- 用中文回答，优先解决核心问题
- 直接进入 ultrathink 模式，如果分析代码问题和修复bug，启用sequential-thinking
- 如果有思考，请详细说明你的思考过程，再给出答案
- **先验证再判断** — 遇到可疑信息（新闻、声明、技术更新等），必须先用工具（WebFetch/WebSearch）查证事实，再给出结论。禁止"光质疑不验证"或"光分析逻辑不看证据"
- 解决复杂问题前先在联网搜索是否有相似方案参考
- 当需求不明确时先提出 1-2 个关键问题确认细节
- 分析问题背后的问题，预测代码可能导致的隐患
- 当创建或更新 TODO 时向用户展示
- 修复完成要自己做验证测试，递归修复最少 3 轮
- 所有需要用户确定的选项提供交互式选择菜单


---

## ⚠️ 执行环境：Windows（强制规范）

### 核心原则
**文件操作用专用工具，系统命令用 Bash**

### 工具映射表

| 操作 | 使用工具 | 禁止 | 原因 |
|------|---------|------|------|
| 读文件 | Read | cat/head/tail/Get-Content | 专用工具支持分块、编码检测 |
| 搜文件 | Glob | find/ls/Get-ChildItem | 跨平台一致性 |
| 搜内容 | Grep | grep/rg/Select-String | 自动处理权限和编码 |
| 编辑 | Edit | sed/awk | 触发 VSCode diff view |
| 创建 | Write | echo >/cat <<EOF | 保证原子性写入 |
| 系统命令 | Bash | PowerShell/CMD 命令 | Git、npm、docker 等 |

**Bash 仅用于**：git、pnpm、npm、vite、tsc、docker、node 等系统命令

**环境说明**：
- Bash 运行在 `/usr/bin/bash`（Git Bash）
- 不支持 PowerShell 命令（Get-ChildItem、Select-String 等）
- 环境变量使用 Linux 语法（`$PATH` 而非 `%PATH%`）

---

### Windows 特有规则（强制执行）

#### 1. 路径处理规范（必须遵守）

**强制要求**：
- **所有包含空格的路径必须用双引号包裹**
- **所有中文路径必须用双引号包裹**
- **统一使用正斜杠 `/` 作为路径分隔符**（推荐）
- **禁止混用正斜杠和反斜杠**

**正确示例**：
```bash
# ✅ 空格路径
cd "C:/Program Files/nodejs"
git add "src/my file.ts"

# ✅ 中文路径
cd "C:/Users/张三/Documents"
pnpm install --prefix "D:/项目/前端代码"

# ✅ 统一正斜杠
cd C:/Users/X1/Projects/myapp
```

**错误示例**：
```bash
# ❌ 空格路径未加引号
cd C:/Program Files/nodejs

# ❌ 混用路径分隔符
cd C:\Users/张三\Documents

# ❌ 中文路径未加引号
git add src/文件名.ts
```

**特殊字符处理**：
```bash
# 文件名包含特殊字符时必须加引号
git add "src/config&settings.ts"
git commit -m "fix: 更新配置文件"
```

---

#### 2. Git Bash 特性说明

**盘符访问规则**：
- Windows 格式：`C:\Users\X1`
- Git Bash 格式：`/c/Users/X1` 或 `C:/Users/X1`
- `pwd` 命令返回：`/d/Projects/myapp`（自动转换）

**环境变量语法**：
```bash
# ✅ Git Bash 使用 Linux 语法
echo $PATH
export NODE_ENV=production

# ❌ 不要使用 PowerShell 语法
echo $env:PATH  # 无效
```

**工作目录切换**：
```bash
# ✅ 推荐：使用绝对路径 + 正斜杠
cd C:/Users/X1/Projects

# ✅ 可选：Git Bash 盘符格式
cd /c/Users/X1/Projects

# ⚠️ 避免：频繁 cd 会导致工作目录混乱
# 推荐：直接在命令中使用绝对路径
pnpm test C:/Users/X1/Projects/myapp/tests
```

---

#### 3. 命令字符串规范（强制执行）

⚠️ **严禁 HTML 实体编码污染 Bash 命令**

**核心要求**：
- **Bash 命令中绝对不能出现 HTML 实体编码**（如 `&amp;` `&lt;` `&gt;` `&quot;` 等）
- **所有传递给 Bash 工具的参数必须是纯文本格式**
- **使用 Bash 原生转义方式（引号、反斜杠）而不是 HTML 编码**

**错误示例**：
```bash
# ❌ HTML 实体编码导致语法错误
cd "F:/Tests/month-report" &amp;&amp; node -e "console.log('test')"
# 报错：syntax error near unexpected token `;&'

# ❌ 其他 HTML 实体也会导致问题
git add . &amp;&amp; git commit -m &quot;fix bug&quot;
# Bash 无法识别 &quot;

# ❌ 特殊字符被错误编码
ls -la | grep &lt;pattern&gt;
# &lt; 和 &gt; 不是 Bash 的重定向符号
```

**正确示例**：
```bash
# ✅ 使用正确的 Bash 运算符
cd "F:/Tests/month-report" && node -e "console.log('test')"

# ✅ 使用 Bash 双引号包裹含空格的字符串
git add . && git commit -m "fix bug"

# ✅ 使用 Bash 原生重定向符号
ls -la | grep "<pattern>"
```

**常见错误来源与预防**：

| 错误来源 | 表现形式 | 预防措施 |
|---------|---------|---------|
| 从网页复制命令 | `&amp;` `&lt;` `&gt;` | 粘贴前检查，使用纯文本编辑器中转 |
| 富文本编辑器 | 自动转义特殊字符 | 使用 VS Code、Notepad++ 等代码编辑器 |
| 工具/框架自动编码 | 命令参数被 HTML 转义 | 检查工具配置，关闭自动转义 |
| 从日志/报告复制 | HTML 格式的错误信息 | 从终端或纯文本日志中复制 |

**特殊字符处理对照表**：

| 场景 | 错误写法（HTML） | 正确写法（Bash） |
|------|----------------|----------------|
| 逻辑与 | `command1 &amp;&amp; command2` | `command1 && command2` |
| 重定向输入 | `program &lt; input.txt` | `program < input.txt` |
| 重定向输出 | `program &gt; output.txt` | `program > output.txt` |
| 引号包裹 | `echo &quot;hello&quot;` | `echo "hello"` |
| 管道符 | `ls &brvbar; grep txt` | `ls | grep txt` |

**调试建议**：

如果遇到类似 `syntax error near unexpected token` 的错误：

1. **检查命令字符串**：查找是否包含 `&amp;` `&lt;` `&gt;` 等 HTML 实体
2. **验证来源**：确认命令是从纯文本源复制的，而非网页或富文本
3. **手动校正**：将所有 HTML 实体替换为对应的 Bash 字符
   - `&amp;` → `&`
   - `&lt;` → `<`
   - `&gt;` → `>`
   - `&quot;` → `"`
4. **使用专用工具检查**：可用 `echo` 命令验证字符串内容

**示例验证命令**：
```bash
# 验证命令字符串是否包含 HTML 实体
echo 'cd "F:/Tests" &amp;&amp; node -e "test"' | grep -o '&[a-z]*;'
# 如果有输出，说明存在 HTML 实体编码

# 正确的命令应该不包含任何 HTML 实体
echo 'cd "F:/Tests" && node -e "test"' | grep -o '&[a-z]*;'
# 无输出，说明是纯 Bash 命令
```

---

#### 4. 换行符设置（推荐配置）

Windows 使用 CRLF，Linux 使用 LF，Git 自动转换可能导致问题。

**推荐配置**：
```bash
# 自动转换：检出时 LF→CRLF，提交时 CRLF→LF
git config --global core.autocrlf true

# 检查当前设置
git config --global core.autocrlf
```

**影响范围**：
- Git diff 显示（避免"整个文件被修改"的假象）
- ESLint、Prettier 等工具的换行符检查
- 部署到 Linux 服务器的兼容性

---

#### 5. 大小写敏感性警告

⚠️ **Windows 文件系统不区分大小写，但 Linux 区分**

**常见问题**：
```typescript
// ❌ Windows 能跑，Linux 会报错
import { MyComponent } from './mycomponent'  // 实际文件名：MyComponent.tsx

// ✅ 严格匹配文件名大小写
import { MyComponent } from './MyComponent'
```

**检查建议**：
- 保持 import 路径与实际文件名大小写完全一致
- 部署前在 WSL 或 Docker 中测试
- 使用 ESLint 插件：`eslint-plugin-import`（检查路径大小写）

---

#### 6. 工具依赖检查

**首次使用前验证**：
```bash
# 检查必需工具
git --version && pnpm --version && node --version

# 检查 Git Bash 环境
which bash  # 应返回：/usr/bin/bash
```

**常见依赖问题**：
- Git 未安装 → [下载 Git for Windows](https://git-scm.com/download/win)
- pnpm 未安装 → `npm install -g pnpm`
- Node.js 版本过低 → 使用 nvm-windows 管理版本

---

### 文件修改工作流（必须遵守）

修改现有文件时，**严格**按以下顺序操作：

1. **先用 Read 读取文件**（获取当前内容，必需步骤）
2. **使用 Edit 工具修改**（触发 VSCode diff view）
3. **禁止用 Write 覆盖现有文件**（除非创建新文件）

**原因**：
- Edit 工具会在 VSCode 中显示修改前后的对比界面
- 方便用户审查更改，避免误操作
- Read 是 Edit 的前置条件，否则会报错

**错误做法**：
```bash
# ❌ 直接用 Write 覆盖现有文件
Write(file_path="src/App.tsx", content="...")

# ❌ 没有先 Read 就 Edit
Edit(file_path="src/App.tsx", old_string="...", new_string="...")
```

**正确做法**：
```bash
# ✅ 先 Read 再 Edit
Read(file_path="src/App.tsx")
Edit(file_path="src/App.tsx", old_string="...", new_string="...")

# ✅ 创建新文件可以直接 Write
Write(file_path="src/NewComponent.tsx", content="...")
```

---

### 常见问题与解决方案

#### Q1: pnpm link 失败提示权限错误？
**原因**：Windows 创建符号链接需要管理员权限或开发者模式

**解决方案**：
1. 开启 Windows 开发者模式：
   - 设置 → 更新和安全 → 开发者选项 → 开启"开发人员模式"
2. 或使用管理员权限运行终端

---

#### Q2: PowerShell 脚本被阻止执行？
**原因**：某些工具（nvm、fnm）可能调用 PowerShell 脚本

**解决方案**：
```powershell
# 在 PowerShell 中执行（仅需一次）
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

#### Q3: WSL 环境支持吗？
**说明**：当前配置针对 **Git Bash**，不支持 WSL

**WSL 环境差异**：
- 路径格式：`/mnt/c/Users/张三`（而非 `/c/Users/张三`）
- 文件权限：需要设置 `metadata` 支持
- 工具安装：需要在 WSL 内部重新安装 Node.js、pnpm 等

**如需 WSL 支持**：需要单独配置，暂不在此规范范围内

---

#### Q4: 路径中包含 `()` 等特殊字符？
**解决方案**：统一用双引号包裹
```bash
# ✅ 正确
cd "C:/Program Files (x86)/nodejs"
git add "src/utils(deprecated).ts"
```

---

#### Q5: Git 报告 "LF will be replaced by CRLF" 警告？
**说明**：这是 `core.autocrlf` 自动转换的正常提示，可忽略

**关闭警告**（不推荐）：
```bash
git config --global core.safecrlf false
```

---

#### Q6: 命令报错 "syntax error near unexpected token"？
**原因**：命令字符串包含 HTML 实体编码（如 `&amp;&amp;` 而不是 `&&`）

**典型错误信息**：
```
/usr/bin/bash: eval: line 37: syntax error near unexpected token `;&'
/usr/bin/bash: eval: line 37: `cd "F:/Tests" &amp;&amp; node -e "'
```

**解决方案**：

1. **检查命令来源**：确认是否从网页、富文本编辑器或 HTML 日志复制
2. **识别 HTML 实体**：查找 `&amp;` `&lt;` `&gt;` `&quot;` 等字符
3. **手动替换为 Bash 字符**：
   ```bash
   # 错误：&amp;&amp;
   cd "F:/Tests" &amp;&amp; node -e "test"
   
   # 正确：&&
   cd "F:/Tests" && node -e "test"
   ```

4. **使用纯文本编辑器**：通过 VS Code 或 Notepad++ 中转命令
5. **参考规范**：查看 "命令字符串规范" 章节的完整对照表

**快速验证**：
```bash
# 检查是否包含 HTML 实体
echo '你的命令' | grep -o '&[a-z]*;'
# 有输出 = 存在问题，无输出 = 正常
```

---

  ## 网络访问策略（强制执行）

  ### 工具优先级（按顺序尝试）

  **标准访问**（默认优先）：
  1. `WebFetch` — 获取网页内容并分析
  2. `WebSearch` — 搜索引擎查询

  **网络受限时的备选方案**：
  当 WebFetch/WebSearch 返回网络错误（403、超时、连接失败）时，**必须立即**切换到 MCP 代理工具：

  1. `mcp__mcp-router__fetch_markdown` — 获取网页（Markdown 格式）
  2. `mcp__mcp-router__fetch_html` — 获取网页（HTML 格式）
  3. `mcp__mcp-router__fetch_txt` — 获取网页（纯文本）
  4. `mcp__mcp-router__fetch_json` — 获取 JSON 数据

  **终极备选方案**：
  当 MCP 代理工具也失败时，使用浏览器自动化：

  - `Playwright 无头模式` — 模拟真实浏览器访问（可绕过反爬、JS 渲染、登录验证）
    - 使用 `browser_navigate` 访问目标 URL
    - 使用 `browser_snapshot` 或 `browser_take_screenshot` 获取内容
    - 适用场景：需要 JS 渲染、有反爬机制、需要模拟用户行为

  ### 强制重试流程

  遇到网络错误时，**严格**按以下顺序重试：

  ```text
  1. 尝试 WebFetch/WebSearch
     ↓ (失败)
  2. 立即切换到 mcp__mcp-router__fetch_markdown
     ↓ (失败)
  3. 尝试 mcp__mcp-router__fetch_html
     ↓ (失败)
  4. 启动 Playwright 无头模式获取页面
     ↓ (失败)
  5. 告知用户网络问题，提供替代方案
  ```

  ### 禁止行为

  - ❌ 遇到网络错误就放弃，不尝试备用工具
  - ❌ 只告诉用户"访问不了"而不尝试其他方法
  - ❌ 跳过重试流程直接让用户提供内容
  - ❌ 在 MCP 工具失败后不尝试 Playwright 就放弃

  ### 示例

  **错误做法**：
  ```
  我：尝试 WebFetch → 403 错误
  我：哎呀访问不了，你把内容发我吧！❌
  ```

  **正确做法（标准流程）**：
  ```
  我：尝试 WebFetch → 403 错误
  我：切换到 mcp__mcp-router__fetch_markdown → 成功 ✅
  ```

  **正确做法（终极流程）**：
  ```
  我：尝试 WebFetch → 403 错误
  我：切换到 mcp__mcp-router__fetch_markdown → 超时
  我：切换到 mcp__mcp-router__fetch_html → 超时
  我：启动 Playwright 无头浏览器 → 成功获取内容 ✅
  ```

---


## 特定场景规则

### Playwright 自动化注意事项

- **空白页 Bug**：频繁使用 `browser_tabs` 创建新标签页会导致空白页累积
  - 优先在当前页面操作，避免频繁开新标签
  - 测试完成后及时关闭不需要的标签页
  - 必要时使用 `browser_navigate` 在同一标签内切换

- **页面刷新优先**：测试页面功能时多用刷新代替跳转
  - 使用 `page.reload()` 或 `browser_navigate` 到当前 URL 刷新
  - 避免频繁使用 `browser_navigate` 跳转到新 URL
  - 刷新可保持页面状态，跳转可能导致回溯

- **交互式元素**：某些模块需要用户交互才会激活
  - 下拉菜单、弹窗等需要先 `browser_click` 触发
  - 懒加载内容需要滚动或点击才会渲染
  - 动态加载的元素要用 `browser_wait_for` 等待出现

- **页面回溯问题**：频繁跳转会导致浏览器历史混乱
  - 尽量在单页面内完成测试流程
  - 需要切换场景时考虑用标签页而非历史跳转
  - 避免依赖浏览器后退按钮进行导航

### 缩写解释

用户可能使用以下缩写进行快速交互：

- `y` = 是 (Yes)
- `n` = 否 (No)
- `c` = 继续 (Continue)
- `r` = 确认 (Review)
- `u` = 撤销 (Undo)

---

## 执行规则

### 立即执行（无需确认）

- **代码操作**：Bug 修复、重构、性能改进
- **文件编辑**：现有文件的修改与更新
- **文档**：README、规范文档的更新（仅在要求时创建新文档）
- **依赖关系**：包的添加、更新与删除
- **测试**：单元测试与集成测试的实现（遵循 TDD 周期）
- **设置**：配置值更改、应用格式化

### 必须确认

- **创建新文件**：说明必要性并确认
- **删除文件**：重要文件的删除
- **结构变更**：架构、文件夹结构的大规模变更
- **外部集成**：新 API、外部库的引入
- **安全**：认证与授权功能的实现
- **数据库**：schema 变更、迁移
- **生产环境**：部署设置、环境变量变更

---

## 执行流程

```text
1. 接收任务
   ↓
2. 判断立即执行或请求确认
   ↓
3. 执行（遵循现有模式）
   ↓
4. 完成报告
```

---

## 异常处理与透明度

### TodoList 执行连续性

**严格禁止**：TodoList 未执行完就突然停止输出且不给出原因

**必须遵守的规则**：
- **完整执行**：创建的 TodoList 必须全部执行完成或明确说明停止原因
- **透明沟通**：任何中断都必须明确告知用户原因
- **异常说明**：遇到错误、阻塞、不确定性时必须立即说明
- **进度可见**：执行过程中定期更新 TodoList 状态，让用户看到进展
- **中断确认**：如果需要停止执行，必须先向用户说明原因并征求意见

### 强制报告要求

每次执行 TodoList 时：
- **开始前**：展示完整任务列表
- **执行中**：每完成一项立即标记为 completed
- **遇到问题**：立即说明，不能跳过或静默失败
- **执行后**：确认所有任务状态，总结完成情况

### 禁止行为

- ❌ 执行到一半突然停止不说话
- ❌ 遇到错误不报告直接跳过
- ❌ 静默失败假装任务完成
- ❌ 改变计划不通知用户
- ❌ 卡住不动也不说明原因

---

## 上下文管理

### 纯任务隔离

将复杂任务分解为"只关注结果的纯任务"，独立执行以保持主上下文的清洁。

- **纯任务示例**：Bug 修复、测试执行、代码生成
- **上下文清理**：当大型工作导致上下文增长时，建议使用 `/compact` 命令

---

## 开发方法

### TDD 周期

开发时遵循测试驱动开发 (TDD) 周期：

1. **Red(失败)**
   - 编写最简单的失败测试
   - 测试名称明确描述行为
   - 确保失败消息易于理解

2. **Green(成功)**
   - 实现通过测试的最小代码
   - 此阶段不考虑优化和美观
   - 专注于让测试通过

3. **Refactor(改进)**
   - 仅在测试通过后进行重构
   - 消除重复，明确意图
   - 每次重构后执行测试

### 实现方法

- 从最简单的情况入手，优先让代码运行
- 发现重复立即消除，编写意图明确的代码
- 完成基本逻辑后逐步补充边缘情况
- 每步完成后务必执行测试

---

## 质量保证

- 遵守单一职责原则，通过接口实现松耦合
- 消除重复代码，立即抽象重复逻辑
- 继承现有代码风格，保持命名规则统一
- 文档与代码同步更新
- 禁止硬编码：魔术数字、URL、路径都应参数化或配置化
- 无法执行时提供 3 个替代方案，可部分执行时优先处理可行部分
- 修复完成要自己做验证测试，递归修复最少 3 轮

---

## 执行示例

- **Bug 修复**：发现 `TypeError` → 立即修正类型错误
- **重构**：检测到重复代码 → 提取为共通函数
- **DB 变更**：需要更新架构 → 确认请求「是否变更表结构？」

---

## 持续改进

- 检测新模式 → 立即学习和应用
- 反馈 → 自动反映到下次执行
- 最佳实践 → 随时更新
