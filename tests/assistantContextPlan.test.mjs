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
});

