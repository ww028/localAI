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
  assert.deepEqual(parseAssistantMemoryCommand("记住张三是一条狗"), {
    type: "remember",
    content: "张三是一条狗",
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

test("memory fact keys normalize equivalent predicates into one slot", async () => {
  const {
    getAssistantMemoryFactKey,
    hasSameAssistantMemoryFactSlot,
    normalizeAssistantMemoryFactPredicate,
  } = await modulePromise;
  const base = {
    subject: "张三",
    predicate: "身份",
    value: "狗",
    confidence: 0.9,
    sourceText: "张三是狗",
    normalizedText: "张三是狗",
  };

  assert.equal(normalizeAssistantMemoryFactPredicate("物种"), "identity");
  assert.equal(getAssistantMemoryFactKey(base), "张三:identity");
  assert.equal(getAssistantMemoryFactKey({ ...base, predicate: "identity", value: "猫" }), "张三:identity");
  assert.equal(
    hasSameAssistantMemoryFactSlot([base], [{ ...base, predicate: "identity", value: "猫" }]),
    true,
  );
  assert.equal(
    hasSameAssistantMemoryFactSlot([base], [{ ...base, predicate: "preference", value: "喜欢猫" }]),
    false,
  );
});

test("filterSourceGroundedAssistantMemoryFacts rejects unsupported model inventions", async () => {
  const { filterSourceGroundedAssistantMemoryFacts } = await modulePromise;
  const sourceText = "张三是一条狗";
  const facts = [
    {
      subject: "张三",
      predicate: "identity",
      value: "狗",
      confidence: 0.9,
      sourceText,
      normalizedText: "张三是狗",
    },
    {
      subject: "张三",
      predicate: "name",
      value: "张三",
      confidence: 0.9,
      sourceText,
      normalizedText: "张三的名字是张三",
    },
  ];

  assert.deepEqual(
    filterSourceGroundedAssistantMemoryFacts(facts, sourceText).map((fact) => fact.normalizedText),
    ["张三是狗"],
  );
});

test("createAssistantMemoryWriteDecision enforces fact-slot replacement over model save_new", async () => {
  const { createAssistantMemoryWriteDecision } = await modulePromise;
  const existingMemory = {
    id: "memory-1",
    type: "fact",
    content: "张三是狗",
    sourceText: "张三是狗",
    facts: [
      {
        subject: "张三",
        predicate: "物种",
        value: "狗",
        confidence: 0.9,
        sourceText: "张三是狗",
        normalizedText: "张三是狗",
      },
    ],
    keywords: ["张三", "是狗"],
    createdAt: 1,
    updatedAt: 1,
  };
  const nextFact = {
    subject: "张三",
    predicate: "identity",
    value: "猫",
    confidence: 0.9,
    sourceText: "张三是猫",
    normalizedText: "张三是猫",
  };
  const decision = createAssistantMemoryWriteDecision({
    content: "张三是猫",
    facts: [nextFact],
    memoryType: "fact",
    relatedMemories: [existingMemory],
    modelDecision: {
      action: "save_new",
      content: "张三是猫",
      memoryType: "fact",
      rationale: "模型错误地建议新增。",
    },
  });

  assert.equal(decision.action, "replace_existing");
  assert.equal(decision.existingMemoryId, "memory-1");
  assert.equal(decision.content, "张三是猫");
});

test("mergeAssistantMemoryFacts replaces same slots and keeps complementary facts", async () => {
  const { mergeAssistantMemoryFacts } = await modulePromise;
  const existingFacts = [
    {
      subject: "张三",
      predicate: "物种",
      value: "狗",
      confidence: 0.9,
      sourceText: "张三是狗，张三住在北京",
      normalizedText: "张三是狗",
    },
    {
      subject: "张三",
      predicate: "location",
      value: "北京",
      confidence: 0.9,
      sourceText: "张三是狗，张三住在北京",
      normalizedText: "张三住在北京",
    },
  ];
  const incomingFacts = [
    {
      subject: "张三",
      predicate: "identity",
      value: "猫",
      confidence: 0.9,
      sourceText: "张三是猫",
      normalizedText: "张三是猫",
    },
  ];

  const mergedFacts = mergeAssistantMemoryFacts(existingFacts, incomingFacts);

  assert.equal(mergedFacts.length, 2);
  assert.deepEqual(
    mergedFacts.map((fact) => [fact.predicate, fact.value]),
    [
      ["identity", "猫"],
      ["location", "北京"],
    ],
  );
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
