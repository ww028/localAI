# localAI Chrome 插件实现与能力总览

## 为什么先写成一篇文章

当前 localAI 仍处在 MVP 到可用原型之间，功能模块之间耦合较强：Chrome Built-in AI 调用、本地知识库、会话持久化、后台执行和 Popup UI 都服务于同一个目标，也就是让用户在浏览器里完成本地优先的 AI 问答。

因此现阶段更适合写成一篇完整文章。读者可以顺着“产品目标 - 技术实现 - 功能价值 - 使用结果 - 当前限制”连续理解项目。后续如果继续扩展到 PDF 解析、真实模型 embedding、检索评测、权限治理或多知识库空间，再拆成多篇专题文档更合理。

## 产品目标

localAI 是一个 Chrome Manifest V3 插件，用于调用 Chrome Built-in AI，在浏览器本地完成 AI 对话和知识库问答。

它的核心目标不是训练模型，也不是替代云端大模型平台，而是验证一条更轻量、更私密的本地 AI 工作流：

1. 用户在浏览器插件里提问。
2. 插件在本地知识库中检索相关资料。
3. 检索到的资料被拼接进 prompt。
4. Chrome 内置模型在本机完成推理。
5. 对话和知识文件元数据保存在浏览器 IndexedDB 中。

这条链路的价值在于，用户的文档和问题默认不需要上传到外部服务，适合处理轻量的个人知识、项目说明、产品文档、技术笔记和离线资料问答。

## 当前实现架构

localAI 使用 Vite、React 和 TypeScript 构建插件 UI，插件入口同时支持 toolbar popup 和 Chrome side panel。

核心模块如下：

| 模块 | 位置 | 职责 |
| --- | --- | --- |
| Chrome AI 适配层 | `src/lib/chromeAi.ts` | 探测并调用 Chrome Built-in AI API |
| 对话存储 | `src/lib/conversationStore.ts` | 使用 IndexedDB 保存历史会话、消息和运行状态 |
| 知识库存储 | `src/lib/knowledgeStore.ts` | 导入文档、切分 chunk、生成 embedding、检索和删除知识文件 |
| 主界面 | `src/App.tsx` | 对话 UI、知识库入口、历史会话、语言切换和任务提交 |
| 样式 | `src/styles/main.css` | 固定 Popup 尺寸、无全局滚动、消息和工具栏样式 |
| 后台任务 | `public/background.js` | 接收 Popup 请求并创建 offscreen 页面 |
| 后台推理页面 | `public/offscreen.js` | Popup 关闭后继续执行 Prompt API 并写回结果 |
| 插件声明 | `public/manifest.json` | MV3 配置、popup、side panel、background 和 offscreen 权限 |

整体执行链路如下：

```text
用户提问
  -> App.tsx 保存用户消息
  -> knowledgeStore.searchKnowledge() 检索本地知识片段
  -> buildKnowledgePrompt() 拼接引用上下文
  -> background.js 转发后台任务
  -> offscreen.js 调用 Chrome LanguageModel.prompt()
  -> conversationStore 保存 AI 回复
  -> Popup 重新打开后恢复最新会话
```

## Chrome Built-in AI 调用

插件通过 `src/lib/chromeAi.ts` 对 Chrome Built-in AI 做统一封装。当前适配的能力包括：

| 能力 | Chrome 全局对象 | 用途 |
| --- | --- | --- |
| Prompt | `LanguageModel` | 通用问答和知识库增强问答 |
| Summarizer | `Summarizer` | 文本摘要能力探测和调用 |
| Translator | `Translator` | 翻译能力探测和调用 |
| LanguageDetector | `LanguageDetector` | 语言检测能力探测和调用 |
| Writer | `Writer` | 写作能力探测和调用 |
| Rewriter | `Rewriter` | 改写能力探测和调用 |

实际主流程目前使用 `LanguageModel.prompt()` 完成对话。其他 API 已经纳入能力探测和适配层，便于后续把 UI 从单一问答扩展成更多文本任务。

Chrome AI API 仍处于实验演进阶段，所以项目把直接 API 调用集中在适配层里。这样当 Chrome 改动 factory 名称、`availability()` 参数或 session 方法时，只需要优先修改适配层，不需要让 UI 组件感知底层差异。

## 后台执行机制

Chrome 插件 popup 关闭后，popup 页面会被销毁。如果 AI 推理直接跑在 popup 中，用户关闭插件窗口就会导致任务中断。

localAI 使用 Manifest V3 的 background service worker 和 offscreen document 解决这个问题：

1. 用户发送问题后，`App.tsx` 先把当前会话保存为 `running`。
2. Popup 通过 `chrome.runtime.sendMessage()` 把任务交给 `background.js`。
3. `background.js` 确保 `offscreen.html` 已创建。
4. `offscreen.js` 在隐藏页面中调用 `LanguageModel.prompt()`。
5. 推理完成后，结果写回 IndexedDB。
6. 用户再次打开 popup 时，界面读取最新会话状态并展示结果。

这个设计解决了一个关键体验问题：用户不用一直保持 popup 打开，也不会因为误关闭窗口丢失正在执行的 AI 任务。

## 本地知识库实现

localAI 支持导入 `.md` 和 `.txt` 文件作为本地知识库。导入后，文档不会上传到外部服务，而是保存在浏览器 IndexedDB。

导入流程：

1. 用户点击底部 `浏览器知识` chip 选择文件。
2. `knowledgeStore.importKnowledgeFiles()` 读取文本内容。
3. 文档按段落切分为多个 chunk。
4. 每个 chunk 生成关键词 terms 和 embedding 向量。
5. 文档元数据写入 `documents` store。
6. chunk、terms 和 embedding 写入 `chunks` store。

检索流程：

1. 用户发送问题。
2. `searchKnowledge()` 为问题生成 query embedding。
3. 对所有 chunk 计算 query embedding 与 chunk embedding 的余弦相似度。
4. 同时计算关键词命中分数作为兜底。
5. 综合排序后取前 5 个片段。
6. 检索结果被插入 prompt，并要求模型优先依据本地片段回答。

当前 embedding 实现采用两层策略：

| 策略 | 说明 |
| --- | --- |
| 浏览器 embedding API 探测 | 如果当前 Chrome 暴露 `EmbeddingModel` 或类似实验接口，则优先尝试使用 |
| 本地 feature-hash embedding | 如果浏览器没有可用 embedding API，则使用确定性的本地向量生成方案 |

需要注意的是，本地 feature-hash embedding 不是神经网络语义向量。它更像一种向量化的模糊词面检索：支持中文 n-gram、英文词和相邻词特征，并通过向量归一化和余弦相似度改善排序稳定性。它比纯关键词检索更平滑，但不能完全理解同义词和深层语义。

这个设计的价值是先把知识库架构切到 embedding 形态：数据结构、检索流程、排序方式和兼容策略都已经准备好。后续接入真正的浏览器本地 embedding 模型时，不需要推倒重写知识库模块。

## 知识库管理 UI

底部工具栏中的 `浏览器知识` 是知识库管理入口。

当前支持：

| 功能 | 说明 |
| --- | --- |
| 导入文件 | 点击 chip 或弹层里的加号导入 `.md`、`.txt` |
| 查看数量 | chip 上展示当前知识文件数量 |
| 查看列表 | hover 或 focus 后展示已导入文件列表 |
| 查看元信息 | 列表展示文件名、导入时间和大小 |
| 删除单个文件 | 删除文档元数据和对应 chunk |
| 清空知识库 | 清空所有文档和 chunk |

这让知识库从“只能导入，不能管理”的一次性能力，变成了可持续使用的本地资料入口。

## 会话持久化

localAI 使用 IndexedDB 保存对话历史。

当前支持：

| 功能 | 说明 |
| --- | --- |
| 自动保存会话 | 用户发送消息和 AI 回复后保存到本地 |
| 最近会话恢复 | 打开插件时默认加载最近一次会话 |
| 历史会话列表 | 左上角历史按钮 hover 后展示最近会话 |
| 新建对话 | 顶部编辑按钮创建新会话 |
| 运行状态恢复 | 后台任务运行中时保存 `running` 状态 |

这个能力让插件不再只是一次性问答框，而是一个有连续上下文的本地 AI 工作台。

## Markdown 回复渲染

AI 回复使用 `react-markdown` 和 `remark-gfm` 渲染。

当前支持：

| 内容类型 | 效果 |
| --- | --- |
| 标题和段落 | 按 Markdown 结构展示 |
| 加粗、列表 | 正常渲染，不再显示源码符号 |
| 表格 | 支持 GitHub Flavored Markdown，并提供横向滚动 |
| 代码块 | 使用独立代码块样式展示 |
| 引用来源 | 回答下方展示 `[1] 文档名` 形式的来源 |

这让模型输出更接近可读文档，而不是一段未处理的 Markdown 源码。

## 交互和视觉设计

当前 UI 是一个固定尺寸的浏览器插件工作区，Popup 尺寸为 `760px x 600px`。

主要交互设计：

| 区域 | 设计 |
| --- | --- |
| 顶部栏 | 压缩到 58px，保留历史、新建、标题和语言切换 |
| 消息区 | 自动滚动到底部，用户消息和 AI 消息左右区分 |
| 输入区 | 底部固定，左右和底部边距统一为 16px |
| 发送按钮 | 加载状态直接替换发送图标 |
| AI 消息操作 | hover 时展示复制、点赞、点踩、重新生成等操作入口 |
| 语言切换 | 支持中文和英文，默认中文 |

整体设计目标是让插件像一个工作工具，而不是营销页或演示页：信息密度适中、控件位置稳定、常用操作直接可达。

## 当前支持的功能清单

| 功能 | 当前状态 | 用户价值 |
| --- | --- | --- |
| Chrome 本地 AI 对话 | 已支持 | 在浏览器内完成本地模型问答 |
| API 能力探测 | 已支持 | 明确知道当前浏览器哪些 AI API 可用 |
| 中文默认界面 | 已支持 | 降低中文用户使用成本 |
| 中英文切换 | 已支持 | 适配中英文使用环境 |
| 会话持久化 | 已支持 | 关闭插件后仍能保留历史 |
| 后台推理 | 已支持 | Popup 关闭后任务仍可继续 |
| Markdown 渲染 | 已支持 | AI 回复更易读 |
| 本地知识库导入 | 已支持 | 可把项目资料导入本地问答 |
| embedding 检索 | 已支持 | 用向量相似度召回相关片段 |
| 关键词兜底 | 已支持 | 提升短查询和兼容旧数据的稳定性 |
| 知识库管理 | 已支持 | 可查看、删除、清空已导入文件 |
| 引用来源展示 | 已支持 | 回答可追溯到本地文档片段 |

## 能得到什么结果

导入本地文档后，用户可以围绕文档内容提问。插件会先从 IndexedDB 检索相关片段，再让 Chrome 内置模型基于这些片段回答。

典型结果包括：

1. 对项目文档进行问答，例如“localAI 是否会上传我的文档？”
2. 对技术说明进行总结，例如“后台执行机制为什么能避免 popup 关闭后中断？”
3. 对产品能力进行解释，例如“这个插件目前支持哪些知识库文件？”
4. 根据本地资料生成结构化回答，例如表格、列表和引用来源。
5. 在回答底部看到命中的知识来源，便于判断回答依据。

如果用户导入 `examples/localai-knowledge-demo.md`，可以测试这些问题：

```text
localAI 是否会上传我的文档？
为什么 popup 关闭后 AI 还能继续运行？
localAI 当前支持哪些知识库文件格式？
本地知识库如何使用 embedding 检索？
Chrome Built-in AI 的语言声明有什么限制？
```

理想情况下，回答会优先引用该文档里的信息，并在关键结论后标注 `[1]`、`[2]` 等来源编号。

## 当前限制

localAI 现在仍有一些明确边界：

| 限制 | 影响 |
| --- | --- |
| Chrome Built-in AI 依赖浏览器版本和 flags | API 不可用时无法完成本地推理 |
| 默认 embedding 不是神经网络语义向量 | 同义词、深层语义和跨语言召回能力有限 |
| 仅支持 `.md` 和 `.txt` | PDF、DOCX 和图片知识暂不支持 |
| 检索结果没有独立评测集 | 召回质量主要靠人工测试判断 |
| 知识库没有分组和命名空间 | 多项目资料混用时需要用户手动管理 |
| 后台任务仅覆盖 Prompt 主流程 | 摘要、翻译等任务还没有完整后台工作流 |

这些限制不影响当前 MVP 的核心验证，但会决定后续迭代重点。

## 后续演进方向

建议后续按优先级推进：

1. 接入真正可用的本地 embedding 模型或 Chrome 官方 embedding API。
2. 增加知识库检索评测样例，记录查询、命中片段和期望答案。
3. 支持 PDF 和 DOCX 文本解析。
4. 增加知识库分组，让不同项目资料隔离。
5. 增加 chunk 预览和引用跳转，提升答案可验证性。
6. 把摘要、翻译、写作、改写等任务接入后台执行。

localAI 当前已经完成了本地 AI 插件的关键闭环：本地文档导入、本地检索、浏览器本地推理、后台执行和会话持久化。下一步的重点不是继续堆 UI，而是提升检索质量和结果可验证性。
