# localAI

localAI 是一个本地优先的 Chrome 个人 AI 助手插件。它调用 Chrome Built-in AI，在浏览器内完成对话、当前网页处理、本地知识库问答、个人记忆、轻量文本动作、确定性任务处理和数据备份。

localAI 不是互联网搜索工具，模型本身不会联网搜索网页、新闻、价格、天气或外部数据库。回答依据来自用户当前输入、当前网页正文、用户导入的知识库、用户保存的个人记忆、最近会话上下文和项目内置使用说明。

技术架构、模块边界、数据流和完整自测说明请看：[localAI Chrome 插件技术架构与功能自测](docs/localai-extension-overview.md)。

如果 README 和该文档存在内容冲突，以 `docs/localai-extension-overview.md` 为准。

## 核心能力

### 本地 AI 对话

- 使用 Chrome `LanguageModel` 在浏览器本地生成回答。
- 根据浏览器语言初始化界面，支持中英文切换，并会记住用户选择。
- 支持 Markdown 渲染，包括标题、列表、代码块和表格。
- 支持历史会话保存、恢复和切换。
- 支持复制回答、重新回答和下载回答为 Word `.doc` 文件。

### 多入口使用

- Toolbar popup：适合快速提问。
- Chrome side panel：适合边浏览网页边使用。
- 新标签页全屏模式：适合长对话、知识库问答和集中整理。
- 全屏模式提供左侧历史侧边栏，支持展开、收起、搜索历史话题和新建对话。
- 侧边栏模式会提示用户可手动拖宽 Chrome side panel。

### 上下文策略

localAI 使用 `ContextPlan` 控制上下文选择，避免模型随意混用信息：

- 识别用户是在问自己、问某个对象、问知识库内容、还是普通问题。
- 区分个人记忆的推理上下文和 UI 来源展示。
- 个人记忆命中时优先使用用户保存的事实，并把记忆中的第一人称自然转换为面向用户的表达。
- 知识库命中时按本地资料回答，并展示引用来源。
- 回答正文会清理模型生成的“引用来源 / Sources”段落，来源统一由 UI Chip 展示。

### 内置使用说明知识库

- 项目内置用户手册位于 [`src/knowledge/localai-usage.zh.md`](src/knowledge/localai-usage.zh.md)。
- 当用户询问“使用说明”“这个 AI 怎么用”“有什么功能”等问题时，会自动把该文档作为内置知识源注入回答链路。
- 内置说明文档不依赖用户导入，也不会写入用户的 IndexedDB 知识库。

### 本地知识库

- 支持导入 `.md` 和 `.txt` 文件。
- 支持多个知识空间，例如个人资料、项目资料、专题资料。
- 本地切分 chunk、生成 embedding、检索和 rerank。
- 回答中展示引用来源，点击引用可以查看对应 chunk 原文。
- 支持重建当前知识空间索引。
- 支持把当前网页保存到当前知识空间。

### 个人记忆

- 可以输入 `记住 ...` 保存个人偏好、长期事实、项目约定或任务状态。
- 可以输入 `忘记 ...`、`忘掉 ...` 删除相关记忆。
- 输入区提供“个人记忆”入口，可查看、编辑、删除和导出记忆。
- 回答时只注入与当前问题相关的少量记忆。
- 个人记忆来源在 UI 中显示为“个人记忆”，不会在正文中暴露内部分类元数据。

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
- 结构化上下文计划：决定是否使用个人记忆、知识库和内置说明。
- 计划器：输出可执行步骤和需要的工具。
- 确定性执行：计算、排序、格式转换不交给模型猜。
- 模型润色：Chrome 内置模型只负责解释和表达。
- 任务状态：保存 `queued`、`checking`、`creating-session`、`downloading`、`running`、`failed`、`completed`。
- 继续任务：失败任务可以回到会话后继续执行。

### 数据管理

- 设置中支持导出完整备份，用于恢复 localAI 的 IndexedDB 数据。
- 设置中支持导出通用 JSONL 数据，便于迁移到其他 AI 或 RAG 工具。
- 支持从备份文件导入数据；导入会覆盖当前本地数据。

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
3. 点击发送按钮，或按 Enter。
4. 等待本地模型回复。

可测试：

```text
你能做什么？
这个 AI 怎么用？
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

1. 点击输入区的“知识库”。
2. 选择或新建知识空间。
3. 导入 `.md` 或 `.txt` 文件。
4. 输入和文档相关的问题。
5. 点击回答下方来源标签查看引用片段。

可用测试文档：

- [examples/localai-knowledge-demo.md](examples/localai-knowledge-demo.md)
- [examples/knowledge-retrieval-eval.json](examples/knowledge-retrieval-eval.json)
- [examples/memory-answer-eval.json](examples/memory-answer-eval.json)
- [examples/memory-operation-eval.json](examples/memory-operation-eval.json)
- [examples/prompt-injection-eval.json](examples/prompt-injection-eval.json)

可测试：

```text
localAI 是否会上传我的文档？
为什么 popup 关闭后 AI 还能继续运行？
localAI 当前支持哪些知识库文件格式？
本地知识库如何使用 embedding 检索？
```

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

### 数据导出和导入

1. 在全屏模式左侧栏底部点击“设置”。
2. 选择“导出备份”保存完整 IndexedDB 备份。
3. 选择“导出通用数据”保存 JSONL 格式知识和记忆文本。
4. 选择“导入数据”从备份文件恢复数据。

导入会覆盖当前本地数据，导入前建议先导出备份。

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
npm run eval       # 运行最小评测清单校验与摘要报告
```

## 给开发同学

README 只保留功能介绍和使用说明。技术实现请优先看：

- [localAI Chrome 插件技术架构与功能自测](docs/localai-extension-overview.md)
- [Chrome Built-in AI Notes](docs/chrome-built-in-ai.md)
- [知识库检索评测](docs/knowledge-retrieval-evaluation.md)
- [AI 工程化路线图](docs/ai-engineering-roadmap.md)

如果文档之间出现冲突，以 [docs/localai-extension-overview.md](docs/localai-extension-overview.md) 为准。

## 当前限制

- localAI 不联网，不提供互联网搜索能力；需要分析外部资料时，必须由用户粘贴、导入知识库或通过当前网页功能提供内容。
- Chrome Built-in AI 依赖浏览器版本、flags、平台支持和模型下载状态。
- offscreen 中某些专用 API 可能不可用，当前会用 Prompt API 兜底。
- 默认 embedding 是本地 feature-hash 向量，不是真正的神经网络语义向量。
- 知识库导入暂时只支持 `.md` 和 `.txt`。
- 意图识别当前主要是规则识别，复杂表达可能分类不准。
- 任务状态 UI 还是轻量状态条，尚未做完整任务卡片。

