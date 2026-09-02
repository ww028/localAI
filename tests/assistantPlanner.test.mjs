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

test("createAssistantPlan builds structured memory operation steps", async () => {
  const { createAssistantPlan } = await modulePromise;
  const plan = createAssistantPlan({
    type: "memory_operation",
    confidence: 0.9,
    executionMode: "deterministic",
    requiredTools: ["memory-planner", "memory-store"],
    entities: {},
    rationale: "用户要求新增、删除或修改个人记忆。",
  }, "删除个人记忆里关于张三和李四的信息吧", "zh");

  assert.equal(plan.intentType, "memory_operation");
  assert.equal(plan.executionMode, "deterministic");
  assert.deepEqual(plan.requiredTools, ["memory-planner", "memory-store"]);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].tool, "memory-planner");
  assert.equal(plan.steps[1].tool, "memory-store");
});

test("createAssistantPlan builds deterministic date-time and text statistics steps", async () => {
  const { createAssistantPlan } = await modulePromise;

  const datePlan = createAssistantPlan({
    type: "date_time",
    confidence: 0.88,
    executionMode: "deterministic",
    requiredTools: ["date-calculator"],
    entities: {},
    rationale: "用户要求日期计算。",
  }, "2026-09-02 10天后", "zh");
  assert.equal(datePlan.intentType, "date_time");
  assert.equal(datePlan.steps[0].tool, "date-calculator");
  assert.equal(datePlan.steps[0].deterministic, true);

  const textStatsPlan = createAssistantPlan({
    type: "text_stats",
    confidence: 0.84,
    executionMode: "deterministic",
    requiredTools: ["text-statistics"],
    entities: {},
    rationale: "用户要求文本统计。",
  }, "统计词频：apple apple", "zh");
  assert.equal(textStatsPlan.intentType, "text_stats");
  assert.equal(textStatsPlan.steps[0].tool, "text-statistics");
  assert.equal(textStatsPlan.steps[1].deterministic, true);
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
