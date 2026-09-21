# 知识库检索评测

localAI 的知识库检索目前使用本地向量相似度和关键词评分。为了避免只靠临时手工提问判断效果，项目提供了一个结构化评测样例：

- 评测集：`examples/knowledge-retrieval-eval.json`
- 测试文档：`examples/localai-knowledge-demo.md`

当前检索流程采用两阶段排序：先用向量相似度和关键词分数扩大候选集，再用 rerank 层综合词项覆盖率、短语命中、文档名命中和词项密度重新排序。调整这些权重后，应重新跑本评测集。

## 评测目标

评测样例用于检查三件事：

1. 用户 query 是否能召回期望文档片段。
2. AI 回复是否覆盖期望答案要点。
3. AI 回复是否避免把未支持能力或外部事实编造成结论。

## 样例结构

每个 case 包含：

| 字段                   | 说明                                   |
| ---------------------- | -------------------------------------- |
| `id`                   | 稳定用例 ID，便于后续自动化和回归记录  |
| `query`                | 用户提问                               |
| `expectedHits`         | 期望检索命中的文档、章节和片段关键词   |
| `expectedAnswerPoints` | 期望 AI 回复覆盖的答案要点和禁止性要求 |

`expectedHits[].mustAppearInSnippet` 是最小检查项。手工检查时，点击回答下方的引用来源，确认预览片段里包含这些关键词。

## 手工评测流程

1. 构建并加载插件：

```bash
npm run build
```

2. 在 Chrome 扩展页加载 `dist/`。
3. 打开 localAI。
4. 在“知识库”中选择目标知识空间，例如默认的“个人资料”。
5. 导入 `examples/localai-knowledge-demo.md`。
6. 打开 `examples/knowledge-retrieval-eval.json`，逐条复制 `cases[].query` 提问。
7. 检查回答底部引用来源：
   - 来源文档应匹配 `expectedHits[].documentName`。
   - 点击来源后，chunk 预览应包含 `mustAppearInSnippet` 中的关键文本。
8. 检查回答正文是否覆盖 `expectedAnswerPoints`。

## 记录结果

建议记录为：

| case id                 | top hit 是否正确 | 引用片段是否覆盖关键词 | 回答要点是否覆盖 | 备注 |
| ----------------------- | ---------------- | ---------------------- | ---------------- | ---- |
| privacy-local-documents | pass/fail        | pass/fail              | pass/fail        |      |

当检索逻辑、chunk 切分、embedding 策略或 rerank 策略变化时，应重新跑这组样例。

## 后续自动化方向

当前评测集先作为人工基线。后续可以增加浏览器内评测 runner：

1. 自动导入测试文档到独立知识空间。
2. 对每个 query 调用 `searchKnowledge()`。
3. 检查 top-k 结果是否包含 `mustAppearInSnippet`。
4. 导出 JSON 报告，用于比较不同检索策略的变化。


## 扩展评测集

除知识库检索评测外，项目还提供以下人工基线评测集：

- `examples/memory-answer-eval.json`：检查个人记忆问答、二人称改写和本地证据边界。
- `examples/memory-operation-eval.json`：检查 remember / forget 的结构化解析与覆盖策略。
- `examples/prompt-injection-eval.json`：检查网页正文和知识库中的恶意指令不会被执行。

建议在调整记忆系统、输出护栏、Prompt 约束或 finalize 流程后，一并回归这些评测集。


## 最小评测 Runner

项目当前提供一个最小可用的评测脚本：

```bash
npm run eval
```

当前脚本会对知识库评测集执行基于当前 chunk 切分逻辑的内存检索命中检查，并输出一份 Markdown 摘要报告。其他评测集当前仍以结构校验和人工基线为主，后续可以继续把它们接到 answer-level 回归执行器。
