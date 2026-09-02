# localAI Chrome 插件技术架构与功能自测

## 项目定位

localAI 是一个 Chrome Manifest V3 插件，目标是把 Chrome Built-in AI 能力包装成一个本地优先的个人助手。

localAI 不是互联网搜索工具。当前实现不会主动联网检索外部网页、新闻、价格、天气或在线数据库；模型回答来自用户输入、当前网页正文、用户导入知识库、个人记忆、最近会话上下文和项目内置知识文档。

它不是简单的聊天框。当前实现已经形成一条受控链路：

```text
用户输入
  -> 意图识别
  -> 上下文计划
  -> 结构化计划
  -> 确定性工具 / 用户知识库 / 内置知识库 / 个人记忆执行
  -> Chrome Built-in AI 负责总结、解释和润色
  -> 清理回答正文、保存会话、引用和任务状态
```

核心原则：

- Chrome 内置模型负责理解、生成、解释和润色，不直接承担可靠计算、状态管理和长期记忆。
- 计算、排序、格式转换、检索、引用、记忆、任务状态、文件解析和上下文选择由确定性代码控制。
- Prompt 必须分区：助手规则、结构化意图、结构化计划、上下文使用策略、确定性执行结果、最近会话、个人记忆、本地知识、用户问题。
- 用户导入知识、个人记忆和内置说明都作为结构化上下文进入同一条回答链路，避免在最终回答处写散落的硬编码分支。
- Chrome Built-in AI API 仍处于实验阶段，所有能力都要能 graceful fallback。

## 当前完成度

按 `todo.md`，迭代 1 到迭代 5 已完成，并且部分体验闭环和发布质量能力已经提前落地：

| 迭代   | 状态   | 重点                                                                  |
| ------ | ------ | --------------------------------------------------------------------- |
| 迭代 1 | 已完成 | Chrome AI 调用、语言 fallback、Prompt 构建、任务状态枚举、最小测试    |
| 迭代 2 | 已完成 | 结构化个人记忆、记住/忘记、记忆管理 UI                                |
| 迭代 3 | 已完成 | 知识库空间、chunk 预览、检索评测样例、重建索引、rerank                |
| 迭代 4 | 已完成 | 当前网页读取、网页摘要/问答/待办/笔记、保存网页到知识库、文本轻量动作 |
| 迭代 5 | 已完成 | intent、plan、确定性执行、模型润色、taskState 恢复和继续任务          |

已额外落地：

- 全屏 Tab 模式历史侧边栏、收起态 rail、历史搜索和设置入口。
- Assistant 消息复制、重新回答和下载为 Word。
- 引用来源正文清理、个人记忆口吻归一化和来源 Chip 展示。
- 完整 IndexedDB 备份、通用 JSONL 导出和备份导入。
- 内置用户手册作为内置知识库参与问答。

当前阶段可以视为个人助手 MVP+：核心链路已经成型，并已补充全屏历史侧边栏、消息操作、引用清理、数据导入导出、内置使用说明和更严格的上下文策略。下一阶段重点是任务卡片、工具增强、记忆升级、更多文档格式和发布质量。

## 入口和运行形态

插件支持三种入口，三者共用同一个 React 应用：

| 入口              | 实现                      | 说明                                                     |
| ----------------- | ------------------------- | -------------------------------------------------------- |
| Toolbar popup     | `index.html`              | 固定 `760px x 600px`，适合快速问答                       |
| Chrome side panel | `side_panel.default_path` | 侧边栏常驻，适合边浏览边问；支持手动拖宽提示             |
| 新标签页对话      | `index.html?surface=tab`  | 大屏对话，适合长任务；左侧历史侧边栏支持展开、收起和搜索 |

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
7. 在全屏模式收起和展开左侧历史侧边栏，搜索历史话题，底部设置入口应保持可用。

## 核心模块

| 模块           | 位置                                        | 职责                                                                |
| -------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| 主界面         | `src/App.tsx`                               | 对话 UI、工具入口、历史、任务提交、状态恢复、来源展示、数据导入导出 |
| Chrome AI 适配 | `src/lib/chromeAi.ts`                       | 能力探测、任务调用、专用 API fallback                               |
| 会话存储       | `src/lib/conversationStore.ts`              | IndexedDB 保存会话、消息、状态、来源和 `taskState`                  |
| 个人记忆       | `src/lib/assistantMemoryStore.ts`           | 结构化记忆 CRUD、搜索、导出、记住/忘记命令解析                      |
| 意图识别       | `src/lib/assistantIntent.ts`                | 基于规则输出结构化 intent                                           |
| 上下文计划     | `src/lib/assistantContextPlan.ts`           | 决定记忆、知识库、来源展示和回答约束                                |
| 计划器         | `src/lib/assistantPlanner.ts`               | 根据 intent 输出可执行步骤和工具                                    |
| 确定性执行器   | `src/lib/assistantDeterministicExecutor.ts` | 计算、排序、格式转换                                                |
| Prompt 构建    | `src/lib/assistantPrompt.ts`                | 统一组织 intent、plan、ContextPlan、执行结果、会话、记忆和知识      |
| 用户知识库     | `src/lib/knowledgeStore.ts`                 | IndexedDB 文档空间、chunk、embedding、rerank、索引重建              |
| 内置知识库     | `src/lib/builtinKnowledge.ts`               | 将内置使用说明转成 `KnowledgeMatch`，参与同一套知识问答链路         |
| 内置用户手册   | `src/knowledge/localai-usage.zh.md`         | 面向用户的 localAI 使用说明                                         |
| 数据备份       | `src/lib/indexedDbBackup.ts`                | 完整 IndexedDB 备份、通用 JSONL 导出、备份导入校验和恢复            |
| Background     | `public/background.js`                      | MV3 service worker，调度 offscreen、网页读取、入口控制              |
| Offscreen      | `public/offscreen.js`                       | 后台执行 Chrome Built-in AI，清理回答，并写回 IndexedDB             |
| 样式           | `src/styles/main.css`                       | 三种 surface 的响应式布局、全屏侧栏、浮层和交互样式                 |

## 主对话执行链路

普通用户问题的执行流程：

```text
App.tsx
  -> parseAssistantMemoryCommand()
  -> resolveKnowledgeSources()
       -> searchBuiltinKnowledge()
       -> searchKnowledge()
  -> resolveAssistantMemories()
  -> detectAssistantIntent()
  -> createContextPlan()
  -> createMessageSources()
  -> createAssistantPlan()
  -> executeDeterministicTask()
  -> buildAssistantPrompt()
  -> saveConversation(status=queued, taskState=...)
  -> submitBackgroundTask()
  -> background.js
  -> offscreen.js
  -> runAiTask()
  -> stripGeneratedSourceSection() / normalizeMemoryAnswerTone()
  -> saveConversation(status=completed/failed)
```

如果不是 Chrome 扩展环境，或后台任务不可用，`App.tsx` 会回退到前台 `runAiTask()`。

自测：

1. 输入普通问题，例如 `你能做什么？`。
2. 发送后应出现加载状态。
3. 关闭 popup 再打开，应恢复最近会话。
4. 在 DevTools Application IndexedDB 中检查 `local-ai / conversations`，应看到会话消息和状态字段。

## 上下文计划和来源策略

`src/lib/assistantContextPlan.ts` 负责在 Prompt 构建前决定本轮回答应该如何使用上下文。它不是让模型自由判断，而是由确定性代码输出 `ContextPlan`：

```ts
type ContextPlan = {
  subject:
    | "user_profile_query"
    | "entity_profile_query"
    | "user"
    | "assistant"
    | "external";
  targetEntity?: string;
  memoryMode: "none" | "implicit" | "answer_source";
  knowledgeMode: "none" | "cite";
  requiresLocalEvidence: boolean;
  visibleSources: Array<"memory" | "knowledge">;
  shouldCompareWithGeneralKnowledge: boolean;
  responseConstraints: string[];
  rationale: string;
};
```

当前策略：

- 问用户本人、称呼、偏好、职业、项目、习惯或“你记得什么”时，优先使用个人记忆。
- 问某个具体对象是谁时，只能根据命中的个人记忆或本地知识库回答，避免根据名称联想编造。
- 命中用户知识库或内置知识库时，`knowledgeMode` 进入 `cite`，回答下方展示知识来源。
- 个人记忆里的第一人称来自用户原话，输出时必须转换为面向用户的自然二人称。
- 回答正文不应生成“引用来源 / Sources”段落；前台和 offscreen 会做兜底清理。
- 用户记忆、用户知识库和内置知识库均作为本地上下文处理，优先级高于模型通识。

相关实现：

- `createContextPlan()` 决定记忆模式、知识模式和来源可见性。
- `buildAssistantPrompt()` 将 `ContextPlan` 序列化进 Prompt。
- `createMessageSources()` 把知识库和个人记忆转换成 UI 来源。
- `formatContextAwareAnswer()` 清理模型输出，并做个人记忆口吻归一化。

自测：

1. 输入 `我是谁？`，如果有个人记忆，应优先按个人记忆回答。
2. 输入 `某个已保存对象是谁？`，应只根据本地上下文回答；没有命中时应说明未保存相关信息。
3. 输入知识库相关问题，回答下方应出现来源 Chip。
4. 模型生成多余“引用来源”段落时，最终展示正文应移除该段落。

## Chrome Built-in AI 调用

Chrome AI 调用集中在 `src/lib/chromeAi.ts` 和 `public/offscreen.js`。

当前支持：

| 能力             | Chrome 全局对象    | 用途                       |
| ---------------- | ------------------ | -------------------------- |
| Prompt           | `LanguageModel`    | 主对话、网页助手、fallback |
| Summarizer       | `Summarizer`       | 输入区摘要动作             |
| Translator       | `Translator`       | 中英互译                   |
| LanguageDetector | `LanguageDetector` | 能力探测和后续语言识别扩展 |
| Writer           | `Writer`           | 输入区写作动作             |
| Rewriter         | `Rewriter`         | 输入区润色改写动作         |

语言策略：

- UI 语言根据浏览器语言初始化，用户手动切换后写入 `localStorage`，重新打开插件时继续使用上次选择。
- UI 顶部展示 `Gemini Nano` 作为 Chrome 内置端侧模型族；具体版本号、参数规模和模型文件由 Chrome 管理，当前公开 API 不向扩展暴露这些元数据。
- Prompt API 会话创建只声明浏览器当前稳定支持的英文能力，并保留无参数 fallback；中文回答通过 Prompt 指令控制，避免新版 Chrome 因不支持 `zh` / `zh-Hans` 语言码而中止请求。
- Summarizer API 必须声明受支持的输出语言。当前中文模式下摘要直接使用 Prompt fallback，英文模式才使用 `Summarizer` 并声明 `outputLanguage: "en"`。
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

| 字段                     | 说明                                                   |
| ------------------------ | ------------------------------------------------------ |
| `kind`                   | `chat`、`text-action`、`web-page`                      |
| `aiTask`                 | `prompt`、`summarize`、`translate`、`write`、`rewrite` |
| `status`                 | 当前任务状态                                           |
| `originalInput`          | 用户原始输入或网页任务描述                             |
| `promptText`             | 可重新提交的完整 prompt 或文本                         |
| `sources`                | 用户知识库、内置知识库或个人记忆来源                   |
| `intent`                 | 结构化意图                                             |
| `plan`                   | 结构化计划                                             |
| `deterministicExecution` | 确定性执行结果                                         |
| `error`                  | 失败原因                                               |

自测：

1. 输入一个较长问题，发送后立刻关闭 popup。
2. 等待几秒后重新打开插件，应看到任务继续或已完成结果。
3. 在 IndexedDB 的 `local-ai / conversations` 中检查 `taskState.status`。
4. 人为制造模型不可用或后台失败后，回到会话，应看到任务状态条和“继续任务”按钮。
5. 点击“继续任务”，应复用保存的 `promptText` 和 `aiTask` 重新提交。

## 结构化个人记忆

个人记忆由 `src/lib/assistantMemoryStore.ts` 管理，存储在独立 IndexedDB：`local-ai-assistant-memory`。

支持类型：

| 类型         | 用途                             |
| ------------ | -------------------------------- |
| `preference` | 用户偏好，例如回答风格、语言偏好 |
| `fact`       | 长期事实，例如身份、常用信息     |
| `project`    | 项目约定，例如技术栈、代码规范   |
| `task`       | 任务状态，例如后续要继续的事情   |

能力：

- 输入 `记住 ...` 保存记忆。
- 输入 `忘记 ...`、`忘掉 ...`、`把 ... 忘掉` 删除相关记忆。
- 输入区的“个人记忆”入口可查看、编辑、删除、导出记忆。
- Prompt 构建时只注入和当前问题相关的少量记忆。
- `resolveAssistantMemories()` 会在用户画像类问题中扩展检索范围，将直接命中的记忆和候选画像记忆合并后注入 Prompt。
- `promptMemories` 用于模型推理，`sourceMemories` 用于 UI 来源展示，两者分离，避免来源 Chip 展示无关背景记忆。
- 个人记忆作为来源展示时，UI 只显示“个人记忆”，不暴露 `长期事实`、`用户偏好` 等内部类型。
- `normalizeMemoryAnswerTone()` 会在使用个人记忆时做输出后处理，把记忆原话中的用户第一人称转换成面向用户的二人称表达。

自测：

1. 输入 `记住 我的回答风格偏好是简洁直接`。
2. 打开输入区的“个人记忆”入口，应看到该记忆。
3. 编辑记忆内容并保存，应立即更新列表。
4. 输入 `忘掉回答风格偏好`，该记忆应被删除。
5. 点击导出按钮，应下载 JSON 文件。
6. 输入 `我是谁？` 或 `你记得我的偏好吗？`，应优先根据个人记忆回答。
7. 个人记忆来源 Chip 不应显示内部类型，回答正文不应包含“类型：长期事实”等元数据。

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
  -> searchBuiltinKnowledge()
  -> 生成 query terms 和 query embedding
  -> 当前知识空间内粗召回
  -> rerank
  -> 合并内置知识和用户知识 top matches
  -> 注入 Prompt 并展示引用
```

内置知识库：

- `src/lib/builtinKnowledge.ts` 提供内置知识源。
- `src/knowledge/localai-usage.zh.md` 是内置用户手册。
- 当用户询问“使用说明”“这个 AI 怎么用”“有什么功能”等问题时，`searchBuiltinKnowledge()` 会返回内置手册作为 `KnowledgeMatch`。
- 内置知识源的 `spaceId` 为 `builtin`，不写入用户 IndexedDB，也不会出现在用户知识库文件列表中。
- `assistantContextPlan.ts` 识别到内置知识源后，会让 `knowledgeMode` 进入 `cite`，因此回答会按知识库方式引用该说明文档。

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

1. 打开“知识库”。
2. 新建一个知识空间。
3. 导入 `examples/localai-knowledge-demo.md`。
4. 提问 `localAI 是否会上传我的文档？`。
5. 回答应引用本地文档来源。
6. 点击回答下方的 `[1] 文档名`，应展开 chunk 预览。
7. 点击“重建索引”，完成后应出现索引重建成功 toast。
8. 对照 `examples/knowledge-retrieval-eval.json` 手动逐条测试检索质量。
9. 输入 `这个 AI 怎么用？`，应根据内置使用说明回答，并显示 `localAI 使用说明` 来源。

## 当前网页助手

网页读取由 `public/background.js` 通过 `chrome.scripting.executeScript()` 注入脚本完成。

抽取策略：

- 读取当前可访问 tab。
- 排除插件自身 tab。
- 过滤 `script`、`style`、`nav`、`footer`、`aside`、表单控件等噪声。
- 优先取 `main`、`article`、`[role=main]`，否则回退到 body。
- 最多保留 24000 字符，Prompt 注入时最多使用 16000 字符。

当前网页动作：

| 动作         | 说明                                   |
| ------------ | -------------------------------------- |
| 摘要         | 总结当前网页                           |
| 问网页       | 用输入框问题基于当前网页回答           |
| 待办         | 从网页正文提取待办                     |
| 笔记         | 把网页整理成结构化笔记                 |
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

| 动作     | 优先 API                 | fallback                 |
| -------- | ------------------------ | ------------------------ |
| 摘要文本 | `Summarizer.summarize()` | `LanguageModel.prompt()` |
| 中英互译 | `Translator.translate()` | `LanguageModel.prompt()` |
| 写作     | `Writer.write()`         | `LanguageModel.prompt()` |
| 润色改写 | `Rewriter.rewrite()`     | `LanguageModel.prompt()` |

自测：

1. 输入一段长文本，点“摘要文本”，应输出要点摘要。
2. 输入中文，点“中英互译”，应输出英文。
3. 输入英文，点“中英互译”，应输出中文。
4. 输入写作要求，点“写作”，应生成文本。
5. 输入一句不够自然的话，点“润色改写”，应输出更清晰自然的版本。
6. 如果专用 API 不可用，应自动使用 Prompt API，不应直接报 `Writer/Rewriter 在当前后台页面不可用`。

## 任务助手

任务助手由多个确定性模块组成：

```text
assistantIntent
  -> assistantContextPlan
  -> assistantPlanner
  -> assistantDeterministicExecutor
  -> assistantPrompt
  -> answer post-processing
```

### Intent

`assistantIntent.detectAssistantIntent()` 输出：

```ts
type AssistantIntent = {
  type:
    | "chat"
    | "knowledge_qa"
    | "summarize"
    | "translate"
    | "write"
    | "rewrite"
    | "plan"
    | "calculate"
    | "sort"
    | "format_convert"
    | "extract_todos";
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
5. 输入 `这个 AI 怎么用？`，即使 intent 仍是普通对话，也应通过内置知识源触发 `ContextPlan.knowledgeMode = "cite"`。

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
- 历史入口展示最近会话。
- 新建对话。
- 全屏 Tab 模式左侧历史侧边栏支持展开、收起和搜索。
- 保存 `taskState`。
- 运行中任务恢复进度。
- 失败任务继续执行。
- Assistant 消息支持复制、重新回答和下载为 Word。

自测：

1. 发送一个任务后关闭 popup。
2. 重新打开插件，应恢复最近会话和任务状态。
3. 选择历史会话，应恢复该会话消息、状态和任务信息。
4. 如果任务失败，应看到“继续任务”按钮。
5. 点击“继续任务”，应使用原 `promptText` 和 `aiTask` 重新提交。
6. 在全屏 Tab 模式搜索历史标题，应只展示匹配会话。
7. 对某条 Assistant 消息点击“重新回答”，应替换该条回答，而不是追加一条新回答。

## Markdown 渲染和引用

AI 回复使用 `react-markdown` 和 `remark-gfm` 渲染。

支持：

- 标题
- 段落
- 加粗
- 列表
- 表格
- 代码块
- 本地知识、内置知识和个人记忆引用来源
- 点击引用展开 chunk 预览
- 清理模型在正文末尾生成的“引用来源 / Sources”段落
- 个人记忆来源使用 `[M1]` 这类标签，UI 文案只显示“个人记忆”

自测：

1. 让模型输出表格，应正确渲染为表格。
2. 让模型输出代码块，应显示独立代码样式。
3. 基于知识库提问后，点击来源引用，应展开对应 chunk。
4. 基于个人记忆提问后，来源 Chip 应显示“个人记忆”，正文不应暴露内部分类。
5. 让模型输出额外“引用来源”段落，最终正文应被清理，只保留下方来源 Chip。

## 数据导入导出

数据导入导出由 `src/lib/indexedDbBackup.ts` 管理。

当前支持两种导出：

| 类型         | 格式  | 用途                                               |
| ------------ | ----- | -------------------------------------------------- |
| 导出备份     | JSON  | 完整保存 localAI 的 IndexedDB 数据，用于恢复       |
| 导出通用数据 | JSONL | 导出知识库文本片段和个人记忆文本，便于其他工具复用 |

完整备份覆盖的数据库：

- `local-ai / conversations`
- `local-ai-knowledge / documents`
- `local-ai-knowledge / chunks`
- `local-ai-knowledge / spaces`
- `local-ai-assistant-memory / memories`

导入流程：

```text
选择备份 JSON
  -> 校验 app、formatVersion、database、store 和 record schema
  -> 清空目标 object stores
  -> 写入备份记录
  -> 刷新会话、知识空间、知识数量和个人记忆 UI
```

自测：

1. 在设置中点击“导出备份”，应下载 `localai-indexeddb-YYYY-MM-DD.json`。
2. 在设置中点击“导出通用数据”，应下载 `localai-portable-data-YYYY-MM-DD.jsonl`。
3. 导入非法 JSON 或 schema 不匹配文件，应提示格式不合规。
4. 导入合法备份前应出现覆盖确认。
5. 导入成功后，会话、知识库和个人记忆 UI 应刷新。

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

| 限制                                                    | 影响                                         |
| ------------------------------------------------------- | -------------------------------------------- |
| localAI 不联网，不是互联网搜索工具                      | 实时信息和外部资料需要用户显式提供           |
| Chrome Built-in AI 依赖浏览器版本、flags 和模型下载状态 | 不同机器上 API 可用性可能不同                |
| offscreen 中专用 API 可能不可用                         | 已用 Prompt API 兜底，但效果依赖 Prompt 模型 |
| 默认 embedding 不是神经网络语义向量                     | 同义词、跨语言和深层语义召回有限             |
| 文档导入仅支持 `.md` 和 `.txt`                          | PDF、DOCX、图片和网页批量资料暂未覆盖        |
| intent 当前主要是规则识别                               | 复杂表达可能分类不准                         |
| 确定性执行器覆盖面有限                                  | 复杂表格、复杂公式、自然语言日期还需要增强   |
| 任务状态 UI 仍是轻量状态条                              | 还没有完整任务卡片和逐步骤状态展示           |

## 下一阶段

下一阶段继续补齐体验闭环和发布质量：

1. 任务卡片 UI：展示 intent、plan、步骤状态和工具使用。
2. 失败任务体验：复制错误、查看任务详情、继续任务。
3. 手动验收文档：覆盖 popup、side panel、新标签页、后台任务、知识库、记忆、网页助手和确定性工具。
4. 清理 `document.execCommand` 复制 fallback。
5. 扩展知识库导入格式，例如 PDF、DOCX 和网页剪藏。

后续迭代继续增强确定性工具、记忆系统、知识库导入类型和发布质量。
