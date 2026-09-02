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

  const percentExpression = executeDeterministicTask("计算 200 * 10%", intent("calculate"), basePlan, "zh");
  assert.equal(percentExpression.resultData.result, 20);

  const sum = executeDeterministicTask("合计 1, 2, 3", intent("calculate"), basePlan, "zh");
  assert.equal(sum.resultData.result, 6);

  const min = executeDeterministicTask("求最小值 4, -2, 8.5", intent("calculate"), basePlan, "zh");
  assert.equal(min.resultData.result, -2);

  const max = executeDeterministicTask("max 4, -2, 8.5", intent("calculate"), basePlan, "en");
  assert.equal(max.resultData.result, 8.5);

  const percentage = executeDeterministicTask("20 占 50 的百分比", intent("calculate"), basePlan, "zh");
  assert.equal(percentage.resultData.result, 40);
});

test("executeDeterministicTask returns calculation failures for invalid input", async () => {
  const { executeDeterministicTask } = await modulePromise;
  const execution = executeDeterministicTask("计算一下", intent("calculate"), basePlan, "zh");

  assert.equal(execution.handled, true);
  assert.equal(execution.tool, "calculator");
  assert.match(execution.error, /没有找到/);
});

test("executeDeterministicTask calculates dates, workdays, and timezone conversions", async () => {
  const { executeDeterministicTask } = await modulePromise;
  const plan = {
    ...basePlan,
    intentType: "date_time",
    requiredTools: ["date-calculator"],
    steps: [{ ...basePlan.steps[0], tool: "date-calculator" }],
  };

  const diff = executeDeterministicTask("2026-09-02 到 2026-09-12 日期差", intent("date_time"), plan, "zh");
  assert.equal(diff.tool, "date-calculator");
  assert.equal(diff.resultData.days, 10);

  const offset = executeDeterministicTask("2026-09-02 10天后", intent("date_time"), plan, "zh");
  assert.equal(offset.resultData.resultDate, "2026-09-12");

  const workdays = executeDeterministicTask("2026-09-07 到 2026-09-13 工作日", intent("date_time"), plan, "zh");
  assert.equal(workdays.resultData.businessDays, 5);

  const timezone = executeDeterministicTask("09:30 UTC 转北京时间", intent("date_time"), plan, "zh");
  assert.equal(timezone.resultData.resultTime, "17:30");
});

test("executeDeterministicTask returns date-time failures for missing dates", async () => {
  const { executeDeterministicTask } = await modulePromise;
  const plan = {
    ...basePlan,
    intentType: "date_time",
    requiredTools: ["date-calculator"],
    steps: [{ ...basePlan.steps[0], tool: "date-calculator" }],
  };
  const execution = executeDeterministicTask("算一下日期", intent("date_time"), plan, "zh");

  assert.equal(execution.handled, true);
  assert.equal(execution.tool, "date-calculator");
  assert.match(execution.error, /没有找到/);
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

test("executeDeterministicTask sorts text and records by field", async () => {
  const { executeDeterministicTask } = await modulePromise;
  const plan = {
    ...basePlan,
    intentType: "sort",
    requiredTools: ["sorter"],
    steps: [{ ...basePlan.steps[0], tool: "sorter" }],
  };

  const text = executeDeterministicTask("排序：张三, 李四, Alice2, Alice10", intent("sort"), plan, "zh");
  assert.deepEqual(text.resultData.sortedItems, ["Alice2", "Alice10", "李四", "张三"]);

  const records = executeDeterministicTask(
    "按 age 升序排序：name=Bob, age=20; name=Alice, age=18",
    intent("sort"),
    plan,
    "zh",
  );
  assert.deepEqual(records.resultData.sortedRecords.map((record) => record.name), ["Alice", "Bob"]);
});

test("executeDeterministicTask returns sorting failures for underspecified lists", async () => {
  const { executeDeterministicTask } = await modulePromise;
  const plan = {
    ...basePlan,
    intentType: "sort",
    requiredTools: ["sorter"],
    steps: [{ ...basePlan.steps[0], tool: "sorter" }],
  };
  const execution = executeDeterministicTask("排序：只有一个", intent("sort"), plan, "zh");

  assert.equal(execution.handled, true);
  assert.equal(execution.tool, "sorter");
  assert.match(execution.error, /至少两个/);
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

  const csv = executeDeterministicTask(
    "转成 CSV：| name | age |\n| --- | --- |\n| Alice | 18 |",
    intent("format_convert", { targetFormat: "csv" }),
    plan,
    "zh",
  );
  assert.match(csv.resultText, /name,age\nAlice,18/);

  const list = executeDeterministicTask(
    "转成列表：name,age\nAlice,18\nBob,20",
    intent("format_convert", { targetFormat: "列表" }),
    plan,
    "zh",
  );
  assert.match(list.resultText, /- name: Alice, age: 18/);
});

test("executeDeterministicTask returns format conversion failures for empty input", async () => {
  const { executeDeterministicTask } = await modulePromise;
  const plan = {
    ...basePlan,
    intentType: "format_convert",
    requiredTools: ["formatter"],
    steps: [{ ...basePlan.steps[0], tool: "formatter" }],
  };
  const execution = executeDeterministicTask("转成 JSON：", intent("format_convert", { targetFormat: "json" }), plan, "zh");

  assert.equal(execution.handled, true);
  assert.equal(execution.tool, "formatter");
  assert.match(execution.error, /没有找到/);
});

test("executeDeterministicTask calculates text statistics", async () => {
  const { executeDeterministicTask } = await modulePromise;
  const plan = {
    ...basePlan,
    intentType: "text_stats",
    requiredTools: ["text-statistics"],
    steps: [{ ...basePlan.steps[0], tool: "text-statistics" }],
  };

  const execution = executeDeterministicTask(
    "文本统计：apple apple banana\n研发 张三\n研发 李四\n设计 王五",
    intent("text_stats"),
    plan,
    "zh",
  );

  assert.equal(execution.tool, "text-statistics");
  assert.equal(execution.resultData.topFrequencies[0].value, "apple");
  assert.deepEqual(execution.resultData.duplicateItems.find((item) => item.value === "apple"), { value: "apple", count: 2 });
  assert.equal(execution.resultData.groupCounts["研发"], 2);
});

test("executeDeterministicTask returns text statistics failures for empty input", async () => {
  const { executeDeterministicTask } = await modulePromise;
  const plan = {
    ...basePlan,
    intentType: "text_stats",
    requiredTools: ["text-statistics"],
    steps: [{ ...basePlan.steps[0], tool: "text-statistics" }],
  };
  const execution = executeDeterministicTask("统计字数：", intent("text_stats"), plan, "zh");

  assert.equal(execution.handled, true);
  assert.equal(execution.tool, "text-statistics");
  assert.match(execution.error, /没有找到/);
});

test("formatDeterministicExecution returns a prompt-ready execution block", async () => {
  const { executeDeterministicTask, formatDeterministicExecution } = await modulePromise;
  const execution = executeDeterministicTask("计算 1+2", intent("calculate"), basePlan, "zh");
  const formatted = formatDeterministicExecution(execution, "zh");

  assert.match(formatted, /确定性执行结果/);
  assert.match(formatted, /"tool": "calculator"/);
  assert.match(formatted, /结果：3/);
});
