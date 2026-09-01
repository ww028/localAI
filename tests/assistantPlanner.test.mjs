import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadAssistantPlannerModule() {
  const source = await readFile(new URL("../src/lib/assistantPlanner.ts", import.meta.url), "utf8");
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

const modulePromise = loadAssistantPlannerModule();

test("createAssistantPlan builds deterministic calculation steps", async () => {
  const { createAssistantPlan } = await modulePromise;
  const plan = createAssistantPlan({
    type: "calculate",
    confidence: 0.9,
    executionMode: "deterministic",
    requiredTools: ["calculator"],
    entities: { numbers: "12, 30" },
    rationale: "用户要求进行数值计算，适合后续由确定性程序执行。",
  }, "帮我计算 12 + 30", "zh");

  assert.match(plan.id, /^calculate-/);
  assert.equal(plan.intentType, "calculate");
  assert.equal(plan.executionMode, "deterministic");
  assert.deepEqual(plan.requiredTools, ["calculator", "language-model"]);
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[0].tool, "calculator");
  assert.equal(plan.steps[1].deterministic, true);
  assert.equal(plan.steps[2].tool, "language-model");
  assert.equal(plan.needsModelPolish, true);
});

test("createAssistantPlan builds retrieval plan for knowledge questions", async () => {
  const { createAssistantPlan } = await modulePromise;
  const plan = createAssistantPlan({
    type: "knowledge_qa",
    confidence: 0.68,
    executionMode: "retrieve",
    requiredTools: ["knowledge-search", "language-model"],
    entities: {},
    rationale: "用户问题可能需要检索本地知识库并引用来源。",
  }, "根据知识库回答架构", "zh");

  assert.equal(plan.intentType, "knowledge_qa");
  assert.equal(plan.steps[0].tool, "knowledge-search");
  assert.equal(plan.steps[0].deterministic, true);
  assert.equal(plan.steps[1].tool, "language-model");
});

test("formatAssistantPlan serializes the executable plan", async () => {
  const { createAssistantPlan, formatAssistantPlan } = await modulePromise;
  const plan = createAssistantPlan({
    type: "sort",
    confidence: 0.86,
    executionMode: "deterministic",
    requiredTools: ["sorter"],
    entities: { numbers: "3, 1, 2" },
    rationale: "用户要求排序，适合后续由确定性排序工具处理。",
  }, "把 3,1,2 从小到大排序", "zh");
  const formatted = formatAssistantPlan(plan, "zh");

  assert.match(formatted, /结构化计划/);
  assert.match(formatted, /"intentType": "sort"/);
  assert.match(formatted, /"tool": "sorter"/);
});

