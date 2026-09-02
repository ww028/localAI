import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadMemoryModule() {
  const source = await readFile(new URL("../src/lib/assistantMemoryStore.ts", import.meta.url), "utf8");
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

const modulePromise = loadMemoryModule();

test("parseAssistantMemoryCommand handles explicit remember and forget commands", async () => {
  const { parseAssistantMemoryCommand } = await modulePromise;

  assert.deepEqual(parseAssistantMemoryCommand("记住：我喜欢结构化计划"), {
    type: "remember",
    content: "我喜欢结构化计划",
  });
  assert.deepEqual(parseAssistantMemoryCommand("忘记：结构化计划"), {
    type: "forget",
    query: "结构化计划",
  });
  assert.deepEqual(parseAssistantMemoryCommand("删除张三相关的信息"), {
    type: "forget",
    query: "张三",
  });
  assert.deepEqual(parseAssistantMemoryCommand("删除个人记忆里张三相关的信息"), {
    type: "forget",
    query: "张三",
  });
  assert.deepEqual(parseAssistantMemoryCommand("删除个人记忆关于张三的信息吧"), {
    type: "forget",
    query: "张三",
  });
  assert.deepEqual(parseAssistantMemoryCommand("删除个人记忆里关于张三和李四的信息吧"), {
    type: "forget",
    query: "张三和李四",
  });
});

test("detectAssistantMemorySuggestion identifies stable preferences and facts", async () => {
  const { detectAssistantMemorySuggestion } = await modulePromise;

  const preference = detectAssistantMemorySuggestion("我喜欢默认用中文回答", "zh");
  assert.equal(preference.type, "preference");
  assert.equal(preference.risk, "low");

  const fact = detectAssistantMemorySuggestion("我的项目叫 localAI", "zh");
  assert.equal(fact.type, "project");
  assert.equal(fact.risk, "medium");

  assert.equal(detectAssistantMemorySuggestion("今天随便聊聊", "zh"), undefined);
});

test("classifyMemoryType classifies reusable memory categories", async () => {
  const { classifyMemoryType } = await modulePromise;

  assert.equal(classifyMemoryType("我喜欢紧凑 UI"), "preference");
  assert.equal(classifyMemoryType("这个项目使用 IndexedDB"), "project");
  assert.equal(classifyMemoryType("下次继续发布 checklist"), "task");
  assert.equal(classifyMemoryType("我的名字是 Allen"), "fact");
});

test("isAssistantMemoryDeletionMatch is conservative for weakly related memories", async () => {
  const { isAssistantMemoryDeletionMatch } = await modulePromise;

  assert.equal(
    isAssistantMemoryDeletionMatch("红色是一只猫", {
      content: "红色是一只猫",
      keywords: ["红色", "是一", "一只", "只猫"],
    }),
    true,
  );
  assert.equal(
    isAssistantMemoryDeletionMatch("红色是一只猫", {
      content: "张三是一条狗",
      keywords: ["张三", "是一", "一条", "条狗"],
    }),
    false,
  );
});

test("isAssistantMemoryDeletionMatch handles multiple deletion targets", async () => {
  const { isAssistantMemoryDeletionMatch } = await modulePromise;

  assert.equal(
    isAssistantMemoryDeletionMatch("张三和李四", {
      content: "张三是一条狗",
      keywords: ["张三", "是一", "一条", "条狗"],
    }),
    true,
  );
  assert.equal(
    isAssistantMemoryDeletionMatch("张三和李四", {
      content: "李四是一只猫",
      keywords: ["李四", "是一", "一只", "只猫"],
    }),
    true,
  );
  assert.equal(
    isAssistantMemoryDeletionMatch("张三和李四", {
      content: "王五是一只鸟",
      keywords: ["王五", "是一", "一只", "只鸟"],
    }),
    false,
  );
});
