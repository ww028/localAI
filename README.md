# localAI

localAI 是一个本地优先的 Chrome 个人 AI 助手插件。它调用 Chrome Built-in AI，在浏览器内完成对话、网页阅读、本地知识库问答、个人记忆和轻量任务处理。

技术架构、模块边界、数据流和完整自测说明请看：[localAI Chrome 插件技术架构与功能自测](docs/localai-extension-overview.md)。

如果 README 和该文档存在内容冲突，以 `docs/localai-extension-overview.md` 为准。

## 核心能力

### 本地 AI 对话

- 使用 Chrome `LanguageModel` 在浏览器本地生成回答。
- 默认中文界面，支持中英文切换。
- 支持 Markdown 渲染，包括列表、代码块和表格。
- 支持历史会话保存和恢复。

### 多入口使用

- Toolbar popup：适合快速提问。
- Chrome side panel：适合边浏览网页边使用。
- 新标签页：适合长对话和复杂任务。

### 本地知识库

- 支持导入 `.md` 和 `.txt` 文件。
- 支持多个知识空间，例如个人资料、项目资料、专题资料。
- 本地切分 chunk、生成 embedding、检索和 rerank。
- 回答中展示引用来源。
- 点击引用可以查看对应 chunk 原文。
- 支持重建当前知识空间索引。

### 个人记忆

- 可以输入 `记住 ...` 保存个人偏好、长期事实、项目约定或任务状态。
- 可以输入 `忘记 ...`、`忘掉 ...` 删除相关记忆。
- 输入区提供“个人记忆”入口，可查看、编辑、删除和导出记忆。
- 回答时只注入与当前问题相关的少量记忆。

### 当前网页助手

- 读取当前网页正文。
- 支持网页摘要。
- 支持基于当前网页问答。
- 支持从网页提取待办。
- 支持把网页整理成笔记。
- 支持将当前网页保存到当前知识空间。

### 输入区轻量动作

点击输入区左侧 `+` 可以使用：

- 摘要文本
- 中英互译
- 写作
- 润色改写

翻译会自动判断方向：中文默认翻译为英文，英文默认翻译为中文。专用 API 不可用时，会自动退回 Prompt API。

### 任务助手

localAI 已具备任务助手的基础链路：

- 意图识别：输出结构化 intent。
- 计划器：输出可执行步骤和需要的工具。
- 确定性执行：计算、排序、格式转换不交给模型猜。
- 模型润色：Chrome 内置模型只负责解释和表达。
- 任务状态：保存 `queued`、`checking`、`creating-session`、`downloading`、`running`、`failed`、`completed`。
- 继续任务：失败任务可以回到会话后继续执行。

## 安装和运行

### 环境要求

- Node.js 20 或更新版本。
- Chrome Canary，或启用了相关 Chrome Built-in AI API 的 Chrome 版本。
- Chrome 中已配置必要的 Built-in AI flags 和模型资源。

常用 Chrome 页面：

- `chrome://flags/`
- `chrome://on-device-internals/`
- `chrome://extensions/`

Chrome Built-in AI API 仍处于实验阶段，可用性会受到 Chrome 版本、渠道、flags、平台支持和模型下载状态影响。

### 本地开发

安装依赖：

```bash
npm install
```

启动 Vite 开发服务：

```bash
npm run dev
```

这适合做 UI 开发。若要验证真实插件行为，需要构建后在 Chrome 中加载 `dist/`。

### 加载插件

构建插件：

```bash
npm run build
```

然后在 Chrome 中操作：

1. 打开 `chrome://extensions/`。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择本仓库生成的 `dist/` 目录。
5. 从浏览器工具栏打开 `localAI`。

## 使用说明

### 普通对话

1. 打开插件。
2. 在输入框输入问题。
3. 点击发送按钮。
4. 等待本地模型回复。

可测试：

```text
你能做什么？
帮我规划一下今天的工作
```

### 使用个人记忆

保存记忆：

```text
记住 我的回答风格偏好是简洁直接
```

删除记忆：

```text
忘掉回答风格偏好
```

查看和管理记忆：

1. 点击输入区的“个人记忆”。
2. 查看记忆列表。
3. 可编辑、删除或导出记忆。

### 使用知识库

1. 点击输入区的“浏览器知识”。
2. 选择或新建知识空间。
3. 导入 `.md` 或 `.txt` 文件。
4. 输入和文档相关的问题。

可用测试文档：

- [examples/localai-knowledge-demo.md](examples/localai-knowledge-demo.md)
- [examples/knowledge-retrieval-eval.json](examples/knowledge-retrieval-eval.json)

可测试：

```text
localAI 是否会上传我的文档？
为什么 popup 关闭后 AI 还能继续运行？
localAI 当前支持哪些知识库文件格式？
本地知识库如何使用 embedding 检索？
```

回答底部如果出现 `[1] 文档名`，点击后可以查看引用 chunk。

### 使用当前网页助手

1. 打开任意普通网页。
2. 打开 localAI。
3. 点击“当前网页”。
4. 选择摘要、问网页、待办、笔记或保存到知识库。

可测试：

- 点击“摘要”，应生成网页摘要。
- 输入问题后点击“问网页”，应基于当前网页回答。
- 点击“待办”，应从网页中提取行动项。
- 点击“保存到知识库”，当前知识空间文件数量应增加。

### 使用轻量文本动作

1. 在输入框输入文本。
2. 点击 `+`。
3. 选择摘要文本、中英互译、写作或润色改写。

可测试：

```text
测试
test
今天是个好日子
写一段介绍 localAI 的短文
```

### 使用确定性任务

localAI 会先识别任务类型，再用确定性程序处理适合程序执行的任务。

可测试：

```text
计算 (12 + 30) / 2
合计 1, 2, 3
20 占 50 的百分比
把 3, 1, 20 从小到大排序
转成表格：name=Alice, age=18; name=Bob, age=20
转成 JSON：name=Alice, age=18; name=Bob, age=20
```

这些任务的核心结果由程序计算、排序或转换，模型只负责解释和润色。

### 恢复和继续任务

1. 发送一个任务。
2. 关闭 popup。
3. 重新打开插件。
4. 应恢复最近会话和任务状态。
5. 如果任务失败，会出现“继续任务”按钮。
6. 点击后会使用保存的任务 payload 重新提交。

## 常用脚本

```bash
npm run dev        # 启动本地开发服务
npm run build      # 类型检查并生成可加载的插件构建产物
npm run build:extension
npm run preview    # 预览生产构建
npm run typecheck  # 仅运行 TypeScript 检查
npm test           # 运行最小回归测试
npm run test:prompt
npm run test:intent
npm run test:planner
npm run test:executor
```

## 给开发同学

README 只保留功能介绍和使用说明。技术实现请优先看：

- [localAI Chrome 插件技术架构与功能自测](docs/localai-extension-overview.md)
- [Chrome Built-in AI Notes](docs/chrome-built-in-ai.md)
- [知识库检索评测](docs/knowledge-retrieval-evaluation.md)

如果文档之间出现冲突，以 [docs/localai-extension-overview.md](docs/localai-extension-overview.md) 为准。

## 当前限制

- Chrome Built-in AI 依赖浏览器版本、flags、平台支持和模型下载状态。
- offscreen 中某些专用 API 可能不可用，当前会用 Prompt API 兜底。
- 默认 embedding 是本地 feature-hash 向量，不是真正的神经网络语义向量。
- 知识库导入暂时只支持 `.md` 和 `.txt`。
- 意图识别当前主要是规则识别，复杂表达可能分类不准。
- 任务状态 UI 还是轻量状态条，尚未做完整任务卡片。

## 下一步

下一阶段按 `todo.md` 的迭代 6 推进：

- 任务卡片 UI
- 计划步骤状态展示
- 失败任务详情
- 端到端手测清单
- 清理 `document.execCommand` fallback
