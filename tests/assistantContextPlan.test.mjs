import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadAssistantContextPlanModule() {
  const source = await readFile(new URL("../src/lib/assistantContextPlan.ts", import.meta.url), "utf8");
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

const modulePromise = loadAssistantContextPlanModule();

test("createContextPlan cites built-in knowledge sources for usage questions", async () => {
  const { createContextPlan } = await modulePromise;
  const contextPlan = createContextPlan({
    question: "这个 AI 怎么用？",
    locale: "zh",
    intent: {
      type: "chat",
      confidence: 0.5,
      executionMode: "answer",
      requiredTools: ["language-model"],
      entities: {},
      rationale: "普通对话。",
    },
    sources: [
      {
        documentId: "builtin:localai-usage",
        spaceId: "builtin",
        documentName: "localAI 使用说明",
        chunkIndex: 0,
        text: "localAI 使用说明",
        score: 1000,
      },
    ],
    memories: [],
  });

  assert.equal(contextPlan.knowledgeMode, "cite");
  assert.deepEqual(contextPlan.visibleSources, ["knowledge"]);
  assert.deepEqual(contextPlan.memoryOperation, { action: "none" });
});

test("createContextPlan includes structured memory deletion targets", async () => {
  const { createContextPlan } = await modulePromise;
  const contextPlan = createContextPlan({
    question: "删除个人记忆里关于张三和李四的信息吧",
    locale: "zh",
    intent: {
      type: "memory_operation",
      confidence: 0.9,
      executionMode: "deterministic",
      requiredTools: ["memory-planner", "memory-store"],
      entities: {},
      rationale: "用户要求新增、删除或修改个人记忆。",
    },
    sources: [],
    memories: [],
  });

  assert.equal(contextPlan.memoryOperation.action, "forget");
  assert.deepEqual(contextPlan.memoryOperation.targets, ["张三", "李四"]);

  const implicitContextPlan = createContextPlan({
    question: "删除张三和李四的信息",
    locale: "zh",
    intent: {
      type: "memory_operation",
      confidence: 0.9,
      executionMode: "deterministic",
      requiredTools: ["memory-planner", "memory-store"],
      entities: {},
      rationale: "用户要求新增、删除或修改个人记忆。",
    },
    sources: [],
    memories: [],
  });
  assert.equal(implicitContextPlan.memoryOperation.action, "forget");
  assert.deepEqual(implicitContextPlan.memoryOperation.targets, ["张三", "李四"]);
});

test("createContextPlan accepts model-planned memory operations", async () => {
  const { createContextPlan } = await modulePromise;
  const modelPlannedOperation = {
    action: "remember",
    content: "我的猫叫薯条",
    memoryType: "fact",
    targets: ["薯条"],
    confidence: 0.93,
    rationale: "模型理解为一条关于用户宠物的长期事实。",
  };
  const contextPlan = createContextPlan({
    question: "记住：我家的猫名字叫薯条",
    locale: "zh",
    intent: {
      type: "memory_operation",
      confidence: 0.9,
      executionMode: "deterministic",
      requiredTools: ["memory-planner", "memory-store"],
      entities: {},
      rationale: "用户要求新增、删除或修改个人记忆。",
    },
    sources: [],
    memories: [],
    memoryOperation: modelPlannedOperation,
  });

  assert.deepEqual(contextPlan.memoryOperation, modelPlannedOperation);
});
