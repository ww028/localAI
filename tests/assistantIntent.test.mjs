import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadAssistantIntentModule() {
  const source = await readFile(new URL("../src/lib/assistantIntent.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;

  return import(dataUrl);
}

const modulePromise = loadAssistantIntentModule();

test("detectAssistantIntent identifies deterministic calculation tasks", async () => {
  const { detectAssistantIntent } = await modulePromise;
  const intent = detectAssistantIntent("帮我计算 12 + 30 的合计", "zh");

  assert.equal(intent.type, "calculate");
  assert.equal(intent.executionMode, "deterministic");
  assert.deepEqual(intent.requiredTools, ["calculator"]);
  assert.equal(intent.entities.numbers, "12, 30");
});

test("detectAssistantIntent identifies sort and format conversion tasks", async () => {
  const { detectAssistantIntent } = await modulePromise;

  assert.equal(detectAssistantIntent("把 3,1,2 从小到大排序", "zh").type, "sort");

  const formatIntent = detectAssistantIntent("把下面内容转成 JSON", "zh");
  assert.equal(formatIntent.type, "format_convert");
  assert.equal(formatIntent.executionMode, "deterministic");
  assert.equal(formatIntent.entities.targetFormat, "json");
});

test("detectAssistantIntent identifies date-time and text statistics tasks", async () => {
  const { detectAssistantIntent } = await modulePromise;

  const dateIntent = detectAssistantIntent("2026-09-02 到 2026-09-12 日期差", "zh");
  assert.equal(dateIntent.type, "date_time");
  assert.equal(dateIntent.executionMode, "deterministic");
  assert.deepEqual(dateIntent.requiredTools, ["date-calculator"]);

  const textStatsIntent = detectAssistantIntent("统计这段文本的词频和重复项", "zh");
  assert.equal(textStatsIntent.type, "text_stats");
  assert.equal(textStatsIntent.executionMode, "deterministic");
  assert.deepEqual(textStatsIntent.requiredTools, ["text-statistics"]);
});

test("detectAssistantIntent identifies knowledge and planning tasks", async () => {
  const { detectAssistantIntent } = await modulePromise;

  const knowledgeIntent = detectAssistantIntent("根据知识库回答这个项目的架构", "zh");
  assert.equal(knowledgeIntent.type, "knowledge_qa");
  assert.equal(knowledgeIntent.executionMode, "retrieve");

  const planIntent = detectAssistantIntent("How to implement the next roadmap step?", "en");
  assert.equal(planIntent.type, "plan");
  assert.equal(planIntent.executionMode, "hybrid");
});

test("detectAssistantIntent identifies memory operations", async () => {
  const { detectAssistantIntent } = await modulePromise;
  const intent = detectAssistantIntent("删除个人记忆里关于张三和李四的信息吧", "zh");
  const implicitMemoryIntent = detectAssistantIntent("删除张三和李四的信息", "zh");

  assert.equal(intent.type, "memory_operation");
  assert.equal(intent.executionMode, "deterministic");
  assert.deepEqual(intent.requiredTools, ["memory-planner", "memory-store"]);
  assert.equal(implicitMemoryIntent.type, "memory_operation");
  assert.equal(implicitMemoryIntent.executionMode, "deterministic");
});

test("detectAssistantIntent falls back to chat for ordinary conversation", async () => {
  const { detectAssistantIntent } = await modulePromise;
  const intent = detectAssistantIntent("你好，今天聊点什么？", "zh");

  assert.equal(intent.type, "chat");
  assert.equal(intent.executionMode, "answer");
  assert.deepEqual(intent.requiredTools, ["language-model"]);
});
