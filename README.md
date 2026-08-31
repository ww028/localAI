# localAI

中文 | [English](#english)

localAI 是一个 Chrome Manifest V3 插件，用于在浏览器本地完成 AI 对话和本地知识库问答。

项目会在可用时调用 Chrome Built-in AI API，把对话和知识库元数据保存在 IndexedDB，并通过 background service worker 与 offscreen document 保持长耗时推理任务运行，避免 popup 关闭导致任务中断。

## 当前能力

- 通过 Chrome `LanguageModel` 实现浏览器本地 AI 对话。
- 探测 `LanguageModel`、`Summarizer`、`Translator`、`LanguageDetector`、`Writer`、`Rewriter` 等 Chrome Built-in AI 能力。
- 支持导入 `.md` 和 `.txt` 文件作为本地知识库。
- 支持知识文档切片、本地 embedding 生成、余弦相似度检索和关键词兜底评分。
- 支持知识库管理 UI：查看已导入文件、删除单个文件、清空知识库。
- 支持检索增强生成：把命中的知识片段拼接进 prompt，并在 AI 回复中展示来源。
- 使用 IndexedDB 持久化历史会话，并在重新打开插件时恢复最近一次会话。
- 使用 `background.js` 和 `offscreen.html` 做后台推理，popup 关闭后任务仍可继续。
- 使用 Markdown 渲染 AI 回复，支持列表、代码块和 GFM 表格。
- 支持中文和英文界面，默认中文。
- 固定尺寸 popup UI，面向紧凑工作场景优化。

## 工作方式

```text
用户提问
  -> App 保存用户消息
  -> knowledgeStore 检索本地知识片段
  -> App 把检索片段拼接进 prompt
  -> background.js 把任务转发到 offscreen document
  -> offscreen.js 调用 Chrome LanguageModel.prompt()
  -> conversationStore 保存 AI 回复
  -> popup 重新打开后从 IndexedDB 恢复最新会话
```

知识库是本地优先的。导入的文档会在浏览器内读取、切分、生成本地向量并保存到 IndexedDB。当前默认 embedding 实现是确定性的本地 feature-hash 向量；如果后续浏览器提供兼容的 embedding API，检索层已经预留接入位置。

## 环境要求

- Node.js 20 或更新版本。
- Chrome Canary，或启用了相关 Chrome Built-in AI API 的 Chrome 版本。
- Chrome 中已配置必要的 Built-in AI flags 和模型资源。

常用 Chrome 页面：

- `chrome://flags/`
- `chrome://on-device-internals/`
- `chrome://extensions/`

Chrome Built-in AI API 仍处于实验阶段，可用性会受到 Chrome 版本、渠道、flags、平台支持和模型下载状态影响。如果 API 缺失或不可用，优先检查 Chrome 自身的 AI 和模型状态页面。

## 本地开发

安装依赖：

```bash
npm install
```

启动 Vite 开发服务：

```bash
npm run dev
```

这适合做 UI 开发。若要验证真实插件行为，需要构建后在 Chrome 中加载生成的 `dist/` 目录。

## 加载插件

构建插件：

```bash
npm run build
```

然后在 Chrome 中操作：

1. 打开 `chrome://extensions/`。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择本仓库生成的 `dist/` 目录。
5. 从浏览器工具栏 popup 或 Chrome side panel 打开 `localAI`。

## 常用脚本

```bash
npm run dev        # 启动本地开发服务
npm run build      # 类型检查并生成可加载的插件构建产物
npm run build:extension
npm run preview    # 预览生产构建
npm run typecheck  # 仅运行 TypeScript 检查
```

## 项目结构

```text
src/
  App.tsx                    # 主 React UI 和对话流程
  lib/chromeAi.ts            # Chrome Built-in AI 适配层
  lib/conversationStore.ts   # IndexedDB 会话存储
  lib/knowledgeStore.ts      # 本地知识导入、embedding、检索和删除
  styles/main.css            # Popup 布局和交互样式
  vite-env.d.ts              # 实验性 Chrome AI 类型声明
public/
  manifest.json              # Chrome 插件 manifest
  background.js              # MV3 service worker 和 offscreen 调度
  offscreen.html             # 承载长耗时 AI 任务的隐藏页面
  offscreen.js               # 后台 Prompt API 执行逻辑
docs/
  chrome-built-in-ai.md
  localai-extension-overview.md
examples/
  localai-knowledge-demo.md
```

## 文档

- [Chrome Built-in AI Notes](docs/chrome-built-in-ai.md)
- [localAI Chrome 插件实现与能力总览](docs/localai-extension-overview.md)
- [知识库测试文档](examples/localai-knowledge-demo.md)

## 当前限制

- Chrome Built-in AI 可用性依赖浏览器版本、flags、平台支持和模型资源。
- 当前默认 embedding 是本地 feature-hash 向量，不是真正的神经网络语义向量。
- 知识库导入暂时只支持 `.md` 和 `.txt`。
- 知识库还没有按项目或工作区分组。
- 后台执行目前覆盖主对话 Prompt 流程。

## 设计方向

localAI 会把浏览器 AI 调用、本地持久化和知识库检索收敛在小而稳定的模块里，让产品工作流在 Chrome 实验性 AI API 演进时仍然保持可维护。

当前主方向是本地优先 RAG：导入私有文档，在本地检索相关片段，再让 Chrome 端侧模型基于引用上下文回答。

## English

[中文](#localai) | English

localAI is a Chrome Manifest V3 extension for browser-local AI chat and local knowledge-base question answering.

The project uses Chrome Built-in AI APIs where available, stores conversations and knowledge metadata in IndexedDB, and keeps long-running prompt tasks alive through a background service worker plus an offscreen document.

## Current Capabilities

- Browser-local AI chat through Chrome `LanguageModel`.
- Capability checks for `LanguageModel`, `Summarizer`, `Translator`, `LanguageDetector`, `Writer`, and `Rewriter`.
- Local knowledge-base import for `.md` and `.txt` files.
- Knowledge chunking, local embedding generation, cosine-similarity retrieval, and keyword fallback scoring.
- Knowledge management UI for viewing imported files, deleting one file, or clearing the whole knowledge base.
- Retrieval-augmented prompting with source snippets and source labels in assistant replies.
- IndexedDB conversation persistence and recent conversation recovery.
- Background inference with `background.js` and `offscreen.html`, so popup closure does not interrupt running AI tasks.
- Markdown rendering for assistant replies, including lists, code blocks, and GFM tables.
- Chinese and English UI switching, with Chinese as the default language.
- Fixed-size popup UI optimized for a compact working surface.

## How It Works

```text
User asks a question
  -> App saves the user message
  -> knowledgeStore searches local document chunks
  -> App builds a prompt with retrieved snippets
  -> background.js forwards the job to the offscreen document
  -> offscreen.js calls Chrome LanguageModel.prompt()
  -> conversationStore saves the assistant response
  -> popup reloads the latest conversation from IndexedDB
```

The knowledge base is local-first. Imported documents are read in the browser, split into chunks, embedded locally, and stored in IndexedDB. The default embedding implementation is a deterministic local feature-hash vector. If a compatible browser embedding API becomes available, the retrieval layer is already structured to use it.

## Requirements

- Node.js 20 or newer.
- Chrome Canary or a Chrome version with the relevant Built-in AI APIs enabled.
- Built-in AI flags and model assets configured in Chrome.

Useful Chrome pages:

- `chrome://flags/`
- `chrome://on-device-internals/`
- `chrome://extensions/`

Chrome Built-in AI APIs are experimental and vary by version, channel, flags, and model download state. If an API is missing or unavailable, inspect Chrome's own AI/model pages first.

## Development

Install dependencies:

```bash
npm install
```

Run the Vite development server:

```bash
npm run dev
```

This is useful for UI development. For real extension behavior, build and load the generated `dist/` directory in Chrome.

## Load The Extension

Build the extension:

```bash
npm run build
```

Then in Chrome:

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this repo's `dist/` directory.
5. Open `localAI` from the toolbar popup or Chrome side panel.

## Scripts

```bash
npm run dev        # start local development server
npm run build      # typecheck and create loadable extension build
npm run build:extension
npm run preview    # preview production build
npm run typecheck  # run TypeScript checks only
```

## Project Structure

```text
src/
  App.tsx                    # Main React UI and chat workflow
  lib/chromeAi.ts            # Chrome Built-in AI adapter
  lib/conversationStore.ts   # IndexedDB conversation storage
  lib/knowledgeStore.ts      # Local knowledge import, embedding, retrieval, deletion
  styles/main.css            # Popup layout and interaction styles
  vite-env.d.ts              # Experimental Chrome AI type declarations
public/
  manifest.json              # Chrome extension manifest
  background.js              # MV3 service worker and offscreen orchestration
  offscreen.html             # Hidden document for long-running AI tasks
  offscreen.js               # Background Prompt API execution
docs/
  chrome-built-in-ai.md
  localai-extension-overview.md
examples/
  localai-knowledge-demo.md
```

## Documentation

- [Chrome Built-in AI Notes](docs/chrome-built-in-ai.md)
- [localAI Chrome 插件实现与能力总览](docs/localai-extension-overview.md)
- [Knowledge Base Demo Document](examples/localai-knowledge-demo.md)

## Current Limits

- Chrome Built-in AI availability depends on browser version, flags, platform support, and model assets.
- The default embedding path is a local feature-hash vector, not a neural semantic embedding model.
- Knowledge import currently supports `.md` and `.txt` only.
- Knowledge bases are not yet grouped by project or workspace.
- Background execution currently covers the main prompt workflow.

## Design Direction

localAI keeps browser AI calls, local persistence, and knowledge retrieval behind small modules so the product workflow can remain stable while Chrome's experimental AI APIs evolve.

The main product direction is local-first RAG: import private documents, retrieve relevant snippets locally, and ask Chrome's on-device model to answer with cited context.
