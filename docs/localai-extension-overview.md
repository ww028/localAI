# localAI Chrome 插件技术架构与功能自测

## 项目定位

localAI 是一个 Chrome Manifest V3 插件，目标是把 Chrome Built-in AI 能力包装成一个本地优先的个人助手。

它不是简单的聊天框。当前实现已经形成一条受控链路：

```text
用户输入
  -> 意图识别
  -> 结构化计划
  -> 确定性工具 / 知识库 / 记忆执行
  -> Chrome Built-in AI 负责总结、解释和润色
  -> 保存会话、引用和任务状态
```

核心原则：

- Chrome 内置模型负责理解、生成、解释和润色，不直接承担可靠计算、状态管理和长期记忆。
- 计算、排序、格式转换、检索、引用、记忆、任务状态和文件解析由确定性代码控制。
- Prompt 必须分区：助手规则、结构化意图、结构化计划、确定性执行结果、最近会话、个人记忆、本地知识、用户问题。
- Chrome Built-in AI API 仍处于实验阶段，所有能力都要能 graceful fallback。

## 当前完成度

按 `todo.md`，迭代 1 到迭代 5 已完成：

| 迭代 | 状态 | 重点 |
| ---- | ---- | ---- |
| 迭代 1 | 已完成 | Chrome AI 调用、语言 fallback、Prompt 构建、任务状态枚举、最小测试 |
| 迭代 2 | 已完成 | 结构化个人记忆、记住/忘记、记忆管理 UI |
| 迭代 3 | 已完成 | 知识库空间、chunk 预览、检索评测样例、重建索引、rerank |
| 迭代 4 | 已完成 | 当前网页读取、网页摘要/问答/待办/笔记、保存网页到知识库、文本轻量动作 |
| 迭代 5 | 已完成 | intent、plan、确定性执行、模型润色、taskState 恢复和继续任务 |

当前阶段可以视为个人助手 MVP：核心链路已经成型，下一阶段重点是体验闭环、工具增强、记忆升级、更多文档格式和发布质量。

## 入口和运行形态

插件支持三种入口，三者共用同一个 React 应用：

| 入口 | 实现 | 说明 |
| ---- | ---- | ---- |
| Toolbar popup | `index.html` | 固定 `760px x 600px`，适合快速问答 |
| Chrome side panel | `side_panel.default_path` | 侧边栏常驻，适合边浏览边问 |
| 新标签页对话 | `index.html?surface=tab` | 大屏对话，适合长任务 |

相关实现：

- `public/manifest.json` 声明 popup、side panel、background、offscreen 和权限。
- `src/App.tsx` 根据 `surface` 参数切换布局。
- `public/background.js` 负责打开 side panel、新标签页聚焦和 popup 动态禁用。

自测：

1. 执行 `npm run build`。
2. 在 `chrome://extensions` 加载 `dist/`。
3. 点击插件图标，应打开 popup。
4. 在 popup 顶部点击侧边栏按钮，应打开 side panel 并关闭 popup。
5. 在 popup 或 side panel 点击新标签页按钮，应打开 `surface=tab` 的全屏对话。
6. 如果新标签页已打开，再点插件图标，应聚焦已有标签页并出现 toast。

## 核心模块

| 模块 | 位置 | 职责 |
| ---- | ---- | ---- |
| 主界面 | `src/App.tsx` | 对话 UI、工具入口、历史、任务提交、状态恢复 |
| Chrome AI 适配 | `src/lib/chromeAi.ts` | 能力探测、任务调用、专用 API fallback |
| 会话存储 | `src/lib/conversationStore.ts` | IndexedDB 保存会话、消息、状态和 `taskState` |
| 个人记忆 | `src/lib/assistantMemoryStore.ts` | 结构化记忆 CRUD、搜索、导出、记住/忘记命令解析 |
| 意图识别 | `src/lib/assistantIntent.ts` | 基于规则输出结构化 intent |
| 计划器 | `src/lib/assistantPlanner.ts` | 根据 intent 输出可执行步骤和工具 |
| 确定性执行器 | `src/lib/assistantDeterministicExecutor.ts` | 计算、排序、格式转换 |
| Prompt 构建 | `src/lib/assistantPrompt.ts` | 统一组织 intent、plan、执行结果、会话、记忆和知识 |
| 知识库 | `src/lib/knowledgeStore.ts` | IndexedDB 文档空间、chunk、embedding、rerank、索引重建 |
| Background | `public/background.js` | MV3 service worker，调度 offscreen、网页读取、入口控制 |
| Offscreen | `public/offscreen.js` | 后台执行 Chrome Built-in AI，并写回 IndexedDB |
| 样式 | `src/styles/main.css` | 三种 surface 的响应式布局和交互样式 |

## 主对话执行链路

普通用户问题的执行流程：

```text
App.tsx
  -> parseAssistantMemoryCommand()
  -> searchKnowledge()
  -> searchAssistantMemories()
  -> detectAssistantIntent()
  -> createAssistantPlan()
  -> executeDeterministicTask()
  -> buildAssistantPrompt()
  -> saveConversation(status=queued, taskState=...)
  -> submitBackgroundTask()
  -> background.js
  -> offscreen.js
  -> runAiTask()
  -> saveConversation(status=completed/failed)
```

如果不是 Chrome 扩展环境，或后台任务不可用，`App.tsx` 会回退到前台 `runAiTask()`。

自测：

1. 输入普通问题，例如 `你能做什么？`。
2. 发送后应出现加载状态。
3. 关闭 popup 再打开，应恢复最近会话。
4. 在 DevTools Application IndexedDB 中检查 `local-ai / conversations`，应看到会话消息和状态字段。

## Chrome Built-in AI 调用

Chrome AI 调用集中在 `src/lib/chromeAi.ts` 和 `public/offscreen.js`。

当前支持：

| 能力 | Chrome 全局对象 | 用途 |
| ---- | ---- | ---- |
| Prompt | `LanguageModel` | 主对话、网页助手、fallback |
| Summarizer | `Summarizer` | 输入区摘要动作 |
| Translator | `Translator` | 中英互译 |
| LanguageDetector | `LanguageDetector` | 能力探测和后续语言识别扩展 |
| Writer | `Writer` | 输入区写作动作 |
| Rewriter | `Rewriter` | 输入区润色改写动作 |

语言策略：

- Prompt API 中文优先：`zh`、`zh-Hans`、`en`、无参数 fallback。
- 翻译会根据输入自动判断方向：中文默认翻译成英文，英文默认翻译成中文。
- Rewriter 默认是“润色改写”，目标是更清晰、更自然，尽量保持原意和长度。

fallback 策略：

- 专用 API 可用时优先使用，例如 `Translator.translate()`。
- 专用 API 在 offscreen 不可用时，自动退回 `LanguageModel.prompt()`，使用明确任务提示词完成同等语义。
- 如果模型不可用，但确定性执行已经成功，界面会直接返回程序执行结果。

自测：

1. 打开插件，查看右下角 API 状态标签。
2. 输入 `测试`，点击 `+ -> 中英互译`，应输出英文。
3. 输入 `test`，点击 `+ -> 中英互译`，应输出中文。
4. 输入 `今天是个好日子`，点击 `+ -> 润色改写`，应输出更自然的表达。
5. 关闭 popup 后重新打开，轻量动作任务不应丢失。

## 后台执行和任务状态

MV3 service worker 不是普通页面上下文，Chrome Built-in AI API 不适合直接跑在 service worker 里。localAI 使用 offscreen document 承载后台推理。

流程：

1. `App.tsx` 先保存会话和 `taskState`，状态为 `queued`。
2. `background.js` 创建或复用 `offscreen.html`。
3. `offscreen.js` 创建 Chrome AI session。
4. offscreen 逐步写回状态：`checking`、`creating-session`、`downloading`、`running`。
5. 成功后写回 AI 回复，状态变为 `completed`。
6. 失败后写回错误消息，状态变为 `failed`。

`taskState` 保存：

| 字段 | 说明 |
| ---- | ---- |
| `kind` | `chat`、`text-action`、`web-page` |
| `aiTask` | `prompt`、`summarize`、`translate`、`write`、`rewrite` |
| `status` | 当前任务状态 |
| `originalInput` | 用户原始输入或网页任务描述 |
| `promptText` | 可重新提交的完整 prompt 或文本 |
| `sources` | 本地知识引用来源 |
| `intent` | 结构化意图 |
| `plan` | 结构化计划 |
| `deterministicExecution` | 确定性执行结果 |
| `error` | 失败原因 |

自测：

1. 输入一个较长问题，发送后立刻关闭 popup。
2. 等待几秒后重新打开插件，应看到任务继续或已完成结果。
3. 在 IndexedDB 的 `local-ai / conversations` 中检查 `taskState.status`。
4. 人为制造模型不可用或后台失败后，回到会话，应看到任务状态条和“继续任务”按钮。
5. 点击“继续任务”，应复用保存的 `promptText` 和 `aiTask` 重新提交。

## 结构化个人记忆

个人记忆由 `src/lib/assistantMemoryStore.ts` 管理，存储在独立 IndexedDB：`local-ai-assistant-memory`。

支持类型：

| 类型 | 用途 |
| ---- | ---- |
| `preference` | 用户偏好，例如回答风格、语言偏好 |
| `fact` | 长期事实，例如身份、常用信息 |
| `project` | 项目约定，例如技术栈、代码规范 |
| `task` | 任务状态，例如后续要继续的事情 |

能力：

- 输入 `记住 ...` 保存记忆。
- 输入 `忘记 ...`、`忘掉 ...`、`把 ... 忘掉` 删除相关记忆。
- 输入区的“个人记忆”入口可查看、编辑、删除、导出记忆。
- Prompt 构建时只注入和当前问题相关的少量记忆。

自测：

1. 输入 `记住 我的回答风格偏好是简洁直接`。
2. 打开输入区的“个人记忆”入口，应看到该记忆。
3. 编辑记忆内容并保存，应立即更新列表。
4. 输入 `忘掉回答风格偏好`，该记忆应被删除。
5. 点击导出按钮，应下载 JSON 文件。

## 本地知识库

知识库由 `src/lib/knowledgeStore.ts` 管理，存储在 IndexedDB：`local-ai-knowledge`。

当前支持：

- `.md` 和 `.txt` 文件导入。
- 多知识空间，例如“个人资料”“项目 A”“项目 B”。
- 文档和 chunk 都记录 `spaceId`。
- 检索默认只查当前知识空间。
- chunk 预览和引用跳转。
- 当前网页保存到知识库。
- 当前空间索引重建。
- 检索评测样例。

导入流程：

```text
选择文件
  -> 读取文本
  -> 按段落和长度切分 chunk
  -> 生成 terms
  -> 生成 embedding
  -> 写入 documents 和 chunks
```

检索流程：

```text
用户问题
  -> 生成 query terms 和 query embedding
  -> 当前知识空间内粗召回
  -> rerank
  -> 返回 top matches
  -> 注入 Prompt 并展示引用
```

embedding 策略：

- 如果浏览器提供可用 embedding API，优先使用。
- 否则使用本地 feature-hash embedding。
- feature-hash 不是真正语义模型，但能提供稳定、离线、可测试的基础检索能力。

rerank 信号：

- 向量相似度
- 关键词命中
- query 词项覆盖率
- 完整短语或中文紧凑短语命中
- 文档名命中
- 词项密度

自测：

1. 打开“浏览器知识”。
2. 新建一个知识空间。
3. 导入 `examples/localai-knowledge-demo.md`。
4. 提问 `localAI 是否会上传我的文档？`。
5. 回答应引用本地文档来源。
6. 点击回答下方的 `[1] 文档名`，应展开 chunk 预览。
7. 点击“重建索引”，完成后应出现索引重建成功 toast。
8. 对照 `examples/knowledge-retrieval-eval.json` 手动逐条测试检索质量。

## 当前网页助手

网页读取由 `public/background.js` 通过 `chrome.scripting.executeScript()` 注入脚本完成。

抽取策略：

- 读取当前可访问 tab。
- 排除插件自身 tab。
- 过滤 `script`、`style`、`nav`、`footer`、`aside`、表单控件等噪声。
- 优先取 `main`、`article`、`[role=main]`，否则回退到 body。
- 最多保留 24000 字符，Prompt 注入时最多使用 16000 字符。

当前网页动作：

| 动作 | 说明 |
| ---- | ---- |
| 摘要 | 总结当前网页 |
| 问网页 | 用输入框问题基于当前网页回答 |
| 待办 | 从网页正文提取待办 |
| 笔记 | 把网页整理成结构化笔记 |
| 保存到知识库 | 把网页转成 Markdown 并导入当前知识空间 |

自测：

1. 打开任意普通网页。
2. 打开插件，点击“当前网页 -> 摘要”，应生成网页摘要。
3. 在输入框输入问题，再点“当前网页 -> 问网页”，应基于网页回答。
4. 点击“当前网页 -> 待办”，应提取行动项。
5. 点击“当前网页 -> 保存到知识库”，当前知识空间文件数量应增加。
6. 切换到插件自身新标签页再读取网页，应自动避开插件 tab，选择最近可读取网页。

## 输入区轻量动作

输入区 `+` 菜单提供四个文本动作：

| 动作 | 优先 API | fallback |
| ---- | -------- | -------- |
| 摘要文本 | `Summarizer.summarize()` | `LanguageModel.prompt()` |
| 中英互译 | `Translator.translate()` | `LanguageModel.prompt()` |
| 写作 | `Writer.write()` | `LanguageModel.prompt()` |
| 润色改写 | `Rewriter.rewrite()` | `LanguageModel.prompt()` |

自测：

1. 输入一段长文本，点“摘要文本”，应输出要点摘要。
2. 输入中文，点“中英互译”，应输出英文。
3. 输入英文，点“中英互译”，应输出中文。
4. 输入写作要求，点“写作”，应生成文本。
5. 输入一句不够自然的话，点“润色改写”，应输出更清晰自然的版本。
6. 如果专用 API 不可用，应自动使用 Prompt API，不应直接报 `Writer/Rewriter 在当前后台页面不可用`。

## 任务助手

任务助手由四个模块组成：

```text
assistantIntent
  -> assistantPlanner
  -> assistantDeterministicExecutor
  -> assistantPrompt
```

### Intent

`assistantIntent.detectAssistantIntent()` 输出：

```ts
type AssistantIntent = {
  type: "chat" | "knowledge_qa" | "summarize" | "translate" | "write" | "rewrite" | "plan" | "calculate" | "sort" | "format_convert" | "extract_todos";
  confidence: number;
  executionMode: "answer" | "retrieve" | "deterministic" | "ai" | "hybrid";
  requiredTools: string[];
  entities: Record<string, string>;
  rationale: string;
};
```

自测：

1. 输入 `帮我计算 12 + 30 的合计`，应识别为 `calculate`。
2. 输入 `把 3,1,2 从小到大排序`，应识别为 `sort`。
3. 输入 `把下面内容转成 JSON`，应识别为 `format_convert`。
4. 输入 `根据知识库回答这个项目的架构`，应识别为 `knowledge_qa`。

### Plan

`assistantPlanner.createAssistantPlan()` 根据 intent 输出步骤，每步包含：

- `id`
- `title`
- `description`
- `tool`
- `status`
- `deterministic`

自测：

1. 输入计算任务。
2. 在 IndexedDB `taskState.plan.steps` 中应看到 `calculator` 步骤和 `language-model` 润色步骤。
3. 输入知识库问题，应看到 `knowledge-search` 和 `language-model` 步骤。

### Deterministic Executor

`assistantDeterministicExecutor.executeDeterministicTask()` 当前覆盖：

- 计算：`1 + 2 * 3`、`合计 1,2,3`、`平均 1,2,3`、`20 占 50 的百分比`
- 排序：`把 3,1,20 从小到大排序`
- 格式转换：`转成 JSON：name=Alice, age=18; name=Bob, age=20`

自测：

1. 输入 `计算 (12 + 30) / 2`，最终答案应基于确定性结果 `21`。
2. 输入 `20 占 50 的百分比`，最终答案应基于确定性结果 `40`。
3. 输入 `把 3, 1, 20 从小到大排序`，应输出 `1, 3, 20`。
4. 输入 `转成表格：name=Alice, age=18; name=Bob, age=20`，应输出 Markdown 表格。
5. 断开或禁用模型时，确定性任务仍应返回程序结果。

## 会话历史和恢复

会话保存在 IndexedDB：`local-ai / conversations`。

当前支持：

- 自动保存用户消息和 AI 回复。
- 打开插件默认恢复最近会话。
- 左上角历史入口展示最近会话。
- 新建对话。
- 保存 `taskState`。
- 运行中任务恢复进度。
- 失败任务继续执行。

自测：

1. 发送一个任务后关闭 popup。
2. 重新打开插件，应恢复最近会话和任务状态。
3. 选择历史会话，应恢复该会话消息、状态和任务信息。
4. 如果任务失败，应看到“继续任务”按钮。
5. 点击“继续任务”，应使用原 `promptText` 和 `aiTask` 重新提交。

## Markdown 渲染和引用

AI 回复使用 `react-markdown` 和 `remark-gfm` 渲染。

支持：

- 标题
- 段落
- 加粗
- 列表
- 表格
- 代码块
- 本地知识引用来源
- 点击引用展开 chunk 预览

自测：

1. 让模型输出表格，应正确渲染为表格。
2. 让模型输出代码块，应显示独立代码样式。
3. 基于知识库提问后，点击来源引用，应展开对应 chunk。

## 测试和验证

当前项目提供最小回归测试：

```bash
npm test
```

可单独运行：

```bash
npm run test:prompt
npm run test:intent
npm run test:planner
npm run test:executor
```

构建验证：

```bash
npm run build
```

建议每次改动至少执行：

```bash
npm test
npm run build
```

## 当前限制

| 限制 | 影响 |
| ---- | ---- |
| Chrome Built-in AI 依赖浏览器版本、flags 和模型下载状态 | 不同机器上 API 可用性可能不同 |
| offscreen 中专用 API 可能不可用 | 已用 Prompt API 兜底，但效果依赖 Prompt 模型 |
| 默认 embedding 不是神经网络语义向量 | 同义词、跨语言和深层语义召回有限 |
| 文档导入仅支持 `.md` 和 `.txt` | PDF、DOCX、图片和网页批量资料暂未覆盖 |
| intent 当前主要是规则识别 | 复杂表达可能分类不准 |
| 确定性执行器覆盖面有限 | 复杂表格、复杂公式、自然语言日期还需要增强 |
| 任务状态 UI 仍是轻量状态条 | 还没有完整任务卡片和逐步骤状态展示 |

## 下一阶段

下一阶段从 `todo.md` 的迭代 6 开始：

1. 任务卡片 UI：展示 intent、plan、步骤状态和工具使用。
2. 失败任务体验：复制错误、查看任务详情、继续任务。
3. 手动验收文档：覆盖 popup、side panel、新标签页、后台任务、知识库、记忆、网页助手和确定性工具。
4. 清理 `document.execCommand` 复制 fallback。

后续迭代继续增强确定性工具、记忆系统、知识库导入类型和发布质量。
