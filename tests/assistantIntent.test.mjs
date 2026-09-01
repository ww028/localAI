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

test("detectAssistantIntent identifies knowledge and planning tasks", async () => {
  const { detectAssistantIntent } = await modulePromise;

  const knowledgeIntent = detectAssistantIntent("根据知识库回答这个项目的架构", "zh");
  assert.equal(knowledgeIntent.type, "knowledge_qa");
  assert.equal(knowledgeIntent.executionMode, "retrieve");

  const planIntent = detectAssistantIntent("How to implement the next roadmap step?", "en");
  assert.equal(planIntent.type, "plan");
  assert.equal(planIntent.executionMode, "hybrid");
});

test("detectAssistantIntent falls back to chat for ordinary conversation", async () => {
  const { detectAssistantIntent } = await modulePromise;
  const intent = detectAssistantIntent("你好，今天聊点什么？", "zh");

  assert.equal(intent.type, "chat");
  assert.equal(intent.executionMode, "answer");
  assert.deepEqual(intent.requiredTools, ["language-model"]);
});

