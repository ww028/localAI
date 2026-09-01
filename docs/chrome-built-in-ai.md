# Chrome Built-in AI 说明

## 运行模型

Chrome Built-in AI API 是浏览器提供的实验性端侧 AI 能力。当 Chrome 版本、feature flags、平台能力和模型资源都满足条件时，相关 API 会以全局对象的形式暴露在 `window` 上。

localAI 当前把 Chrome AI 调用分成两类：

1. 能力探测和普通 UI 调用：通过 `src/lib/chromeAi.ts` 在页面上下文中完成。
2. 主对话 Prompt 流程：通过 `background.js` 创建 `offscreen.html`，再由 `offscreen.js` 在隐藏页面中调用 `LanguageModel.prompt()`。

不能把 Chrome Built-in AI 调用直接放进 Manifest V3 service worker。service worker 不是普通页面上下文，很多浏览器 AI API 不会在那里暴露。需要后台继续执行时，应使用 offscreen document 作为承载页面。

## 通用调用流程

项目中对 Chrome AI API 的调用遵循同一套流程：

1. 找到对应的全局 factory，例如 `window.LanguageModel`。
2. 如果 API 支持 `availability()`，先检查当前能力是否可用。
3. 创建 session，必要时监听模型下载进度。
4. 执行任务对应的方法，例如 `prompt()`、`summarize()`、`translate()`。
5. 任务结束后调用 `destroy()` 释放 session。

这套流程集中封装在 `src/lib/chromeAi.ts`，UI 层只按任务名称调用适配器，避免 Chrome 实验 API 变化直接扩散到组件代码里。

## 当前适配的任务

| 任务            | Chrome 全局对象           | Session 方法  | 当前用途                                 |
| --------------- | ------------------------- | ------------- | ---------------------------------------- |
| Prompt          | `window.LanguageModel`    | `prompt()`    | 主对话、本地知识库增强问答               |
| Summarize       | `window.Summarizer`       | `summarize()` | 输入区轻量摘要动作                       |
| Translate       | `window.Translator`       | `translate()` | 输入区中英互译动作，根据输入自动选择方向 |
| Detect language | `window.LanguageDetector` | `detect()`    | 能力探测和后续语言检测扩展               |
| Write           | `window.Writer`           | `write()`     | 输入区轻量写作动作                       |
| Rewrite         | `window.Rewriter`         | `rewrite()`   | 输入区润色改写动作，默认让表达更清晰自然 |

当前主对话和网页助手使用 Prompt API。摘要、翻译、写作、改写已经接入输入区轻量动作，并通过后台 offscreen document 执行。
如果某个专用 API 在 offscreen 后台页面不可用，系统会退回到 Prompt API，用明确的任务提示词完成同等语义的处理。

## 后台 AI 执行

Chrome 插件 popup 被关闭后，popup 页面会销毁。如果 Prompt 直接运行在 popup 页面中，正在执行的任务会被中断。

localAI 使用 Manifest V3 的 background service worker 和 offscreen document 解决这个问题：

1. `App.tsx` 先把会话状态保存为 `running`。
2. `App.tsx` 通过 `chrome.runtime.sendMessage()` 把任务发送给 `background.js`。
3. `background.js` 调用 `chrome.offscreen.createDocument()` 创建或复用 `offscreen.html`。
4. `offscreen.js` 在隐藏页面中按任务调用 `LanguageModel.prompt()`、`Summarizer.summarize()`、`Translator.translate()`、`Writer.write()` 或 `Rewriter.rewrite()`。
5. 推理完成后，`offscreen.js` 把 AI 回复写回 IndexedDB。
6. popup 重新打开后从 IndexedDB 恢复最新会话。

这个设计的重点是：service worker 只做调度，真正的浏览器 AI 调用仍运行在页面上下文里。

## 兼容性规则

Chrome Built-in AI API 仍在快速演进，不同 Chrome 版本、渠道和 flags 下可能存在差异。

维护时遵循这些规则：

- 直接访问 Chrome AI 全局对象的代码应尽量集中在 `src/lib/chromeAi.ts` 或 `public/offscreen.js`。
- UI 组件不要直接读写 `window.LanguageModel` 等实验性 API。
- 每次创建 session 前优先调用 `availability()`，避免在不可用状态下直接执行任务。
- Prompt 主流程必须考虑 popup 关闭场景，不能回退到只在 popup 内执行。
- 新增 AI 能力时，先补适配层，再接 UI。

## 手工检查

调试 Chrome Built-in AI 时，可以按下面步骤检查：

1. 打开 `chrome://flags/`，确认相关 Built-in AI flags 已开启。
2. 打开 `chrome://on-device-internals/`，检查模型下载和运行状态。
3. 执行 `npm run build`。
4. 在 `chrome://extensions/` 中加载生成的 `dist/` 目录。
5. 在 Chrome 中测试插件，不要用 Safari 或 Firefox。
6. 关闭 popup 后等待后台任务完成，再重新打开插件确认会话是否恢复。
7. 提交前执行 `npm run typecheck` 或 `npm run build`。

## 常见问题

### 为什么不能直接在 background service worker 里调用 AI API？

Manifest V3 service worker 不是页面环境，Chrome Built-in AI API 通常不会在那里暴露。offscreen document 是隐藏页面，更适合承载需要页面上下文的长耗时任务。

### 为什么有时 API 显示不可用？

可能原因包括 Chrome 版本不支持、flags 没打开、模型资源未下载、平台不支持或 API 参数不满足当前实验版本要求。

### 为什么代码里要保留能力探测？

Chrome Built-in AI API 还不稳定。能力探测可以让 UI 明确展示当前浏览器是否支持目标能力，也能避免不可用时直接触发运行错误。
