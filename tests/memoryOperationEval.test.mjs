import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadContextPlanModule() {
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

const modulePromise = loadContextPlanModule();

const deterministicIntent = {
  type: "memory_operation",
  confidence: 0.9,
  executionMode: "deterministic",
  requiredTools: ["memory-planner", "memory-store"],
  entities: {},
  rationale: "test",
};

test("memory operation eval fixtures still parse expected actions", async () => {
  const { createContextPlan } = await modulePromise;
  const evalPayload = JSON.parse(await readFile(new URL("../examples/memory-operation-eval.json", import.meta.url), "utf8"));

  const rememberCase = evalPayload.cases.find((item) => item.id === "remember-project-fact");
  const forgetCase = evalPayload.cases.find((item) => item.id === "forget-multiple-targets");

  const rememberPlan = createContextPlan({
    question: rememberCase.input,
    locale: "zh",
    intent: deterministicIntent,
    sources: [],
    memories: [],
  });
  assert.equal(rememberPlan.memoryOperation.action, "remember");
  assert.equal(rememberPlan.memoryOperation.content, rememberCase.expectedPlan.content);

  const forgetPlan = createContextPlan({
    question: forgetCase.input,
    locale: "zh",
    intent: deterministicIntent,
    sources: [],
    memories: [],
  });
  assert.equal(forgetPlan.memoryOperation.action, "forget");
  assert.deepEqual(forgetPlan.memoryOperation.targets, forgetCase.expectedPlan.targets);
});
