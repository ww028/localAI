import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadAssistantPromptModule() {
  const source = await readFile(new URL("../src/lib/assistantPrompt.ts", import.meta.url), "utf8");
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

const modulePromise = loadAssistantPromptModule();

function createContextPlanFixture(overrides = {}) {
  return {
    subject: "external",
    memoryOperation: { action: "none" },
    memoryMode: "answer_source",
    knowledgeMode: "cite",
    requiresLocalEvidence: false,
    visibleSources: ["knowledge", "memory"],
    shouldCompareWithGeneralKnowledge: false,
    responseConstraints: [
      "个人记忆里的第一人称表达来自用户原话，回答时要转换成自然二人称。",
    ],
    rationale: "测试上下文策略。",
    ...overrides,
  };
}

test("buildAssistantPrompt creates a partitioned Chinese assistant prompt", async () => {
  const { buildAssistantPrompt } = await modulePromise;
  const prompt = buildAssistantPrompt({
    question: "这个项目下一步做什么？",
    locale: "zh",
    intent: {
      type: "plan",
      confidence: 0.8,
      executionMode: "hybrid",
      requiredTools: ["planner", "language-model"],
      entities: {},
      rationale: "用户要求规划或拆解任务，需要输出结构化步骤。",
    },
    plan: {
      id: "plan-1",
      intentType: "plan",
      executionMode: "hybrid",
      summary: "把目标拆解成可执行步骤和依赖工具。",
      requiredTools: ["planner", "language-model"],
      steps: [
        {
          id: "step-1",
          title: "澄清目标",
          description: "识别目标、约束、输入和预期输出。",
          tool: "planner",
          status: "pending",
          deterministic: true,
        },
      ],
      needsModelPolish: true,
      rationale: "用户要求规划或拆解任务，需要输出结构化步骤。",
    },
    deterministicExecution: {
      handled: true,
      tool: "calculator",
      resultText: "表达式：1+2\n结果：3",
      resultData: {
        expression: "1+2",
        result: 3,
      },
    },
    contextPlan: createContextPlanFixture(),
    memories: [
      {
        id: "memory-1",
        type: "preference",
        content: "用户偏好简洁直接的回答",
        keywords: ["简洁", "直接"],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    sources: [
      {
        documentId: "doc-1",
        spaceId: "default",
        documentName: "roadmap.md",
        chunkIndex: 0,
        text: "迭代 5 要先实现意图识别器。",
        score: 0.92,
      },
    ],
    recentMessages: [
      {
        id: "message-1",
        role: "user",
        text: "继续按 todo 实现",
      },
    ],
  });

  assert.match(prompt, /工作原则/);
  assert.match(prompt, /结构化意图/);
  assert.match(prompt, /"type": "plan"/);
  assert.match(prompt, /"executionMode": "hybrid"/);
  assert.match(prompt, /结构化计划/);
  assert.match(prompt, /"id": "plan-1"/);
  assert.match(prompt, /"tool": "planner"/);
  assert.match(prompt, /确定性执行结果/);
  assert.match(prompt, /结果：3/);
  assert.match(prompt, /不要重新计算/);
  assert.match(prompt, /最近会话上下文/);
  assert.match(prompt, /上下文使用策略/);
  assert.match(prompt, /"memoryMode": "answer_source"/);
  assert.match(prompt, /个人记忆/);
  assert.match(prompt, /本地知识库片段/);
  assert.match(prompt, /本地个人事实: 用户偏好简洁直接的回答/);
  assert.match(prompt, /回答前先理解事实、对象和关系/);
  assert.match(prompt, /不要照抄原句/);
  assert.match(prompt, /\[1\] roadmap\.md #1/);
  assert.match(prompt, /用户问题：\n这个项目下一步做什么？/);
});

test("buildAssistantPrompt creates explicit empty sections in English", async () => {
  const { buildAssistantPrompt } = await modulePromise;
  const prompt = buildAssistantPrompt({
    question: "What can you do?",
    locale: "en",
    memories: [],
    sources: [],
    recentMessages: [],
    contextPlan: createContextPlanFixture({
      memoryMode: "none",
      knowledgeMode: "none",
      visibleSources: [],
    }),
  });

  assert.match(prompt, /Operating rules/);
  assert.match(prompt, /Context Usage Plan/);
  assert.match(prompt, /Structured intent: none/);
  assert.match(prompt, /Structured plan: none/);
  assert.match(prompt, /Deterministic execution result: none/);
  assert.match(prompt, /Recent conversation context: none/);
  assert.match(prompt, /Personal memories: none/);
  assert.match(prompt, /Local knowledge snippets: none/);
  assert.match(prompt, /User question:\nWhat can you do\?/);
});
