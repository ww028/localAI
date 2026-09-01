import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadExecutorModule() {
  const source = await readFile(new URL("../src/lib/assistantDeterministicExecutor.ts", import.meta.url), "utf8");
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

const modulePromise = loadExecutorModule();

const basePlan = {
  id: "plan-1",
  intentType: "calculate",
  executionMode: "deterministic",
  summary: "test",
  requiredTools: ["calculator"],
  steps: [
    {
      id: "step-1",
      title: "执行",
      description: "执行确定性步骤",
      tool: "calculator",
      status: "pending",
      deterministic: true,
    },
  ],
  needsModelPolish: true,
  rationale: "test",
};

function intent(type, entities = {}) {
  return {
    type,
    confidence: 0.9,
    executionMode: "deterministic",
    requiredTools: [],
    entities,
    rationale: "test",
  };
}

test("executeDeterministicTask calculates arithmetic and aggregate expressions", async () => {
  const { executeDeterministicTask } = await modulePromise;

  const arithmetic = executeDeterministicTask("计算 (12 + 30) / 2", intent("calculate"), basePlan, "zh");
  assert.equal(arithmetic.handled, true);
  assert.equal(arithmetic.resultData.result, 21);

  const sum = executeDeterministicTask("合计 1, 2, 3", intent("calculate"), basePlan, "zh");
  assert.equal(sum.resultData.result, 6);

  const percentage = executeDeterministicTask("20 占 50 的百分比", intent("calculate"), basePlan, "zh");
  assert.equal(percentage.resultData.result, 40);
});

test("executeDeterministicTask sorts numeric items deterministically", async () => {
  const { executeDeterministicTask } = await modulePromise;
  const plan = {
    ...basePlan,
    intentType: "sort",
    requiredTools: ["sorter"],
    steps: [{ ...basePlan.steps[0], tool: "sorter" }],
  };
  const execution = executeDeterministicTask("把 3, 1, 20 从小到大排序", intent("sort"), plan, "zh");

  assert.equal(execution.handled, true);
  assert.equal(execution.tool, "sorter");
  assert.deepEqual(execution.resultData.sortedItems, ["1", "3", "20"]);
});

test("executeDeterministicTask converts simple records to JSON and markdown table", async () => {
  const { executeDeterministicTask } = await modulePromise;
  const plan = {
    ...basePlan,
    intentType: "format_convert",
    requiredTools: ["formatter"],
    steps: [{ ...basePlan.steps[0], tool: "formatter" }],
  };

  const json = executeDeterministicTask(
    "转成 JSON：name=Alice, age=18; name=Bob, age=20",
    intent("format_convert", { targetFormat: "json" }),
    plan,
    "zh",
  );
  assert.match(json.resultText, /"name": "Alice"/);
  assert.deepEqual(json.resultData.records[1], { name: "Bob", age: "20" });

  const table = executeDeterministicTask(
    "转成表格：name=Alice, age=18; name=Bob, age=20",
    intent("format_convert", { targetFormat: "表格" }),
    plan,
    "zh",
  );
  assert.match(table.resultText, /\| name \| age \|/);
  assert.match(table.resultText, /\| Bob \| 20 \|/);
});

test("formatDeterministicExecution returns a prompt-ready execution block", async () => {
  const { executeDeterministicTask, formatDeterministicExecution } = await modulePromise;
  const execution = executeDeterministicTask("计算 1+2", intent("calculate"), basePlan, "zh");
  const formatted = formatDeterministicExecution(execution, "zh");

  assert.match(formatted, /确定性执行结果/);
  assert.match(formatted, /"tool": "calculator"/);
  assert.match(formatted, /结果：3/);
});

